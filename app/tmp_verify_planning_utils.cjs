// Temporäre Verifikation für src/lib/planning-utils.ts (Aufgabe 3, L-05-Vorbereitung).
// Lädt die isoliert kompilierte Datei und prüft das Platzhalter-Zeitfenster-Mapping.
const utils = require('./tmp_planning_utils_build/planning-utils.js');

const erwartet = [
  ['VM', '08:00', '12:00'],
  ['K1', '08:00', '12:00'],
  ['NM', '13:00', '17:00'],
  ['K2', '13:00', '17:00'],
  ['GT', '08:00', '17:00'],
  ['HT', '08:00', '17:00'],
];

let fehler = 0;
for (const [code, von, bis] of erwartet) {
  const z = utils.blockZeitfenster(code);
  const ok = z && z.von === von && z.bis === bis;
  console.log(
    `${code} -> ${z ? `${z.von} bis ${z.bis} (${z.vonMinuten}-${z.bisMinuten} min)` : 'null'} ${ok ? 'OK' : 'FEHLER'}`
  );
  if (!ok) fehler++;
}

// Unbekannter Code muss null liefern.
if (utils.blockZeitfenster('X') !== null) {
  console.log('Unbekannter Code "X" -> FEHLER (erwartet null)');
  fehler++;
} else {
  console.log('Unbekannter Code "X" -> null OK');
}

// Minuten-Umrechnung.
if (utils.uhrzeitZuMinuten('08:00') !== 480 || utils.uhrzeitZuMinuten('17:00') !== 1020) {
  console.log('uhrzeitZuMinuten -> FEHLER');
  fehler++;
} else {
  console.log('uhrzeitZuMinuten 08:00=480, 17:00=1020 OK');
}

console.log(`BLOCK_CODES: ${utils.BLOCK_CODES.join(', ')}`);
process.exit(fehler === 0 ? 0 : 1);