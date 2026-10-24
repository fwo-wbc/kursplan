// Temporäre Bereinigung: Duplikate in course_events entfernen, die durch den
// Zeitzonen-Bug (UTC-Datum statt Berliner Datum) beim Abschluss entstanden.
// Es bleibt je (course_id, Berliner Datum) der älteste Eintrag erhalten.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

(async () => {
  try {
    const res = await pool.query(
      `DELETE FROM public.course_events ce
        USING (
          SELECT course_id,
                 (start_time AT TIME ZONE 'Europe/Berlin')::date AS berlin_datum,
                 MIN(id) AS behalten
            FROM public.course_events
           WHERE course_id IN (SELECT id FROM public.course_modules)
           GROUP BY course_id, (start_time AT TIME ZONE 'Europe/Berlin')::date
        ) dupe
        WHERE ce.course_id = dupe.course_id
          AND (ce.start_time AT TIME ZONE 'Europe/Berlin')::date = dupe.berlin_datum
          AND ce.id <> dupe.behalten
        RETURNING ce.id`
    );
    console.log(`Bereinigt: ${res.rowCount} Duplikat(e) entfernt.`);
  } catch (err) {
    console.error('FEHLER:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();