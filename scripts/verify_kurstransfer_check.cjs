// ---------------------------------------------------------------------------
// Verifikation der Kollisions- & Zähler-Prüfung (repliziert exakt die SQL der
// Route POST /api/kurstransfer/check in app/src/app/api/kurstransfer/check/route.ts)
//
// Testfälle:
//   A) wrd-serie / 06.12.2027  -> Erwartung kollision=false (Angebot ist
//      soft-deleted, is_deleted=true -> gilt NICHT als aktives Duplikat),
//      Monatszähler 1227 = 0 (keine aktiven wrd-serie-1227-Angebote).
//   B) wrd-serie / 02.11.2027  -> Erwartung kollision=true, falls das aktive
//      Angebot wrd-serie-1127-1 (is_deleted=false) diesen Termin trägt.
//
// Verwendung: node scripts/verify_kurstransfer_check.cjs
// ---------------------------------------------------------------------------
const path = require('path');

const pgPath = path.join(__dirname, '..', 'app', 'node_modules', 'pg');
const { Client } = require(pgPath);

function pad2(n) { return String(n).padStart(2, '0'); }

function parseDatum(wert) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(wert || '').trim());
  if (!m) return null;
  return { tag: Number(m[1]), monat: Number(m[2]), jahr: Number(m[3]) };
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5433,
    database: process.env.DB_NAME || 'kursplan',
    user: process.env.DB_USER || 'kursplan_user',
    password: process.env.DB_PASSWORD || 'MeinAdmin2026',
  });

  await client.connect();
  try {
    // --- Testzeilen (wie aus der Kurstransfer-MS-Office.xlsx) ---------------
    const zeilen = [
      { kursCode: 'wrd-serie', datum: '06.12.2027', beginn: '09:00' },
      { kursCode: 'wrd-serie', datum: '02.11.2027', beginn: '09:00' },
      { kursCode: 'unbekannt-xyz', datum: '15.03.2028', beginn: '10:00' },
    ];

    const eingaben = zeilen.map((z) => {
      const p = parseDatum(z.datum);
      return {
        ...z,
        kurs_key: `${z.datum}|${z.beginn}|${z.kursCode}`,
        mmyy: p ? `${pad2(p.monat)}${String(p.jahr).slice(-2)}` : '',
        isoDatum: p ? `${p.jahr}-${pad2(p.monat)}-${pad2(p.tag)}` : '',
      };
    });
    const gueltige = eingaben.filter((e) => e.kurs_key && e.mmyy && e.isoDatum);

    // --- 1) Kollisionsabfrage (identisch zur Route) -------------------------
    const kollisionByKey = new Map();
    if (gueltige.length > 0) {
      const kollisionsResult = await client.query(
        `WITH eingaben(kurs_code, mmyy, datum) AS (
           SELECT * FROM unnest($1::text[], $2::text[], $3::date[])
         )
         SELECT e.kurs_code, e.datum::text AS datum,
                EXISTS (
                  SELECT 1
                  FROM edoobox_raw.offer o
                  JOIN edoobox_raw.offer_date od ON od.offer_id = o.offer_id
                  WHERE (o.offer_number = e.kurs_code
                         OR o.offer_number = e.kurs_code || '-' || e.mmyy
                         OR o.offer_number LIKE e.kurs_code || '-' || e.mmyy || '-%')
                    AND (od.date_start AT TIME ZONE 'Europe/Berlin')::date = e.datum
                    AND o.is_deleted IS NOT TRUE
                    AND od.is_deleted IS NOT TRUE
                    AND o.status <> '0'
                ) AS kollision
         FROM eingaben e`,
        [gueltige.map((e) => e.kursCode), gueltige.map((e) => e.mmyy), gueltige.map((e) => e.isoDatum)]
      );
      for (const row of kollisionsResult.rows) {
        kollisionByKey.set(`${row.kurs_code}|${row.datum}`, Boolean(row.kollision));
      }
    }

    // --- 2) Monatszähler (identisch zur Route) ------------------------------
    const monatByKey = new Map();
    const eindeutigeMonate = new Map();
    for (const e of gueltige) {
      eindeutigeMonate.set(`${e.kursCode}|${e.mmyy}`, { kursCode: e.kursCode, mmyy: e.mmyy });
    }
    if (eindeutigeMonate.size > 0) {
      const monatListe = [...eindeutigeMonate.values()];
      const monatResult = await client.query(
        `WITH eingaben(kurs_code, mmyy) AS (
           SELECT * FROM unnest($1::text[], $2::text[])
         )
         SELECT e.kurs_code, e.mmyy,
                (SELECT COUNT(*)
                 FROM edoobox_raw.offer o
                 WHERE o.is_deleted IS NOT TRUE
                   AND o.status <> '0'
                   AND (o.offer_number = e.kurs_code || '-' || e.mmyy
                        OR o.offer_number LIKE e.kurs_code || '-' || e.mmyy || '-%')
                ) AS monat_anzahl
         FROM eingaben e`,
        [monatListe.map((m) => m.kursCode), monatListe.map((m) => m.mmyy)]
      );
      for (const row of monatResult.rows) {
        monatByKey.set(`${row.kurs_code}|${row.mmyy}`, Number(row.monat_anzahl) || 0);
      }
    }

    // --- Ergebnis ausgeben ------------------------------------------------
    console.log('=== Prüfergebnis (repliziert POST /api/kurstransfer/check) ===');
    for (const e of eingaben) {
      const gueltig = Boolean(e.kurs_key && e.mmyy && e.isoDatum);
      const kollision = gueltig ? (kollisionByKey.get(`${e.kursCode}|${e.isoDatum}`) ?? false) : false;
      const monatAnzahl = gueltig ? (monatByKey.get(`${e.kursCode}|${e.mmyy}`) ?? 0) : 0;
      console.log(JSON.stringify({
        kurs_key: e.kurs_key,
        mmyy: e.mmyy,
        kollision,
        monatAnzahl,
      }, null, 2));
    }

    // --- Erwartungsprüfung --------------------------------------------------
    const a = eingaben[0]; // wrd-serie 06.12.2027
    const b = eingaben[1]; // wrd-serie 02.11.2027
    const kA = a.isoDatum && kollisionByKey.get(`${a.kursCode}|${a.isoDatum}`) === true;
    const kB = b.isoDatum && kollisionByKey.get(`${b.kursCode}|${b.isoDatum}`) === true;
    const mA = monatByKey.get(`${a.kursCode}|${a.mmyy}`) ?? 0;

    console.log('=== Erwartungsprüfung ===');
    console.log('A) wrd-serie 06.12.2027 kollision=false erwartet:', kA === false ? 'OK' : 'FEHLER (ist ' + kA + ')');
    console.log('A) wrd-serie Monat 1227 monatAnzahl=0 erwartet:', mA === 0 ? 'OK' : 'FEHLER (ist ' + mA + ')');
    console.log('B) wrd-serie 02.11.2027 kollision=true erwartet:', kB === true ? 'OK' : 'HINWEIS (ist ' + kB + ' – ggf. kein aktives Angebot an diesem Tag)');

    const fehler = kA === true || mA !== 0;
    if (fehler) {
      console.error('FEHLER: Verifikation fehlgeschlagen.');
      process.exit(1);
    }
    console.log('Verifikation erfolgreich (kein Fehler bei Fall A).');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler bei der Verifikation:', err.message);
  process.exit(1);
});
