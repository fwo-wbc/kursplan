// Laufzeit-Verifikation der Themen-Verwaltung (POST / PATCH / GET + Soft-Delete).
// Reines CommonJS (kein TypeScript), Node >= 18 (global fetch).
// Jeder Request hat einen Timeout (AbortController), damit nichts hängen bleibt.
const BASE_CANDIDATES = ['http://127.0.0.1:3000', 'http://127.0.0.1:3001'];
const TEST_NAME = '__VERIFY__ Test-Thema Verwaltung';

let failures = 0;

function log(step, ok, extra) {
  console.log(`${ok ? '✓' : '✗'} ${step} ${extra || ''}`);
  if (!ok) failures++;
}

function fetchJson(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...(options || {}), signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function findBase() {
  for (const base of BASE_CANDIDATES) {
    try {
      const res = await fetchJson(`${base}/api/course-topics`);
      if (res.ok) return base;
    } catch {
      /* Port nicht erreichbar / Timeout -> nächster */
    }
  }
  throw new Error('Kein laufender Kursplan-Server unter Port 3000/3001 gefunden.');
}

async function postTopic(base, payload) {
  const res = await fetchJson(`${base}/api/course-topics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

async function patchTopic(base, payload) {
  const res = await fetchJson(`${base}/api/course-topics`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

async function getTopics(base, suffix) {
  const res = await fetchJson(`${base}/api/course-topics${suffix || ''}`);
  return { status: res.status, body: await res.json() };
}

async function main() {
  const base = await findBase();
  console.log(`Server: ${base}\n`);

  // 1) POST: neues Thema anlegen.
  const post = await postTopic(base, { name: TEST_NAME });
  const created = post.body;
  log(
    `POST /api/course-topics "${TEST_NAME}" -> HTTP ${post.status}`,
    post.status === 201 && created && Number(created.id) > 0 && created.is_active === true,
    `(id=${created ? created.id : '-'}, is_active=${created ? created.is_active : '-'})`
  );
  const topicId = created ? Number(created.id) : -1;

  // 2) GET standard: nur aktive Themen -> Test-Thema sichtbar.
  const list = await getTopics(base, '');
  const inList = Array.isArray(list.body) ? list.body.find((t) => t.id === topicId) : undefined;
  log(
    'GET (Standard) liefert nur aktive Themen',
    list.status === 200 && inList !== undefined && inList.is_active === true,
    `(Liste: ${Array.isArray(list.body) ? list.body.length : '-'} Themen, Test-Thema enthalten: ${inList !== undefined})`
  );

  // 3) POST idempotent: gleicher Name -> keine neue Zeile (Reaktivierung).
  const dup = await postTopic(base, { name: TEST_NAME });
  log(
    `POST (Duplikat) -> HTTP ${dup.status}`,
    dup.status === 201 && Number(dup.body.id) === topicId,
    '(ON CONFLICT reaktiviert, keine neue Zeile)'
  );

  // 4) PATCH: Löschvermerk setzen (is_active=false).
  const off = await patchTopic(base, { id: topicId, is_active: false });
  log(
    `PATCH is_active=false -> HTTP ${off.status}`,
    off.status === 200 && off.body.is_active === false,
    '(Löschvermerk gesetzt, kein DELETE)'
  );

  // 5) GET standard: deaktiviertes Thema darf NICHT mehr auftauchen.
  const list2 = await getTopics(base, '');
  const gone = Array.isArray(list2.body) && !list2.body.some((t) => t.id === topicId);
  log(
    'GET (Standard) blendet deaktiviertes Thema aus',
    list2.status === 200 && gone,
    `(Test-Thema in Zuordnungs-Maske enthalten: ${!gone})`
  );

  // 6) GET ?includeInactive=1: deaktiviertes Thema ist weiterhin sichtbar.
  const all = await getTopics(base, '?includeInactive=1');
  const inAll = Array.isArray(all.body) ? all.body.find((t) => t.id === topicId) : undefined;
  log(
    'GET ?includeInactive=1 liefert auch deaktivierte Themen',
    all.status === 200 && inAll !== undefined && inAll.is_active === false,
    `(Gesamtliste: ${Array.isArray(all.body) ? all.body.length : '-'}, davon aktiv: ${Array.isArray(all.body) ? all.body.filter((t) => t.is_active).length : '-'})`
  );

  // 7) PATCH: umbenennen + reaktivieren (Löschvermerk entfernen).
  const renamedName = `${TEST_NAME} (umbenannt)`;
  const on = await patchTopic(base, { id: topicId, name: renamedName, is_active: true });
  log(
    `PATCH name+is_active=true -> HTTP ${on.status}`,
    on.status === 200 && on.body.name === renamedName && on.body.is_active === true,
    '(Umbenennen + Reaktivierung)'
  );

  // 8) Unsinnige Eingaben: POST mit leerem Name -> 400.
  const bad = await postTopic(base, { name: '   ' });
  log(`POST leerer Name -> HTTP ${bad.status}`, bad.status === 400);

  // 9) Endzustand: Löschvermerk setzen, damit das Test-Thema in der
  //    Zuordnungs-Maske NICHT mehr als Checkbox auftaucht (gewünschter Endstand).
  const fin = await patchTopic(base, { id: topicId, is_active: false });
  log(
    `Endzustand: Test-Thema deaktiviert -> HTTP ${fin.status}`,
    fin.status === 200 && fin.body.is_active === false,
    '(Löschvermerk gesetzt, kein hartes DELETE)'
  );

  console.log(`\n${failures === 0 ? 'ALLE CHECKS BESTANDEN' : `${failures} CHECK(S) FEHLGESCHLAGEN`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});