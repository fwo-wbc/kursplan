// ---------------------------------------------------------------------------
// Laufzeit-Verifikation: kurs_key-Durchreichung in B01_Kurstransfer_edoobox
// Simuliert die Logik der Nodes "Auth & Konfiguration aufbereiten" und
// "ID extrahieren & normalisieren" sowie die Key-Berechnung der Postgres-Query.
// Kein Produktionseffekt (kein edoobox-Aufruf, keine DB-Schreibzugriffe).
// ---------------------------------------------------------------------------

// --- Simulierter Input aus "Array & Auth vorbereiten" (Schleifen-Item) ---
const kurs = {
  sourceOfferId: '12345',
  category: 'wbc',
  number: 'wrd-ab-komp-1026-1',
  name: 'Testkurs',
  date_start: '2026-11-01',
  token: 'test-token',
  edid: 'test-edid',
  kurs_key: '01.11.2026|09:00|wrd-ab-komp',
  datum: '01.11.2026',
  beginn: '09:00',
  kursCode: 'wrd-ab-komp'
};

// --- Node: "Auth & Konfiguration aufbereiten" ---
const config = {
  basis: kurs.sourceOfferId || kurs.basis,
  category: kurs.category,
  number: kurs.number,
  name: kurs.name,
  date_start: kurs.date_start,
  copy_dates: true,
  status: 1,
  token: kurs.token,
  edid: kurs.edid,
  kurs_key: kurs.kurs_key,
  datum: kurs.datum,
  beginn: kurs.beginn,
  kursCode: kurs.kursCode
};

// --- Node: "ID extrahieren & normalisieren" ---
const response = { success: true, data: { id: '99999' } };
const newId = (response.data && response.data.id) || response.id;
if (!newId) throw new Error('Keine neue Angebots-ID gefunden.');

const out = {
  success: response.success,
  new_offer_id: newId,
  basis: config.basis,
  category: config.category,
  number: config.number,
  name: config.name,
  token: config.token,
  edid: config.edid,
  kurs_key: config.kurs_key,
  datum: config.datum,
  beginn: config.beginn,
  kursCode: config.kursCode,
  raw_response: response
};

// --- Query-Key-Berechnung aus "Postgres: Status Erledigt" ---
const key = out.kurs_key || (out.datum + '|' + out.beginn + '|' + out.kursCode);

console.log('Output "ID extrahieren & normalisieren":');
console.log(JSON.stringify(out, null, 2));
console.log('Berechneter kurs_key für Postgres:', key);

if (key === 'undefined|undefined|undefined') {
  console.error('FEHLER: kurs_key ist weiterhin undefined|undefined|undefined');
  process.exit(1);
}
if (key !== '01.11.2026|09:00|wrd-ab-komp') {
  console.error('FEHLER: kurs_key weicht vom erwarteten Wert ab');
  process.exit(1);
}
console.log('OK: kurs_key wird korrekt durchgereicht und von der Query verwendet.');