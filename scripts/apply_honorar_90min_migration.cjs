// ---------------------------------------------------------------------------
//  Kursplan  |  Ausfuehrung der Migration  |  Trainer-Honorar 90-Minuten-Satz
// ---------------------------------------------------------------------------
//  Liest scripts/trainer_honorar_90min_migration.sql und fuehrt die Statements
//  gegen die lokale PostgreSQL-Instanz (Port 5433) aus. Idempotent.
// ---------------------------------------------------------------------------
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const sqlFile = path.join(__dirname, 'trainer_honorar_90min_migration.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');

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
    console.log('Migration erfolgreich ausgefuehrt.');
    // Letztes Statement ist die Kontrollabfrage (SELECT ...).
    const rows = result[result.length - 1]?.rows ?? [];
    for (const row of rows) {
      console.log(
        `  ${row.column_name}: ${row.data_type}(${row.numeric_precision},${row.numeric_scale}) default=${row.column_default}`
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler bei der Migration:', err);
  process.exit(1);
});