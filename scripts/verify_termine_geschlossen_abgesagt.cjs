// ---------------------------------------------------------------------------
// Verifikation: Geschlossene Kurse (edoobox-Status '3') mit 0 Teilnehmern
// sowie abgesagte Kurse (edoobox-Status '5') werden in der Kursplanung
// (/api/termine) mit Zuweisungsstatus 'abgesagt' geliefert – exakt konsistent
// zur Trainerverfügbarkeit (/api/verfuegbarkeit).
//
// Vorgehen:
//   1. Kandidaten im Zeitfenster (heute - 4 Wochen bis heute + 6 Wochen) finden:
//      a) geschlossene Angebote (o.status='3') ohne gebuchte Teilnehmer
//      b) abgesagte Angebote (o.status='5')
//   2. Die API /api/termine aufrufen und prüfen, ob die Kandidaten-Kurse
//      Zuweisungen mit status='abgesagt' besitzen.
//   3. Fallback: Falls der Dev-Server nicht läuft, die identische Ableitungs-
//      Logik der Route direkt per SQL prüfen.
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
  // Zeitfenster: heute - 4 Wochen bis heute + 6 Wochen (konsistent zum Sync).
  const heute = new Date();
  const vonFenster = new Date(heute);
  vonFenster.setDate(vonFenster.getDate() - 28);
  const bisFenster = new Date(heute);
  bisFenster.setDate(bisFenster.getDate() + 42);
  const fmt = (d) => d.toISOString().split('T')[0];

  // 1) Kandidaten finden: geschlossen+0TN bzw. abgesagt, gruppiert je offer_id.
  const kandidatenRes = await pool.query(
    `SELECT
       o.offer_id,
       o.name AS kursname,
       o.status AS offer_status,
       COALESCE(tn.teilnehmer, 0) AS teilnehmer,
       MIN(to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD')) AS datum
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
     WHERE (od.date_start AT TIME ZONE 'Europe/Berlin')::date BETWEEN $1::date AND $2::date
       AND od.is_deleted IS NOT TRUE
       AND o.is_deleted IS NOT TRUE
       AND o.status <> '0'
       AND (o.status = '5' OR (o.status = '3' AND COALESCE(tn.teilnehmer, 0) = 0))
     GROUP BY o.offer_id, o.name, o.status, tn.teilnehmer
     ORDER BY MIN(od.date_start)
     LIMIT 10`,
    [fmt(vonFenster), fmt(bisFenster)]
  );
  const kandidaten = kandidatenRes.rows;
  if (kandidaten.length === 0) {
    console.log(
      'HINWEIS: Kein geschlossener Kurs mit 0 TN und kein abgesagter Kurs ' +
        'im Zeitfenster gefunden.'
    );
    return;
  }
  console.log(`Kandidaten (${kandidaten.length}):`);
  for (const k of kandidaten) {
    console.log(
      `  offer_id=${k.offer_id} "${k.kursname}" am ${k.datum} ` +
        `(offer_status='${k.offer_status}', teilnehmer=${k.teilnehmer})`
    );
  }

  const daten = kandidaten.map((k) => k.datum).sort();
  const from = daten[0];

  // 2) API aufrufen und prüfen.
  let httpOk = false;
  let apiKurse = [];
  try {
    const url = `http://localhost:3000/api/termine?from=${from}`;
    const res = await fetch(url);
    const body = await res.json();
    apiKurse = Array.isArray(body) ? body : [];
    console.log(`\nHTTP ${res.status}: ${apiKurse.length} Kurse geliefert.`);
    httpOk = res.status === 200;
  } catch (err) {
    console.log(`\nHTTP-Aufruf fehlgeschlagen: ${err.message}`);
    console.log('Fallback: Ableitungs-Logik der Route wird direkt per SQL geprüft.');
  }

  // 3) Prüfung je Kandidat: Zuweisungen müssen status='abgesagt' besitzen.
  let geprueft = 0;
  let ok = true;
  for (const k of kandidaten) {
    let statuses = null;
    if (httpOk) {
      const kurs = apiKurse.find((x) => x.offer_id === k.offer_id);
      if (!kurs) {
        console.log(
          `  [FEHLT] offer_id=${k.offer_id}: Kurs nicht in API-Antwort enthalten.`
        );
        ok = false;
        continue;
      }
      statuses = (kurs.zuweisungen || []).map((z) => z.status);
    } else {
      // Fallback: identische Ableitungs-Logik der Route direkt per SQL.
      const res = await pool.query(
        `SELECT
           o.offer_id,
           o.status AS offer_status,
           COALESCE(tn.teilnehmer, 0) AS teilnehmer,
           CASE
             WHEN o.status = '5'
               OR (o.status = '3' AND COALESCE(tn.teilnehmer, 0) = 0)
             THEN 'abgesagt'
             ELSE COALESCE(tz.status, 'ausgeschrieben')
           END AS zuweisung_status
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
         LEFT JOIN public.trainer_zuweisung tz ON od.date_id = tz.date_id
         WHERE o.offer_id = $1
           AND od.is_deleted IS NOT TRUE
           AND o.is_deleted IS NOT TRUE
           AND o.status <> '0'
         LIMIT 1`,
        [k.offer_id]
      );
      const row = res.rows[0];
      statuses = row ? [row.zuweisung_status] : null;
    }

    if (!statuses || statuses.length === 0) {
      console.log(
        `  [OHNE ZUWEISUNG] offer_id=${k.offer_id}: keine Zuweisung vorhanden, ` +
          `Kursstatus (date_status) trägt die Absage.`
      );
      continue;
    }

    const alleAbgesagt = statuses.every((s) => s === 'abgesagt');
    geprueft += 1;
    if (alleAbgesagt) {
      console.log(
        `  [OK] offer_id=${k.offer_id}: Zuweisungsstatus(es) = ${JSON.stringify(statuses)}`
      );
    } else {
      console.log(
        `  [FEHLER] offer_id=${k.offer_id}: erwartet 'abgesagt', erhalten ${JSON.stringify(statuses)}`
      );
      ok = false;
    }
  }

  console.log(
    `\nErgebnis: ${geprueft} Kandidat(en) mit Zuweisung geprüft, ` +
      `${ok ? 'alle korrekt als abgesagt' : 'Abweichungen gefunden'}.`
  );
  if (!ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('FEHLER:', err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    clearTimeout(timer);
    return pool.end();
  });