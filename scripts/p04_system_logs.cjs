/* Liest die letzten System-Logs (Workflow-Fehler/Durchlaeufe) aus public.system_logs */
const path = require('path');
const { Pool } = require(path.join(__dirname, '..', 'app', 'node_modules', 'pg'));

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

(async () => {
  // Spalten der Tabelle kurz ermitteln
  const col = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='system_logs' ORDER BY ordinal_position`
  );
  console.log('Spalten system_logs:', col.rows.map((r) => r.column_name).join(', '));

  const r = await pool.query(
    `SELECT * FROM public.system_logs
      ORDER BY created_at DESC
      LIMIT 12`
  );
  console.log('=== Letzte System-Logs ===');
  for (const row of r.rows) {
    console.log('---');
    console.log(JSON.stringify(row, null, 1).slice(0, 1200));
  }
  await pool.end();
})().catch((e) => {
  console.error('[FEHLER]', e.message);
  process.exit(1);
});
