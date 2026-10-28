/* Diagnose P04: letzte Läufe + Kontrollabfrage testen (read-only) */
const fs = require('fs');
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
  const r1 = await pool.query(
    `SELECT run_id, run_type, status, started_at, finished_at, left(coalesce(error_text,''),60) AS error_text
       FROM edoobox_raw.sync_run
      WHERE run_type = 'P04'
      ORDER BY started_at DESC
      LIMIT 15`
  );
  console.log('=== Letzte P04-Laeufe ===');
  console.table(r1.rows);

  const wf = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'n8n', 'P04_Qualitaetskontrolle.json'), 'utf8')
  )[0];
  const kontrollNode = wf.nodes.find((n) => n.name === 'P04 Kontrollen ausfuehren');
  const q = kontrollNode.parameters.query;

  try {
    const r2 = await pool.query(q);
    console.log('=== Kontrollen-Query OK ===');
    console.log('Zeilen:', r2.rows.length);
    console.log(JSON.stringify(r2.rows[0], null, 1));
  } catch (e) {
    console.log('=== Kontrollen-Query FEHLER ===');
    console.log(e.message.slice(0, 1200));
  }

  const r3 = await pool.query(
    `SELECT count(*) AS laeuft_heute
       FROM edoobox_raw.sync_run
      WHERE run_type = 'P04' AND status = 'laeuft'
        AND started_at >= CURRENT_DATE`
  );
  console.log('=== P04 laeuft heute ===', JSON.stringify(r3.rows[0]));

  await pool.end();
})().catch((e) => {
  console.error('[FEHLER]', e.message);
  process.exit(1);
});
