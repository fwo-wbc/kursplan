#!/usr/bin/env node
/**
 * push_workflows_to_n8n.cjs
 * -------------------------
 * Aktualisiert die Workflows P04 (Qualitaetskontrolle) und P05 (Wiederanlauf)
 * direkt ueber die n8n REST API (Public API v1), statt ueber die MCP-Tools.
 *
 * Konfiguration (Reihenfolge):
 *   1. Umgebungsvariablen N8N_API_URL / N8N_API_KEY
 *   2. .env-Datei im Projektroot
 *   3. Standard URL: http://127.0.0.1:5678/api/v1
 *
 * Ablauf:
 *   - P04: PUT /workflows/dnf6LyuhQawESBX0  (ID fix aus Datei/Export)
 *   - P05: Existenz-Check per GET /workflows?name=...
 *          vorhanden -> PUT, sonst POST (id wird dabei entfernt)
 *   - Danach beide Workflows aktivieren: PUT /workflows/{id}/activate
 *   - Konsolenausgabe: ID, Name, active
 */
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Konfiguration ermitteln
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, '..');

/** Laedt .env-Dateien (simpler Parser: KEY=VALUE, Kommentare, Quotes). */
function loadEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const envFromFile = loadEnvFile(path.join(ROOT, '.env'));
const env = { ...envFromFile, ...process.env };

const N8N_API_URL = (env.N8N_API_URL || 'http://127.0.0.1:5678/api/v1').replace(/\/+$/, '');
const N8N_API_KEY = env.N8N_API_KEY || '';

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------
async function api(method, urlPath, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (N8N_API_KEY) headers['X-N8N-API-KEY'] = N8N_API_KEY;

  const res = await fetch(`${N8N_API_URL}${urlPath}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let text = '';
  try {
    text = await res.text();
  } catch {
    /* leer */
  }
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(
      `${method} ${urlPath} -> HTTP ${res.status}: ${detail && detail.length > 2000 ? detail.slice(0, 2000) : detail}`
    );
  }
  return data;
}

/** Entfernt felder, die die Public API beim POST nicht annehmen darf. */
function buildWorkflowBody(wf) {
  return {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || {},
  };
}

async function activate(id, label) {
  // n8n Public API v1: Aktivierung/Deaktivierung ist POST, nicht PUT.
  const wf = await api('POST', `/workflows/${id}/activate`);
  const activeNow = wf.active === true || wf.active === 1;
  console.log(
    `[OK] aktiviert     : ${label}\n     id=${wf.id} name="${wf.name}" active=${activeNow}`
  );
  return wf;
}

async function findWorkflowByName(name) {
  const url = `/workflows?name=${encodeURIComponent(name)}&limit=100`;
  const data = await api('GET', url);
  const list = Array.isArray(data) ? data : data?.data || [];
  return list.find((w) => w.name === name) || null;
}

// ---------------------------------------------------------------------------
// Hauptprogramm
// ---------------------------------------------------------------------------
async function main() {
  console.log(`n8n API: ${N8N_API_URL}${N8N_API_KEY ? ' (mit API-Key)' : ' (ohne API-Key)'}`);
  console.log('---');

  // --- P04: Qualitaetskontrolle -------------------------------------------
  const p04Arr = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'n8n', 'P04_Qualitaetskontrolle.json'), 'utf8')
  );
  const p04 = Array.isArray(p04Arr) ? p04Arr[0] : p04Arr;
  const P04_ID = p04.id || 'dnf6LyuhQawESBX0';

  console.log(`\nP04 -> ${P04_ID} ("${p04.name}")`);
  const p04Updated = await api('PUT', `/workflows/${P04_ID}`, buildWorkflowBody(p04));
  console.log(`[OK] P04 aktualisiert (id=${p04Updated.id}, name="${p04Updated.name}")`);

  // --- P05: Wiederanlauf ----------------------------------------------------
  const p05Arr = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'n8n', 'P05_Wiederanlauf.json'), 'utf8')
  );
  const p05 = Array.isArray(p05Arr) ? p05Arr[0] : p05Arr;

  console.log(`\nP05 -> Existenz-Check per Name "${p05.name}"`);
  const existing = await findWorkflowByName(p05.name);

  let p05Updated;
  if (existing) {
    console.log(`P05 existiert (id=${existing.id}) -> PUT`);
    p05Updated = await api('PUT', `/workflows/${existing.id}`, buildWorkflowBody(p05));
  } else {
    console.log('P05 existiert nicht -> POST');
    const body = buildWorkflowBody(p05);
    p05Updated = await api('POST', '/workflows', body);
  }
  console.log(`[OK] P05 gespeichert (id=${p05Updated.id}, name="${p05Updated.name}")`);

  // --- Aktivierung beider Workflows ----------------------------------------
  console.log('\n--- Aktivierung ---');
  const p04Active = await activate(P04_ID, 'P04');
  const p05Active = await activate(p05Updated.id, 'P05');

  // --- Abschlussausgabe -----------------------------------------------------
  console.log('\n=== Zusammenfassung ===');
  console.table([
    {
      id: p04Active.id,
      name: p04Active.name,
      active: p04Active.active === true || p04Active.active === 1,
    },
    {
      id: p05Active.id,
      name: p05Active.name,
      active: p05Active.active === true || p05Active.active === 1,
    },
  ]);
}

main().catch((err) => {
  console.error(`\n[FEHLER] ${err.message}`);
  process.exitCode = 1;
});