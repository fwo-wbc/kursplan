/**
 * Inspect-Skript Teil 2: gezielte Zeilenbereiche aus app/src/app/page.tsx
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

// 1) ZuweisungStatus Typdefinition
const zIdx = lines.findIndex((l) => /type\s+ZuweisungStatus|interface\s+ZuweisungStatus/.test(l));
if (zIdx >= 0) {
  let end = zIdx;
  for (let i = zIdx; i < lines.length; i++) {
    if (/^\};|^;/.test(lines[i])) { end = i; break; }
  }
  showRange(zIdx + 1, end + 1, 'ZuweisungStatus');
} else {
  console.log('ZuweisungStatus Typ NICHT gefunden');
}

// 2) Trainer interface
const tIdx = lines.findIndex((l) => /interface\s+Trainer\b/.test(l));
if (tIdx >= 0) {
  let end = tIdx;
  for (let i = tIdx; i < lines.length; i++) {
    if (/^\}/.test(lines[i])) { end = i; break; }
  }
  showRange(tIdx + 1, end + 1, 'interface Trainer');
} else {
  console.log('interface Trainer NICHT gefunden');
}

// 3) setKurse((prev) Bereich (Zeile ~1339)
showRange(1325, 1370, 'setKurse(prev) Kontext');

// 4) handleTrainerChange Bereich (Zeile ~1560-1640)
showRange(1550, 1645, 'handleTrainerChange');

// 5) Anzeige-Bereich hatTrainer / trainer_kuerzel (Zeile ~2000-2070)
showRange(1995, 2075, 'Anzeige hatTrainer/trainer_kuerzel');

// 6) Select-Bereich (Zeile ~2225-2250)
showRange(2220, 2250, 'Trainer-Select');

// 7) Zuweisung interface
const z2Idx = lines.findIndex((l) => /interface\s+Zuweisung\b/.test(l));
if (z2Idx >= 0) {
  let end = z2Idx;
  for (let i = z2Idx; i < lines.length; i++) {
    if (/^\}/.test(lines[i])) { end = i; break; }
  }
  showRange(z2Idx + 1, end + 1, 'interface Zuweisung');
} else {
  console.log('interface Zuweisung NICHT gefunden');
}

// 8) scrollToToday Definition
const sIdx = lines.findIndex((l) => /scrollToToday/.test(l));
if (sIdx >= 0) {
  let end = sIdx;
  for (let i = sIdx; i < lines.length; i++) {
    if (/^\};|^\}/.test(lines[i])) { end = i; break; }
  }
  showRange(sIdx + 1, end + 1, 'scrollToToday');
} else {
  console.log('scrollToToday NICHT gefunden');
}