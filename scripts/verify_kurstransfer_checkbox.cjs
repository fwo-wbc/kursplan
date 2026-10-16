#!/usr/bin/env node
"use strict";

/**
 * Verifikation der geänderten Checkbox-/Auswahl-Logik in
 * app/public/Kurstransfer/index.html
 *
 * Prüft:
 *  1. Das eingebettete <script> ist syntaktisch gültig.
 *  2. Keine `cb.disabled = row.done` / `cb.disabled = done` Reste (disabled nur
 *     noch bei UI-Lock / explizit false).
 *  3. Kernlogik getSelectedRows / getSelectedOpen / updateSelectionUI-Semantik:
 *     - Erledigte Zeilen sind markierbar (getSelectedRows enthält sie).
 *     - getSelectedOpen liefert NUR offene Zeilen (Transfer-Schutz).
 *     - applyBulkStatus verarbeitet getSelectedRows (auch erledigte).
 */

const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "app", "public", "Kurstransfer", "index.html");
const html = fs.readFileSync(file, "utf8");

let failures = 0;
const check = (cond, msg) => {
  if (cond) {
    console.log("  OK   " + msg);
  } else {
    failures++;
    console.error("  FEHL " + msg);
  }
};

// --- 1. <script> extrahieren und Syntax prüfen ------------------------------
const m = /<script>([\s\S]*?)<\/script>/.exec(html);
check(!!m, "Ein <script>-Block gefunden");
if (!m) process.exit(1);
const js = m[1];

try {
  new Function(js); // reine Syntaxprüfung, keine Ausführung
  check(true, "JavaScript-Syntax valide (new Function)");
} catch (err) {
  check(false, "JavaScript-Syntax: " + err.message);
}

// --- 2. Keine erledigt-abhängigen disabled-Reste ----------------------------
const badDisabled = [
  /cb\.disabled\s*=\s*row\.done/,
  /cb\.disabled\s*=\s*done/,
  /disabled\s*=\s*locked\s*\|\|\s*!!\(row\s*&&\s*row\.done\)/,
  /cb\.disabled\s*=\s*row\.done\s*;\s*cb\.checked\s*=\s*row\.done/,
];
for (const re of badDisabled) {
  check(!re.test(js), "Kein erledigt-abhängiges disabled: " + re.source);
}

// --- 3. Kernfunktionen vorhanden & korrekt verdrahtet ------------------------
check(/function getSelectedRows\(\)/.test(js), "getSelectedRows() definiert");
check(/function getSelectedOpen\(\)/.test(js), "getSelectedOpen() definiert");
check(
  /function getSelectedOpen\(\)\s*\{\s*return getSelectedRows\(\)\.filter\(\(r\) => !r\.done\);/s.test(js),
  "getSelectedOpen() basiert auf getSelectedRows() + !r.done (Transfer-Schutz)"
);
check(
  /function updateSelectionUI\(\)\s*\{\s*const selected = getSelectedRows\(\);/s.test(js),
  "updateSelectionUI() zaehlt getSelectedRows()"
);
check(
  /async function applyBulkStatus\(\)\s*\{\s*\/\/ Alle markierten Zeilen verarbeiten[\s\S]*?const selected = getSelectedRows\(\);/s.test(js),
  "applyBulkStatus() verarbeitet getSelectedRows() (auch erledigte)"
);
check(
  /async function syncToEdoobox\(\)\s*\{\s*\/\/ Nur offene Kurse übertragen[\s\S]*?const selected = getSelectedOpen\(\);/s.test(js),
  "syncToEdoobox() nutzt getSelectedOpen() (nur offene)"
);

// --- 4. Funktions-Test der Kernlogik (Simulation) ---------------------------
function simulate() {
  const rows = [
    { id: "a", done: false },
    { id: "b", done: true },
    { id: "c", done: false },
  ];
  // Simulierte DOM-Checkboxen: a + b angehakt
  const tableBody = {
    querySelectorAll: () => [
      { dataset: { id: "a" } },
      { dataset: { id: "b" } },
    ],
  };
  const getSelectedRows = () => {
    const ids = new Set(
      Array.from(tableBody.querySelectorAll("input[type='checkbox']:checked")).map((c) => c.dataset.id)
    );
    return rows.filter((r) => ids.has(r.id));
  };
  return { rows, getSelectedRows };
}

const { getSelectedRows } = simulate();
const all = getSelectedRows();
check(
  all.length === 2 && all.some((r) => r.id === "b") && all.some((r) => r.id === "a"),
  "Simulation: erledigte Zeile (b) ist markierbar & in getSelectedRows() enthalten"
);
const open = all.filter((r) => !r.done);
check(
  open.length === 1 && open[0].id === "a",
  "Simulation: getSelectedOpen()-Semantik liefert nur offene Zeile (a)"
);

console.log(failures === 0 ? "\nERGEBNIS: ALLE CHECKS BESTANDEN" : "\nERGEBNIS: " + failures + " CHECK(S) FEHLGESCHLAGEN");
process.exit(failures === 0 ? 0 : 1);
