// Seed-Skript: Reale Kursthemen in public.course_topics eintragen.
// 1) Entfernt den Test-Eintrag '__VERIFY__ Trainer-Topic' restlos.
// 2) Fügt die 9 echten Kursthemen idempotent ein.
// 3) Gibt den resultierenden Bestand aus.
// Läuft gegen PostgreSQL auf Port 5433 (Docker).
const { Client } = require('./app/node_modules/pg');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
  connectionTimeoutMillis: 5000,
  statement_timeout: 8000,
};

const TOPICS = [
  'Microsoft Excel',
  'Microsoft Word',
  'Microsoft PowerPoint',
  'Power BI Desktop',
  'VBA',
  'LibreOffice Writer',
  'LibreOffice Calc',
  'LibreOffice Impress',
  'SQL',
];

async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  try {
    // 0) Schema-Orientierung: Spalten + UNIQUE-Constraint auf name?
    const schema = await client.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'course_topics'
        ORDER BY ordinal_position`
    );
    console.log('Schema public.course_topics:');
    for (const col of schema.rows) {
      console.log(`  ${col.column_name} ${col.data_type} nullable=${col.is_nullable}`);
    }
    const uniq = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
          AND conrelid = 'public.course_topics'::regclass
          AND contype = 'u'`
    );
    const hasUniqueName = uniq.rows.some((r) => r.def.includes('name'));
    console.log(`UNIQUE-Constraint auf name: ${hasUniqueName ? 'ja' : 'nein'}\n`);

    // 1) Test-Eintrag restlos entfernen (public-Schema, keine Soft-Delete-Pflicht;
    //    ON DELETE CASCADE räumt etwaige trainer_topics-Zuordnungen mit ab).
    const del = await client.query(
      `DELETE FROM public.course_topics WHERE name = '__VERIFY__ Trainer-Topic'`
    );
    console.log(`✓ Test-Eintrag '__VERIFY__ Trainer-Topic' entfernt: ${del.rowCount} Zeile(n)`);

    // 2) Echte Themen idempotent einfügen.
    for (const name of TOPICS) {
      let inserted = false;
      if (hasUniqueName) {
        const ins = await client.query(
          `INSERT INTO public.course_topics (name)
           VALUES ($1)
           ON CONFLICT (name) DO NOTHING`,
          [name]
        );
        inserted = ins.rowCount === 1;
      } else {
        const exists = await client.query(
          `SELECT 1 FROM public.course_topics WHERE name = $1`,
          [name]
        );
        if (exists.rowCount === 0) {
          await client.query(
            `INSERT INTO public.course_topics (name) VALUES ($1)`,
            [name]
          );
          inserted = true;
        }
      }
      console.log(`  ${inserted ? '✓ eingefügt   ' : '= bereits vorhanden'} ${name}`);
    }

    // 3) Bestand anzeigen.
    const all = await client.query(
      `SELECT id, name, created_at
         FROM public.course_topics
        ORDER BY name ASC, id ASC`
    );
    console.log(`\nAktueller Bestand course_topics (${all.rowCount} Zeilen):`);
    for (const row of all.rows) {
      console.log(`  [${row.id}] ${row.name}`);
    }
  } finally {
    await client.end();
  }
}

main();