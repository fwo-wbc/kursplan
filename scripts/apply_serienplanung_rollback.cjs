/**
 * Wendet den Rückbau serienplanung_rollback_migration.sql an.
 *
 * Verbindungswerte entsprechen app/src/lib/db.ts (Port 5433).
 * Alle Statements sind idempotent (DROP ... IF EXISTS).
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
  const file = path.join(__dirname, '..', 'serienplanung_rollback_migration.sql');
  const sql = fs.readFileSync(file, 'utf8');
  try {
    await pool.query(sql);
    console.log(
      '✓ Rückbau abgeschlossen: kursplan_termin (+Sichten), planning_drafts, ' +
        'series_templates, course_modules, calendar_blockers entfernt.'
    );
  } catch (err) {
    console.error('Fehler beim Anwenden des Rollbacks:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();