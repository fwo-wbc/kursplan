#!/usr/bin/env node
/**
 * Wendet sync_run_alert_migration.sql auf edoobox_raw.sync_run an (O-7).
 * PostgreSQL läuft lokal im Docker-Container auf Port 5433.
 */
const fs = require('fs');
const path = require('path');
// 'pg' liegt im node_modules der Next.js-App (app/), nicht im Projektroot.
let Pool;
try {
  ({ Pool } = require('pg'));
} catch {
  ({ Pool } = require(path.join(__dirname, '..', 'app', 'node_modules', 'pg')));
}

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

const sqlFile = path.join(__dirname, '..', 'sync_run_alert_migration.sql');
const sql = fs.readFileSync(sqlFile, 'utf8');

(async () => {
  const res = await pool.query(sql);
  console.log('[OK] Migration angewendet. Status:', JSON.stringify(res));
  const check = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'edoobox_raw' AND table_name = 'sync_run'
        AND column_name IN ('alert_sent', 'alert_sent_at', 'alert_message')
      ORDER BY column_name`
  );
  console.log('[CHECK] Neue Spalten:', JSON.stringify(check.rows, null, 2));
  if (check.rows.length !== 3) {
    throw new Error('Erwartet wurden 3 Spalten, gefunden: ' + check.rows.length);
  }
})().then(() => pool.end()).catch((e) => {
  console.error('[FEHLER]', e.message);
  process.exit(1);
});