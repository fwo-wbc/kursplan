// Temporäre Verifikation: Existieren course_modules / course_events / trainer?
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
    const res = await pool.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('course_modules', 'course_events', 'course_topics', 'trainer', 'planning_drafts', 'calendar_blockers')
      ORDER BY table_name
    `);
    console.log('Gefundene Tabellen:');
    for (const row of res.rows) {
      console.log(`  ${row.table_schema}.${row.table_name}`);
    }
    if (res.rows.length === 0) {
      console.log('  (keine der geprüften Tabellen vorhanden)');
    }

    // Spalten von course_events, falls vorhanden
    const ce = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'course_events'
      ORDER BY ordinal_position
    `);
    if (ce.rows.length > 0) {
      console.log('\nSpalten von course_events:');
      for (const row of ce.rows) {
        console.log(`  ${row.column_name} (${row.data_type})`);
      }
    }
  } catch (err) {
    console.error('FEHLER:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();