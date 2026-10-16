// ---------------------------------------------------------------------------
// Bereinigung: fehlerhafte Test-Einträge in kurstransfer_status
// mit kurs_key = 'undefined|undefined|undefined'
// (public-Tabelle, kein edoobox_raw -> physisches DELETE zulässig)
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
    const before = await client.query(
      `SELECT count(*)::int AS n
         FROM kurstransfer_status
        WHERE kurs_key = 'undefined|undefined|undefined'`
    );
    console.log('Betroffene Einträge vor Bereinigung:', before.rows[0].n);

    if (before.rows[0].n > 0) {
      const del = await client.query(
        `DELETE FROM kurstransfer_status
          WHERE kurs_key = 'undefined|undefined|undefined'`
      );
      console.log('Gelöschte Einträge:', del.rowCount);
    } else {
      console.log('Keine fehlerhaften Einträge vorhanden.');
    }

    const after = await client.query(
      `SELECT count(*)::int AS n
         FROM kurstransfer_status
        WHERE kurs_key = 'undefined|undefined|undefined'`
    );
    console.log('Betroffene Einträge nach Bereinigung:', after.rows[0].n);

    const remaining = await client.query(
      `SELECT kurs_key, status, edoobox_offer_id, updated_at
         FROM kurstransfer_status
        ORDER BY updated_at DESC
        LIMIT 10`
    );
    console.log('Aktuelle Einträge (Top 10):');
    console.table(remaining.rows);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler bei der Bereinigung:', err.message);
  process.exit(1);
});