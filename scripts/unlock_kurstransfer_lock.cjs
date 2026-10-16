// ---------------------------------------------------------------------------
// Entsperrt die Kurstransfer-Sperre (id = 1) und verifiziert den Zustand.
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
    const result = await client.query(
      `UPDATE kurstransfer_lock
          SET is_locked = false, updated_at = NOW()
        WHERE id = 1
        RETURNING id, is_locked, owner_key, updated_at`
    );
    console.log('UPDATE kurstransfer_lock (id=1):');
    console.table(result.rows);

    const check = await client.query(
      `SELECT id, is_locked, owner_key, updated_at
         FROM kurstransfer_lock
        WHERE id = 1`
    );
    console.log('AKTUELLER ZUSTAND:');
    console.table(check.rows);

    if (check.rows.length !== 1 || check.rows[0].is_locked !== false) {
      console.error('Entsperrung FEHLGESCHLAGEN: is_locked ist nicht false.');
      process.exit(1);
    }
    console.log('Entsperrung erfolgreich: is_locked = false.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler beim Entsperren:', err.message);
  process.exit(1);
});