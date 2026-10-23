/* Gezielte Verifikation (Verifikationspflicht): Existiert trainer_availabilities?
   Nur information_schema, keine Tabellenscans. */
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

(async () => {
  const t = await pool.query(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_name ILIKE '%availab%' OR table_name ILIKE '%verfueg%'
     ORDER BY 1, 2`
  );
  console.log('TABELLEN:', JSON.stringify(t.rows));

  if (t.rows.some((r) => r.table_name === 'trainer_availabilities')) {
    const c = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'trainer_availabilities'
       ORDER BY ordinal_position`
    );
    console.log('SPALTEN trainer_availabilities:', JSON.stringify(c.rows, null, 2));
  } else {
    console.log('trainer_availabilities EXISTIERT NICHT in der Datenbank.');
  }
})().then(() => pool.end()).catch((e) => {
  console.error('FEHLER:', e.message);
  process.exit(1);
});