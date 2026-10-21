/* Temporäre Verifikation des page.tsx-Filters nach dem Fix:
   Reservierung ohne offer_id/offer_name (LEFT-JOIN-Fall) muss durchkommen. */
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('app/tmp_live_termine.json', 'utf8'));

// NEUE Filter-Logik exakt wie in page.tsx nach dem Fix:
function filterKurse(kurse) {
  return kurse.filter((kurs) => {
    if (kurs === null || !Array.isArray(kurs.termine)) return false;
    const status = String(kurs.date_status ?? '').toLowerCase();
    const istReservierung = status === 'reservierung' || status === 'reserviert';
    const hatIdentitaet =
      kurs.offer_id !== null ||
      kurs.offer_name !== null ||
      istReservierung;
    const hatTerminMitId = kurs.termine.some(
      (t) => t && typeof t.date_id === 'string'
    );
    return hatIdentitaet && hatTerminMitId;
  });
}

// Testfall 1: echte Reservierung aus der Live-JSON (offer_id 'reservierung-68')
const echteReservierung = data.find(
  (k) => String(k?.date_status ?? '').toLowerCase() === 'reservierung'
);
console.log('Testfall 1 (echte Reservierung):');
console.log('  vorher durchgelassen:', Boolean(
  echteReservierung && echteReservierung.offer_id !== null
));
console.log('  nach Fix durchgelassen:', Boolean(
  echteReservierung && filterKurse([echteReservierung]).length === 1
));

// Testfall 2: Reservierung OHNE offer_id UND ohne offer_name (LEFT-JOIN-Sonderfall)
const minimalReservierung = {
  offer_id: null,
  offer_name: null,
  date_status: 'Reservierung',
  termine: [
    { date_id: 'res-99', date_start: '2026-10-23T07:00:00.000Z', date_end: '2026-10-23T11:00:00.000Z' },
  ],
};
console.log('Testfall 2 (Reservierung ohne Identität):');
console.log('  alte Logik (offer_id!==null||offer_name!==null):', Boolean(
  minimalReservierung.offer_id !== null || minimalReservierung.offer_name !== null
));
console.log('  neue Logik durchgelassen:', filterKurse([minimalReservierung]).length === 1);

// Testfall 3: Regulärer Kurs mit offer_name, aber Abgesagt – darf weiter durch
const normalerKurs = {
  offer_id: 'offer_x',
  offer_name: 'Excel',
  date_status: 'Abgesagt',
  termine: [{ date_id: 'date_x', date_start: '2026-10-23T07:00:00.000Z', date_end: null }],
};
console.log('Testfall 3 (regulärer abgesagter Kurs):');
console.log('  durchgelassen:', filterKurse([normalerKurs]).length === 1);

// Gesamt-Check: alle 778 Live-Kurse durch neue Logik
const gefiltert = filterKurse(data);
const reserv = gefiltert.filter((k) => String(k?.date_status ?? '').toLowerCase() === 'reservierung');
console.log('Gesamt: durch neue Logik:', gefiltert.length, '| Reservierungen erhalten:', reserv.length);
