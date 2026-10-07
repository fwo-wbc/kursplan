// Diagnose: Drei Datensatz-Diskrepanzen (Trainer/Status) in der Kursplan-App.
//
// Betroffene Kurse:
//   1) 15.10.2026 09:00-13:00 "PowerPoint Grundlagen (kompakt)"
//        angezeigt: DH / Unter Vorbehalt   | Soll: FW / Bestätigt
//   2) 21.10.2026 09:00-13:00 "Excel: Daten einlesen mit Power Query"
//        angezeigt: DH / Ausgeschrieben    | Soll: FW / Ausgeschrieben
//   3) 27.11.2026 09:00-13:00 "MS Project Aufbau"
//        angezeigt: FK / Ausgeschrieben    | Soll: MS / Ausgeschrieben
//
// Liest NUR (keine schreibenden Änderungen):
//   a) public.trainer_zuweisung  (ALLE Zeilen je Termin, inkl. Status/Notiz/updated_at)
//   b) edoobox_raw.date_leader   (ALLE Zeilen je Termin mit last_synced_at -> Altbestände)
//   c) edoobox_raw.offer         (status, payload-Leader/Instructor-Felder)
//   d) Teilnehmerzahl/Einnahmen  (gleiche Logik wie /api/termine)
//   e) public.trainer + edoobox_raw.trainer_admin (Stammdaten DH, FW, FK, MS)
//
// Direkter PostgreSQL-Zugriff (Port 5433), Timeout gesamt < 10 s.
const { Client } = require('../app/node_modules/pg');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
  connectionTimeoutMillis: 5000,
  statement_timeout: 8000,
};

const FAELLE = [
  { name: '%PowerPoint Grundlagen%', datum: '2026-10-15', label: 'Fall 1: PowerPoint Grundlagen (kompakt)' },
  { name: '%Power Query%', datum: '2026-10-21', label: 'Fall 2: Excel: Daten einlesen mit Power Query' },
  { name: '%MS Project Aufbau%', datum: '2026-11-27', label: 'Fall 3: MS Project Aufbau' },
];

const BETROFFENE_KUERZEL = ['DH', 'FW', 'FK', 'MS'];

/** Wird während des Laufs mit den gefundenen date_ids befüllt (für Abschnitt f). */
const DATE_IDS = [];

/** Gibt alle Spalten einer Zeile als "spalte = wert" aus. */
function zeigeZeile(prefix, row) {
  for (const [k, v] of Object.entries(row)) {
    const wert = v === null ? 'NULL' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    console.log(`${prefix}${k} = ${wert}`);
  }
}

async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  try {
    for (const fall of FAELLE) {
      console.log('='.repeat(100));
      console.log(fall.label);
      console.log('='.repeat(100));

      const terminResult = await client.query(
        `SELECT od.date_id,
                od.offer_id,
                o.offer_number,
                o.name,
                o.status,
                o.is_deleted AS offer_is_deleted,
                od.is_deleted AS date_is_deleted,
                to_char(od.date_start AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') AS start_berlin,
                to_char(od.date_end AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') AS end_berlin
         FROM edoobox_raw.offer_date od
         JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
         WHERE o.name ILIKE $1
           AND (od.date_start AT TIME ZONE 'Europe/Berlin')::date = $2::date
         ORDER BY od.date_start`,
        [fall.name, fall.datum]
      );

      if (terminResult.rows.length === 0) {
        console.log('  -> KEIN Termin gefunden (Name/Datum).');
        continue;
      }

      for (const row of terminResult.rows) {
        const dateId = row.date_id;
        const offerId = row.offer_id;
        DATE_IDS.push(dateId);
        console.log('');
        console.log(`Termin: ${dateId} | Offer: ${offerId} | ${row.offer_number} | ${row.name}`);
        console.log(`  Start (Berlin): ${row.start_berlin} - ${row.end_berlin}`);
        console.log(`  o.status = ${row.status} | offer.is_deleted = ${row.offer_is_deleted} | date.is_deleted = ${row.date_is_deleted}`);

        // --- a) Lokale Zuweisungen (ALLE Zeilen, auch Altbestände) ---
        const tzResult = await client.query(
          `SELECT tz.*, t.kuerzel, t.vorname, t.nachname, t.edoobox_admin_id
           FROM public.trainer_zuweisung tz
           LEFT JOIN public.trainer t ON t.id = tz.trainer_id
           WHERE tz.date_id = $1
           ORDER BY tz.updated_at DESC NULLS LAST, tz.id`,
          [dateId]
        );
        console.log('  --- a) public.trainer_zuweisung (alle Zeilen) ---');
        if (tzResult.rows.length === 0) {
          console.log('    (keine lokale Zuweisung)');
        }
        for (const z of tzResult.rows) {
          zeigeZeile('    ', z);
          console.log('    ---');
        }

        // --- b) date_leader: ALLE Zeilen (Altbestände erkennen) ---
        const dlResult = await client.query(
          `SELECT dl.*, ta.*
           FROM edoobox_raw.date_leader dl
           LEFT JOIN edoobox_raw.trainer_admin ta ON ta.admin_id = dl.admin_id
           WHERE dl.date_id = $1
           ORDER BY dl.last_synced_at DESC NULLS LAST, dl.admin_id`,
          [dateId]
        );
        console.log('  --- b) edoobox_raw.date_leader (ALLE Zeilen, neueste zuerst) ---');
        if (dlResult.rows.length === 0) {
          console.log('    (keine date_leader-Zeilen -> edoo_admin_id = NULL -> Fallback auf lokale Zuweisung)');
        }
        for (const d of dlResult.rows) {
          zeigeZeile('    ', d);
          console.log('    ---');
        }

        // --- c) offer.payload: Trainer-/Leiter-Felder ---
        const offerResult = await client.query(
          `SELECT payload FROM edoobox_raw.offer WHERE offer_id = $1`,
          [offerId]
        );
        const payload = offerResult.rows.length > 0 ? (offerResult.rows[0].payload ?? {}) : {};
        console.log('  --- c) edoobox_raw.offer.payload (Trainer-Felder) ---');
        const trainerKeys = Object.keys(payload).filter((k) => /instr|leader|trainer|dozent|leiter/i.test(k));
        if (trainerKeys.length === 0) {
          console.log('    (keine Felder mit instructor/leader/trainer/dozent/leiter im payload)');
        }
        for (const key of trainerKeys) {
          console.log(`    payload->'${key}' = ${JSON.stringify(payload[key])}`);
        }
        for (const pfad of ['instructors', 'instructor_id', 'leader', 'leaders', 'responsible']) {
          if (payload[pfad] !== undefined) {
            console.log(`    [gezielt] payload->'${pfad}' = ${JSON.stringify(payload[pfad])}`);
          }
        }

        // --- d) Teilnehmerzahl/Einnahmen (Logik wie /api/termine) ---
        try {
          const tnResult = await client.query(
            `SELECT COALESCE(SUM(quantity) FILTER (WHERE ist_teilnehmer), 0)::int AS teilnehmer,
                    COALESCE(SUM(amount_net * quantity) FILTER (WHERE ist_erloes), 0)::numeric AS einnahmen
             FROM (
               SELECT DISTINCT ON (b.booking_id, st.quelle, p.amount_net)
                      p.quantity, p.amount_net, p.last_synced_at,
                      COALESCE(a.ist_erloes, st.ist_erloes) AS ist_erloes,
                      COALESCE(a.ist_teilnehmer, st.ist_teilnehmer) AS ist_teilnehmer,
                      st.quelle
               FROM edoobox_raw.booking b
               JOIN edoobox_raw.booking_position p ON p.booking_id = b.booking_id
               CROSS JOIN LATERAL kursplan.einstufung(p.pricecategory_name, p.amount_net)
                      AS st(ist_erloes, ist_teilnehmer, quelle)
               LEFT JOIN kursplan.preiskategorie_ausnahme a
                 ON a.offer_id = b.offer_id AND a.pricecategory_name = p.pricecategory_name
               WHERE b.offer_id = $1
                 AND b.is_deleted IS NOT TRUE
                 AND b.status = 'gebucht'
               ORDER BY b.booking_id, st.quelle, p.amount_net,
                        p.last_synced_at DESC NULLS LAST, p.quantity DESC
             ) dedup`,
            [offerId]
          );
          const tn = tnResult.rows[0];
          console.log('  --- d) Teilnehmer/Einnahmen (Route-Logik) ---');
          console.log(`    teilnehmer = ${tn.teilnehmer} | einnahmen = ${tn.einnahmen}`);
        } catch (e) {
          console.log(`  --- d) Teilnehmer/Einnahmen: FEHLER: ${e.message}`);
        }
      }
    }

    // --- e) Stammdaten der betroffenen Trainer (lokal + edoobox-Spiegelung) ---
    console.log('');
    console.log('='.repeat(100));
    console.log('e) Stammdaten der betroffenen Trainer (DH, FW, FK, MS)');
    console.log('='.repeat(100));
    const trResult = await client.query(
      `SELECT t.id, t.kuerzel, t.vorname, t.nachname, t.edoobox_admin_id, t.is_active
       FROM public.trainer t
       WHERE t.kuerzel = ANY($1::text[])
       ORDER BY t.kuerzel`,
      [BETROFFENE_KUERZEL]
    );
    for (const t of trResult.rows) {
      console.log(`  public.trainer: id=${t.id} kuerzel=${t.kuerzel} name=${t.vorname} ${t.nachname} edoo_admin_id=${t.edoobox_admin_id} is_active=${t.is_active}`);
    }
    const taResult = await client.query(
      `SELECT ta.*
       FROM edoobox_raw.trainer_admin ta
       WHERE ta.shortcut = ANY($1::text[])
       ORDER BY ta.shortcut`,
      [BETROFFENE_KUERZEL]
    );
    for (const t of taResult.rows) {
      zeigeZeile('  edoobox_raw.trainer_admin: ', t);
    }

    // --- f) Nachbildung der Route-Logik (/api/termine) für die drei Termine ---
    // Führt die exakte SQL der Route aus und wendet die JS-Deduplizierung an,
    // um zu zeigen, welche Zuweisungen/Status die API aktuell liefern würde.
    console.log('');
    console.log('='.repeat(100));
    console.log('f) Nachbildung der Route-Logik (/api/termine)');
    console.log('='.repeat(100));

    const routeResult = await client.query(
      `SELECT
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
         edoo_t.kuerzel      AS edoo_trainer_kuerzel
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
       WHERE od.date_id = ANY($1::text[])
         AND od.is_deleted IS NOT TRUE
         AND o.is_deleted IS NOT TRUE
       ORDER BY od.date_start ASC, od.date_id ASC`,
      [DATE_IDS]
    );

    // JS-Logik der Route nachbilden (Deduplizierung + Status-Überschreibung).
    const kursMap = new Map();
    for (const row of routeResult.rows) {
      const gruppenSchluessel = row.offer_id ?? row.date_id;
      let build = kursMap.get(gruppenSchluessel);
      if (!build) {
        build = { lokaleZuweisungen: new Map(), edooboxZuweisungen: new Map() };
        kursMap.set(gruppenSchluessel, build);
      }
      const passtZuLeiter =
        row.edoo_admin_id !== null &&
        row.lokale_edoobox_admin_id !== null &&
        row.lokale_edoobox_admin_id === row.edoo_admin_id;

      if (
        row.zuweisung_id !== null &&
        row.trainer_id !== null &&
        !build.lokaleZuweisungen.has(row.trainer_id) &&
        (row.edoo_admin_id === null || passtZuLeiter)
      ) {
        build.lokaleZuweisungen.set(row.trainer_id, {
          id: row.zuweisung_id,
          trainer_id: row.trainer_id,
          status: row.zuweisung_status,
          kuerzel: row.trainer_kuerzel,
        });
      }
      if (
        row.edoo_trainer_id !== null &&
        !build.edooboxZuweisungen.has(row.edoo_trainer_id)
      ) {
        build.edooboxZuweisungen.set(row.edoo_trainer_id, {
          id: null,
          trainer_id: row.edoo_trainer_id,
          status:
            row.date_status === 'Garantierte Durchführung' ? 'bestätigt' : 'ausgeschrieben',
          kuerzel: row.edoo_trainer_kuerzel,
        });
      }
    }

    for (const [key, build] of kursMap) {
      const zuweisungen = [];
      if (build.edooboxZuweisungen.size > 0) {
        for (const [trainerId, edooZ] of build.edooboxZuweisungen) {
          const lokal = build.lokaleZuweisungen.get(trainerId);
          if (lokal) {
            edooZ.status = lokal.status;
          }
          zuweisungen.push(edooZ);
        }
      } else {
        zuweisungen.push(...build.lokaleZuweisungen.values());
      }
      const status = zuweisungen[0]?.status ?? null;
      const trainer = zuweisungen.map((z) => `${z.kuerzel} (${z.status})`).join(', ') || '(keine)';
      console.log(`  ${key}:`);
      console.log(`    angezeigte Zuweisungen: ${trainer}`);
      console.log(`    zuweisung_status (erste Zuweisung): ${status}`);
    }

    console.log('');
    console.log('FERTIG (nur Leseoperationen, keine Änderungen).');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});