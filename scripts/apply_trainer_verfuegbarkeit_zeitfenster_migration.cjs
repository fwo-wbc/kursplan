#!/usr/bin/env node
/**
 * Wendet trainer_verfuegbarkeit_zeitfenster_migration.sql auf die lokale
 * PostgreSQL-Datenbank (Docker, Port 5433) an.
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

const sqlFile = path.join(__dirname, '..', 'trainer_verfuegbarkeit_zeitfenster_migration.sql');
const sql = fs.readFileSync(sqlFile, 'utf8');

(async () => {
  const res = await pool.query(sql);
  console.log('[OK] Migration angewendet. Status:', JSON.stringify(res));
  const check = await pool.query(
    `SELECT column_name, data_type, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'trainer_verfuegbarkeit'
       AND column_name IN ('start_time', 'end_time', 'is_booked')
     ORDER BY column_name`
  );
  console.log('[CHECK] Neue Spalten:', JSON.stringify(check.rows, null, 2));
})().then(() => pool.end()).catch((e) => {
  console.error('[FEHLER]', e.message);
  process.exit(1);
});