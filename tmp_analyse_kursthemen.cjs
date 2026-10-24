// Gezielte Analyse: course_topics, kurs_kategorie_mapping, "Kursthemen"
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
  const c = new Client(DB_CONFIG);
  await c.connect();
  try {
    // 1) Spalten von kurs_kategorie_mapping
    const cols = await c.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='kurs_kategorie_mapping'
        ORDER BY ordinal_position`
    );
    console.log('kurs_kategorie_mapping Spalten:');
    for (const x of cols.rows) console.log(`  ${x.column_name} | ${x.data_type}`);

    // 2) Inhalt kurs_kategorie_mapping (Kategorien!)
    const km = await c.query(`SELECT * FROM public.kurs_kategorie_mapping ORDER BY 1`);
    console.log('\nkurs_kategorie_mapping (' + km.rowCount + ' Zeilen):');
    for (const r of km.rows) console.log('  ', JSON.stringify(r));

    // 3) course_topics Zahlen
    const g = await c.query(
      `SELECT count(*)::int AS gesamt,
              count(*) FILTER (WHERE kurs_code IS NOT NULL)::int AS mit_kurs_code
         FROM public.course_topics`
    );
    console.log('\ncourse_topics:', g.rows[0]);

    const kat = await c.query(
      `SELECT kategorie_name, count(*)::int AS n
         FROM public.course_topics
        GROUP BY kategorie_name ORDER BY kategorie_name NULLS FIRST`
    );
    console.log('\ncourse_topics nach kategorie_name (max 30):');
    kat.rows.slice(0, 30).forEach((x) => console.log(`  ${JSON.stringify(x.kategorie_name)} -> ${x.n}`));

    // 4) course_topics ohne Planungsdaten und ohne Kategorie -> Kurstitel-Kandidaten
    const ohne = await c.query(
      `SELECT id, name, is_active
         FROM public.course_topics
        WHERE kurs_code IS NULL AND kategorie_id IS NULL AND kategorie_name IS NULL
        ORDER BY id LIMIT 15`
    );
    console.log('\ncourse_topics OHNE Planungsdaten/Kategorie (Beispiel):');
    ohne.rows.forEach((r) => console.log(`  id=${r.id} is_active=${r.is_active} | ${r.name}`));

    // 5) Alle distinct kategorie_id/kategorie_name in course_topics mit Planungsdaten
    const gepl = await c.query(
      `SELECT DISTINCT kategorie_name FROM public.course_topics WHERE kurs_code IS NOT NULL ORDER BY kategorie_name`
    );
    console.log('\nGeplante Kurse - kategorie_name (nur mit Kursdaten):');
    for (const x of gepl.rows) console.log('  -', x.kategorie_name);

  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});