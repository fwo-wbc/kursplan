// ===========================================================================
// apply_kursthemen_migration.cjs
// Wendet kursthemen_migration.sql an (Tabelle public."Kursthemen" + Befuellung)
// und verifiziert das Ergebnis.
//
// Ablauf:
//   1) Migration ausfuehren (CREATE TABLE IF NOT EXISTS + INSERT ... SELECT
//      DISTINCT mit ON CONFLICT (titel) DO NOTHING). Idempotent, mehrfach
//      ausfuehrbar.
//   2) Verifikation:
//        - Anzahl Kursthemen in public."Kursthemen"
//        - Distinct-Titel in der Quelle (inkl. Verworfener > 255 Zeichen)
//        - 8 Beispieltitel
//   3) Fehlschlag nur, wenn die Migration selbst einen Fehler wirft.
//
// Laueft gegen PostgreSQL auf Port 5433 (Docker), DB kursplan.
// ===========================================================================
const fs = require('fs');
const path = require('path');
const { Client } = require('../app/node_modules/pg');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
  connectionTimeoutMillis: 5000,
  statement_timeout: 60000,
};

const MIGRATION_FILE = path.join(__dirname, '..', 'kursthemen_migration.sql');

async function main() {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');

  const client = new Client(DB_CONFIG);
  await client.connect();
  try {
    console.log(`Migration ausfuehren: ${MIGRATION_FILE}`);
    await client.query(sql);
    console.log('Migration erfolgreich.\n');

    // ------------------------------------------------------------------
    // Verifikation
    // ------------------------------------------------------------------
    const anz = await client.query(
      `SELECT count(*)::int AS n FROM public."Kursthemen"`
    );
    console.log(`Anzahl Kursthemen in public."Kursthemen": ${anz.rows[0].n}`);

    // Quelle: distinct, getrimmte Titel aus aktiven Angeboten.
    const src = await client.query(
      `SELECT count(DISTINCT btrim(name))::int AS n_ges,
              count(DISTINCT btrim(name)) FILTER (
                 WHERE length(btrim(name)) <= 255)::int AS n_importierbar,
              count(DISTINCT btrim(name)) FILTER (
                 WHERE length(btrim(name)) > 255)::int AS n_verworfen
         FROM edoobox_raw.offer
        WHERE name IS NOT NULL
          AND is_deleted IS NOT TRUE
          AND btrim(name) <> ''`
    );
    const s = src.rows[0];
    console.log(`Quelle edoobox_raw.offer (Kennzahlen):`);
    console.log(`  Distinct-Titel gesamt        : ${s.n_ges}`);
    console.log(`  Davon importierbar (<= 255)  : ${s.n_importierbar}`);
    console.log(`  Davon verworfen (> 255)      : ${s.n_verworfen}`);

    // 5 bis 10 Beispieltitel.
    const bsp = await client.query(
      `SELECT titel, created_at
         FROM public."Kursthemen"
        ORDER BY id
        LIMIT 8`
    );
    console.log(`\nBeispieltitel (${bsp.rowCount}):`);
    bsp.rows.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.titel}`);
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});