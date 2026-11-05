// =============================================================================
// Gemeinsame DB-Verbindungslogik für lokale Wartungsskripte (Host-Seite)
// -----------------------------------------------------------------------------
// Docker-intern lautet die Verbindung kursplan-db:5432 (siehe .env.production).
// Vom Host aus ist die PostgreSQL-Instanz laut Projekt-Doku auf Port 5433
// erreichbar. Daher: Host "kursplan-db" -> "127.0.0.1", Port "5432" -> "5433".
// Einzelne Werte (DB_HOST / DB_PORT) lassen sich als Umgebungsvariable oder
// Override-Objekt übersteuern.
//
// Die npm-Pakete (pg, bcryptjs) liegen ausschließlich unter app/node_modules.
// Das Modul lädt sie bewusst über createRequire mit absolutem Pfad, damit die
// Skripte unabhängig von NODE_PATH und der aufrufenden Shell funktionieren.
// =============================================================================
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const APP_NODE_MODULES = path.resolve(__dirname, '../../app/node_modules');
const requireFromApp = createRequire(path.join(APP_NODE_MODULES, 'package.json'));

const { Pool } = requireFromApp('pg');

const ENV_FILE = path.resolve(__dirname, '../../.env.production');

/**
 * Liest eine .env-Datei (KEY="value") ohne zusätzliche Abhängigkeiten ein.
 */
function loadDotEnv(filePath) {
  const result = {};
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return result;
  const raw = fs.readFileSync(abs, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Ermittelt den finalen Connection-String für Host-Zugriffe.
 * Reihenfolge: Override-Parameter > Prozess-Umgebung > .env.production.
 */
function resolveDatabaseUrl(overrides = {}) {
  const envFile = loadDotEnv(ENV_FILE);
  const raw =
    overrides.DATABASE_URL || process.env.DATABASE_URL || envFile.DATABASE_URL;
  if (!raw) {
    throw new Error('Keine DATABASE_URL in .env.production oder Umgebung gefunden.');
  }
  const url = new URL(raw);
  const host =
    overrides.DB_HOST ||
    process.env.DB_HOST ||
    (url.hostname === 'kursplan-db' ? '127.0.0.1' : url.hostname);
  const port =
    overrides.DB_PORT ||
    process.env.DB_PORT ||
    (url.port === '5432' ? '5433' : url.port);
  url.hostname = host;
  url.port = String(port);
  return url.toString();
}

/**
 * Erstellt einen pg-Pool für Host-Verbindungen (Port 5433).
 */
function createPool(overrides = {}) {
  return new Pool({
    connectionString: resolveDatabaseUrl(overrides),
    max: 5,
  });
}

/**
 * Führt eine komplette SQL-Datei aus (mehrere Statements via Simple Query).
 */
async function runSqlFile(filePath, overrides = {}) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`SQL-Datei nicht gefunden: ${abs}`);
  }
  const sql = fs.readFileSync(abs, 'utf8');
  const pool = createPool(overrides);
  try {
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

module.exports = {
  loadDotEnv,
  resolveDatabaseUrl,
  createPool,
  runSqlFile,
  requireFromApp,
  APP_NODE_MODULES,
  ENV_FILE,
};
