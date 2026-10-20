// Temporärer Diagnose-Test: Admin-Login + offer/list mit serialisiertem data.login als Bearer.
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.local');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const base = (env.EDOOBOX_API_BASE || 'https://app1.edoobox.com').trim();
const user = (env.EDOOBOX_USER || '').trim();
const pass = (env.EDOOBOX_PASSWORD || '').trim();
const url = `${base}/v2/auth`;

(async () => {
  // 1. Login
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'grant-type': 'password' },
    body: JSON.stringify({ email: user, password: pass, remember: true, reply: 'token' }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json();
  console.log('Login-Status:', res.status, '| success:', json.success);
  const edid = json?.data?.edid;
  const login = json?.data?.login;
  const cookie = json?.data?.cookie;
  console.log('edid:', edid);
  console.log('cookie:', cookie, '| login ist', typeof login);

  // 2. offer/list mit serialisiertem login als Bearer
  const tokenCandidate = typeof login === 'object' ? JSON.stringify(login) : login;
  const listRes = await fetch(`${base}/v2/offer/list?limit[start]=0&limit[reply]=5`, {
    method: 'GET',
    headers: {
      edid,
      'grant-type': 'access_token',
      Authorization: `Bearer ${tokenCandidate}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await listRes.text();
  console.log('offer/list Status:', listRes.status);
  console.log('Antwort (gekürzt):', text.slice(0, 300));
})().catch((e) => {
  console.error('Fehler:', e.message);
  process.exit(1);
});