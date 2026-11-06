// Diagnose: Kurse mit Zuweisungsstatus 'keine Zuordnung' oder NULL-Zuweisungen.
// Liest NUR. Verbindet sich über DATABASE_URL aus .env.production (Docker-intern
// "kursplan-db:5432"), mit Fallback auf 127.0.0.1:5432/5433.
const fs = require('fs');
const path = require('path');
const { Client } = require('../app/node_modules/pg');

// --- .env.production parsen (nur für DATABASE_URL/Host) ---
function parseEnv(file) {
  const out = {};
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z0-9_]+)="?([^"]*)"?$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch {
    /* Datei nicht vorhanden – nutze Fallback */
  }
  return out;
}

const env = parseEnv(path.join(__dirname, '..', '.env.production'));
const urlMatch = (env.DATABASE_URL || '').match(
  /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\/(.+)$/
);

const KANDIDATEN = [];

if (urlMatch && urlMatch[3] !== 'kursplan-db') {
  KANDIDATEN.push({
    host: urlMatch[3],
    port: Number(urlMatch[4] || 5433 || 5432),
    database: urlMatch[5],
    user: urlMatch[1],
    password: urlMatch[2],
    label: `DATABASE_URL direkt (${urlMatch[3]}:${urlMatch[4] || '5433'})`,
  });
} else if (urlMatch) {
  // Docker-interner Host 'kursplan-db': von der lokalen Maschine nicht
  // auflösbar – probiere die üblichen lokalen Wege zum getunnelten Port.
  KANDIDATEN.push({
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 5433),
    database: env.DB_NAME || 'kursplan',
    user: env.DB_USER || 'kursplan_user',
    password: env.DB_PASSWORD || urlMatch[2],
    label: `.env-Fallback (${env.DB_HOST || '127.0.0.1'}:${env.DB_PORT || 5433})`,
  });
}
KANDIDATEN.push(
  {
    host: '127.0.0.1', port: 5433, database: 'kursplan',
    user: 'kursplan_user', password: 'MeinAdmin2026',
    label: 'Legacy 127.0.0.1:5433',
  },
  {
    host: '127.0.0.1', port: 5432, database: 'kursplan',
    user: 'kursplan_user', password: 'MeinAdmin2026',
    label: 'Legacy 127.0.0.1:5432',
  }
);

async function abfrage(client, sql, params) {
  try {
    return await client.query(sql, params);
  } catch (e) {
    return { error: e.message, rows: [] };
  }
}

async function main() {
  for (const k of KANDIDATEN) {
    const client = new Client({
      host: k.host,
      port: k.port,
      database: k.database,
      user: k.user,
      password: k.password,
      connectionTimeoutMillis: 4000,
      statement_timeout: 15000,
    });
    try {
      await client.connect();
      console.log(`[OK] Verbunden via ${k.label}`);
      await lauf(client);
      await client.end();
      return;
    } catch (e) {
      console.log(`[--] ${k.label}: ${e.code || e.message}`);
      try { await client.end(); } catch {}
    }
  }
  console.error('FEHLER: Keine PostgreSQL-Verbindung herstellbar.');
  console.error('Hinweis: Die Produktions-DB läuft Docker-intern ("kursplan-db", Port 5432).');
  console.error('In dieser lokalen Umgebung ist weder der Port getunnelt noch docker verfügbar.');
  process.exit(1);
}

async function lauf(client) {
  // 1) Statusverteilung über alle Zuweisungen
  const v = await abfrage(client, `
    SELECT status, count(*) AS anzahl
    FROM public.trainer_zuweisung
    GROUP BY status
    ORDER BY anzahl DESC`);
  console.log('\n=== Statusverteilung public.trainer_zuweisung ===');
  if (v.error) console.log('  FEHLER:', v.error);
  for (const r of v.rows) console.log(`  ${r.status ?? 'NULL'} -> ${r.anzahl}`);

  // 2) Letzte betroffene Kurse (Status 'keine Zuordnung' oder NULL-status)
  const b = await abfrage(client, `
    SELECT tz.date_id,
           od.offer_id,
           o.offer_number AS kurs_code,
           o.name         AS kurs_titel,
           o.status       AS edoobox_status,
           o.is_deleted   AS offer_geloescht,
           od.is_deleted  AS termin_geloescht,
           tz.trainer_id,
           t.kuerzel      AS trainer_kuerzel,
           t.edoobox_admin_id AS trainer_edoo_admin_id,
           tz.status      AS zuweisung_status,
           tz.updated_at
    FROM public.trainer_zuweisung tz
    LEFT JOIN edoobox_raw.offer_date od ON od.date_id = tz.date_id
    LEFT JOIN edoobox_raw.offer o      ON o.offer_id = od.offer_id
    LEFT JOIN public.trainer t         ON t.id = tz.trainer_id
    WHERE tz.status = 'keine Zuordnung'
       OR tz.status IS NULL
    ORDER BY tz.updated_at DESC NULLS LAST, tz.date_id DESC
    LIMIT 10`);
  console.log('\n=== Betroffene Kurse (Status "keine Zuordnung" / NULL) ===');
  if (b.error) console.log('  FEHLER:', b.error);
  if (b.rows.length === 0) console.log('  (keine gefunden)');
  for (const r of b.rows) {
    console.log(
      `  date_id=${r.date_id} | offer_id=${r.offer_id} | code=${r.kurs_code} | ` +
      `titel=${r.kurs_titel} | edoo_status=${r.edoobox_status} | ` +
      `geloescht_o=${r.offer_geloescht}/t=${r.termin_geloescht} | ` +
      `trainer_id=${r.trainer_id} (${r.trainer_kuerzel}, admin=${r.trainer_edoo_admin_id}) | ` +
      `status=${r.zuweisung_status} | updated=${r.updated_at}`
    );
  }

  // 3) Termine mit edoobox-Leiter + Trainermapping-Check (letzte 10)
  //    Hinweis: edoobox_raw.date_leader hat NUR date_id/admin_id/last_synced_at
  //    (kein is_deleted), edoobox_raw.trainer_admin hat keine Namens-Spalten.
  const k = await abfrage(client, `
    SELECT od.date_id,
           od.offer_id,
           o.offer_number AS kurs_code,
           o.name         AS kurs_titel,
           dl.admin_id    AS edoo_admin_id,
           ta.shortcut    AS edoo_leiter_kuerzel,
           t.id           AS lokaler_trainer_id,
           t.kuerzel      AS lokaler_trainer_kuerzel,
           t.edoobox_admin_id AS lokale_edoo_admin_id
    FROM edoobox_raw.date_leader dl
    JOIN edoobox_raw.offer_date od ON od.date_id = dl.date_id
    JOIN edoobox_raw.offer o      ON o.offer_id = od.offer_id
    LEFT JOIN edoobox_raw.trainer_admin ta ON ta.admin_id = dl.admin_id
    LEFT JOIN public.trainer t   ON t.edoobox_admin_id = dl.admin_id
    WHERE od.is_deleted IS NOT TRUE
      AND o.is_deleted IS NOT TRUE
      AND (od.date_start >= NOW() - INTERVAL '90 days')
    ORDER BY od.date_start DESC
    LIMIT 10`);
  console.log('\n=== Termine mit edoobox-Leiter + Trainermapping-Check (letzte 10) ===');
  if (k.error) console.log('  FEHLER:', k.error);
  if (k.rows.length === 0) console.log('  (keine gefunden)');
  for (const r of k.rows) {
    console.log(
      `  date_id=${r.date_id} | code=${r.kurs_code} | titel=${r.kurs_titel} | ` +
      `edoo_admin_id=${r.edoo_admin_id} (Kürzel: ${r.edoo_leiter_kuerzel}) | ` +
      `LOKAL: id=${r.lokaler_trainer_id} kuerzel=${r.lokaler_trainer_kuerzel} ` +
      `edoo_admin_id=${r.lokale_edoo_admin_id} ` +
      `=> ${r.lokaler_trainer_id !== null ? 'MATCH' : 'KEIN LOCAL MATCH (!)'}`
    );
  }
}

main().catch((err) => {
  console.error('Diagnose fehlgeschlagen:', err.message);
  process.exit(1);
});
