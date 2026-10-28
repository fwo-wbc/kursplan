/* Listet die letzten Executions eines Workflows ueber die n8n Public REST API. */
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
const workflowId = process.argv[2] || 'dnf6LyuhQawESBX0';

(async () => {
  const headers = { 'Content-Type': 'application/json' };
  if (N8N_API_KEY) headers['X-N8N-API-KEY'] = N8N_API_KEY;
  const url = `${N8N_API_URL}/executions?workflowId=${workflowId}&limit=10&includeData=true`;
  const res = await fetch(url, { headers });
  const text = await res.text();
  console.log('HTTP', res.status, '| URL', url);
  if (!res.ok) {
    console.log(text.slice(0, 3000));
    process.exit(1);
  }
  const data = JSON.parse(text);
  const list = data.data || [];
  console.log('Anzahl:', list.length);
  for (const e of list) {
    console.log('---');
    console.log('id:', e.id, '| status:', e.status, '| finished:', e.finished);
    console.log('startedAt:', e.startedAt, '| stoppedAt:', e.stoppedAt);
    const runData = e.data && (e.data.resultData || e.data).runData;
    if (runData) {
      for (const [nodeName, runs] of Object.entries(runData)) {
        for (const run of runs || []) {
          const err = run.error;
          console.log(`   - node: ${nodeName} | status: ${run.executionStatus}${err ? ' | FEHLER: ' + JSON.stringify(err).slice(0, 600) : ''}`);
        }
      }
    } else {
      console.log('   (kein runData)');
    }
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
