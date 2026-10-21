// Ersetzt die Tailwind-Farbfamilie `rose` durch `red` in allen betroffenen
// App-Dateien (Status "Abgesagt", Fehlermeldungen, rote Hervorhebungen).
// Zusätzlich werden die Hex-Werte der CSS-Kommentare in kalender/page.tsx
// auf die exakten `red`-Äquivalente korrigiert.
const fs = require('fs');
const path = require('path');

const files = [
  'app/src/app/page.tsx',
  'app/src/app/kalender/page.tsx',
  'app/src/app/trainer/page.tsx',
  'app/src/app/trainer/zeitplan/page.tsx',
  'app/src/app/trainer/verfuegbarkeit/page.tsx',
];

// rose-100 -> red-100, rose-300 -> red-300, rose-800 -> red-800
const hexMap = {
  '#ffe4e6': '#fee2e2',
  '#fda4af': '#fca5a5',
  '#9f1239': '#991b1b',
};

let changed = 0;
for (const rel of files) {
  const abs = path.join(process.cwd(), rel);
  let content = fs.readFileSync(abs, 'utf8');
  const before = content;

  content = content.replace(/rose/g, 'red');
  for (const [from, to] of Object.entries(hexMap)) {
    content = content.replace(from, to);
  }

  if (content !== before) {
    fs.writeFileSync(abs, content, 'utf8');
    changed++;
    console.log(`OK: ${rel}`);
  } else {
    console.log(`UNCHANGED: ${rel}`);
  }
}

console.log(`\n${changed} Datei(en) geändert.`);