// ---------------------------------------------------------------------------
// Detail-Inspektion der aktiven wrd-serie-Kandidaten, die auf die Kategorie
// 'Vorlagen für offene Kurse' (category_f769d814fefe_10463312570) verweisen.
//
// Verwendung: node scripts/inspect_wrd_serie_kandidaten.cjs
// ---------------------------------------------------------------------------
const path = require('path');

const pgPath = path.join(__dirname, '..', 'app', 'node_modules', 'pg');
const { Client } = require(pgPath);

const KANDIDATEN = [
  'offer_1d983cfa5e2c_10463984860',
  'offer_b287e8116865_10463993945',
];

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
    const res = await client.query(
      `SELECT offer_id, offer_number, name, category_ref, offerdef_ref,
              date_start, date_end, status, offer_type, is_deleted,
              first_seen_at, last_changed_at, last_synced_at,
              payload
       FROM edoobox_raw.offer
       WHERE offer_id = ANY($1::text[])
       ORDER BY offer_id`,
      [KANDIDATEN]
    );

    for (const row of res.rows) {
      console.log('==================================================');
      console.log('offer_id      :', row.offer_id);
      console.log('offer_number  :', JSON.stringify(row.offer_number));
      console.log('name          :', row.name);
      console.log('category_ref  :', row.category_ref);
      console.log('offerdef_ref  :', row.offerdef_ref);
      console.log('date_start    :', row.date_start);
      console.log('date_end      :', row.date_end);
      console.log('status        :', row.status);
      console.log('offer_type    :', row.offer_type);
      console.log('is_deleted    :', row.is_deleted);
      console.log('first_seen_at :', row.first_seen_at);
      console.log('last_changed  :', row.last_changed_at);
      console.log('last_synced   :', row.last_synced_at);
      console.log('payload       :', JSON.stringify(row.payload, null, 2));
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler bei der Inspektion:', err.message);
  process.exit(1);
});
