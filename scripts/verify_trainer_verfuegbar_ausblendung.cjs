// ---------------------------------------------------------------------------
// Verifikation: Warn-Badge "Trainer nicht verfügbar" wird bei abgesagten
// sowie geschlossenen Kursen mit 0 Teilnehmern unterdrückt.
//
// Prüfziele:
//   1. Kandidaten im Zeitfenster (heute - 4 Wochen bis heute + 6 Wochen):
//      a) geschlossene Angebote (o.status='3') ohne gebuchte Teilnehmer
//      b) abgesagte Angebote (o.status='5')
//   2. GET /api/termine aufrufen und für jeden Kandidaten prüfen:
//      - trainer_verfuegbar === null (keine Verfügbarkeitswarnung)
//      - zuweisung_status === 'abgesagt' (effektiver Status)
//   3. Frontend-Bedingung nachbilden: trainerNichtVerfuegbarHinweis() liefert
//      null (kein Badge), wenn trainer_verfuegbar !== false ODER der Kurs
//      effektiv abgesagt/geschlossen ohne Teilnehmer ist.
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

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

/** Frontend-Bedingung aus page.tsx: trainerNichtVerfuegbarHinweis(kurs). */
function badgeWirdGerendert(kurs) {
  if (kurs.trainer_verfuegbar !== false) return false;
  if (kurs.zuweisung_status === 'abgesagt') return false;
  if (kurs.offer_status === '5') return false;
  if (kurs.offer_status === '3' && (kurs.teilnehmer ?? 0) === 0) return false;
  return true;
}

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
      `  - offer_id=${k.offer_id} | ${k.kursname} | status=${k.offer_status} | TN=${k.teilnehmer} | ${k.datum}`
    );
  }

  // 2) API /api/termine aufrufen.
  const res = await fetch(`${API_BASE}/api/termine`);
  if (!res.ok) {
    throw new Error(`API /api/termine antwortete mit Status ${res.status}`);
  }
  const kurse = await res.json();
  console.log(`\nAPI /api/termine lieferte ${kurse.length} Kurse.`);

  // 3) Kandidaten in der API-Antwort prüfen.
  let fehler = 0;
  for (const k of kandidaten) {
    const kurs = kurse.find((x) => x.offer_id === k.offer_id);
    if (!kurs) {
      console.log(
        `  [FEHLER] offer_id=${k.offer_id} nicht in /api/termine gefunden.`
      );
      fehler++;
      continue;
    }
    const badge = badgeWirdGerendert(kurs);
    const okVerfuegbar = kurs.trainer_verfuegbar === null;
    const okStatus = kurs.zuweisung_status === 'abgesagt';
    const okBadge = badge === false;
    const status = okVerfuegbar && okStatus && okBadge ? 'OK' : 'FEHLER';
    if (status === 'FEHLER') fehler++;
    console.log(
      `  [${status}] offer_id=${k.offer_id} | trainer_verfuegbar=${kurs.trainer_verfuegbar} ` +
        `| zuweisung_status=${kurs.zuweisung_status} | offer_status=${kurs.offer_status} ` +
        `| TN=${kurs.teilnehmer} | Badge gerendert=${badge}`
    );
  }

  if (fehler > 0) {
    throw new Error(`${fehler} Prüfung(en) fehlgeschlagen.`);
  }
  console.log('\nERGEBNIS: Alle Kandidaten liefern trainer_verfuegbar=null ' +
    'und keinen Warn-Badge.');
}

main()
  .then(() => {
    clearTimeout(timer);
    return pool.end();
  })
  .then(() => process.exit(0))
  .catch((err) => {
    clearTimeout(timer);
    console.error('FEHLER:', err.message);
    return pool.end().finally(() => process.exit(1));
  });