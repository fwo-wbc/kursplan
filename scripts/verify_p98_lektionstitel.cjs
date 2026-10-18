// Verifiziert die JS-Syntax des neuen jsCode im Knoten "P98 Lektionstitel anpassen"
// und gibt den jsCode als JSON-String aus (für n8n_update_full_workflow).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const file = path.join(__dirname, '..', 'n8n', 'P98_Update_Trainer_Single.json');
const workflow = JSON.parse(fs.readFileSync(file, 'utf8'));

const node = workflow.nodes.find((n) => n.name === 'P98 Lektionstitel anpassen');
if (!node) {
  console.error('FEHLER: Knoten nicht gefunden.');
  process.exit(1);
}

const jsCode = node.parameters.jsCode;

// 1. Syntax-Check über node --check (temporäre Datei)
const tmp = path.join(os.tmpdir(), 'p98_lektionstitel_check.js');
fs.writeFileSync(tmp, jsCode, 'utf8');
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  console.log('SYNTAX: OK');
} catch (e) {
  console.error('SYNTAX-FEHLER:');
  console.error(String(e.stderr || e.message));
  process.exit(1);
} finally {
  fs.unlinkSync(tmp);
}

// 2. Wichtige Logik-Bausteine prüfen
const checks = [
  ["liest neuer_trainer_kuerzel", jsCode.includes('neuer_trainer_kuerzel')],
  ["liest altes_trainer_kuerzel", jsCode.includes('altes_trainer_kuerzel')],
  ["liest kursData", jsCode.includes("$('P98 Kurs & Trainerdaten ermitteln').first().json")],
  ["is_unassign im return", jsCode.includes('is_unassign')],
  ["kuerzel im return", jsCode.includes('kuerzel: neuer_trainer_kuerzel')],
  ["neuer_lektionstitel im return", jsCode.includes('neuer_lektionstitel')],
  ["kein matchZweiZeichen (Abschneiden)", !jsCode.includes('matchZweiZeichen')],
  ["kein lektionstitel_alt", !jsCode.includes('lektionstitel_alt')],
];
let allOk = true;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FEHLT'} - ${label}`);
  if (!ok) allOk = false;
}
if (!allOk) {
  console.error('Logik-Prüfung fehlgeschlagen.');
  process.exit(1);
}

// 3. jsCode als JSON-String ausgeben (für den n8n-Update-Aufruf)
console.log('---JSCODE_JSON_START---');
console.log(JSON.stringify(jsCode));
console.log('---JSCODE_JSON_END---');
