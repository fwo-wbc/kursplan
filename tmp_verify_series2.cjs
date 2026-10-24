/**
 * Verify-Helfer (Szenario 2): Zeigt Trainer-Zuordnungen je Thema mit
 * is_primary sowie die Anzahl freier Verfügbarkeiten ab heute.
 * Gezielte, minimal gefilterte Abfragen (Port 5433).
 * Schreibend ist dieses Skript NICHT.
 */
const path = require('path');
function requirePg() {
  try {
    return require('pg');
  } catch {
    return require(path.join(__dirname, 'app', 'node_modules', 'pg'));
  }
}
const { Pool } = requirePg();

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

(async () => {
  try {
    const tt = await pool.query(
      `SELECT tt.topic_id, ct.name AS thema, tt.trainer_id, t.kuerzel, tt.is_primary
       FROM public.trainer_topics tt
       JOIN public.course_topics ct ON ct.id = tt.topic_id
       JOIN public.trainer t ON t.id = tt.trainer_id
       ORDER BY tt.topic_id, tt.is_primary DESC, tt.trainer_id`
    );
    console.log('=== trainer_topics (Priorität je Thema) ===');
    for (const r of tt.rows) {
      console.log(
        `  Thema ${r.topic_id} (${r.thema}): Trainer ${r.trainer_id} (${r.kuerzel}) is_primary=${r.is_primary}`
      );
    }

    if (tt.rows.length > 0) {
      const ids = [...new Set(tt.rows.map((r) => r.trainer_id))];
      const av = await pool.query(
        `SELECT trainer_id, COUNT(DISTINCT datum) AS tage
         FROM public.trainer_verfuegbarkeit
         WHERE trainer_id = ANY($1::int[])
           AND datum >= CURRENT_DATE
           AND status = 'frei'
         GROUP BY trainer_id
         ORDER BY trainer_id`,
        [ids]
      );
      console.log('=== freie Verfügbarkeiten (Tage ab heute) je Trainer ===');
      for (const r of av.rows) {
        console.log(`  Trainer ${r.trainer_id}: ${r.tage} verfügbare Tage`);
      }
    }
  } catch (err) {
    console.error('Fehler:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
