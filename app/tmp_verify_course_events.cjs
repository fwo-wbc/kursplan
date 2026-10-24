// Temporäre Verifikation: course_events nach Sandbox-Abschluss + Idempotenz.
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
      `SELECT ce.id, ce.course_id, ce.topic_id, ct.name AS topic_name,
              ce.trainer_id, ce.start_time::text AS start_time
         FROM public.course_events ce
         LEFT JOIN public.course_topics ct ON ct.id = ce.topic_id
        WHERE ce.course_id IN (SELECT id FROM public.course_modules)
        ORDER BY ce.id`
    );
    console.log('course_events (Sandbox-Übernahme):');
    for (const row of res.rows) {
      console.log(`  id=${row.id} course_id=${row.course_id} topic="${row.topic_name}" trainer=${row.trainer_id} start=${row.start_time}`);
    }
    if (res.rows.length === 0) {
      console.log('  (keine Einträge)');
    }
  } catch (err) {
    console.error('FEHLER:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();