// Prüft: Welche course_topics-Einträge OHNE Kursdaten sind exakt edoobox-Titel?
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
    const r = await c.query(
      `SELECT ct.id, ct.name, ct.is_active,
              EXISTS (SELECT 1 FROM edoobox_raw.offer o
                       WHERE o.is_deleted IS NOT TRUE
                         AND btrim(o.name) = ct.name) AS in_edoobox
         FROM public.course_topics ct
        WHERE ct.kurs_code IS NULL
        ORDER BY ct.id`
    );
    console.log('course_topics OHNE kurs_code (' + r.rowCount + '):');
    for (const x of r.rows) {
      console.log(`  id=${x.id} edoobox=${x.in_edoobox ? 'JA ' : 'nein'} aktiv=${x.is_active} | ${x.name}`);
    }
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});