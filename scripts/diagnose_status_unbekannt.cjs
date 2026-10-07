// Diagnose: Vorkommen des Kursstatus "Unbekannt" in edoobox_raw.offer
// Readonly – führt ausschließlich SELECT-Abfragen aus (kein Schreiben, kein DELETE).
// Timeout: statement_timeout = 8s (Gesamtlaufzeit < 10s).
// pg wird aus app/node_modules geladen, damit das Skript cwd-unabhängig läuft.
const { Pool } = require('../app/node_modules/pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
  options: '-c statement_timeout=8000',
});

const GUELTIGE_STATUS = ['1', '2', '3', '4', '5'];

async function main() {
  try {
    // 0) Faktenbasiert ermitteln, wie die Termin-Tabelle im Schema edoobox_raw heißt.
    const tabellen = await pool.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'edoobox_raw'
          AND table_name IN ('offer_date', 'date')
        ORDER BY table_name`
    );
    const terminTabelle = tabellen.rows.map((r) => r.table_name);
    if (terminTabelle.length === 0) {
      console.error('FEHLER: Weder edoobox_raw.offer_date noch edoobox_raw.date gefunden.');
      process.exitCode = 1;
      return;
    }
    console.log(`Termin-Tabelle(n) im Schema edoobox_raw: ${terminTabelle.join(', ')}`);

    // 1) Status-Verteilung in edoobox_raw.offer
    const verteilung = await pool.query(
      `SELECT status, COUNT(*) AS anzahl
         FROM edoobox_raw.offer
        GROUP BY status
        ORDER BY status`
    );
    console.log('\n=== 1) Status-Verteilung in edoobox_raw.offer ===');
    for (const row of verteilung.rows) {
      const s = row.status === null ? 'NULL' : `'${row.status}'`;
      console.log(`  status=${s}  anzahl=${row.anzahl}`);
    }

    // 2) Offers mit status NULL oder außerhalb ('1','2','3','4','5')
    const auffaellig = await pool.query(
      `SELECT status, COUNT(*) AS anzahl
         FROM edoobox_raw.offer
        WHERE status IS NULL OR status NOT IN ('1','2','3','4','5')
        GROUP BY status`
    );
    console.log('\n=== 2) Auffällige Offers (status NULL oder außerhalb 1-5) ===');
    if (auffaellig.rows.length === 0) {
      console.log('  Keine.');
    } else {
      for (const row of auffaellig.rows) {
        const s = row.status === null ? 'NULL' : `'${row.status}'`;
        console.log(`  status=${s}  anzahl=${row.anzahl}`);
      }
    }

    // 3) Termine, die mit auffälligen Offers verknüpft sind
    //    (nur für die tatsächlich vorhandene Termin-Tabelle)
    for (const tabelle of terminTabelle) {
      const spalten = await pool.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'edoobox_raw'
            AND table_name = $1
            AND column_name IN ('offer_id', 'date_id')`,
        [tabelle]
      );
      const spaltenNamen = spalten.rows.map((r) => r.column_name);
      if (!spaltenNamen.includes('offer_id')) {
        console.log(`\n=== 3) ${tabelle}: keine Spalte offer_id vorhanden, Überspringen ===`);
        continue;
      }
      const termine = await pool.query(
        `SELECT d.offer_id, o.status, COUNT(*) AS anzahl_termine
           FROM edoobox_raw.${tabelle} d
           JOIN edoobox_raw.offer o ON o.offer_id = d.offer_id
          WHERE o.status IS NULL OR o.status NOT IN ('1','2','3','4','5')
          GROUP BY d.offer_id, o.status
          ORDER BY d.offer_id
          LIMIT 50`
      );
      console.log(`\n=== 3) Termine (edoobox_raw.${tabelle}) verknüpft mit auffälligen Offers ===`);
      if (termine.rows.length === 0) {
        console.log('  Keine.');
      } else {
        for (const row of termine.rows) {
          const s = row.status === null ? 'NULL' : `'${row.status}'`;
          console.log(`  offer_id=${row.offer_id}  status=${s}  termine=${row.anzahl_termine}`);
        }
      }

      // 4) Aktive auffällige Offers mit Terminen im Zeitfenster (analog API-Logik:
      //    is_deleted IS NOT TRUE, date_start >= 4 Wochen Vergangenheit)
      const aktiv = await pool.query(
        `SELECT o.offer_id, o.status, o.name, COUNT(d.date_id) AS anzahl_termine
           FROM edoobox_raw.${tabelle} d
           JOIN edoobox_raw.offer o ON o.offer_id = d.offer_id
          WHERE (o.status IS NULL OR o.status NOT IN ('1','2','3','4','5'))
            AND o.is_deleted IS NOT TRUE
            AND d.is_deleted IS NOT TRUE
            AND d.date_start >= NOW() - INTERVAL '4 weeks'
          GROUP BY o.offer_id, o.status, o.name
          ORDER BY o.offer_id
          LIMIT 50`
      );
      console.log(`\n=== 4) AKTIVE auffällige Offers (nicht soft-gelöscht, Termine ab -4 Wochen) ===`);
      if (aktiv.rows.length === 0) {
        console.log('  Keine.');
      } else {
        for (const row of aktiv.rows) {
          const s = row.status === null ? 'NULL' : `'${row.status}'`;
          console.log(`  offer_id=${row.offer_id}  status=${s}  name=${row.name}  termine=${row.anzahl_termine}`);
        }
      }
    }
  } catch (err) {
    console.error('FEHLER:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();