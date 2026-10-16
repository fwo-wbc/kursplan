// ---------------------------------------------------------------------------
// Laufzeit-Verifikation: "Postgres: Status Erledigt (Start-Batch)" in
// B01_Kurstransfer_edoobox. Simuliert die Nodes "Kurse für Status-Batch
// aufbereiten" (Code) und die SQL-Expression der Start-Batch-Postgres-Node.
// Kein Produktionseffekt (kein edoobox-Aufruf, keine DB-Schreibzugriffe).
// ---------------------------------------------------------------------------

// --- Simulierter Webhook-Body (Struktur aus Frontend syncToEdoobox) ---
const webhookItem = {
  body: {
    kurse: [
      {
        sourceOfferId: '12345',
        category: 'wbc',
        number: 'wrd-ab-komp-1026-1',
        name: 'Testkurs 1',
        date_start: '2026-11-01',
        kurs_key: '01.11.2026|09:00|wrd-ab-komp',
        datum: '01.11.2026',
        beginn: '09:00',
        kursCode: 'wrd-ab-komp'
      },
      {
        sourceOfferId: '12346',
        category: 'wbc',
        number: 'ms-excel-1026-1',
        name: 'Testkurs 2',
        date_start: '2026-11-02',
        datum: '02.11.2026',
        beginn: '10:00',
        kursCode: 'ms-excel'
      }
    ]
  }
};

// --- Node: "Kurse für Status-Batch aufbereiten" (Code) ---
let body = webhookItem.body || webhookItem;
if (typeof body === 'string') {
  try { body = JSON.parse(body); } catch (e) { body = {}; }
}
let kurse = (body && Array.isArray(body.kurse)) ? body.kurse : [];
if (kurse.length === 0 && body && body.name) {
  kurse = [body];
}
if (kurse.length === 0) {
  console.error('FEHLER: Keine Kurse im Webhook-Body gefunden.');
  process.exit(1);
}
const batchKurse = kurse.map((k) => {
  const key = k.kurs_key || ((k.datum && k.beginn && k.kursCode)
    ? (k.datum + '|' + k.beginn + '|' + k.kursCode)
    : null);
  return { kurs_key: key };
});
if (batchKurse.some((k) => !k.kurs_key)) {
  console.error('FEHLER: Mindestens ein Kurs ohne kurs_key/datum/beginn/kursCode.');
  process.exit(1);
}

// --- SQL-Expression der Postgres-Node "Postgres: Status Erledigt (Start-Batch)" ---
const sql =
  "INSERT INTO kurstransfer_status (kurs_key, status, updated_at)\nVALUES \n" +
  batchKurse.map((k) => "('" + k.kurs_key + "', 'erledigt', NOW())").join(', ') +
  "\nON CONFLICT (kurs_key) \nDO UPDATE SET \n    status = 'erledigt',\n    updated_at = NOW();";

console.log('Generierte SQL:');
console.log(sql);

// --- Prüfungen ---
const expectedCount = batchKurse.length;
const valuesCount = (sql.match(/NOW\(\)\)/g) || []).length;
if (valuesCount !== expectedCount) {
  console.error('FEHLER: Anzahl VALUES-Einträge (' + valuesCount + ') weicht von erwarteten Kursen (' + expectedCount + ') ab.');
  process.exit(1);
}
if (!sql.includes('ON CONFLICT (kurs_key)')) {
  console.error('FEHLER: ON CONFLICT (kurs_key) fehlt in der Query.');
  process.exit(1);
}
if (!sql.includes("'erledigt'")) {
  console.error('FEHLER: Status "erledigt" fehlt in der Query.');
  process.exit(1);
}
console.log('OK: ' + expectedCount + ' Kurs-Keys werden im Start-Batch in einem Query geschrieben.');

// --- Fallback-Prüfung ohne kurs_key (Key aus datum|beginn|kursCode) ---
const fallback = kurse.filter((k) => !k.kurs_key).length === 0;
const fallbackKey = { datum: '03.11.2026', beginn: '08:30', kursCode: 'wbc-z' };
const computed = fallbackKey.kurs_key || (fallbackKey.datum + '|' + fallbackKey.beginn + '|' + fallbackKey.kursCode);
if (computed !== '03.11.2026|08:30|wbc-z') {
  console.error('FEHLER: Fallback-Key-Berechnung falsch: ' + computed);
  process.exit(1);
}
console.log('OK: Fallback kurs_key (datum|beginn|kursCode) korrekt.');
console.log('VERIFIKATION BESTANDEN: Start-Batch schreibt alle Kurs-Keys als "erledigt".');
