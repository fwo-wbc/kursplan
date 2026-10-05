// Verifikation der automatisierten Schließungsprüfung (Spalte "Hinweis"):
// Zaehlt Kurse mit aktivem Status (Veröffentlicht / Garantierte Durchführung /
// Freigegeben), 0 Teilnehmern und Start innerhalb der naechsten 21 Tage.
//   0-14 Tage  -> 14-Tage-Markierung (Signal-Rot)
//   15-21 Tage -> 21-Tage-Markierung (Rosarot)
// Nutzt die laufende App-API (Port 3000) - keine neue Dependency.
const http = require('http');

const API_URL = 'http://localhost:3000/api/termine';

const SCHLIESSUNG_STATUSWERTE = [
  'Veröffentlicht',
  'Garantierte Durchführung',
  'Freigegeben',
];

/** Formatiert ein Datum als ISO-Tag (YYYY-MM-DD) - identisch zur App. */
function toIsoDate(date) {
  const jahr = date.getFullYear();
  const monat = String(date.getMonth() + 1).padStart(2, '0');
  const tag = String(date.getDate()).padStart(2, '0');
  return `${jahr}-${monat}-${tag}`;
}

/** Fruehester Termin-Start eines Kurses als ISO-Tag (identisch zur App). */
function kursStartIso(kurs) {
  let earliest = null;
  for (const termin of kurs.termine ?? []) {
    if (!termin.date_start) continue;
    const d = new Date(termin.date_start);
    if (Number.isNaN(d.getTime())) continue;
    if (!earliest || d.getTime() < earliest.getTime()) earliest = d;
  }
  return earliest ? toIsoDate(earliest) : null;
}

/** Liefert '14', '21' oder null - identische Logik zu schliessungHinweis(). */
function schliessungStufe(kurs, heuteIso) {
  if (!SCHLIESSUNG_STATUSWERTE.includes(kurs.date_status ?? '')) return null;
  if (kurs.teilnehmer !== 0) return null;

  const kursIso = kursStartIso(kurs);
  if (!kursIso) return null;

  const diffTage = Math.round(
    (new Date(kursIso).getTime() - new Date(heuteIso).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  if (diffTage >= 0 && diffTage <= 14) return '14';
  if (diffTage > 14 && diffTage <= 21) return '21';
  return null;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

(async () => {
  const kurse = await getJson(API_URL);
  const heuteIso = toIsoDate(new Date());

  let anzahl14 = 0;
  let anzahl21 = 0;
  const details = [];

  for (const kurs of kurse) {
    const stufe = schliessungStufe(kurs, heuteIso);
    if (stufe === '14') anzahl14 += 1;
    if (stufe === '21') anzahl21 += 1;
    if (stufe) {
      details.push(
        `${stufe}-Tage  ${kurs.kursnr ?? '?'}  ${kurs.offer_name ?? '?'}  [${kurs.date_status}]`
      );
    }
  }

  console.log(`Stichtag (heute): ${heuteIso}`);
  console.log(`Kurse gesamt (API): ${kurse.length}`);
  console.log(`14-Tage-Markierung (0-14 Tage, Signal-Rot): ${anzahl14}`);
  console.log(`21-Tage-Markierung (15-21 Tage, Rosarot):   ${anzahl21}`);
  if (details.length > 0) {
    console.log('=== Betroffene Kurse ===');
    for (const d of details) console.log(d);
  }
})().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});