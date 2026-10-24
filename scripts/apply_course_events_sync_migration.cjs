/**
 * Wendet die Migration course_events_sync_tracking_migration.sql an
 * (edoobox_id + sync_status mit CHECK-Constraint auf public.course_events).
 *
 * DDL (ALTER TABLE, ADD CONSTRAINT) erfordert den Admin-User `kursplan_user`
 * (Owner des public-Schemas) – analog zu den übrigen Migrations-Skripten.
 * Verbindungswerte aus Umgebungsvariablen/Defaults (Port 5433, SSH-Tunnel).
 * Das Skript ist idempotent (ADD COLUMN IF NOT EXISTS / DO-Block).
 */
const fs = require('fs');
const path = require('path');

/** Lädt 'pg' – zuerst regulär, sonst aus den node_modules der App. */
function requirePg() {
  try {
    return require('pg');
  } catch {
    return require(path.join(__dirname, '..', 'app', 'node_modules', 'pg'));
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
  const file = path.join(__dirname, '..', 'course_events_sync_tracking_migration.sql');
  const sql = fs.readFileSync(file, 'utf8');
  try {
    await pool.query(sql);
    console.log(
      '✓ public.course_events um edoobox_id & sync_status (CHECK) erweitert.'
    );
  } catch (err) {
    console.error('Fehler beim Anwenden der Migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();