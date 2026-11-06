// =============================================================================
// Lesende Analyse zur Kurs-Identifikation (angebot_id + course_code)
// -----------------------------------------------------------------------------
// Prüft:
//   1. Schema von public.trainer_zuweisung (Spalten, PK/FK/UNIQUE)
//   2. edoobox_raw-Spiegeltabellen (Feldnamen Angebots-ID / course_code)
//   3. Duplikate: gleiche course_code bei unterschiedlichen Angebots-/Termin-IDs
//   4. Verwaiste Zuweisungen ohne aktiven Termin
// Führt ausschließlich SELECT-Abfragen aus (kein Schreibzugriff).
// =============================================================================
const { createPool } = require('./lib/portal_db.cjs');

async function run() {
  const pool = createPool();
  const out = {};

  try {
    // -------------------------------------------------------------------------
    // 1. public.trainer_zuweisung – Spalten
    // -------------------------------------------------------------------------
    const colsTz = await pool.query(
      `SELECT column_name, data_type, is_nullable,
              COALESCE(column_default, '') AS column_default,
              character_maximum_length AS max_len
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'trainer_zuweisung'
       ORDER BY ordinal_position`
    );
    out.trainer_zuweisung_spalten = colsTz.rows;

    // -------------------------------------------------------------------------
    // 1b. Constraints von public.trainer_zuweisung
    // -------------------------------------------------------------------------
    const consTz = await pool.query(
      `SELECT tc.constraint_name, tc.constraint_type,
              kcu.column_name, kcu.ordinal_position,
              cc.check_clause,
              -- Fremdschlüssel-Ziel
              (SELECT ccu.table_schema || '.' || ccu.table_name || '.' || ccu.column_name
               FROM information_schema.constraint_column_usage ccu
               WHERE ccu.constraint_name = tc.constraint_name
                 AND ccu.table_schema = tc.table_schema
               LIMIT 1) AS referenced_by
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
        AND kcu.table_name = tc.table_name
       LEFT JOIN information_schema.check_constraints cc
         ON cc.constraint_name = tc.constraint_name
        AND cc.constraint_schema = tc.table_schema
       WHERE tc.table_schema = 'public'
         AND tc.table_name = 'trainer_zuweisung'
       ORDER BY tc.constraint_type, tc.constraint_name, kcu.ordinal_position`
    );
    out.trainer_zuweisung_constraints = consTz.rows;

    // -------------------------------------------------------------------------
    // 2. edoobox_raw – relevante Tabellen (nur diese, kein Scan aller Tabellen)
    // -------------------------------------------------------------------------
    const rawTables = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'edoobox_raw'
         AND table_name IN (
           'offer', 'offer_date', 'courses', 'dates', 'course',
           'offers', 'offer_date_leader', 'date_leader', 'trainer_admin'
         )
       ORDER BY table_name`
    );
    out.edoobox_raw_tabellen = rawTables.rows;

    // -------------------------------------------------------------------------
    // 2b. Spalten der relevanten edoobox_raw-Tabellen
    // -------------------------------------------------------------------------
    const rawCols = await pool.query(
      `SELECT table_name, column_name, data_type, is_nullable,
              COALESCE(column_default, '') AS column_default,
              character_maximum_length AS max_len
       FROM information_schema.columns
       WHERE table_schema = 'edoobox_raw'
         AND table_name IN (
           'offer', 'offer_date', 'courses', 'dates', 'course',
           'offers', 'date_leader', 'trainer_admin'
         )
       ORDER BY table_name, ordinal_position`
    );
    out.edoobox_raw_spalten = rawCols.rows;

    // -------------------------------------------------------------------------
    // 2c. Gibt es wirklich eine Spalte mit course_code / code in edoobox_raw?
    // -------------------------------------------------------------------------
    const codeCols = await pool.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'edoobox_raw'
         AND column_name ILIKE '%code%'
       ORDER BY table_name, column_name`
    );
    out.edoobox_raw_code_spalten = codeCols.rows;

    // -------------------------------------------------------------------------
    // 3. Duplikate: gleiche course_code bei unterschiedlichen Angebots-/Termin-IDs
    //    (abhängig davon, wo course_code liegt – wird beides gezeigt)
    // -------------------------------------------------------------------------
    const dupOffer = await pool.query(
      `WITH codes AS (
         SELECT o.course_code AS course_code, o.offer_id
         FROM edoobox_raw.offer o
         WHERE o.is_deleted IS NOT TRUE
           AND o.course_code IS NOT NULL
         GROUP BY o.course_code, o.offer_id
       )
       SELECT course_code, count(*) AS anzahl_angebote,
              string_agg(offer_id::text, ', ' ORDER BY offer_id) AS offer_ids
       FROM codes
       GROUP BY course_code
       HAVING count(*) > 1
       ORDER BY count(*) DESC
       LIMIT 50`
    ).catch((e) => ({ rows: [{ fehler: e.message }] }));
    out.duplikate_course_code_offer = dupOffer.rows;

    const dupOfferAlias = await pool.query(
      `WITH codes AS (
         SELECT o.code AS course_code, o.offer_id
         FROM edoobox_raw.offer o
         WHERE o.is_deleted IS NOT TRUE
           AND o.code IS NOT NULL
         GROUP BY o.code, o.offer_id
       )
       SELECT course_code, count(*) AS anzahl_angebote,
              string_agg(offer_id::text, ', ' ORDER BY offer_id) AS offer_ids
       FROM codes
       GROUP BY course_code
       HAVING count(*) > 1
       ORDER BY count(*) DESC
       LIMIT 50`
    ).catch((e) => ({ rows: [{ fehler: e.message }] }));
    out.duplikate_code_offer = dupOfferAlias.rows;

    // -------------------------------------------------------------------------
    // 4. Verwaiste Zuweisungen: tz ohne aktiven offer_date in edoobox_raw
    // -------------------------------------------------------------------------
    const orphan = await pool.query(
      `SELECT count(*) AS verwaiste_zaehlung
       FROM public.trainer_zuweisung tz
       LEFT JOIN edoobox_raw.offer_date od
         ON od.date_id = tz.date_id
        AND od.is_deleted IS NOT TRUE
       WHERE od.date_id IS NULL`
    );
    out.verwaiste_zuweisungen_gesamt = orphan.rows;

    // -------------------------------------------------------------------------
    // 4b. Verwaiste Zuweisungen: Stichprobe (bis 20, mit Ausreißer-Statistik)
    // -------------------------------------------------------------------------
    const orphanSamples = await pool.query(
      `SELECT tz.id, tz.date_id, tz.trainer_id, tz.status, tz.created_at
       FROM public.trainer_zuweisung tz
       LEFT JOIN edoobox_raw.offer_date od
         ON od.date_id = tz.date_id
        AND od.is_deleted IS NOT TRUE
       WHERE od.date_id IS NULL
       ORDER BY tz.id
       LIMIT 20`
    );
    out.verwaiste_zuweisungen_stichprobe = orphanSamples.rows;

    // -------------------------------------------------------------------------
    // 4c. Offer-Datum ohne aktiven Offer? (Kettenriss-Termine)
    // -------------------------------------------------------------------------
    const orphanDates = await pool.query(
      `SELECT count(*) AS termine_ohne_offer
       FROM edoobox_raw.offer_date od
       LEFT JOIN edoobox_raw.offer o
         ON o.offer_id = od.offer_id
        AND o.is_deleted IS NOT TRUE
       WHERE od.is_deleted IS NOT TRUE
         AND o.offer_id IS NULL`
    );
    out.termine_ohne_aktiven_offer = orphanDates.rows;

    // -------------------------------------------------------------------------
    // 5. Wichtige Bestandszahlen (ohne Volllisten)
    // -------------------------------------------------------------------------
    const totalTz = await pool.query(
      `SELECT count(*) AS anzahl FROM public.trainer_zuweisung`
    );
    out.zuweisungen_gesamt = totalTz.rows;

    const totalDates = await pool.query(
      `SELECT count(*) AS anzahl
       FROM edoobox_raw.offer_date
       WHERE is_deleted IS NOT TRUE`
    );
    out.aktive_termine_gesamt = totalDates.rows;

    // -------------------------------------------------------------------------
    // Ausgabe
    // -------------------------------------------------------------------------
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[FEHLER]', err.message);
  process.exit(1);
});
