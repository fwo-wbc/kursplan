/**
 * Inspect-Skript für app/src/app/page.tsx (Datei zu groß für read_file).
 * Findet gezielt:
 *  a) interface Kurs + Status-Feld (zuweisung_status o. ä.)
 *  b) loadData-Aufbau (setLoading, setKurse, Filter-States)
 *  c) handleTrainerChange (trainer_kuerzel, hat_trainer, trainer_id)
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'app', 'src', 'app', 'page.tsx');
const src = fs.readFileSync(file, 'utf8');
const lines = src.split('\n');

function showRange(from, to, label) {
  console.log(`\n===== ${label} (Zeilen ${from}-${to}) =====`);
  for (let i = from; i <= Math.min(to, lines.length); i++) {
    console.log(`${String(i).padStart(5)} | ${lines[i - 1]}`);
  }
}

// a) interface Kurs finden
const ifaceIdx = lines.findIndex((l) => /interface\s+Kurs\b/.test(l));
if (ifaceIdx >= 0) {
  // Ende des Interfaces: nächste schließende Klammer auf Spaltenebene
  let end = ifaceIdx;
  for (let i = ifaceIdx; i < lines.length; i++) {
    if (/^\}/.test(lines[i])) { end = i; break; }
  }
  showRange(ifaceIdx + 1, end + 1, 'interface Kurs');
} else {
  console.log('interface Kurs NICHT gefunden');
}

// b) loadData finden
const loadIdx = lines.findIndex((l) => /(async\s+)?function\s+loadData|const\s+loadData\s*=/.test(l));
if (loadIdx >= 0) {
  let end = loadIdx;
  for (let i = loadIdx; i < lines.length; i++) {
    if (/^\};/.test(lines[i]) || /^\}/.test(lines[i])) { end = i; break; }
  }
  showRange(loadIdx + 1, end + 1, 'loadData');
} else {
  console.log('loadData NICHT gefunden');
}

// c) handleTrainerChange finden
const hIdx = lines.findIndex((l) => /handleTrainerChange/.test(l));
if (hIdx >= 0) {
  let end = hIdx;
  for (let i = hIdx; i < lines.length; i++) {
    if (/^\};/.test(lines[i]) || /^\}/.test(lines[i])) { end = i; break; }
  }
  showRange(hIdx + 1, end + 1, 'handleTrainerChange');
} else {
  console.log('handleTrainerChange NICHT gefunden');
}

// d) setLoading / setKurse Vorkommen
console.log('\n===== setLoading / setKurse Vorkommen =====');
lines.forEach((l, i) => {
  if (/setLoading|setKurse/.test(l)) {
    console.log(`${String(i + 1).padStart(5)} | ${l.trim()}`);
  }
});

// e) trainer_kuerzel / hat_trainer / zuweisung_status Vorkommen
console.log('\n===== trainer-Felder Vorkommen =====');
lines.forEach((l, i) => {
  if (/trainer_kuerzel|hat_trainer|zuweisung_status|trainer_id|trainer_vorname|trainer_nachname|trainer_farbe/.test(l)) {
    console.log(`${String(i + 1).padStart(5)} | ${l.trim()}`);
  }
});

// f) trainer-Liste (trainerOptions o. ä.)
console.log('\n===== Trainer-Liste Vorkommen =====');
lines.forEach((l, i) => {
  if (/trainerOptions|trainerListe|trainer_liste|setTrainer|useState.*[Tt]rainer/.test(l)) {
    console.log(`${String(i + 1).padStart(5)} | ${l.trim()}`);
  }
});

// g) useEffect / window Event-Listener
console.log('\n===== useEffect Vorkommen =====');
lines.forEach((l, i) => {
  if (/useEffect/.test(l)) {
    console.log(`${String(i + 1).padStart(5)} | ${l.trim()}`);
  }
});