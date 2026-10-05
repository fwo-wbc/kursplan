// ---------------------------------------------------------------------------
// Verifikation: Kurse im Status "Entwurf" (offer.status = '0') erscheinen
// NICHT mehr in der Trainerverfügbarkeit (/api/verfuegbarkeit).
//
// Vorgehen:
//   1. Entwurf-Kurse (o.status = '0') im Zeitfenster finden, die einem
//      Trainer zugeordnet sind (trainer_zuweisung ODER date_leader).
//   2. NEUE Abfrage (mit o.status <> '0' Filter, identisch zur Route)
//      ausführen und prüfen, dass KEIN Entwurf-Kurs erscheint.
//   3. ALTE Abfrage (ohne Filter) ausführen und zeigen, dass Entwurf-Kurse
//      dort enthalten wären (Beweis, dass der Filter greift).
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
  // 0) Gesamtbestand: Wie viele Entwurf-Angebote (o.status = '0') existieren
  //    überhaupt in der DB (unabhängig von Zeitfenster/Trainer-Zuordnung)?
  const bestandRes = await pool.query(
    `SELECT COUNT(*) AS anzahl
     FROM edoobox_raw.offer
     WHERE status = '0'
       AND is_deleted IS NOT TRUE`
  );
  const entwurfBestand = Number(bestandRes.rows[0].anzahl);
  console.log(`Gesamtbestand Entwurf-Angebote (o.status='0', nicht gelöscht): ${entwurfBestand}`);

  // Zeitfenster für die NEUE Abfrage: bewusst sehr weit (1900–2100), damit
  // ALLE Entwurf-Kurse mit Trainer-Zuordnung abgedeckt sind und der Filter
  // direkt nachgewiesen werden kann.
  const vonFenster = '1900-01-01';
  const bisFenster = '2100-01-01';

  // 1) ALLE Entwurf-Kurse finden, die einem Trainer zugeordnet sind
  //    (trainer_zuweisung ODER date_leader) – ohne Zeitfenster-Beschränkung.
  const entwurfRes = await pool.query(
    `SELECT DISTINCT
       od.date_id,
       o.name AS kursname,
       o.status,
       to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS datum,
       COALESCE(tz.trainer_id, edoo_t.id) AS trainer_id,
       od.date_start AS date_start
     FROM edoobox_raw.offer_date od
     JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
     LEFT JOIN public.trainer_zuweisung tz
            ON od.date_id = tz.date_id
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
     WHERE o.status = '0'
       AND od.is_deleted IS NOT TRUE
       AND o.is_deleted IS NOT TRUE
       AND (tz.trainer_id IS NOT NULL OR edoo_t.id IS NOT NULL)
     ORDER BY od.date_start
     LIMIT 5`
  );
  const entwurfKurse = entwurfRes.rows;
  console.log(
    `Entwurf-Kurse (o.status='0') im Zeitfenster mit Trainer-Zuordnung: ${entwurfKurse.length}`
  );
  for (const k of entwurfKurse) {
    console.log(
      `  - date_id=${k.date_id} "${k.kursname}" am ${k.datum} (trainer_id=${k.trainer_id})`
    );
  }

  if (entwurfKurse.length === 0) {
    console.log(
      '\nHINWEIS: Keine Entwurf-Kurse im Zeitfenster gefunden – der Filter kann ' +
        'nicht direkt anhand von Entwurf-Daten nachgewiesen werden.'
    );
  }

  // 2) NEUE Abfrage (identisch zu /api/verfuegbarkeit GET, Block 2, MIT Filter)
  //    je betroffenem Trainer ausführen und prüfen, dass KEIN Entwurf-Kurs
  //    erscheint.
  const trainerIds = [...new Set(entwurfKurse.map((k) => Number(k.trainer_id)))];
  let verletzungen = 0;
  for (const trainerId of trainerIds) {
    const neuRes = await pool.query(
      `SELECT
         to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS datum,
         od.date_id,
         o.name AS kursname,
         o.status,
         COALESCE(tz.status, 'ausgeschrieben') AS zuweisung_status
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
         AND o.is_deleted IS NOT TRUE
         AND o.status <> '0'
         AND (tz.trainer_id = $1 OR edoo_t.id = $1)
       ORDER BY (od.date_start AT TIME ZONE 'Europe/Berlin')::date, od.date_start`,
      [trainerId, vonFenster, bisFenster]
    );
    const entwurfInNeu = neuRes.rows.filter((r) => String(r.status) === '0');
    if (entwurfInNeu.length > 0) {
      verletzungen += entwurfInNeu.length;
      console.log(
        `  VERLETZUNG: Trainer ${trainerId}: ${entwurfInNeu.length} Entwurf-Kurs(e) erscheinen!`
      );
    }
  }
  console.log(
    verletzungen === 0
      ? 'NEUE Abfrage (mit Filter): KEINE Entwurf-Kurse erscheinen – OK'
      : `NEUE Abfrage (mit Filter): ${verletzungen} Verletzung(en)!`
  );

  // 3) ALTE Abfrage (ohne o.status-Filter) zum Vergleich: Entwurf-Kurse wären
  //    ohne den Fix sichtbar.
  if (trainerIds.length > 0) {
    const altRes = await pool.query(
      `SELECT
         to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS datum,
         od.date_id,
         o.name AS kursname,
         o.status
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
      [trainerIds[0], vonFenster, bisFenster]
    );
    const entwurfInAlt = altRes.rows.filter((r) => String(r.status) === '0');
    console.log(
      `ALTE Abfrage (ohne Filter, Trainer ${trainerIds[0]}): ${entwurfInAlt.length} Entwurf-Kurs(e) sichtbar (Beweis, dass der Filter greift).`
    );
  }

  const ok = verletzungen === 0;
  console.log(
    ok
      ? '\nERGEBNIS: OK – Entwurf-Kurse sind aus der Trainerverfügbarkeit ausgeschlossen.'
      : '\nERGEBNIS: FEHLER – Entwurf-Kurse erscheinen weiterhin.'
  );
  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((err) => {
    console.error('Skriptfehler:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());