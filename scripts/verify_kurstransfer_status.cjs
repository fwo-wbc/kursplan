// ---------------------------------------------------------------------------
// Verifikation: kurstransfer_status (Tabelle, Trigger, Funktion)
// ---------------------------------------------------------------------------
const path = require('path');

const pgPath = path.join(__dirname, '..', 'app', 'node_modules', 'pg');
const { Client } = require(pgPath);

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5433,
    database: process.env.DB_NAME || 'kursplan',
    user: process.env.DB_USER || 'kursplan_user',
    password: process.env.DB_PASSWORD || 'MeinAdmin2026',
  });

  await client.connect();
  try {
    const columns = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'kurstransfer_status'
        ORDER BY ordinal_position`
    );
    console.log('TABELLE kurstransfer_status:');
    console.table(columns.rows);

    const triggers = await client.query(
      `SELECT tgname AS trigger_name, pg_get_triggerdef(oid) AS definition
         FROM pg_trigger
        WHERE tgrelid = 'public.kurstransfer_status'::regclass
          AND NOT tgisinternal`
    );
    console.log('TRIGGER:');
    console.table(triggers.rows);

    const functions = await client.query(
      `SELECT proname AS function_name, pg_get_functiondef(oid) AS definition
         FROM pg_proc
        WHERE proname = 'update_modified_column'`
    );
    console.log('FUNKTION update_modified_column:');
    console.table(functions.rows);

    const ok =
      columns.rows.length === 6 &&
      triggers.rows.some((r) => r.trigger_name === 'set_timestamp') &&
      functions.rows.length === 1;

    if (!ok) {
      console.error('Verifikation FEHLGESCHLAGEN: Schema unvollständig.');
      process.exit(1);
    }
    console.log('Verifikation erfolgreich: Tabelle, Trigger und Funktion vorhanden.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler bei der Verifikation:', err.message);
  process.exit(1);
});