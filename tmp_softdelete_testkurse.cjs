// Soft-Delete aller Testkurse (name ILIKE '%test%') in edoobox_raw.
// Gemäß Projektregel: KEIN DELETE, nur UPDATE is_deleted = true.
// Hinweis: Die Tabellen haben KEIN updated_at - Zeitstempel-Spalten sind
// last_synced_at (beide) und last_changed_at (nur offer), siehe information_schema.
// Reihenfolge: 1) Termine (offer_date) -> 2) Kurse (offer).
// Direkter PostgreSQL-Zugriff (Port 5433) - keine neue Dependency.
const { Client } = require('./app/node_modules/pg');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
};

async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();

  try {
    // --- 0) Vorschau: betroffene Kurse ---
    const vorschauKurse = await client.query(
      `SELECT offer_id, offer_number, name, is_deleted
       FROM edoobox_raw.offer
       WHERE name ILIKE '%test%'
       ORDER BY offer_number`
    );
    console.log('=== Betroffene KURSE (name ILIKE %test%) ===');
    console.log(`Anzahl: ${vorschauKurse.rows.length}`);
    for (const r of vorschauKurse.rows) {
      console.log(`  ${r.offer_id} | ${r.offer_number} | ${r.name} | is_deleted=${r.is_deleted}`);
    }

    // --- 0b) Vorschau: betroffene Termine ---
    const vorschauTermine = await client.query(
      `SELECT od.date_id, od.offer_id, o.offer_number, o.name, od.is_deleted
       FROM edoobox_raw.offer_date od
       JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
       WHERE o.name ILIKE '%test%'
       ORDER BY o.offer_number`
    );
    console.log('=== Betroffene TERMINE (zu Testkursen) ===');
    console.log(`Anzahl: ${vorschauTermine.rows.length}`);
    for (const r of vorschauTermine.rows) {
      console.log(`  ${r.date_id} | offer=${r.offer_id} | ${r.offer_number} | ${r.name} | is_deleted=${r.is_deleted}`);
    }

    if (vorschauKurse.rows.length === 0 && vorschauTermine.rows.length === 0) {
      console.log('Keine Testkurse gefunden - nichts zu tun.');
      return;
    }

    // --- 1) Termine soft-löschen ---
    const resTermine = await client.query(
      `UPDATE edoobox_raw.offer_date
       SET is_deleted = true, last_synced_at = NOW()
       WHERE offer_id IN (
         SELECT offer_id
         FROM edoobox_raw.offer
         WHERE name ILIKE '%test%'
       )`
    );
    console.log(`\nTermine soft-gelöscht: ${resTermine.rowCount}`);

    // --- 2) Kurse soft-löschen ---
    const resKurse = await client.query(
      `UPDATE edoobox_raw.offer
       SET is_deleted = true, last_synced_at = NOW(), last_changed_at = NOW()
       WHERE name ILIKE '%test%'`
    );
    console.log(`Kurse soft-gelöscht: ${resKurse.rowCount}`);

    // --- 3) Verifikation ---
    const verifKurse = await client.query(
      `SELECT offer_id, offer_number, name, is_deleted
       FROM edoobox_raw.offer
       WHERE name ILIKE '%test%'
       ORDER BY offer_number`
    );
    console.log('\n=== Verifikation KURSE ===');
    for (const r of verifKurse.rows) {
      console.log(`  ${r.offer_id} | ${r.offer_number} | ${r.name} | is_deleted=${r.is_deleted}`);
    }

    const verifTermine = await client.query(
      `SELECT od.date_id, od.offer_id, o.offer_number, od.is_deleted
       FROM edoobox_raw.offer_date od
       JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
       WHERE o.name ILIKE '%test%'
       ORDER BY o.offer_number`
    );
    console.log('=== Verifikation TERMINE ===');
    for (const r of verifTermine.rows) {
      console.log(`  ${r.date_id} | offer=${r.offer_id} | ${r.offer_number} | is_deleted=${r.is_deleted}`);
    }

    const nochAktiv = verifKurse.rows.filter((r) => r.is_deleted !== true).length +
                      verifTermine.rows.filter((r) => r.is_deleted !== true).length;
    console.log(`\nNoch aktive (nicht soft-gelöschte) Testdatensätze: ${nochAktiv}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});