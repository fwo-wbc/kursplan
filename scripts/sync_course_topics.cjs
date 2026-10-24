// ===========================================================================
// sync_course_topics.cjs
// Automatische Themen-Ableitung aus edoobox_raw.offer in public.course_topics.
//
// Ablauf:
//   1) Liest die deduplizierten Kursthemen aus der Sicht
//      public.v_course_topics_edoobox (nur aktive, nur name).
//   2) Fuegt neue Namen idempotent in public.course_topics ein
//      (ON CONFLICT (name) DO NOTHING). Bestehende Zeilen bleiben
//      unveraendert - insbesondere die manuell gepflegten Planungsdaten
//      (kurs_code, kategorie_id, vorlage_offer_id, prioritaet, ...).
//   3) Gibt den resultierenden Bestand aus.
//
// Voraussetzung: Migration kursplan_themen_migration.sql ist ausgefuehrt.
// Laueft gegen PostgreSQL auf Port 5433 (Docker).
// ===========================================================================
const { Client } = require('../app/node_modules/pg');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
};

async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  try {
    // 1) Deduplizierte Themen aus edoobox_raw.offer (Sicht).
    const src = await client.query(
      `SELECT name FROM public.v_course_topics_edoobox`
    );
    console.log(`Quelle v_course_topics_edoobox: ${src.rowCount} Themen\n`);

    // 2) Neue Namen idempotent uebernehmen.
    let neu = 0;
    let vorhanden = 0;
    for (const row of src.rows) {
      const ins = await client.query(
        `INSERT INTO public.course_topics (name)
         VALUES ($1)
         ON CONFLICT (name) DO NOTHING`,
        [row.name]
      );
      if (ins.rowCount === 1) {
        neu++;
        console.log(`  + neu eingefuegt: ${row.name}`);
      } else {
        vorhanden++;
      }
    }
    console.log(`\nErgebnis: ${neu} neu eingefuegt, ${vorhanden} bereits vorhanden`);

    // 3) Bestand anzeigen (nur Themen mit Planungsdaten + Gesamtzahl).
    const geplant = await client.query(
      `SELECT kurs_code, name, planungsbereich, prioritaet
         FROM public.course_topics
        WHERE kurs_code IS NOT NULL
        ORDER BY planungsbereich, prioritaet, kurs_code`
    );
    console.log(`\nThemen mit Planungsdaten (${geplant.rowCount}):`);
    for (const r of geplant.rows) {
      console.log(`  [${r.planungsbereich ?? '-'}] P${r.prioritaet ?? '-'} ${r.kurs_code} - ${r.name}`);
    }

    const gesamt = await client.query(
      `SELECT count(*)::int AS n FROM public.course_topics`
    );
    console.log(`\nGesamtbestand course_topics: ${gesamt.rows[0].n}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});