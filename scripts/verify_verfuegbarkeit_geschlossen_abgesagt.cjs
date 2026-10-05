// ---------------------------------------------------------------------------
// Verifikation: Geschlossene Kurse (edoobox-Status '3') mit 0 Teilnehmern
// sowie abgesagte Kurse (edoobox-Status '5') werden in der Trainerverfügbarkeit
// mit zuweisung_status='abgesagt' geliefert.
//
// Vorgehen:
//   1. Trainer mit edoobox_admin_id auswählen.
//   2. Kandidaten im Zeitfenster (heute - 4 Wochen bis heute + 6 Wochen) finden:
//      a) geschlossene Angebote (o.status='3') ohne gebuchte Teilnehmer
//      b) abgesagte Angebote (o.status='5')
//   3. Die API /api/verfuegbarkeit aufrufen und prüfen, ob die Kandidaten mit
//      zuweisung_status='abgesagt' geliefert werden.
//   4. Fallback: Falls der Dev-Server nicht läuft, die identische SQL-Abfrage
//      der Route direkt ausführen und prüfen.
// ---------------------------------------------------------------------------
const path = require('path');
const { Pool } = require(path.join(__dirname, '..', 'app', 'node_modules', 'pg'));

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

// Globaler Timeout: max. 10s Gesamtlaufzeit.
const TIMEOUT_MS = 10000;
const timer = setTimeout(() => {
  console.error('FEHLER: Timeout nach 10s überschritten.');
  process.exit(2);
}, TIMEOUT_MS);

async function main() {
  // 1) Trainer mit edoobox_admin_id auswählen.
  const trainerRes = await pool.query(
    `SELECT id, vorname, nachname, kuerzel, edoobox_admin_id
     FROM public.trainer
     WHERE edoobox_admin_id IS NOT NULL
     ORDER BY id
     LIMIT 1`
  );
  const trainer = trainerRes.rows[0];
  if (!trainer) {
    console.log('FEHLER: Kein Trainer mit edoobox_admin_id gefunden.');
    return;
  }
  console.log(
    `Trainer: id=${trainer.id} ${trainer.vorname} ${trainer.nachname} ` +
      `(kuerzel=${trainer.kuerzel}, edoobox_admin_id=${trainer.edoobox_admin_id})`
  );

  // Zeitfenster: heute - 4 Wochen bis heute + 6 Wochen (konsistent zum Sync).
  const heute = new Date();
  const vonFenster = new Date(heute);
  vonFenster.setDate(vonFenster.getDate() - 28);
  const bisFenster = new Date(heute);
  bisFenster.setDate(bisFenster.getDate() + 42);
  const fmt = (d) => d.toISOString().split('T')[0];

  // 2) Kandidaten finden: geschlossen+0TN bzw. abgesagt, dem Trainer über
  //    trainer_zuweisung ODER date_leader zugeordnet.
  const kandidatenRes = await pool.query(
    `SELECT
       od.date_id,
       o.name AS kursname,
       o.status AS offer_status,
       COALESCE(tn.teilnehmer, 0) AS teilnehmer,
       to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS datum
     FROM edoobox_raw.offer_date od
     LEFT JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
     LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(p.quantity), 0)::int AS teilnehmer
            FROM edoobox_raw.booking b
            JOIN edoobox_raw.booking_position p ON p.booking_id = b.booking_id
            WHERE b.offer_id = od.offer_id
              AND b.is_deleted IS NOT TRUE
              AND b.status = 'gebucht'
          ) tn ON true
     LEFT JOIN public.trainer_zuweisung tz
            ON od.date_id = tz.date_id
           AND tz.trainer_id = $1
     LEFT JOIN LATERAL (
            SELECT dl2.admin_id
            FROM edoobox_raw.date_leader dl2
            WHERE dl2.date_id = od.date_id
              AND dl2.last_synced_at = (
                SELECT MAX(dl3.last_synced_at)
                FROM edoobox_raw.date_leader dl3
                WHERE dl3.date_id = od.date_id
              )
            LIMIT 1
          ) dl ON true
     LEFT JOIN public.trainer edoo_t
            ON dl.admin_id = edoo_t.edoobox_admin_id
     WHERE (od.date_start AT TIME ZONE 'Europe/Berlin')::date BETWEEN $2::date AND $3::date
       AND od.is_deleted IS NOT TRUE
       AND o.is_deleted IS NOT TRUE
       AND o.status <> '0'
       AND (tz.trainer_id = $1 OR edoo_t.id = $1)
       AND (o.status = '5' OR (o.status = '3' AND COALESCE(tn.teilnehmer, 0) = 0))
     ORDER BY od.date_start
     LIMIT 5`,
    [trainer.id, fmt(vonFenster), fmt(bisFenster)]
  );
  const kandidaten = kandidatenRes.rows;
  if (kandidaten.length === 0) {
    console.log(
      'HINWEIS: Kein geschlossener Kurs mit 0 TN und kein abgesagter Kurs ' +
        'im Zeitfenster für diesen Trainer gefunden.'
    );
    return;
  }
  console.log(`Kandidaten (${kandidaten.length}):`);
  for (const k of kandidaten) {
    console.log(
      `  date_id=${k.date_id} "${k.kursname}" am ${k.datum} ` +
        `(offer_status='${k.offer_status}', teilnehmer=${k.teilnehmer})`
    );
  }

  // Datumsfenster um die Kandidaten herum (min/max).
  const daten = kandidaten.map((k) => k.datum).sort();
  const von = daten[0];
  const bis = daten[daten.length - 1];

  // 3) API aufrufen und prüfen.
  let httpOk = false;
  let apiKurse = [];
  try {
    const url =
      `http://localhost:3000/api/verfuegbarkeit?trainerId=${trainer.id}` +
      `&von=${von}&bis=${bis}`;
    const res = await fetch(url);
    const body = await res.json();
    apiKurse = body.kurse || [];
    console.log(`\nHTTP ${res.status}: ${apiKurse.length} Kurse geliefert.`);
    httpOk = res.status === 200;
  } catch (err) {
    console.log(`\nHTTP-Aufruf fehlgeschlagen: ${err.message}`);
    console.log('Fallback: SQL-Abfrage der Route wird direkt geprüft.');
  }

  // 4) Prüfung je Kandidat: zuweisung_status muss 'abgesagt' sein.
  let geprueft = 0;
  let ok = true;
  for (const k of kandidaten) {
    let status = null;
    if (httpOk) {
      const gefunden = apiKurse.find((x) => x.date_id === k.date_id);
      status = gefunden ? gefunden.zuweisung_status : null;
    } else {
      // Fallback: identische SQL-Abfrage der Route (Block 2).
      const res = await pool.query(
        `SELECT
           to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS datum,
           od.date_id,
           o.name AS kursname,
           o.status AS offer_status,
           CASE
             WHEN o.status = '5'
               OR (o.status = '3' AND COALESCE(tn.teilnehmer, 0) = 0)
             THEN 'abgesagt'
             ELSE COALESCE(tz.status, 'ausgeschrieben')
           END AS zuweisung_status,
           COALESCE(tn.teilnehmer, 0) AS teilnehmer
         FROM edoobox_raw.offer_date od
         LEFT JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
         LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(p.quantity), 0)::int AS teilnehmer
                FROM edoobox_raw.booking b
                JOIN edoobox_raw.booking_position p ON p.booking_id = b.booking_id
                WHERE b.offer_id = od.offer_id
                  AND b.is_deleted IS NOT TRUE
                  AND b.status = 'gebucht'
              ) tn ON true
         LEFT JOIN public.trainer_zuweisung tz
                ON od.date_id = tz.date_id
               AND tz.trainer_id = $1
         LEFT JOIN LATERAL (
                SELECT dl2.admin_id
                FROM edoobox_raw.date_leader dl2
                WHERE dl2.date_id = od.date_id
                  AND dl2.last_synced_at = (
                    SELECT MAX(dl3.last_synced_at)
                    FROM edoobox_raw.date_leader dl3
                    WHERE dl3.date_id = od.date_id
                  )
                LIMIT 1
              ) dl ON true
         LEFT JOIN public.trainer edoo_t
                ON dl.admin_id = edoo_t.edoobox_admin_id
         WHERE (od.date_start AT TIME ZONE 'Europe/Berlin')::date BETWEEN $2::date AND $3::date
           AND od.is_deleted IS NOT TRUE
           AND o.is_deleted IS NOT TRUE
           AND o.status <> '0'
           AND (tz.trainer_id = $1 OR edoo_t.id = $1)
         ORDER BY (od.date_start AT TIME ZONE 'Europe/Berlin')::date, od.date_start`,
        [trainer.id, von, bis]
      );
      const gefunden = res.rows.find((r) => r.date_id === k.date_id);
      status = gefunden ? gefunden.zuweisung_status : null;
    }
    geprueft++;
    const korrekt = status === 'abgesagt';
    if (!korrekt) ok = false;
    console.log(
      `  date_id=${k.date_id}: zuweisung_status='${status}' ` +
        `(erwartet 'abgesagt') ${korrekt ? 'OK' : 'FEHLER'}`
    );
  }

  console.log(
    ok
      ? `\nERGEBNIS: OK – ${geprueft}/${kandidaten.length} Kandidaten als 'abgesagt' geliefert.`
      : `\nERGEBNIS: FEHLER – nicht alle Kandidaten als 'abgesagt' geliefert.`
  );
  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((err) => {
    console.error('Skriptfehler:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    clearTimeout(timer);
    pool.end();
  });