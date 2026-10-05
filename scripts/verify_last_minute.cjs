// Verifikation der automatisierten Last-Minute-Erkennung (Spalte "Hinweis"):
// Prueft gezielt die Kurse #out-gl-1026 (14.10.) und #ppt-gl-komp-1026 (15.10.)
// gegen die identischen Kriterien wie lastMinuteHinweis() in der App.
// Nutzt die laufende App-API (Port 3000) - keine neue Dependency.
const http = require('http');

const API_URL = 'http://localhost:3000/api/termine';

const LAST_MINUTE_STATUSWERTE = ['Veröffentlicht', 'Garantierte Durchführung'];

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

/** Identische Logik zu lastMinuteHinweis() in der App. */
function lastMinuteTreffer(kurs, heuteIso) {
  const kursIso = kursStartIso(kurs);
  if (!kursIso) return { badge: false, grund: 'kein Startdatum' };

  const diffTage = Math.round(
    (new Date(kursIso).getTime() - new Date(heuteIso).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  if (!(diffTage >= 0 && diffTage <= 14)) {
    return { badge: false, grund: `diffTage=${diffTage} (nicht 0-14)` };
  }
  if (!LAST_MINUTE_STATUSWERTE.includes(kurs.date_status ?? '')) {
    return { badge: false, grund: `Status=${kurs.date_status}` };
  }
  if ((kurs.einnahmen || 0) < 100) {
    return { badge: false, grund: `Einnahmen=${kurs.einnahmen}` };
  }
  if ((kurs.teilnehmer || 0) < 0) {
    return { badge: false, grund: `Teilnehmer=${kurs.teilnehmer}` };
  }
  const hatLastMinuteTag = (kurs.tags ?? []).some((tag) => {
    const bereinigt = tag.trim().toLowerCase();
    return bereinigt === 'lastminute' || bereinigt === 'last minute';
  });
  if (hatLastMinuteTag) {
    return { badge: false, grund: 'Tag LastMinute/Last Minute vorhanden' };
  }
  return { badge: true, grund: 'alle Kriterien erfuellt' };
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
  const zielKursnrs = ['out-gl-1026', 'ppt-gl-komp-1026'];

  console.log(`Stichtag (heute): ${heuteIso}`);
  console.log(`Kurse gesamt (API): ${kurse.length}`);

  for (const kursnr of zielKursnrs) {
    const kurs = kurse.find(
      (k) => (k.kursnr ?? '').trim().toLowerCase() === kursnr.toLowerCase()
    );
    if (!kurs) {
      console.log(`#${kursnr}: NICHT GEFUNDEN in API`);
      continue;
    }
    const ergebnis = lastMinuteTreffer(kurs, heuteIso);
    const startIso = kursStartIso(kurs);
    console.log(
      `#${kursnr}  Start=${startIso}  Status=${kurs.date_status}  ` +
        `Einnahmen=${kurs.einnahmen}  Teilnehmer=${kurs.teilnehmer}  ` +
        `Tags=[${(kurs.tags ?? []).join(', ')}]`
    );
    console.log(
      `  -> Last-Minute-Badge: ${ergebnis.badge ? 'JA (gruen)' : 'NEIN'}  (${ergebnis.grund})`
    );
  }
})().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});