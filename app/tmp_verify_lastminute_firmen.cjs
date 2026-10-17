// Deterministische Verifikation der Last-Minute-Badge-Logik aus src/app/page.tsx
// inkl. neuem Firmenkurs/Coaching-Ausschluss (Kursnummer beginnt mit Ziffer).
// Reine Logikprüfung ohne API/DB - lauffähig mit: node tmp_verify_lastminute_firmen.cjs
'use strict';

/** Identische Logik zu istFirmenkurs() in page.tsx. */
function istFirmenkurs(kurs) {
  const erweitert = kurs; // page.tsx: Kurs & {kursnummer?, nummer?, offer_number?}
  const nummer =
    (kurs.kursnr ?? '').trim() ||
    (erweitert.kursnummer ?? '').trim() ||
    (erweitert.nummer ?? '').trim() ||
    (erweitert.offer_number ?? '').trim() ||
    '';
  return /^\d/.test(nummer);
}

/** Identische Logik zu lastMinuteHinweis() in page.tsx (inkl. Firmenkurs-Ausschluss). */
function lastMinuteHinweis(kurs, diffTage) {
  if (istFirmenkurs(kurs)) return null;
  if (!(diffTage >= 0 && diffTage <= 14)) return null;
  if (!['Veröffentlicht', 'Garantierte Durchführung'].includes(kurs.date_status ?? '')) {
    return null;
  }
  if ((kurs.einnahmen || 0) < 100) return null;
  if ((kurs.teilnehmer || 0) < 0) return null;
  const hatLastMinuteTag = (kurs.tags ?? []).some((tag) => {
    const bereinigt = tag.trim().toLowerCase();
    return bereinigt === 'lastminute' || bereinigt === 'last minute';
  });
  if (hatLastMinuteTag) return null;
  return { text: 'Last Minute' };
}

let fehler = 0;
function check(name, ergebnis, erwartet) {
  const ok = ergebnis === erwartet;
  if (!ok) fehler++;
  console.log(
    `  [${ok ? 'OK' : 'FEHLER'}] ${name}: ${String(ergebnis)} (erwartet: ${String(erwartet)})`
  );
}

// Basis-Kurs, der alle Last-Minute-Kriterien erfuellt (diffTage 5, veroeffentlicht, 200 EUR).
function basisKurs(kursnr) {
  return {
    kursnr,
    date_status: 'Veröffentlicht',
    einnahmen: 200,
    teilnehmer: 5,
    tags: [],
  };
}

console.log('== Positivfälle: Offene Kurse (Kursnummer beginnt mit Buchstabe) ==');
for (const nr of ['xls-2026-001', 'wrd-komp-1026', 'ppt-gl-komp-1026', 'out-gl-1026']) {
  check(`Kurs ${nr}`, lastMinuteHinweis(basisKurs(nr), 5) ? 'Badge' : null, 'Badge');
}

console.log('== Negativfälle: Firmenkurse/Coachings (Kursnummer beginnt mit Ziffer) ==');
for (const nr of ['2250-2026-01', '2250-1234', '12345', '9999-xls', '0-abc']) {
  check(`Firmenkurs ${nr}`, lastMinuteHinweis(basisKurs(nr), 5) ? 'Badge' : null, null);
}

console.log('== Firmenkurs über alternative Feldnamen ==');
const kursAlt = basisKurs(null);
kursAlt.kursnummer = '2250-K';
check('Firmenkurs via kursnummer', lastMinuteHinweis(kursAlt, 5) ? 'Badge' : null, null);
const kursAlt2 = basisKurs(null);
kursAlt2.offer_number = '9001';
check('Firmenkurs via offer_number', lastMinuteHinweis(kursAlt2, 5) ? 'Badge' : null, null);

console.log('== Firmenkurs mit manueller Option last_minute (violette Badge) ==');
// Die manuelle Option wird in kursHinweise() ebenfalls via !istFirmenkurs(kurs) ausgeblendet.
const kursOption = basisKurs('2250-999');
kursOption.optionen = { einladungslink: false, last_minute: true, abgerechnet: false };
const optionBadge = !istFirmenkurs(kursOption) && kursOption.optionen.last_minute;
check('Option last_minute bei Firmenkurs', optionBadge ? 'Badge' : null, null);

const kursOptionOffen = basisKurs('xls-2026-002');
kursOptionOffen.optionen = { einladungslink: false, last_minute: true, abgerechnet: false };
const optionBadgeOffen = !istFirmenkurs(kursOptionOffen) && kursOptionOffen.optionen.last_minute;
check('Option last_minute bei offenem Kurs', optionBadgeOffen ? 'Badge' : null, 'Badge');

console.log('== Randfälle ==');
check('Kursnr leer -> kein Firmenkurs', istFirmenkurs(basisKurs(null)) ? 'Firmenkurs' : null, null);
check('Kursnr mit Leerzeichen  " 2250 "', istFirmenkurs(basisKurs(' 2250 ')) ? 'Firmenkurs' : null, 'Firmenkurs');

console.log('\nErgebnis: ' + (fehler === 0 ? 'ALLE TESTS BESTANDEN' : `${fehler} FEHLER`));
process.exit(fehler === 0 ? 0 : 1);
