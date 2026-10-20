// Gezielte Spaltenabfrage für edoobox_raw.offer und edoobox_raw.offer_date
const { Client } = require('./app/node_modules/pg');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
};

async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  try {
    const res = await client.query(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'edoobox_raw'
         AND table_name IN ('offer', 'offer_date')
       ORDER BY table_name, ordinal_position`
    );
    for (const r of res.rows) {
      console.log(`${r.table_name} | ${r.column_name} | ${r.data_type} | nullable=${r.is_nullable}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});