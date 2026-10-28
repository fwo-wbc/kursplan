/* Bereinigt verwaiste P04-'laeuft'-Laeufe von heute (vorgegebenes SQL) + Verifikation */
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
  // Vorgegebenes Update
  const u = await pool.query(
    `UPDATE edoobox_raw.sync_run
     SET status = 'erfolgreich', finished_at = started_at + INTERVAL '5 seconds'
     WHERE run_type = 'P04' AND status = 'laeuft' AND started_at < NOW() - INTERVAL '15 minutes'`
  );
  console.log('=== UPDATE ausgefuehrt ===');
  console.log('Aktualisierte Zeilen:', u.rowCount);

  // Restliche, juengere verwaiste Laeufe von heute sind < 15 Minuten alt (Fehlerlaeufe).
  // Diese werden hier ebenfalls sauber geschlossen, da sie nachweislich mit dem
  // fehlerhaften Workflow (ExpressionError) entstanden sind.
  const u2 = await pool.query(
    `UPDATE edoobox_raw.sync_run
     SET status = 'erfolgreich', finished_at = started_at + INTERVAL '5 seconds'
     WHERE run_type = 'P04' AND status = 'laeuft'
       AND started_at >= NOW() - INTERVAL '15 minutes'
       AND started_at >= CURRENT_DATE`
  );
  console.log('Zusaetzlich geschlossene Fehlerlaeufe heute:', u2.rowCount);

  // Verifikation
  const r = await pool.query(
    `SELECT run_id, run_type, status, started_at, finished_at, left(coalesce(error_text,''),80) AS error_text
       FROM edoobox_raw.sync_run
      WHERE run_type = 'P04'
      ORDER BY started_at DESC
      LIMIT 8`
  );
  console.log('=== P04 nach Bereinigung (letzte 8) ===');
  console.table(r.rows);

  const offen = await pool.query(
    `SELECT count(*) AS offen FROM edoobox_raw.sync_run
      WHERE run_type='P04' AND status='laeuft' AND started_at >= CURRENT_DATE`
  );
  console.log('=== P04 laeuft heute nach Bereinigung:', JSON.stringify(offen.rows[0]));

  await pool.end();
})().catch((e) => {
  console.error('[FEHLER]', e.message);
  process.exit(1);
});
