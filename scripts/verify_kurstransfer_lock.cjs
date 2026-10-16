// ---------------------------------------------------------------------------
// Verifikation: kurstransfer_lock (Tabelle, Trigger, Funktion, Sperrzustand)
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
        WHERE table_schema = 'public' AND table_name = 'kurstransfer_lock'
        ORDER BY ordinal_position`
    );
    console.log('TABELLE kurstransfer_lock:');
    console.table(columns.rows);

    const checkConstraint = await client.query(
      `SELECT conname AS constraint_name, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'public.kurstransfer_lock'::regclass`
    );
    console.log('CONSTRAINTS:');
    console.table(checkConstraint.rows);

    const triggers = await client.query(
      `SELECT tgname AS trigger_name, pg_get_triggerdef(oid) AS definition
         FROM pg_trigger
        WHERE tgrelid = 'public.kurstransfer_lock'::regclass
          AND NOT tgisinternal`
    );
    console.log('TRIGGER:');
    console.table(triggers.rows);

    const zeile = await client.query(
      `SELECT id, is_locked, owner_key, hinweis, created_at, updated_at
         FROM kurstransfer_lock`
    );
    console.log('ZEILE:');
    console.table(zeile.rows);

    const ok =
      columns.rows.length === 6 &&
      checkConstraint.rows.some((r) => r.constraint_name === 'single_row') &&
      zeile.rows.length === 1;

    if (!ok) {
      console.error('Verifikation FEHLGESCHLAGEN: Schema unvollständig.');
      process.exit(1);
    }
    console.log('Verifikation erfolgreich: Tabelle, Check-Constraint und Ein-Zeilen-Lock vorhanden.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler bei der Verifikation:', err.message);
  process.exit(1);
});
