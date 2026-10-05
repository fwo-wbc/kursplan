// Verifikation der Zeilen-Hervorhebung (05.10.2026):
// 1) Parallele Kurse am 05.10.2026 auflisten
// 2) Abgesagte (Status '5') / geschlossene (Status '3') Kurse im Zeitfenster
//    zaehlen - die API mappt '3'->Geschlossen, '5'->Abgesagt.
// Nutzt pg aus app/node_modules (keine neue Dependency).
const { Pool } = require('../app/node_modules/pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
});

(async () => {
  try {
    const r1 = await pool.query(`
      SELECT o.offer_number AS kursnr,
             o.name AS offer_name,
             o.status,
             to_char(od.date_start AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS startzeit
      FROM edoobox_raw.offer_date od
      JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
      WHERE od.is_deleted IS NOT TRUE
        AND o.is_deleted IS NOT TRUE
        AND (od.date_start AT TIME ZONE 'Europe/Berlin')::date = DATE '2026-10-05'
      ORDER BY od.date_start
    `);
    console.log('=== Kurse am 05.10.2026 ===');
    for (const row of r1.rows) {
      console.log(`${row.startzeit}  ${row.kursnr}  ${row.offer_name}  [${row.status}]`);
    }
    console.log(`Anzahl: ${r1.rows.length}`);

    const r2 = await pool.query(`
      SELECT o.status,
             COUNT(*) AS anzahl
      FROM edoobox_raw.offer_date od
      JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
      WHERE od.is_deleted IS NOT TRUE
        AND o.is_deleted IS NOT TRUE
        AND od.date_start >= NOW() - INTERVAL '4 weeks'
        AND od.date_start <= NOW() + INTERVAL '6 weeks'
        AND o.status IN ('3', '5')
      GROUP BY o.status
      ORDER BY o.status
    `);
    console.log('=== Abgesagt/Geschlossen im Zeitfenster (4 Wo. zurueck bis 6 Wo. voraus) ===');
    for (const row of r2.rows) {
      console.log(`${row.status}: ${row.anzahl}`);
    }
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});