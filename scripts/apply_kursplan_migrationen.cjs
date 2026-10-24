/**
 * Wendet die Kursplan-Migrationen in Reihenfolge an:
 *   1. kursplan_themen_migration.sql   (Kursthemen-Stamm erweitern)
 *   2. kursplan_planung_migration.sql  (Planungstabelle + Sichten)
 *   3. kursplan_seed_ms_office.sql     (Startbestand 20 MS-Office-Kurse)
 *
 * Verbindungswerte entsprechen app/src/lib/db.ts (Port 5433).
 * Alle Dateien sind idempotent ausfuehrbar.
 */
const fs = require('fs');
const path = require('path');

/** Laedt 'pg' – zuerst regulär, sonst aus den node_modules der App. */
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

const MIGRATIONEN = [
  'kursplan_themen_migration.sql',
  'kursplan_planung_migration.sql',
  'kursplan_seed_ms_office.sql',
];

(async () => {
  for (const file of MIGRATIONEN) {
    const full = path.join(__dirname, '..', file);
    const sql = fs.readFileSync(full, 'utf8');
    try {
      await pool.query(sql);
      console.log(`✓ ${file} angewendet.`);
    } catch (err) {
      console.error(`✗ Fehler in ${file}:`, err.message);
      process.exitCode = 1;
      break;
    }
  }
  await pool.end();
})();