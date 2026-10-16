// ---------------------------------------------------------------------------
// Verifikation der Migration 'public.kurs_kategorie_mapping':
//   1) Enthält die Tabelle die Seed-Zeile für 'Word - Seriendruck' mit der
//      erwarteten edoobox category_ref?
//   2) Ist das UNIQUE-Index-Muster (ein Import-Titel -> genau eine ID) aktiv?
//
// Verwendung:
//   node scripts/verify_kurs_kategorie_mapping.cjs
// ---------------------------------------------------------------------------
const path = require('path');

const pgPath = path.join(__dirname, '..', 'app', 'node_modules', 'pg');
const { Client } = require(pgPath);

const ERWARTETER_TITEL = 'Word - Seriendruck';
const ERWARTETE_CATEGORY_REF = 'category_25ea33c5e986_4391280140';

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
    // 1) Seed-Zeile prüfen.
    const result = await client.query(
      `SELECT import_titel, category_id AS category_ref
       FROM public.kurs_kategorie_mapping
       WHERE is_deleted IS NOT TRUE
         AND import_titel = $1::text`,
      [ERWARTETER_TITEL]
    );

    if (result.rows.length === 0) {
      console.error(
        `FEHLER: Kein Mapping für Import-Titel '${ERWARTETER_TITEL}' gefunden.`
      );
      process.exit(1);
    }

    const row = result.rows[0];
    console.log('Gefundenes Mapping:');
    console.table([row]);

    if (String(row.category_ref).trim() !== ERWARTETE_CATEGORY_REF) {
      console.error(
        `FEHLER: category_ref ${row.category_ref} weicht von der erwarteten ` +
          `ID ${ERWARTETE_CATEGORY_REF} ab.`
      );
      process.exit(1);
    }

    // 2) Eindeutigkeit je Import-Titel (exakt ein nicht-gelöschter Eintrag).
    const mehrfach = await client.query(
      `SELECT import_titel, COUNT(*) AS anzahl
       FROM public.kurs_kategorie_mapping
       WHERE is_deleted IS NOT TRUE
       GROUP BY import_titel
       HAVING COUNT(*) > 1`
    );

    if (mehrfach.rows.length > 0) {
      console.error('FEHLER: Mehrere aktive Mappings je Import-Titel:', mehrfach.rows);
      process.exit(1);
    }

    console.log('Verifikation erfolgreich: Mapping konsistent und eindeutig.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler bei der Verifikation:', err.message);
  process.exit(1);
});
