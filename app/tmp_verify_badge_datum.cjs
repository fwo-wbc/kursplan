// ---------------------------------------------------------------------------
// Laufzeit-Verifikation der Badge-Datumslogik "Trainer nicht verfügbar".
// Bildet exakt die Kernlogik aus app/src/app/page.tsx nach:
//   toIsoDate(start) >= heuteIso  ->  Badge erscheint NUR fuer aktuelle &
//   zukuenftige Kurse (Tagesbeginn 00:00, ohne Uhrzeit-Fokus).
// ---------------------------------------------------------------------------
function toIsoDate(date) {
  const jahr = date.getFullYear();
  const monat = String(date.getMonth() + 1).padStart(2, '0');
  const tag = String(date.getDate()).padStart(2, '0');
  return `${jahr}-${monat}-${tag}`;
}

function kursStartDate(termine) {
  let earliest = null;
  for (const t of termine) {
    const d = t.date_start ? new Date(t.date_start) : null;
    if (d && !Number.isNaN(d.getTime()) && (!earliest || d.getTime() < earliest.getTime())) {
      earliest = d;
    }
  }
  return earliest;
}

// Replikat der neuen Pruefung in trainerNichtVerfuegbarHinweis():
// trainer_verfuegbar === false UND Kursdatum >= heutigem Tag.
function badgeErlaubt(kurs, heuteIso) {
  if (kurs.trainer_verfuegbar !== false) return false;
  const start = kursStartDate(kurs.termine);
  if (!start) return false;
  return toIsoDate(start) >= heuteIso;
}

const heute = new Date();
const heuteIso = toIsoDate(heute);

const checks = [
  // 1) Kurs vor 19 Tagen -> vergangener Termin, KEIN Badge.
  [
    'vergangener Termin (heute - 19 Tage) -> kein Badge (erwartet false)',
    badgeErlaubt(
      { trainer_verfuegbar: false, termine: [{ date_start: new Date(heute.getTime() - 19 * 86400000).toISOString() }] },
      heuteIso
    ) === false,
  ],
  // 2) Kurs genau heute -> Badge (Start gleich heutigem Tag).
  [
    'heutiger Termin -> Badge (erwartet true)',
    badgeErlaubt(
      { trainer_verfuegbar: false, termine: [{ date_start: heute.toISOString() }] },
      heuteIso
    ) === true,
  ],
  // 3) Kurs in der Zukunft -> Badge.
  [
    'zukuenftiger Termin (heute + 90 Tage) -> Badge (erwartet true)',
    badgeErlaubt(
      { trainer_verfuegbar: false, termine: [{ date_start: new Date(heute.getTime() + 90 * 86400000).toISOString() }] },
      heuteIso
    ) === true,
  ],
  // 4) Mehrteiliger Kurs: fruehester Termin in der Vergangenheit, Spaeter-Termin
  //    in der Zukunft -> Badge (orientiert sich am fruehesten Termin-Start).
  [
    'mehrteiliger Kurs mit fruehestem Termin in der Vergangenheit -> kein Badge (erwartet false)',
    badgeErlaubt(
      {
        trainer_verfuegbar: false,
        termine: [
          { date_start: new Date(heute.getTime() - 5 * 86400000).toISOString() },
          { date_start: new Date(heute.getTime() + 30 * 86400000).toISOString() },
        ],
      },
      heuteIso
    ) === false,
  ],
  // 5) Trainer verfuegbar -> kein Badge, unabhängig vom Datum.
  [
    'Trainer verfuegbar -> kein Badge (erwartet false)',
    badgeErlaubt(
      { trainer_verfuegbar: true, termine: [{ date_start: new Date(heute.getTime() + 90 * 86400000).toISOString() }] },
      heuteIso
    ) === false,
  ],
];

let ok = true;
console.log(`Heutiges Datum (ISO-Tag): ${heuteIso}`);
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!pass) ok = false;
}
console.log(ok ? '\nALLE CHECKS BESTANDEN' : '\nMINDESTENS EIN CHECK FEHLGESCHLAGEN');
process.exitCode = ok ? 0 : 1;
