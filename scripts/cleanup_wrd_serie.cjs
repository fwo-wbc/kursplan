// ---------------------------------------------------------------------------
// Bereinigung wrd-serie:
//   1) Soft-Delete der veralteten Test-Offers, die noch auf die Kategorie
//      'Vorlagen für offene Kurse' (category_f769d814fefe_10463312570) verweisen.
//      -> KEIN DELETE, ausschließlich is_deleted = true (Soft-Delete-Regel).
//   2) Ergänzung des Kürzel-Mappings in public.kurs_kategorie_mapping:
//      import_titel = 'wrd-serie' -> category_25ea33c5e986_4391280140
//      ('Word - Seriendruck (kompakt)').
//
// Verwendung: node scripts/cleanup_wrd_serie.cjs
// ---------------------------------------------------------------------------
const path = require('path');

const pgPath = path.join(__dirname, '..', 'app', 'node_modules', 'pg');
const { Client } = require(pgPath);

// Veraltete Test-Offers (leere offer_number, keine Termine, archive=true),
// die auf 'Vorlagen für offene Kurse' verweisen.
const TEST_OFFER_IDS = [
  'offer_1d983cfa5e2c_10463984860',
  'offer_b287e8116865_10463993945',
];

const MAPPING_TITEL = 'wrd-serie';
const MAPPING_CATEGORY = 'category_25ea33c5e986_4391280140';

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
    // --- 1) Soft-Delete der veralteten Test-Offers -------------------------
    const vorher = await client.query(
      `SELECT offer_id, offer_number, name, category_ref, is_deleted
       FROM edoobox_raw.offer
       WHERE offer_id = ANY($1::text[])
       ORDER BY offer_id`,
      [TEST_OFFER_IDS]
    );
    console.log('=== VORHER: betroffene Test-Offers ===');
    console.table(vorher.rows);

    const del = await client.query(
      `UPDATE edoobox_raw.offer
          SET is_deleted = true,
              last_changed_at = NOW()
        WHERE offer_id = ANY($1::text[])
          AND is_deleted IS NOT TRUE
        RETURNING offer_id, offer_number, name, category_ref, is_deleted`,
      [TEST_OFFER_IDS]
    );
    console.log('=== Soft-Delete ausgeführt (RETURNING) ===');
    console.table(del.rows);
    console.log(`Soft-deleted: ${del.rowCount} Zeile(n).`);

    // --- 2) Mapping-Kürzel ergänzen ---------------------------------------
    const ins = await client.query(
      `INSERT INTO public.kurs_kategorie_mapping (import_titel, category_id)
       VALUES ($1::text, $2::text)
       ON CONFLICT (import_titel) WHERE is_deleted IS NOT TRUE DO NOTHING
       RETURNING id, import_titel, category_id, is_deleted`,
      [MAPPING_TITEL, MAPPING_CATEGORY]
    );
    if (ins.rowCount > 0) {
      console.log('=== Mapping ergänzt ===');
      console.table(ins.rows);
    } else {
      console.log(
        `Mapping '${MAPPING_TITEL}' existierte bereits (kein Insert).`
      );
    }

    // --- 3) Endkontrolle ---------------------------------------------------
    const mapping = await client.query(
      `SELECT id, import_titel, category_id, is_deleted
       FROM public.kurs_kategorie_mapping
       WHERE is_deleted IS NOT TRUE
       ORDER BY id`
    );
    console.log('=== public.kurs_kategorie_mapping (aktiv) ===');
    console.table(mapping.rows);

    const rest = await client.query(
      `SELECT offer_id, offer_number, name, category_ref, is_deleted
       FROM edoobox_raw.offer
       WHERE category_ref IN (
               'category_f769d814fefe_10463312570',
               'category_41b0c0d06429_10460223670'
             )
         AND is_deleted IS NOT TRUE
       ORDER BY offer_id`
    );
    console.log('=== Verbleibende AKTIVE Offers auf "Vorlagen für offene Kurse" ===');
    console.table(rest.rows);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler bei der Bereinigung:', err.message);
  process.exit(1);
});
