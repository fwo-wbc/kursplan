// ---------------------------------------------------------------------------
// Gezielte Datenprobe: Kollisionsprüfung für den Kurstransfer
//   1) Relevante Spalten von edoobox_raw.offer und edoobox_raw.offer_date
//   2) wrd-serie-Angebote (offer_number / name) inkl. is_deleted, status
//   3) Termine (offer_date) dieser Angebote – insb. 06.12.2027
//   4) Monatszähler: Angebote mit Kürzel wrd-serie im Monat 1227
//
// Verwendung: node scripts/probe_kollision_wrd_serie.cjs
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
    // 1) Relevante Spalten offer
    const offerCols = await client.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'edoobox_raw' AND table_name = 'offer'
       ORDER BY ordinal_position`
    );
    console.log('=== Spalten edoobox_raw.offer (relevant) ===');
    const relevante = ['offer_id', 'offer_number', 'name', 'category_ref', 'status', 'is_deleted', 'date_start', 'offerdef_ref', 'offer_type'];
    console.table(offerCols.rows.filter((r) => relevante.includes(r.column_name)));

    // 2) wrd-serie-Angebote
    const offers = await client.query(
      `SELECT offer_id, offer_number, name, category_ref, status, offer_type, is_deleted
       FROM edoobox_raw.offer
       WHERE offer_number ILIKE 'wrd-serie%'
          OR name ILIKE 'Word%Seriendruck%'
       ORDER BY offer_number`
    );
    console.log('\n=== Offers (wrd-serie / Word*Seriendruck) ===');
    console.table(offers.rows);

    // 3) Termine dieser Angebote (insb. 06.12.2027)
    if (offers.rows.length > 0) {
      const offerIds = offers.rows.map((r) => r.offer_id);
      const dates = await client.query(
        `SELECT od.date_id, od.offer_id, o.offer_number,
                (od.date_start AT TIME ZONE 'Europe/Berlin')::date AS datum,
                to_char(od.date_start AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS beginn,
                od.is_deleted
         FROM edoobox_raw.offer_date od
         JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
         WHERE od.offer_id = ANY($1::text[])
           AND (od.date_start AT TIME ZONE 'Europe/Berlin')::date
               BETWEEN DATE '2027-11-01' AND DATE '2027-12-31'
         ORDER BY datum, beginn`,
        [offerIds]
      );
      console.log('\n=== offer_date Nov-Dez 2027 (wrd-serie) ===');
      console.table(dates.rows);

      const kollision = dates.rows.filter((r) => String(r.datum) === '2027-12-06' && r.is_deleted !== true);
      console.log('\n=== Kollision 06.12.2027 (aktiv) ===');
      console.table(kollision);
    }

    // 4) Monatszähler wrd-serie im Monat 1227
    const monat = await client.query(
      `SELECT offer_number, offer_id, is_deleted
       FROM edoobox_raw.offer
       WHERE is_deleted IS NOT TRUE
         AND (offer_number = 'wrd-serie-1227'
              OR offer_number LIKE 'wrd-serie-1227-%')
       ORDER BY offer_number`
    );
    console.log('\n=== wrd-serie Monat 1227 (aktiv) ===');
    console.table(monat.rows);
    console.log('Anzahl aktiv im Monat 1227:', monat.rows.length);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler bei der Probe:', err.message);
  process.exit(1);
});
