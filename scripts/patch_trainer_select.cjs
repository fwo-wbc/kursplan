#!/usr/bin/env node
/**
 * patch_trainer_select.cjs
 *
 * Patcht app/src/app/page.tsx:
 *  1. handleTrainerChange: State-Update setzt trainer_kuerzel: neuesKuerzel
 *     und hat_trainer: neuesKuerzel !== 'n. v.'.
 *  2. Tabellenansicht: getrennte Zweige (hatTrainer vs. !hatTrainer / rotes Badge)
 *     werden durch EIN einheitliches <select> ersetzt.
 *
 * Ausführung: node scripts/patch_trainer_select.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'app', 'src', 'app', 'page.tsx');

function fail(msg) {
  console.error('FEHLER: ' + msg);
  process.exit(1);
}

function findMatchingBrace(text, openIdx) {
  const open = text[openIdx];
  const close = open === '{' ? '}' : ')';
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function buildSelect(className, listName, paramName) {
  const classAttr = className ? ` className="${className}"` : '';
  return `<select${classAttr}
  value={kurs.trainer_kuerzel || 'n. v.'}
  onChange={(e) => handleTrainerChange(kurs, e.target.value)}
>
  <option value="n. v.">n. v.</option>
  {${listName}.map((${paramName}) => (
    <option key={${paramName}.id} value={${paramName}.kuerzel}>{${paramName}.kuerzel}</option>
  ))}
</select>`;
}

let src = fs.readFileSync(FILE, 'utf8');
const original = src;
let changes = 0;

console.log('Patch: ' + FILE);

// ============================================================
// Teil 1: handleTrainerChange
// ============================================================
const fnDef = src.match(/const\s+handleTrainerChange\s*=\s*(?:useCallback\s*\(\s*)?(?:async\s*)?\(/);
if (!fnDef) fail('handleTrainerChange-Definition nicht gefunden.');

const bodyOpen = src.indexOf('{', fnDef.index);
if (bodyOpen === -1) fail('Funktionskörper von handleTrainerChange nicht gefunden.');
const bodyClose = findMatchingBrace(src, bodyOpen);
if (bodyClose === -1) fail('Funktionskörper von handleTrainerChange nicht abschließbar.');
let body = src.slice(bodyOpen, bodyClose + 1);

// 1a) trainer_kuerzel: neuesKuerzel
const kuerzelRe = /trainer_kuerzel\s*:\s*([^,}\n]+)/;
const km = kuerzelRe.exec(body);
if (km) {
  const wert = km[1].trim();
  if (wert !== 'neuesKuerzel') {
    body = body.slice(0, km.index) + 'trainer_kuerzel: neuesKuerzel' + body.slice(km.index + km[0].length);
    console.log('  [1a] trainer_kuerzel im State-Update auf neuesKuerzel gesetzt (war: ' + wert + ').');
    changes++;
  } else {
    console.log('  [1a] trainer_kuerzel ist bereits korrekt (neuesKuerzel).');
  }
} else {
  fail('Kein trainer_kuerzel im Funktionskörper von handleTrainerChange gefunden.');
}

// 1b) hat_trainer: neuesKuerzel !== 'n. v.'
const hatRe = /hat_trainer\s*:\s*([^,}\n]+)/;
const hm = hatRe.exec(body);
if (hm) {
  const wert = hm[1].trim();
  if (wert !== "neuesKuerzel !== 'n. v.'") {
    body = body.slice(0, hm.index) + "hat_trainer: neuesKuerzel !== 'n. v.'" + body.slice(hm.index + hm[0].length);
    console.log("  [1b] hat_trainer im State-Update auf neuesKuerzel !== 'n. v.' gesetzt (war: " + wert + ').');
    changes++;
  } else {
    console.log('  [1b] hat_trainer ist bereits korrekt.');
  }
} else {
  const anchor = 'trainer_kuerzel: neuesKuerzel';
  const ai = body.indexOf(anchor);
  if (ai === -1) fail('Anker für hat_trainer-Einfügung nicht gefunden.');
  body = body.slice(0, ai + anchor.length) + ", hat_trainer: neuesKuerzel !== 'n. v.'" + body.slice(ai + anchor.length);
  console.log('  [1b] hat_trainer nach trainer_kuerzel eingefügt.');
  changes++;
}

src = src.slice(0, bodyOpen) + body + src.slice(bodyClose + 1);

// ============================================================
// Teil 2: Tabellenansicht – einheitliches <select>
// ============================================================

// Trainer-Liste erkennen (map mit .kuerzel)
function findTrainerListe(text) {
  const mapRe = /([A-Za-z_$][\w$]*)\s*\.\s*map\s*\(\s*(?:\(\s*)?([A-Za-z_$][\w$]*)\s*(?:\s*\))?\s*=>/g;
  let mm;
  while ((mm = mapRe.exec(text)) !== null) {
    const after = text.slice(mm.index + mm[0].length, mm.index + mm[0].length + 400);
    if (new RegExp('\\b' + mm[2] + '\\s*\\.\\s*kuerzel\\b').test(after)) {
      return { listName: mm[1], paramName: mm[2] };
    }
  }
  return null;
}

const trainerInfo = findTrainerListe(src);
if (!trainerInfo) fail('Trainer-Liste (map mit .kuerzel) nicht gefunden.');
console.log('  [2] Trainer-Liste erkannt: ' + trainerInfo.listName + ' (Parameter: ' + trainerInfo.paramName + ')');

const edits = [];

// 2a) Ternäre Blöcke: {kurs.hat_trainer ? (...) : (...)}
const ternRe = /\{\s*(?:kurs\.)?hat_?trainer\s*\?\s*[\(<]/g;
let tm;
while ((tm = ternRe.exec(src)) !== null) {
  const blockStart = tm.index;
  const blockEnd = findMatchingBrace(src, blockStart);
  if (blockEnd === -1) fail('Ternärer hatTrainer-Block nicht abschließbar.');
  const block = src.slice(blockStart, blockEnd + 1);
  const classMatch = block.match(/className\s*=\s*\{?["'`]([^"'`]+)["'`]\}?/);
  const className = classMatch ? classMatch[1] : null;
  edits.push({ start: blockStart, end: blockEnd + 1, text: buildSelect(className, trainerInfo.listName, trainerInfo.paramName) });
  ternRe.lastIndex = blockEnd + 1;
}

// 2b) Getrennte Blöcke: {kurs.hat_trainer && (...)} / {!kurs.hat_trainer && (...)}
if (edits.length === 0) {
  const posRe = /\{\s*(?:kurs\.)?hat_?trainer\s*&&/g;
  let pm;
  while ((pm = posRe.exec(src)) !== null) {
    const blockStart = pm.index;
    const blockEnd = findMatchingBrace(src, blockStart);
    if (blockEnd === -1) fail('Positiver hatTrainer-Block nicht abschließbar.');
    const block = src.slice(blockStart, blockEnd + 1);
    const classMatch = block.match(/className\s*=\s*\{?["'`]([^"'`]+)["'`]\}?/);
    const className = classMatch ? classMatch[1] : null;
    edits.push({ start: blockStart, end: blockEnd + 1, text: buildSelect(className, trainerInfo.listName, trainerInfo.paramName) });
    posRe.lastIndex = blockEnd + 1;
  }

  const negRe = /\{\s*!(?:kurs\.)?hat_?trainer\s*&&/g;
  let nm;
  while ((nm = negRe.exec(src)) !== null) {
    const blockStart = nm.index;
    const blockEnd = findMatchingBrace(src, blockStart);
    if (blockEnd === -1) fail('Negativer hatTrainer-Block nicht abschließbar.');
    edits.push({ start: blockStart, end: blockEnd + 1, text: '' });
    negRe.lastIndex = blockEnd + 1;
  }
}

if (edits.length === 0) {
  // Prüfen, ob bereits ein einheitliches <select> mit der gewünschten Struktur existiert
  const bereitsEinheitlich =
    /<select[\s\S]*?value=\{kurs\.trainer_kuerzel \|\| 'n\. v\.'\}[\s\S]*?<option value="n\. v\.">n\. v\.<\/option>[\s\S]*?\.map\(/.test(
      src
    );
  if (bereitsEinheitlich) {
    console.log(
      '  [2] Einheitliches <select> ist bereits vorhanden – keine Änderung nötig.'
    );
  } else {
    fail(
      'Weder ternärer noch getrennter hatTrainer-Block in der Tabellenansicht gefunden.'
    );
  }
}

edits.sort((a, b) => b.start - a.start);
for (const e of edits) {
  src = src.slice(0, e.start) + e.text + src.slice(e.end);
  changes++;
  console.log('  [2] Block ersetzt (Zeichen ' + e.start + '–' + e.end + ').');
}

// ============================================================
// Speichern
// ============================================================
if (src === original) {
  console.log('Keine Änderungen erforderlich – Datei bleibt unverändert.');
} else {
  fs.writeFileSync(FILE, src, 'utf8');
  console.log('Datei gespeichert: ' + FILE);
}
console.log('Fertig. ' + changes + ' Änderung(en).');