// ---------------------------------------------------------------------------
// Hilfsskript: Führt die Migration für die Tabelle 'kurstransfer_lock'
// aus. Die Lock-Tabelle hält die persistente, serverseitige Transfersperre,
// damit die UI nach einem Seiten-Reload gesperrt bleibt, solange eine
// Übertragung nach edoobox läuft.
//
// Nutzt die pg-Dependency der App (app/node_modules), damit keine neuen
// Dependencies nötig sind. Verbindungsparameter wie in app/src/lib/db.ts.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const pgPath = path.join(__dirname, '..', 'app', 'node_modules', 'pg');
const { Client } = require(pgPath);

async function main() {
  const sqlPath = path.join(__dirname, '..', 'kurstransfer_lock_migration.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5433,
    database: process.env.DB_NAME || 'kursplan',
    user: process.env.DB_USER || 'kursplan_user',
    password: process.env.DB_PASSWORD || 'MeinAdmin2026',
  });

  await client.connect();
  try {
    const result = await client.query(sql);
    console.log('Migration erfolgreich ausgeführt.');
    if (result && Array.isArray(result.rows) && result.rows.length > 0) {
      console.table(result.rows);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler bei der Migration:', err.message);
  process.exit(1);
});
