/* Entfernt den blockierten $env-Zugriff aus dem P04-Code-Knoten.
   Root Cause: N8N_BLOCK_ENV_ACCESS_IN_NODE=true -> $env.Zugriffe in Code-/Expression-Knoten
   führen zu ExpressionError, wodurch der Abschluss-Knoten nie erreicht wird. */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'n8n', 'P04_Qualitaetskontrolle.json');
const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
const wf = arr[0];
const node = wf.nodes.find((n) => n.name === 'P04 Ergebnis auswerten');
if (!node) throw new Error('Code-Knoten nicht gefunden');

let code = node.parameters.jsCode;

const vorher = code;

// 1) $env-Zugriff im Code-Knoten entfernen (Empfaenger hart setzen; Mail-Knoten ist disabled)
code = code.replace(
  /\/\/ Empf(ä|a)ngeradresse über n8n-Umgebungsvariable, z\. B\. P04_ALERT_EMAIL=team@example\.com\nconst mailEmpfaenger = \$env\.P04_ALERT_EMAIL \|\| '';/,
  "// E-Mail-Versand ist aktuell deaktiviert (Knoten 'P04 Alert-Mail senden' ist disabled).\n// Empfaenger daher leer halten – kein $env-Zugriff (N8N_BLOCK_ENV_ACCESS_IN_NODE).\nconst mailEmpfaenger = '';"
);

// 2) Sicherheit: Falls ein anderer $env-Verweis im Code auftaucht, ebenfalls neutralisieren
code = code.replace(/\$env\.[A-Za-z0-9_]+/g, "''");

if (code === vorher) {
  console.log('[WARN] Keine $env-Referenz im Code-Knoten gefunden – nichts zu tun?');
} else {
  node.parameters.jsCode = code;
  fs.writeFileSync(file, JSON.stringify(arr, null, 2) + '\n', 'utf8');
  console.log('[OK] Code-Knoten bereinigt.');
}

// 3) Verify: keine $env-Zugriffe mehr im Workflow (abgesehen vom disabled Mail-Knoten)
const json = fs.readFileSync(file, 'utf8');
const envRefs = [];
for (const n of wf.nodes) {
  const p = JSON.stringify(n.parameters || {});
  if (/\$env\.[A-Za-z0-9_]+/.test(p)) {
    envRefs.push(`${n.name}: disabled=${!!n.disabled}`);
  }
}
console.log('Verbleibende $env-Referenzen:', envRefs.length ? JSON.stringify(envRefs) : 'keine');
