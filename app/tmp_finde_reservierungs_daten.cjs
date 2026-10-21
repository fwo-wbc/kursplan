/* Temporäre Analyse: Wo liegen die heute angelegten Reservierungen?
 * Reine Leseoperation - keinerlei Schreibzugriffe.
 * 1) Findet alle Tabellen in public + edoobox_raw mit "reservier" im Namen
 * 2) Fragt die neuesten 5 Zeilen je Tabelle ab
 * 3) Fragt Zeilen von HEUTE ab (created_at/updated_at, Berlin-Zeitzone)
 */
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

(async () => {
  // --- 1) Reservierungs-Tabellen finden (gezielt, beide Schemata) ---
  const tabellenRs = await pool.query(`
    SELECT table_schema, table_name
      FROM information_schema.tables
     WHERE table_type = 'BASE TABLE'
       AND (table_schema = 'public' OR table_schema = 'edoobox_raw')
       AND table_name ILIKE '%reservier%'
     ORDER BY table_schema, table_name
  `);
  console.log('=== Reservierungs-Tabellen (public + edoobox_raw) ===');
  for (const t of tabellenRs.rows) {
    console.log(`  ${t.table_schema}.${t.table_name}`);
  }
  console.log('');

  for (const t of tabellenRs.rows) {
    const full = `${t.table_schema}.${t.table_name}`;
    try {
      // --- 2) Spalten der Tabelle ermitteln ---
      const colRs = await pool.query(`
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position
      `, [t.table_schema, t.table_name]);
      const cols = colRs.rows.map((c) => c.column_name);
      const hasId = cols.includes('id');
      const hasCreated = cols.includes('created_at');
      const hasUpdated = cols.includes('updated_at');
      const orderBy = hasId ? 'id' : cols[0];

      // --- 3) Neueste 5 Zeilen ---
      const neu = await pool.query(
        `SELECT * FROM ${full} ORDER BY ${orderBy} DESC LIMIT 5`
      );
      console.log(`=== ${full} : neueste ${neu.rows.length} Zeile(n) ===`);
      if (neu.rows.length === 0) {
        console.log('  (keine Zeilen)');
      } else {
        for (const row of neu.rows) {
          const kompakt = {};
          for (const k of cols) {
            const v = row[k];
            kompakt[k] = v instanceof Date ? v.toISOString() : v;
          }
          console.log('  ' + JSON.stringify(kompakt));
        }
      }

      // --- 4) Zeilen von HEUTE (Berlin) prüfen ---
      if (hasCreated || hasUpdated) {
        const zeitSpalte = hasCreated ? 'created_at' : 'updated_at';
        const heute = await pool.query(
          `SELECT * FROM ${full}
            WHERE ${zeitSpalte} >= (NOW() AT TIME ZONE 'Europe/Berlin')::date
            ORDER BY ${zeitSpalte} DESC LIMIT 10`
        );
        console.log(`  -> HEUTE (bezgl. ${zeitSpalte}): ${heute.rows.length} Zeile(n)`);
        for (const row of heute.rows) {
          const kompakt = {};
          for (const k of cols) {
            const v = row[k];
            kompakt[k] = v instanceof Date ? v.toISOString() : v;
          }
          console.log('     ' + JSON.stringify(kompakt));
        }
      } else {
        console.log('  -> keine Zeitstempel-Spalte vorhanden');
      }
      console.log('');
    } catch (err) {
      console.error(`FEHLER bei ${full}: ${err.message}`);
    }
  }

  await pool.end();
})().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});
