// scripts/cleanup_ghost_trainer.cjs
// ---------------------------------------------------------------------------
// Test-Bereinigung verwaister Trainer für die Kurse #out-gl-1026 und
// #ppt-gl-komp-1026 (PostgreSQL Port 5433).
//
// Ziel: Beantworten, was die Kursplan-App (/api/termine) anzeigt, wenn
//   a) nur der Eintrag aus edoobox_raw.date_leader entfernt wird
//      (greift dann public.trainer_zuweisung als Fallback?)
//   b) sowohl date_leader als auch trainer_zuweisung entfernt werden
//      (wird der Kurs sofort trainerlos "–"?)
//
// Vorgehen: Echte DB-Änderung mit SOFORTIGER Wiederherstellung. Die API läuft
// in einem separaten Prozess mit eigener DB-Verbindung, daher muss die
// Bereinigung committet werden, damit /api/termine den Zustand real sieht.
// Vor jedem Szenario werden die betroffenen Zeilen gesichert und danach exakt
// wiederhergestellt (kein dauerhafter Datenverlust).
//
// Hinweis: edoobox_raw.date_leader besitzt KEINE is_deleted-Spalte
// (PK date_id+admin_id, FK auf offer_date mit ON DELETE CASCADE). Ein
// "Entfernen" ist daher nur per DELETE möglich – die Zeilen werden vorher
// gesichert und nach jedem Szenario wieder eingefügt.
//
// Sicherheitsvorgaben: Timeouts überall (DB 5000ms, API 5000ms), keine neuen
// Dependencies (nutzt pg aus app/node_modules).
// ---------------------------------------------------------------------------
const { Client } = require('../app/node_modules/pg');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
};

const API_BASE = 'http://localhost:3000';
const SUCHBEGRIFFE = ['%out-gl-1026%', '%ppt-gl-komp-1026%'];

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

/** Wert für pg-Parameter normalisieren (Objekte -> JSON-String, Date bleibt). */
function normWert(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return v;
}

/** Kurse aus /api/termine laden und auf die beiden betroffenen Kurse filtern. */
async function apiTermine() {
  const res = await fetch(`${API_BASE}/api/termine`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`API /api/termine lieferte HTTP ${res.status}`);
  }
  const alle = await res.json();
  return alle.filter(
    (k) =>
      k.kursnr &&
      (k.kursnr.includes('out-gl-1026') || k.kursnr.includes('ppt-gl-komp-1026'))
  );
}

/** Trainer-Anzeige eines Kurses kompakt ausgeben. */
function zeigeKurse(kurse) {
  if (kurse.length === 0) {
    console.log('  (keine Kurse in der API-Antwort gefunden)');
    return;
  }
  for (const k of kurse) {
    const trainer =
      k.zuweisungen.length === 0
        ? '– (trainerlos)'
        : k.zuweisungen
            .map(
              (z) =>
                `${z.trainer ? `${z.trainer.vorname} ${z.trainer.nachname} (${z.trainer.kuerzel})` : '?'} [status=${z.status}, quelle=${z.quelle}]`
            )
            .join('; ');
    console.log(
      `  Kurs ${k.kursnr} | ${k.offer_name} | Termine: ${k.termine.length} | Trainer: ${trainer}`
    );
  }
}

/** Spaltenliste einer Tabelle (für dynamisches INSERT). */
async function spalten(client, schema, tabelle) {
  const r = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, tabelle]
  );
  return r.rows.map((x) => x.column_name);
}

// ---------------------------------------------------------------------------
// Backup / Restore
// ---------------------------------------------------------------------------

async function backupDateLeader(client, dateIds) {
  const r = await client.query(
    `SELECT date_id, admin_id, last_synced_at
     FROM edoobox_raw.date_leader
     WHERE date_id = ANY($1::text[])
     ORDER BY date_id, admin_id`,
    [dateIds]
  );
  return r.rows;
}

async function backupZuweisung(client, dateIds) {
  const r = await client.query(
    `SELECT *
     FROM public.trainer_zuweisung
     WHERE date_id = ANY($1::text[])
     ORDER BY id`,
    [dateIds]
  );
  return r.rows;
}

async function restoreDateLeader(client, dateIds, backup) {
  await client.query(
    `DELETE FROM edoobox_raw.date_leader WHERE date_id = ANY($1::text[])`,
    [dateIds]
  );
  for (const z of backup) {
    await client.query(
      `INSERT INTO edoobox_raw.date_leader (date_id, admin_id, last_synced_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (date_id, admin_id)
       DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at`,
      [z.date_id, z.admin_id, z.last_synced_at]
    );
  }
}

async function restoreZuweisung(client, dateIds, backup, cols) {
  await client.query(
    `DELETE FROM public.trainer_zuweisung WHERE date_id = ANY($1::text[])`,
    [dateIds]
  );
  if (backup.length === 0) return;
  const spaltenSql = cols.map((c) => `"${c}"`).join(', ');
  const platzhalter = cols.map((_, i) => `$${i + 1}`).join(', ');
  for (const z of backup) {
    const werte = cols.map((c) => normWert(z[c]));
    await client.query(
      `INSERT INTO public.trainer_zuweisung (${spaltenSql}) VALUES (${platzhalter})`,
      werte
    );
  }
}

// ---------------------------------------------------------------------------
// Hauptablauf
// ---------------------------------------------------------------------------

async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();

  try {
    // ---- Phase 0: Ist-Zustand erfassen ----
    const terminResult = await client.query(
      `SELECT od.date_id,
              o.offer_id,
              o.offer_number,
              o.name,
              to_char(od.date_start AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') AS date_start
       FROM edoobox_raw.offer_date od
       JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
       WHERE o.offer_number ILIKE ANY($1::text[])
         AND od.is_deleted IS NOT TRUE
         AND o.is_deleted IS NOT TRUE
       ORDER BY o.offer_number, od.date_start`,
      [SUCHBEGRIFFE]
    );

    if (terminResult.rows.length === 0) {
      console.log('Keine Termine zu den Suchbegriffen gefunden.');
      return;
    }

    const dateIds = terminResult.rows.map((r) => r.date_id);
    console.log('='.repeat(90));
    console.log('PHASE 0 – Ist-Zustand');
    console.log('='.repeat(90));
    for (const row of terminResult.rows) {
      console.log(
        `  Termin ${row.date_id} | Kurs ${row.offer_number} | ${row.name} | Start: ${row.date_start}`
      );
    }

    const backupDL = await backupDateLeader(client, dateIds);
    const backupTZ = await backupZuweisung(client, dateIds);
    const tzSpalten = await spalten(client, 'public', 'trainer_zuweisung');

    console.log(`\n  date_leader-Zeilen (${backupDL.length}):`);
    for (const l of backupDL) {
      console.log(
        `    date_id=${l.date_id} | admin_id=${l.admin_id} | last_synced_at=${l.last_synced_at}`
      );
    }
    console.log(`  trainer_zuweisung-Zeilen (${backupTZ.length}):`);
    for (const z of backupTZ) {
      console.log(
        `    id=${z.id} | date_id=${z.date_id} | trainer_id=${z.trainer_id} | status=${z.status}`
      );
    }

    // Baseline: Was zeigt die App aktuell?
    console.log('\n  API-Baseline (/api/termine, aktueller Zustand):');
    zeigeKurse(await apiTermine());

    // ---- Phase 1: Szenario a) nur date_leader entfernen ----
    console.log('\n' + '='.repeat(90));
    console.log('PHASE 1 – Szenario a) date_leader entfernt, trainer_zuweisung bleibt');
    console.log('='.repeat(90));
    const delA = await client.query(
      `DELETE FROM edoobox_raw.date_leader WHERE date_id = ANY($1::text[])`,
      [dateIds]
    );
    console.log(`  DELETE date_leader: ${delA.rowCount} Zeile(n) entfernt (committed).`);
    console.log('  API-Antwort nach Entfernen von date_leader:');
    zeigeKurse(await apiTermine());

    await restoreDateLeader(client, dateIds, backupDL);
    console.log(`  -> date_leader wiederhergestellt (${backupDL.length} Zeile(n)).`);

    // ---- Phase 2: Szenario b) date_leader + trainer_zuweisung entfernen ----
    console.log('\n' + '='.repeat(90));
    console.log('PHASE 2 – Szenario b) date_leader UND trainer_zuweisung entfernt');
    console.log('='.repeat(90));
    const delB1 = await client.query(
      `DELETE FROM edoobox_raw.date_leader WHERE date_id = ANY($1::text[])`,
      [dateIds]
    );
    const delB2 = await client.query(
      `DELETE FROM public.trainer_zuweisung WHERE date_id = ANY($1::text[])`,
      [dateIds]
    );
    console.log(
      `  DELETE date_leader: ${delB1.rowCount} Zeile(n), DELETE trainer_zuweisung: ${delB2.rowCount} Zeile(n) (committed).`
    );
    console.log('  API-Antwort nach Entfernen beider Tabellen:');
    zeigeKurse(await apiTermine());

    await restoreZuweisung(client, dateIds, backupTZ, tzSpalten);
    await restoreDateLeader(client, dateIds, backupDL);
    console.log(
      `  -> trainer_zuweisung (${backupTZ.length}) und date_leader (${backupDL.length}) wiederhergestellt.`
    );

    // ---- Phase 3: Verifikation ----
    console.log('\n' + '='.repeat(90));
    console.log('PHASE 3 – Verifikation (Originalzustand wiederhergestellt?)');
    console.log('='.repeat(90));
    const jetztDL = await backupDateLeader(client, dateIds);
    const jetztTZ = await backupZuweisung(client, dateIds);

    const dlGleich =
      JSON.stringify(jetztDL.map((r) => [r.date_id, r.admin_id, String(r.last_synced_at)])) ===
      JSON.stringify(backupDL.map((r) => [r.date_id, r.admin_id, String(r.last_synced_at)]));
    const tzGleich =
      JSON.stringify(jetztTZ.map((r) => [r.id, r.date_id, r.trainer_id, r.status])) ===
      JSON.stringify(backupTZ.map((r) => [r.id, r.date_id, r.trainer_id, r.status]));

    console.log(`  date_leader identisch: ${dlGleich ? 'JA' : 'NEIN'}`);
    console.log(`  trainer_zuweisung identisch: ${tzGleich ? 'JA' : 'NEIN'}`);
    if (dlGleich && tzGleich) {
      console.log('  => Originalzustand vollständig wiederhergestellt.');
    } else {
      console.log('  => ACHTUNG: Abweichung! Bitte manuell prüfen.');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});