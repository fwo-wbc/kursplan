// Wendet die Migration `course_topics_is_active_migration.sql` an und
// verifiziert anschließend Spalte + Standardwert + Index.
// Läuft gegen PostgreSQL auf Port 5433 (Docker).
const { Client } = require('../app/node_modules/pg');

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
    // 1) Spalte anlegen (idempotent).
    await client.query(`
      ALTER TABLE public.course_topics
          ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true
    `);
    console.log('✓ Spalte is_active angelegt (falls nicht vorhanden).');

    // 2) Partieller Index für die aktiven Themen.
    await client.query(`
      CREATE INDEX IF NOT EXISTS course_topics_is_active_idx
          ON public.course_topics (name)
          WHERE is_active IS TRUE
    `);
    console.log('✓ Partieller Index course_topics_is_active_idx sichergestellt.');

    // 3) Verifikation: Spalte + Default.
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'course_topics'
          AND column_name = 'is_active'`
    );
    if (cols.rowCount === 0) {
      throw new Error('Spalte is_active wurde nicht gefunden!');
    }
    const c = cols.rows[0];
    console.log(
      `✓ Spalte is_active | ${c.data_type} | nullable=${c.is_nullable} | default=${c.column_default}`
    );

    // 4) Verifikation: Bestand mit aktiv/inaktiv.
    const counts = await client.query(`
      SELECT is_active, COUNT(*)::int AS anzahl
        FROM public.course_topics
       GROUP BY is_active
       ORDER BY is_active ASC
    `);
    for (const r of counts.rows) {
      console.log(`  Themen is_active=${r.is_active}: ${r.anzahl}`);
    }

    const idx = await client.query(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'course_topics'`
    );
    console.log(`✓ Indizes auf course_topics: ${idx.rows.map((r) => r.indexname).join(', ')}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});