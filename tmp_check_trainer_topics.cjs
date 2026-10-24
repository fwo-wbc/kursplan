// Gezielte Prüfung: Existiert die Verknüpfungstabelle trainer_topics sowie der
// Themenstamm course_topics im Schema public? Ggf. vorhandene FK-Constraints ausgeben.
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

async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  try {
    const tables = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('trainer_topics', 'course_topics')
       ORDER BY table_name`
    );
    console.log('TABELLEN (public):');
    for (const r of tables.rows) {
      console.log(`  - ${r.table_name}`);
    }

    const cols = await client.query(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('trainer_topics', 'course_topics')
       ORDER BY table_name, ordinal_position`
    );
    console.log('SPALTEN:');
    for (const r of cols.rows) {
      console.log(`  ${r.table_name} | ${r.column_name} | ${r.data_type} | nullable=${r.is_nullable}`);
    }

    const fks = await client.query(
      `SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND tc.table_name IN ('trainer_topics', 'course_topics')`
    );
    console.log('FOREIGN KEYS:');
    for (const r of fks.rows) {
      console.log(`  ${r.table_name}(${r.column_name}) -> ${r.ref_table}(${r.ref_column})`);
    }

    const count = await client.query(
      `SELECT (SELECT count(*) FROM public.course_topics) AS topics,
              (SELECT count(*) FROM public.trainer) AS trainer`
    );
    console.log(`ANZAHL: course_topics=${count.rows[0].topics}, trainer=${count.rows[0].trainer}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});