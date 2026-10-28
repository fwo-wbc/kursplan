/* P04 Fix-Verifikation: sync_run-Schema + Abschluss-UPDATE trockenen Test */
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
  // 1. Schema von edoobox_raw.sync_run
  const r1 = await pool.query(
    `SELECT column_name || ' | ' || data_type || ' | ' || coalesce(column_default,'') AS spalte
       FROM information_schema.columns
      WHERE table_schema = 'edoobox_raw' AND table_name = 'sync_run'
      ORDER BY ordinal_position`
  );
  console.log('=== Schema edoobox_raw.sync_run ===');
  console.table(r1.rows);

  // 2. Abschluss-UPDATE als trockener Test (BEGIN/ROLLBACK)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query(
      `UPDATE edoobox_raw.sync_run
       SET
         status = $1,
         finished_at = now(),
         error_text = $2,
         alert_sent = $4,
         alert_sent_at = CASE WHEN $4 THEN now() ELSE NULL END,
         alert_message = CASE WHEN $4 THEN $5 ELSE NULL END
       WHERE run_id = $3
       RETURNING run_id, status, finished_at, error_text, alert_sent, alert_sent_at, alert_message`,
      ['erfolgreich', 'Test-Null-Werte', 3193, false, null]
    );
    console.log('=== Abschluss-UPDATE trocken OK (ROLLBACK) ===');
    console.table(u.rows);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  // 3. Pruefen: Liefert der Code-Knoten alle noetigen Felder? (statisch aus JSON)
  const fs = require('fs');
  const wf = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'n8n', 'P04_Qualitaetskontrolle.json'), 'utf8')
  )[0];
  const codeNode = wf.nodes.find((n) => n.name === 'P04 Ergebnis auswerten');
  const keys = ['run_id', 'status', 'fehler', 'warnungen', 'error_text', 'alert_message'];
  console.log('=== Code-Knoten liefert Felder ===');
  console.table(keys.map((k) => ({
    feld: k,
    vorhanden: codeNode.parameters.jsCode.includes(k + ':') || codeNode.parameters.jsCode.includes(`${k},`) || codeNode.parameters.jsCode.includes(' ' + k + ',') || codeNode.parameters.jsCode.includes(' ' + k + ':'),
  })));

  // 4. Connections des IF-Knotens nach Fix
  const ifCons = wf.connections['P04 Mail erforderlich?'];
  console.log('=== IF-Knoten Connections (Fix) ===');
  console.log(JSON.stringify(ifCons, null, 1));

  await pool.end();
})().catch((e) => {
  console.error('[FEHLER]', e.message);
  process.exit(1);
});
