// ---------------------------------------------------------------------------
// Verifikation: Kurse mit Status "Ausgeschrieben" erscheinen in der
// Trainerverfügbarkeit, auch wenn noch KEINE Zeile in public.trainer_zuweisung
// existiert (kein manuelles Anklicken im Dropdown).
//
// Vorgehen:
//   1. Trainer mit edoobox_admin_id auswählen.
//   2. Einen "nicht angeklickten" Kurs finden: offer_date, der über
//      edoobox_raw.date_leader dem Trainer zugeordnet ist, aber keine
//      trainer_zuweisung-Zeile für diesen Trainer besitzt.
//   3. Die NEUE Abfrage (aus /api/verfuegbarkeit) ausführen und prüfen,
//      ob der Kurs mit zuweisung_status='ausgeschrieben' erscheint.
//   4. Die ALTE Abfrage (INNER JOIN auf trainer_zuweisung) ausführen und
//      zeigen, dass der Kurs dort NICHT enthalten war.
// ---------------------------------------------------------------------------
// pg liegt in den node_modules der App; der Pfad wird explizit aufgelöst,
// damit das Skript unabhängig vom Aufrufverzeichnis funktioniert.
const path = require('path');
const { Pool } = require(path.join(__dirname, '..', 'app', 'node_modules', 'pg'));

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

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

  // 2) "Nicht angeklickten" Kurs finden: über date_leader dem Trainer
  //    zugeordnet, aber OHNE trainer_zuweisung-Zeile für diesen Trainer.
  //    Zeitfenster: heute - 4 Wochen bis heute + 6 Wochen (konsistent zum
  //    Zeitfenster-Sync), damit ein aktueller Kurs nachgewiesen wird.
  const heute = new Date();
  const vonFenster = new Date(heute);
  vonFenster.setDate(vonFenster.getDate() - 28);
  const bisFenster = new Date(heute);
  bisFenster.setDate(bisFenster.getDate() + 42);
  const fmt = (d) => d.toISOString().split('T')[0];

  const kursRes = await pool.query(
    `SELECT
       od.date_id,
       o.name AS kursname,
       to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS datum,
       to_char(od.date_start AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS start_time
     FROM edoobox_raw.offer_date od
     LEFT JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
     JOIN edoobox_raw.date_leader dl
       ON dl.date_id = od.date_id
     JOIN public.trainer t
       ON dl.admin_id = t.edoobox_admin_id
      AND t.id = $1
     WHERE od.is_deleted IS NOT TRUE
       AND (od.date_start AT TIME ZONE 'Europe/Berlin')::date
             BETWEEN $2::date AND $3::date
       AND NOT EXISTS (
         SELECT 1 FROM public.trainer_zuweisung tz
         WHERE tz.date_id = od.date_id AND tz.trainer_id = $1
       )
     ORDER BY od.date_start
     LIMIT 1`,
    [trainer.id, fmt(vonFenster), fmt(bisFenster)]
  );
  const kurs = kursRes.rows[0];
  if (!kurs) {
    console.log(
      'HINWEIS: Kein Kurs ohne trainer_zuweisung-Zeile gefunden, der über ' +
        'date_leader diesem Trainer zugeordnet ist.'
    );
    return;
  }
  console.log(
    `Kandidat (nicht angeklickt): date_id=${kurs.date_id} ` +
      `"${kurs.kursname}" am ${kurs.datum} um ${kurs.start_time}`
  );

  // Datumsfenster um den Kurstermin herum.
  const von = kurs.datum;
  const bis = kurs.datum;

  // 3) NEUE Abfrage (identisch zu /api/verfuegbarkeit GET, Block 2).
  const neuRes = await pool.query(
    `SELECT
       to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS datum,
       od.date_id,
       o.name AS kursname,
       COALESCE(tz.status, 'ausgeschrieben') AS zuweisung_status,
       to_char(od.date_start AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS start_time,
       to_char(od.date_end AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS end_time
     FROM edoobox_raw.offer_date od
     LEFT JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
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
       AND (tz.trainer_id = $1 OR edoo_t.id = $1)
     ORDER BY (od.date_start AT TIME ZONE 'Europe/Berlin')::date, od.date_start`,
    [trainer.id, von, bis]
  );
  const neuKurs = neuRes.rows.find((r) => r.date_id === kurs.date_id);
  console.log(
    neuKurs
      ? `NEUE Abfrage: Kurs ERSCHEINT mit zuweisung_status='${neuKurs.zuweisung_status}'`
      : 'NEUE Abfrage: Kurs erscheint NICHT (unerwartet!)'
  );

  // 4) ALTE Abfrage (INNER JOIN auf trainer_zuweisung) zum Vergleich.
  const altRes = await pool.query(
    `SELECT
       to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS datum,
       od.date_id,
       o.name AS kursname,
       tz.status AS zuweisung_status
     FROM public.trainer_zuweisung tz
     JOIN edoobox_raw.offer_date od ON od.date_id = tz.date_id
     LEFT JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
     WHERE tz.trainer_id = $1
       AND (od.date_start AT TIME ZONE 'Europe/Berlin')::date BETWEEN $2::date AND $3::date
       AND od.is_deleted IS NOT TRUE
     ORDER BY (od.date_start AT TIME ZONE 'Europe/Berlin')::date, od.date_start`,
    [trainer.id, von, bis]
  );
  const altKurs = altRes.rows.find((r) => r.date_id === kurs.date_id);
  console.log(
    altKurs
      ? `ALTE Abfrage: Kurs war enthalten (status='${altKurs.zuweisung_status}')`
      : 'ALTE Abfrage: Kurs war NICHT enthalten (Ursache bestätigt)'
  );

  // 5) End-to-End: HTTP-Route /api/verfuegbarkeit aufrufen und prüfen, ob der
  //    Kurs in der JSON-Antwort erscheint (Status 200 vorausgesetzt).
  let httpOk = false;
  try {
    const url =
      `http://localhost:3000/api/verfuegbarkeit?trainerId=${trainer.id}` +
      `&von=${von}&bis=${bis}`;
    const res = await fetch(url);
    const body = await res.json();
    const gefunden = (body.kurse || []).find((k) => k.date_id === kurs.date_id);
    console.log(
      `HTTP ${res.status}: Kurs ${gefunden ? 'ERSCHEINT' : 'erscheint NICHT'} ` +
        `(zuweisung_status=${gefunden ? gefunden.zuweisung_status : '-'})`
    );
    httpOk = res.status === 200 && Boolean(gefunden);
  } catch (err) {
    console.log(`HTTP-Aufruf fehlgeschlagen: ${err.message}`);
  }

  const ok = Boolean(neuKurs) && !altKurs && httpOk;
  console.log(ok ? '\nERGEBNIS: OK – Fix wirksam.' : '\nERGEBNIS: FEHLER – Fix nicht wirksam.');
  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((err) => {
    console.error('Skriptfehler:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());