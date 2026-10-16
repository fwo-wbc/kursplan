// ---------------------------------------------------------------------------
// Diagnose: wrd-serie / Word-Seriendruck
//   1) Spalten von edoobox_raw.offer (gezielt, kein Full-Scan)
//   2) Betroffene Offer-Datensätze (number ILIKE '%wrd-serie%' OR name Word%Seriendruck)
//   3) Inhalt von public.kurs_kategorie_mapping
//
// Verwendung: node scripts/diagnose_wrd_serie.cjs
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
    // 1) Spalten von edoobox_raw.offer
    const cols = await client.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'edoobox_raw' AND table_name = 'offer'
       ORDER BY ordinal_position`
    );
    console.log('=== Spalten edoobox_raw.offer ===');
    console.table(cols.rows);

    // 2) Betroffene Offer-Datensätze
    const offers = await client.query(
      `SELECT offer_id, offer_number, name, category_ref, offer_type,
              is_deleted, last_changed_at, last_synced_at
       FROM edoobox_raw.offer
       WHERE offer_number ILIKE '%wrd-serie%'
          OR name ILIKE 'Word%Seriendruck%'
       ORDER BY last_changed_at DESC NULLS LAST`
    );
    console.log('=== Betroffene Offers (wrd-serie / Word*Seriendruck) ===');
    console.table(offers.rows);

    // 2b) Kategorie-Namen zu den gefundenen category_ref auflösen
    const refs = [...new Set(offers.rows.map((r) => r.category_ref).filter(Boolean))];
    if (refs.length > 0) {
      const cats = await client.query(
        `SELECT category_id, name
         FROM edoobox_raw.category
         WHERE category_id = ANY($1::text[])`,
        [refs]
      );
      console.log('=== Kategorien zu den gefundenen category_ref ===');
      console.table(cats.rows);
    }

    // 3) Inhalt kurs_kategorie_mapping
    const mapping = await client.query(
      `SELECT id, import_titel, category_id, is_deleted, created_at, updated_at
       FROM public.kurs_kategorie_mapping
       ORDER BY id`
    );
    console.log('=== public.kurs_kategorie_mapping ===');
    console.table(mapping.rows);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler bei der Diagnose:', err.message);
  process.exit(1);
});
