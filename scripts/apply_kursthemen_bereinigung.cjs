// ===========================================================================
// apply_kursthemen_bereinigung.cjs
// Bereinigt public.course_topics: alle per edoobox-Sync automatisch eingefuegten
// Kurstitel werden soft-deleted (is_active = false). Es bleiben ausschliesslich
// die ursprünglichen Kursthemen-KATEGORIEN (z. B. "Microsoft Excel",
// "Microsoft Word", "VBA", "SQL", ...) sowie die geplanten Seed-Kurse (mit
// kurs_code) aktiv.
//
// Ablauf:
//   1) Kategorien-Bestand vor der Bereinigung anzeigen (aktiv, ohne kurs_code).
//   2) Preview: Anzahl der Kurstitel, die deaktiviert wuerden (Dry-Run-Zaehler).
//   3) UPDATE ... SET is_active = false WHERE kurs_code IS NULL AND name kommt
//      als aktiver edoobox-Kurstitel vor (btrim-Vergleich auf beiden Seiten).
//   4) Verifikation des verbleibenden aktiven Bestands.
//
// Konformitaet:
//   - Kein physisches DELETE. Loeschungen laufen ausschliesslich ueber den
//     Loeschvermerk is_active = false (Soft-Delete, siehe
//     course_topics_is_active_migration.sql).
//   - edoobox_raw bleibt unveraendert.
//
// Idempotent mehrfach ausfuehrbar.
// Laueft gegen PostgreSQL auf Port 5433 (Docker), DB kursplan.
// ===========================================================================
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

async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  try {
    // 1) Kategorien-Bestand VOR der Bereinigung (aktiv, ohne kurs_code)
    const kategorien = await client.query(
      `SELECT id, name FROM public.course_topics
        WHERE is_active IS TRUE AND kurs_code IS NULL
        ORDER BY id`
    );
    console.log(`1) Aktive Themen OHNE kurs_code vor der Bereinigung (Kategorien-Kandidaten): ${kategorien.rowCount}`);
    for (const r of kategorien.rows) {
      console.log(`   id=${r.id} | ${r.name}`);
    }

    // 2) Preview: Wie viele davon sind edoobox-Kurstitel?
    const preview = await client.query(
      `SELECT count(*)::int AS n
         FROM public.course_topics ct
        WHERE ct.kurs_code IS NULL
          AND EXISTS (
                SELECT 1 FROM edoobox_raw.offer o
                 WHERE o.is_deleted IS NOT TRUE
                   AND o.name IS NOT NULL
                   AND btrim(o.name) = btrim(ct.name)
              )`
    );
    console.log(`\n2) Preview: ${preview.rows[0].n} Kurstitel wuerden deaktiviert (edoobox-Herkunft).`);

    // 3) Bereinigung ausfuehren (idempotent)
    const upd = await client.query(
      `UPDATE public.course_topics ct
          SET is_active = false
        WHERE ct.kurs_code IS NULL
          AND ct.is_active IS TRUE
          AND EXISTS (
                SELECT 1 FROM edoobox_raw.offer o
                 WHERE o.is_deleted IS NOT TRUE
                   AND o.name IS NOT NULL
                   AND btrim(o.name) = btrim(ct.name)
              )`
    );
    console.log(`3) Deaktiviert: ${upd.rowCount} Kurstitel (is_active = false).`);

    // 4) Verifikation: verbleibende aktive Themen
    const verbleiben = await client.query(
      `SELECT id, name, kurs_code, planungsbereich
         FROM public.course_topics
        WHERE is_active IS TRUE
        ORDER BY kurs_code IS NULL, id`
    );
    console.log(`\n4) Verbleibender aktiver Bestand (${verbleiben.rowCount}):`);
    for (const r of verbleiben.rows) {
      console.log(`   id=${r.id} code=${r.kurs_code ?? '-'} | ${r.name}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});