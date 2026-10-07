// Bereinigung: Veraltete Trainer-Zuweisungen entfernen.
//
// Betroffene Termine (Soll-Zustand):
//   1) 15.10.2026 "PowerPoint Grundlagen (kompakt)"
//        entfernen: id=143 (DH)  |  Soll bleibt: id=96  (FW)
//   2) 21.10.2026 "Excel: Daten einlesen mit Power Query"
//        entfernen: id=117 (DH)  |  Soll bleibt: id=118 (FW)
//   3) 27.11.2026 "MS Project Aufbau"
//        entfernen: id=127 (FK)  |  Soll bleibt: id=128 (MS)
//
// Hinweis: public.trainer_zuweisung ist eine LOKALE App-Tabelle (kein
// edoobox_raw-Spiegel) und besitzt keine is_deleted-Spalte. Die strikte
// Soft-Delete-Regel gilt ausschliesslich fuer das Schema edoobox_raw.
// Daher ist hier ein physisches DELETE der Altbestaende korrekt.
//
// Direkter PostgreSQL-Zugriff (Port 5433), Timeout gesamt < 10 s.
const { Client } = require('../app/node_modules/pg');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
  connectionTimeoutMillis: 5000,
  statement_timeout: 8000,
};

const ZU_LOESCHEN = [143, 117, 127];

// Erwartete verbleibende Zuweisungs-IDs je betroffenem Termin.
const SOLL_IDS = [96, 118, 128];

async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  try {
    // 1) date_ids der betroffenen Termine ermitteln (aus den Altbestaenden).
    const dateResult = await client.query(
      `SELECT DISTINCT date_id
       FROM public.trainer_zuweisung
       WHERE id = ANY($1::int[])`,
      [ZU_LOESCHEN]
    );
    const dateIds = dateResult.rows.map((r) => r.date_id);
    if (dateIds.length === 0) {
      console.log('Keine der zu loeschenden Zuweisungen gefunden – nichts zu tun.');
      return;
    }
    console.log(`Betroffene Termine (date_id): ${dateIds.join(', ')}`);

    // 2) Vorher-Zustand anzeigen.
    const vorher = await client.query(
      `SELECT tz.id, tz.date_id, t.kuerzel, tz.status, tz.created_at
       FROM public.trainer_zuweisung tz
       LEFT JOIN public.trainer t ON t.id = tz.trainer_id
       WHERE tz.date_id = ANY($1::text[])
       ORDER BY tz.date_id, tz.id`,
      [dateIds]
    );
    console.log('\nVorher (alle Zuweisungen der betroffenen Termine):');
    for (const z of vorher.rows) {
      console.log(`  id=${z.id} date_id=${z.date_id} kuerzel=${z.kuerzel} status=${z.status} created_at=${z.created_at}`);
    }

    // 3) Altbestaende physisch entfernen.
    const del = await client.query(
      `DELETE FROM public.trainer_zuweisung
       WHERE id = ANY($1::int[])
       RETURNING id, date_id`,
      [ZU_LOESCHEN]
    );
    console.log(`\nGeloescht: ${del.rows.length} Zuweisung(en): ${del.rows.map((r) => r.id).join(', ')}`);

    // 4) Nachher-Verifikation.
    const nachher = await client.query(
      `SELECT tz.id, tz.date_id, t.kuerzel, tz.status
       FROM public.trainer_zuweisung tz
       LEFT JOIN public.trainer t ON t.id = tz.trainer_id
       WHERE tz.date_id = ANY($1::text[])
       ORDER BY tz.date_id, tz.id`,
      [dateIds]
    );
    console.log('\nNachher (verbleibende Zuweisungen):');
    for (const z of nachher.rows) {
      console.log(`  id=${z.id} date_id=${z.date_id} kuerzel=${z.kuerzel} status=${z.status}`);
    }

    // 5) Soll-Abgleich: exakt die gewuenschten Zuweisungen muessen uebrig sein.
    const verbleibendeIds = nachher.rows.map((r) => r.id);
    const sollErfuellt =
      verbleibendeIds.length === SOLL_IDS.length &&
      SOLL_IDS.every((id) => verbleibendeIds.includes(id));
    console.log(`\nSoll-Zustand (${SOLL_IDS.join(', ')}) erfuellt: ${sollErfuellt ? 'JA' : 'NEIN'}`);
    if (!sollErfuellt) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});