/* Holt eine einzelne n8n-Execution ueber die REST API (kein MCP-zugriff).
   Verwendet dieselbe Konfig/Auth wie push_workflows_to_n8n.cjs. */
const fs = require('fs');
const path = require('path');

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const ROOT = path.resolve(__dirname, '..');
const envFromFile = loadEnvFile(path.join(ROOT, '.env'));
const env = { ...envFromFile, ...process.env };
const N8N_API_URL = (env.N8N_API_URL || 'http://127.0.0.1:5678').replace(/\/+$/, '');
const N8N_API_KEY = env.N8N_API_KEY || '';

const executionId = process.argv[2];
if (!executionId) {
  console.error('Aufruf: node scripts/n8n_execution_jetzt.cjs <executionId>');
  process.exit(1);
}

(async () => {
  const headers = { 'Content-Type': 'application/json' };
  if (N8N_API_KEY) headers['X-N8N-API-KEY'] = N8N_API_KEY;
  const res = await fetch(`${N8N_API_URL}/api/v1/executions/${executionId}?includeData=true`, { headers });
  const text = await res.text();
  console.log('HTTP', res.status);
  if (!res.ok) {
    console.log(text.slice(0, 2000));
    process.exit(1);
  }
  const data = JSON.parse(text);
  const e = data.data || data;
  console.log('id        :', e.id);
  console.log('status    :', e.status);
  console.log('finished  :', e.finished);
  console.log('startedAt :', e.startedAt);
  console.log('stoppedAt :', e.stoppedAt);

  const nodes = (e.data && (e.data.resultData || e.data).runData) || {};
  for (const [nodeName, runs] of Object.entries(nodes)) {
    for (const run of runs || []) {
      const err = run.error;
      const status = run.executionStatus;
      const dataItems = run.data && run.data.main ? run.data.main.length : 0;
      console.log(`- ${nodeName}: status=${status} items=${dataItems}${err ? ' FEHLER=' + JSON.stringify(err).slice(0, 500) : ''}`);
    }
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
