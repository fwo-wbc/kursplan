/**
 * Erzeugt die web-app-optimierte Header-Logo-Variante aus der Original-SVG.
 *
 * Quelle:  app/public/webinarcenter_Logo_2_2021_V2.4_weiss-2.svg
 * Ziel:    app/public/webinarcenter_Logo_2_2021_V2.4_weiss-header.svg
 *
 * Was die Variante tut:
 *  1. Behält NUR Bildmarke (Welle, path88/path90) und Hauptschriftzug
 *     „webinarcenter.de" (path14..path44).
 *  2. Entfernt die Unterzeile „die moderne Art zu lernen" (path46..path86)
 *     und die horizontale Trennlinie (rect92).
 *  3. Skaliert die Bildmarke proportional auf Schriftzug-Höhe (~14 Einheiten)
 *     und setzt die viewBox auf Höhe 14.5 – halb so hoch wie das Original (28).
 *     Damit verdoppelt sich die effektive Buchstabengröße bei konstanter
 *     Headerhöhe (h-8 = 32px, sm:h-9 = 36px).
 *
 * Aufruf: node scripts/generate_logo_header_svg.cjs
 */
const fs = require('fs');
const path = require('path');

const srcFile = path.join(__dirname, '..', 'app', 'public', 'webinarcenter_Logo_2_2021_V2.4_weiss-2.svg');
const outFile = path.join(__dirname, '..', 'app', 'public', 'webinarcenter_Logo_2_2021_V2.4_weiss-header.svg');

const src = fs.readFileSync(srcFile, 'utf8');

// Alle Pfade mit id + d + transform extrahieren
const paths = [];
for (const m of src.matchAll(/<path\b([^>]*)>/g)) {
  const attrs = m[1];
  const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
  const d = (attrs.match(/\bd="([^"]+)"/) || [])[1];
  const tf = (attrs.match(/\btransform="([^"]+)"/) || [])[1];
  if (id && d) paths.push({ id, d, tf });
}

const fontIds = [];
for (let n = 14; n <= 44; n += 2) fontIds.push('path' + n);
const markIds = ['path88', 'path90'];

const byId = (id) => paths.find((p) => p.id === id);

function assertPath(id) {
  if (!byId(id)) throw new Error(`Pfad ${id} nicht gefunden!`);
}
for (const id of [...fontIds, ...markIds]) assertPath(id);

const plainPath = (id) => {
  const p = byId(id);
  return `      <path class="cls-1" d="${p.d}" transform="${p.tf}" id="${p.id}"></path>`;
};

// --- Ausgabe aufbauen ---
const viewBox = '0 0 193 14.5';
// Bildmarke im Original nach g140-Matrix: x -0.8..29.7, y 0.3..27.7
// Zentrum: (14.45, 14.0), Höhe 27.4 -> Faktor für Zielhöhe ~13: 13/27.4
const markScale = (13 / 27.4).toFixed(6);
const cx = '14.45';
const cy = '14.0';
const tyTarget = '7.25'; // vertikales Zentrum im 14.5er-Band
const markTransform = `translate(${cx},${tyTarget}) scale(${markScale}) translate(-${cx},-${cy})`;

const lines = [];
lines.push(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>`);
lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="193mm" height="14.5mm" shape-rendering="geometricPrecision" id="svg-header">`);
lines.push(`  <defs id="defs-header"><style id="style-header">.cls-1{fill:#fff;}</style></defs>`);
lines.push(`  <!-- Bildmarke (Welle): proportional auf Schriftzug-Hoehe komprimiert -->`);
lines.push(`  <g id="g-marke" transform="${markTransform}">`);
lines.push(`    <g id="g-matrix-marke" transform="matrix(0.79226988,0,0,0.79226988,0.72371333,0.34513941)">`);
for (const id of markIds) lines.push(plainPath(id));
lines.push(`    </g>`);
lines.push(`  </g>`);
lines.push(`  <!-- Hauptschriftzug "webinarcenter.de" (unveraendert) -->`);
lines.push(`  <g id="g-schriftzug" transform="matrix(0.79226988,0,0,0.79226988,0.72371333,0.34513941)">`);
for (const id of fontIds) lines.push(plainPath(id));
lines.push(`  </g>`);
lines.push(`</svg>`);

fs.writeFileSync(outFile, lines.join('\n'), 'utf8');

const size = fs.statSync(outFile).size;
console.log(`OK: ${outFile}`);
console.log(`viewBox: ${viewBox}  (Original: 0 0 193 28)`);
console.log(`Bildmarke-Skala: ${markScale} (Zentrum ${cx},${cy})`);
console.log(`Unterzeile (path46-86) + Trennlinie (rect92): ENTFERNT`);
console.log(`Dateigroesse: ${size} Bytes`);
