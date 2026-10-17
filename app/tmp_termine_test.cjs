/* Temporärer Test: Führt die exakte GET-/api/termine-SQL direkt gegen
   PostgreSQL aus (Port 5433, DB kursplan), um den Fehler zu reproduzieren. */
const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
});

const SQL = `SELECT
         od.date_id,
         od.offer_id,
         od.date_start,
         od.date_end,
         CASE
           WHEN o.status = '1' THEN 'Veröffentlicht'
           WHEN o.status = '2' THEN 'Garantierte Durchführung'
           WHEN o.status = '4' THEN 'Freigegeben'
           WHEN o.status = '3' THEN 'Geschlossen'
           WHEN o.status = '5' THEN 'Abgesagt'
           ELSE COALESCE(o.status, 'Unbekannt')
         END                 AS date_status,
         o.status            AS offer_status,
         o.name              AS offer_name,
         o.offer_type,
         o.offer_number     AS kursnr,
         COALESCE(e.teilnehmer, 0)                 AS teilnehmer,
         COALESCE(e.einnahmen, 0)::numeric         AS einnahmen,
         o.user_maximum            AS max_plaetze,
         tz.id               AS zuweisung_id,
         tz.trainer_id,
         tz.status           AS zuweisung_status,
         tz.notiz            AS zuweisung_notiz,
         tz.honorar_manuell  AS honorar_manuell,
         t.vorname           AS trainer_vorname,
         t.nachname          AS trainer_nachname,
         t.kuerzel           AS trainer_kuerzel,
         t.edoobox_admin_id  AS lokale_edoobox_admin_id,
         dl.admin_id         AS edoo_admin_id,
         edoo_t.id           AS edoo_trainer_id,
         edoo_t.vorname      AS edoo_trainer_vorname,
         edoo_t.nachname     AS edoo_trainer_nachname,
         edoo_t.kuerzel      AS edoo_trainer_kuerzel,
         COALESCE((
           SELECT array_agg(DISTINCT tg.name ORDER BY tg.name)
           FROM edoobox_raw.tag tg
           WHERE tg.is_deleted IS NOT TRUE
             AND tg.tag_id IN (
               SELECT tag_obj.obj->>'tag'
               FROM jsonb_array_elements(
                      CASE
                        WHEN jsonb_typeof(o.payload->'tags') = 'array'
                          THEN o.payload->'tags'
                        ELSE '[]'::jsonb
                      END
                    ) AS tag_obj(obj)
             )
         ), '{}')          AS tags,
         opt.einladungslink,
         opt.last_minute,
         opt.abgerechnet,
         to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS termin_datum,
         (EXTRACT(HOUR FROM (od.date_start AT TIME ZONE 'Europe/Berlin'))
           + EXTRACT(MINUTE FROM (od.date_start AT TIME ZONE 'Europe/Berlin')) / 60.0)::double precision AS start_uhr,
         (EXTRACT(HOUR FROM (od.date_end AT TIME ZONE 'Europe/Berlin'))
           + EXTRACT(MINUTE FROM (od.date_end AT TIME ZONE 'Europe/Berlin')) / 60.0)::double precision AS end_uhr
       FROM edoobox_raw.offer_date od
       LEFT JOIN edoobox_raw.offer o
              ON od.offer_id = o.offer_id
       LEFT JOIN LATERAL (
              WITH pos AS (
                SELECT
                  b.booking_id,
                  p.quantity,
                  p.amount_net,
                  p.last_synced_at,
                  COALESCE(a.ist_erloes,     st.ist_erloes)     AS ist_erloes,
                  COALESCE(a.ist_teilnehmer, st.ist_teilnehmer) AS ist_teilnehmer,
                  st.quelle                                     AS klassenschluessel
                FROM edoobox_raw.booking b
                JOIN edoobox_raw.booking_position p
                  ON p.booking_id = b.booking_id
                CROSS JOIN LATERAL kursplan.einstufung(p.pricecategory_name, p.amount_net)
                       AS st(ist_erloes, ist_teilnehmer, quelle)
                LEFT JOIN kursplan.preiskategorie_ausnahme a
                  ON a.offer_id = b.offer_id
                 AND a.pricecategory_name = p.pricecategory_name
                WHERE b.offer_id = od.offer_id
                  AND b.is_deleted IS NOT TRUE
                  AND b.status = 'gebucht'
                  AND p.last_synced_at = (
                    SELECT MAX(p2.last_synced_at)
                    FROM edoobox_raw.booking_position p2
                    WHERE p2.booking_id = p.booking_id
                  )
             ),
              dedup AS (
                SELECT DISTINCT ON (booking_id, klassenschluessel, amount_net)
                       quantity, amount_net, ist_erloes, ist_teilnehmer
                FROM pos
                ORDER BY booking_id, klassenschluessel, amount_net,
                         last_synced_at DESC NULLS LAST, quantity DESC
              )
              SELECT
                COALESCE(SUM(quantity)
                  FILTER (WHERE ist_teilnehmer), 0)::int          AS teilnehmer,
                COALESCE(SUM(amount_net * quantity)
                  FILTER (WHERE ist_erloes), 0)::numeric          AS einnahmen
              FROM dedup
            ) e ON true
       LEFT JOIN public.termin_optionen opt
              ON od.date_id = opt.date_id
       LEFT JOIN public.trainer_zuweisung tz
              ON od.date_id = tz.date_id
       LEFT JOIN public.trainer t
              ON tz.trainer_id = t.id
       LEFT JOIN LATERAL (
              SELECT dl2.admin_id
              FROM edoobox_raw.date_leader dl2
              WHERE dl2.date_id = od.date_id
                AND dl2.last_synced_at = (
                  SELECT MAX(dl3.last_synced_at)
                  FROM edoobox_raw.date_leader dl3
                  WHERE dl3.date_id = od.date_id
                )
            ) dl ON true
       LEFT JOIN public.trainer edoo_t
              ON dl.admin_id = edoo_t.edoobox_admin_id
       WHERE od.is_deleted IS NOT TRUE
         AND o.is_deleted IS NOT TRUE
         AND od.date_start >= COALESCE(
               $1::timestamptz,
               NOW() - ($2::int * INTERVAL '1 day')
             )
         AND o.status <> '0'
       ORDER BY od.date_start ASC, od.date_id ASC,
                tz.created_at DESC NULLS LAST, tz.id DESC`;

const UPDATE_ABGESAGTE = `UPDATE public.trainer_zuweisung z
     SET status = 'abgesagt',
         updated_at = NOW()
     FROM edoobox_raw.offer_date od
     JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
     WHERE z.date_id = od.date_id
       AND (o.status IN ('3', '5')
            OR o.is_archived IS TRUE
            OR o.is_deleted IS TRUE
            OR od.is_deleted IS TRUE)
       AND z.status IN ('ausgeschrieben', 'unter Vorbehalt')`;

const SELECT_TRAINER = `SELECT id FROM public.trainer WHERE is_active = true ORDER BY id`;

const SELECT_VERF = `SELECT trainer_id,
            to_char(datum, 'YYYY-MM-DD') AS datum,
            slot_code,
            status
     FROM public.trainer_verfuegbarkeit
     WHERE trainer_id = ANY($1::int[])
       AND datum >= $2::date
       AND datum <= $3::date
       AND slot_code = ANY($4::text[])`;

async function main() {
  // 1. UPDATE aktualisiereAbgesagteZuweisungen (in Transaktion + ROLLBACK, keine Datenänderung)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(UPDATE_ABGESAGTE);
    console.log('OK: UPDATE aktualisiereAbgesagteZuweisungen ->', res.rowCount, 'Zeile(n)');
    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FEHLER bei UPDATE aktualisiereAbgesagteZuweisungen:');
    console.error(' ', err.message);
    console.error('  Code:', err.code, '| Position:', err.position);
  }

  // 2. Haupt-Query
  try {
    const result = await pool.query(SQL, [null, 365]);
    console.log('OK: Haupt-Query erfolgreich. Zeilen:', result.rowCount);
  } catch (err) {
    console.error('FEHLER bei Haupt-Query:');
    console.error(' ', err.message);
    console.error('  Code:', err.code, '| Position:', err.position);
  }

  // 3. SELECT Trainer (is_active)
  try {
    const r = await pool.query(SELECT_TRAINER);
    console.log('OK: SELECT public.trainer (is_active) ->', r.rowCount, 'Trainer');
  } catch (err) {
    console.error('FEHLER bei SELECT public.trainer (is_active):');
    console.error(' ', err.message);
    console.error('  Code:', err.code, '| Position:', err.position);
  }

  // 4. Verfuegbarkeits-Query
  try {
    const r = await pool.query(SELECT_VERF, [
      [1],
      '2025-01-01',
      '2026-12-31',
      ['HT', 'K1', 'K2', 'K3', 'K4'],
    ]);
    console.log('OK: Verfuegbarkeits-Query ->', r.rowCount, 'Zeile(n)');
  } catch (err) {
    console.error('FEHLER bei Verfuegbarkeits-Query:');
    console.error(' ', err.message);
    console.error('  Code:', err.code, '| Position:', err.position);
  }

  await pool.end();
}

main();
