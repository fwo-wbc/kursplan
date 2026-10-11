// =============================================================================
// Import-Skript: Trainerkosten aus CSV (trainer_kosten.csv) nach PostgreSQL
// Ablauf:
//   1. Migration trainer_kosten_migration.sql ausfuehren
//   2. CSV parsen (Semikolon/Komma, deutsches Zahlenformat) -> staging_trainer_kosten
//   3. Vorab-Pruefung: Trainer-Kuerzel + Kurstermine (offer_date), Differenz-Check
//   4. Upsert in public.trainer_kosten (ON CONFLICT date_id+admin_id), ist_standard = FALSE
//   5. Finale Anzahl + Aufraeumen
// =============================================================================
const fs = require('fs');
const path = require('path');
const { Pool } = require(path.join(__dirname, '..', 'app', 'node_modules', 'pg'));

// --- .env.local manuell laden (dotenv ist nicht installiert) -----------------
const envPath = path.join(__dirname, '..', 'app', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || '',
});

// Migrations-Pool: CREATE-Rechte im Schema public benoetigt -> kursplan_user
// (n8n_writer aus .env.local hat nur DML-Rechte, siehe Migration-Kopfzeile)
const migrationPool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_MIGRATION_USER || 'kursplan_user',
  password: process.env.DB_MIGRATION_PASSWORD || process.env.DB_PASSWORD || 'MeinAdmin2026',
});

// --- Hilfsfunktionen ----------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');

/** "Fr, 09.01.26" -> '2026-01-09' (deutsches Datum, 2- oder 4-stellige Jahreszahl) */
function parseDatum(s) {
  const m = String(s).match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  let jahr = parseInt(m[3], 10);
  if (jahr < 100) jahr += jahr < 70 ? 2000 : 1900;
  return `${jahr}-${pad(m[2])}-${pad(m[1])}`;
}

/** " 370,00 " / "1.234,56" -> 370.00 / 1234.56 (deutsches Zahlenformat) */
function parseBetrag(raw) {
  let s = String(raw).trim().replace(/\u00A0/g, '').replace(/ /g, '');
  if (s === '') return null;
  if (s.includes(',')) {
    // deutsches Format: Tausender-Punkte entfernen, Komma -> Dezimalpunkt
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

/** CSV parsen: BOM entfernen, Trennzeichen erkennen (Semikolon bevorzugt), Zeilen aufteilen */
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const header = lines[0].split(';');
  const sep = header.length >= 4 ? ';' : ',';
  const cols = lines[0].split(sep).map((c) => c.trim().toLowerCase());
  const idx = {
    kursnr: cols.indexOf('kursnr'),
    kursdatum: cols.indexOf('kursdatum'),
    kuerzel: cols.indexOf('trainer_kuerzel'),
    betrag: cols.indexOf('betrag'),
  };
  if (idx.kursnr < 0 || idx.kursdatum < 0 || idx.kuerzel < 0 || idx.betrag < 0) {
    throw new Error(`CSV-Spalten nicht gefunden. Header: ${lines[0]}`);
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(sep);
    rows.push({
      kursnr: (c[idx.kursnr] || '').trim(),
      kursdatum: (c[idx.kursdatum] || '').trim(),
      kuerzel: (c[idx.kuerzel] || '').trim(),
      betragRaw: (c[idx.betrag] || '').trim(),
    });
  }
  return rows;
}

// --- Hauptablauf ---------------------------------------------------------------
async function main() {
  const root = path.join(__dirname, '..');

  // ===========================================================================
  // 1. Migration ausfuehren
  // ===========================================================================
  console.log('=== SCHRITT 1: Migration ===');
  const sql = fs.readFileSync(path.join(root, 'trainer_kosten_migration.sql'), 'utf8');
  try {
    await migrationPool.query(sql);
    console.log('  Migration erfolgreich ausgefuehrt (Tabellen trainer_kosten + staging_trainer_kosten).');
  } catch (e) {
    // Tabellen evtl. schon vorhanden -> pruefen, ob GRANT das Problem ist
    const t1 = await pool.query(`SELECT to_regclass('public.trainer_kosten') AS t`);
    const t2 = await pool.query(`SELECT to_regclass('public.staging_trainer_kosten') AS t`);
    if (t1.rows[0].t && t2.rows[0].t) {
      console.log(`  Warnung: Tabellen existieren bereits, GRANT-Statement fehlgeschlagen: ${e.message}`);
    } else {
      throw new Error(`Migration fehlgeschlagen: ${e.message}`);
    }
  }

  // ===========================================================================
  // 2. CSV parsen + in Staging laden
  // ===========================================================================
  console.log('\n=== SCHRITT 2: CSV -> Staging ===');
  const csvText = fs.readFileSync(path.join(root, 'app', 'trainer_kosten.csv'), 'utf8');
  const rows = parseCsv(csvText);
  console.log(`  CSV gelesen: ${rows.length} Datensaetze`);

  await pool.query('TRUNCATE public.staging_trainer_kosten;');
  for (const r of rows) {
    await pool.query(
      `INSERT INTO public.staging_trainer_kosten (kursnr, kursdatum, trainer_kuerzel, betrag)
       VALUES ($1, $2, $3, $4)`,
      [r.kursnr, r.kursdatum, r.kuerzel, r.betragRaw]
    );
  }
  console.log(`  Staging gefuellt: ${rows.length} Zeilen (TRUNCATE vorab).`);

  // ===========================================================================
  // 3. Vorab-Pruefung
  // ===========================================================================
  console.log('\n=== SCHRITT 3: Vorab-Pruefung ===');

  // 3a. Trainer-Kuerzel (auch inaktive beruecksichtigen)
  const trainerRes = await pool.query(`SELECT kuerzel, edoobox_admin_id FROM public.trainer`);
  const kuerzelMap = new Map(trainerRes.rows.map((r) => [r.kuerzel, r.edoobox_admin_id]));
  const fehlendeKuerzel = [...new Set(rows.map((r) => r.kuerzel))].filter((k) => !kuerzelMap.has(k));
  console.log(`  Trainer-Kuerzel: ${kuerzelMap.size} vorhanden (inkl. inaktiver).`);
  if (fehlendeKuerzel.length > 0) {
    console.log(`  FEHLENDE Kuerzel (${fehlendeKuerzel.length}): ${fehlendeKuerzel.join(', ')}`);
  } else {
    console.log('  Alle Kuerzel vorhanden.');
  }

  // 3b. Kurstermine in edoobox_raw.offer_date finden (offer_number + Datum)
  const zuordnung = []; // { row, date_id, admin_id, mehrdeutig }
  const nichtGefunden = [];
  for (const r of rows) {
    const datum = parseDatum(r.kursdatum);
    if (!datum) { nichtGefunden.push({ kursnr: r.kursnr, grund: `Datum unlesbar: "${r.kursdatum}"` }); continue; }
    const res = await pool.query(
      `SELECT od.date_id, od.date_start
       FROM edoobox_raw.offer_date od
       JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
       WHERE o.offer_number = $1
         AND (od.date_start AT TIME ZONE 'Europe/Berlin')::date = $2
         AND od.is_deleted IS NOT TRUE
         AND o.is_deleted IS NOT TRUE
       ORDER BY od.date_start`,
      [r.kursnr, datum]
    );
    if (res.rows.length === 0) {
      nichtGefunden.push({ kursnr: r.kursnr, grund: `kein Termin am ${datum}` });
    } else {
      zuordnung.push({
        row: r,
        date_id: res.rows[0].date_id,
        admin_id: kuerzelMap.get(r.kuerzel),
        mehrdeutig: res.rows.length > 1,
        treffer: res.rows.length,
      });
    }
  }
  console.log(`  Kurstermine: ${zuordnung.length} gefunden, ${nichtGefunden.length} nicht gefunden.`);
  for (const n of nichtGefunden) console.log(`    - ${n.kursnr}: ${n.grund}`);
  const mehrdeutig = zuordnung.filter((z) => z.mehrdeutig);
  if (mehrdeutig.length > 0) {
    console.log(`  Warnung: ${mehrdeutig.length} Zeile(n) mit mehreren Terminen am selben Tag (erster Treffer genommen):`);
    for (const z of mehrdeutig) console.log(`    - ${z.row.kursnr} am ${z.row.kursdatum} (${z.treffer} Treffer)`);
  }

  // 3c. Differenz-Check: neu / identisch / abweichend
  const importierbar = zuordnung.filter((z) => z.admin_id);
  let neu = 0, identisch = 0, abweichend = 0;
  const abweichungen = [];
  for (const z of importierbar) {
    const betrag = parseBetrag(z.row.betragRaw);
    const res = await pool.query(
      `SELECT betrag FROM public.trainer_kosten WHERE date_id = $1 AND admin_id = $2`,
      [z.date_id, z.admin_id]
    );
    if (res.rows.length === 0) {
      neu++;
    } else if (parseFloat(res.rows[0].betrag) === betrag) {
      identisch++;
    } else {
      abweichend++;
      abweichungen.push({ kursnr: z.row.kursnr, kuerzel: z.row.kuerzel, alt: res.rows[0].betrag, neu: betrag });
    }
  }
  console.log(`\n  Differenz-Check (${importierbar.length} importierbare Zeilen):`);
  console.log(`    NEU:        ${neu}`);
  console.log(`    IDENTISCH:  ${identisch}`);
  console.log(`    ABWEICHEND: ${abweichend}`);
  for (const a of abweichungen) {
    console.log(`      - ${a.kursnr} / ${a.kuerzel}: ${a.alt} -> ${a.neu}`);
  }

  // ===========================================================================
  // 4. Upsert
  // ===========================================================================
  console.log('\n=== SCHRITT 4: Upsert ===');
  let inserted = 0, updated = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const z of importierbar) {
      const betrag = parseBetrag(z.row.betragRaw);
      const datum = parseDatum(z.row.kursdatum);
      const res = await client.query(
        `INSERT INTO public.trainer_kosten
           (admin_id, date_id, kursnr, leistungsdatum, betrag, kostenart, ist_standard, bemerkung, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'kurs', FALSE, $6, NOW())
         ON CONFLICT (date_id, admin_id) DO UPDATE SET
           kursnr = EXCLUDED.kursnr,
           leistungsdatum = EXCLUDED.leistungsdatum,
           betrag = EXCLUDED.betrag,
           kostenart = EXCLUDED.kostenart,
           ist_standard = FALSE,
           bemerkung = EXCLUDED.bemerkung,
           updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [z.admin_id, z.date_id, z.row.kursnr, datum, betrag, `Import ${new Date().toISOString().slice(0, 10)}`]
      );
      if (res.rows.length > 0 && res.rows[0].inserted) inserted++;
      else updated++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  console.log(`  Upsert abgeschlossen: ${importierbar.length} Zeilen verarbeitet.`);

  // ===========================================================================
  // 5. Finale Anzahl
  // ===========================================================================
  console.log('\n=== SCHRITT 5: Ergebnis ===');
  const cnt = await pool.query(`SELECT COUNT(*) AS n FROM public.trainer_kosten`);
  const cntStaging = await pool.query(`SELECT COUNT(*) AS n FROM public.staging_trainer_kosten`);
  console.log(`  Gesamt in public.trainer_kosten: ${cnt.rows[0].n}`);
  console.log(`  Staging (verbleibend): ${cntStaging.rows[0].n}`);
  console.log(`  Nicht importiert (fehlendes Kuerzel/Termin): ${rows.length - importierbar.length}`);
  console.log('\nFERTIG');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(`\nABBRUCH: ${e.message}`); process.exit(1); });