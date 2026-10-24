/**
 * Verifiziert die course_events_sync_tracking_migration:
 *  - Verbindung über .env.local Zugangsdaten
 *  - Spalten edoobox_id / sync_status vorhanden?
 *  - CHECK-Constraint ck_course_events_sync_status vorhanden?
 *  - Default 'pending' gesetzt?
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('./app/node_modules/pg');

function loadDotEnv(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return env;
  } catch {
    return {};
  }
}

(async () => {
  const env = loadDotEnv(path.join(__dirname, 'app', '.env.local'));
  const cfg = {
    host: process.env.DB_HOST || env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || env.DB_PORT) || 5433,
    database: process.env.DB_NAME || env.DB_NAME || 'kursplan',
    user: process.env.DB_USER || env.DB_USER || 'kursplan_user',
    password: process.env.DB_PASSWORD || env.DB_PASSWORD || 'MeinAdmin2026',
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  };

  const client = new Client(cfg);
  await client.connect();
  try {
    console.log('Verbunden als:', (await client.query('SELECT current_user')).rows[0].current_user);

    const spalten = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'course_events'
         AND column_name IN ('edoobox_id', 'sync_status')
       ORDER BY ordinal_position`
    );
    console.log('\nSpalten:');
    for (const r of spalten.rows) {
      console.log(`  ${r.column_name} | ${r.data_type} | nullable=${r.is_nullable} | default=${r.column_default}`);
    }

    const constraints = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.course_events'::regclass
         AND conname = 'ck_course_events_sync_status'`
    );
    console.log('\nCHECK-Constraint:');
    if (constraints.rows.length === 0) {
      console.log('  FEHLT!');
    } else {
      for (const r of constraints.rows) console.log(`  ${r.conname}: ${r.def}`);
    }
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});