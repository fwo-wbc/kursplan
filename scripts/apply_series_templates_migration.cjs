/**
 * Wendet die Migration series_templates_migration.sql an
 * (Serien-Vorlagen des L-05 Serienplaners).
 *
 * DDL (CREATE TABLE, ADD CONSTRAINT) erfordert den Admin-User `kursplan_user`.
 * Verbindungswerte aus Umgebungsvariablen/Defaults (Port 5433, SSH-Tunnel).
 * Idempotent ausführbar.
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
  const file = path.join(__dirname, '..', 'series_templates_migration.sql');
  const sql = fs.readFileSync(file, 'utf8');
  try {
    await pool.query(sql);
    console.log('✓ public.series_templates ist angelegt bzw. aktuell.');
  } catch (err) {
    console.error('Fehler beim Anwenden der Migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();