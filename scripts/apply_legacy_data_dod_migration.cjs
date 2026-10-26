/**
 * Wendet die Migration legacy_data_dod_migration.sql an.
 *
 * Inhalt der Migration:
 *  - Stichtags-Konfiguration (kursplan.datenstand_config, 'legacy_stichtag' = 2026-09-01)
 *  - Zugriffsfunktion kursplan.get_legacy_stichtag()
 *  - Qualitäts-View kursplan.v_qualitaet_historienluecken (is_legacy-Klassifizierung)
 *  - GRANT SELECT/EXECUTE für den n8n_writer
 *
 * Verbindungswerte entsprechen app/src/lib/db.ts (Port 5433).
 * Die Migration ist idempotent (CREATE OR REPLACE / IF NOT EXISTS + UPSERT).
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
  const file = path.join(__dirname, '..', 'legacy_data_dod_migration.sql');
  const sql = fs.readFileSync(file, 'utf8');
  try {
    await pool.query(sql);
    const stichtag = await pool.query('SELECT kursplan.get_legacy_stichtag() AS stichtag');
    console.log(
      `✓ Legacy-Stichtags-Regelung angewendet (Stichtag: ${stichtag.rows[0].stichtag.toISOString()}).`
    );
  } catch (err) {
    console.error('Fehler beim Anwenden der Migration:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();