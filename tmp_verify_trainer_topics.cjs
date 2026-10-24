// Laufzeit-Verifikation der neuen Routen /api/trainer-topics.
// Erzeugt einen temporären Test-Topic, speichert eine Zuordnung per PUT,
// prüft sie per GET und räumt den Test-Topic anschließend wieder ab
// (ON DELETE CASCADE entfernt die Zuordnungszeilen mit).
// Läuft gegen den Dev-Server auf Port 3000 (bestehender aktiver Dev-Server).
const { Client } = require('./app/node_modules/pg');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
  connectionTimeoutMillis: 5000,
  statement_timeout: 8000,
};

const BASE = 'http://127.0.0.1:3000';
const TRAINER_ID = 1;
const HTTP_TIMEOUT = 30000; // ms – Dev-Server kompiliert beim ersten Request.

function fail(msg) {
  console.error('✗ ' + msg);
  process.exitCode = 1;
}

/** fetch mit hartem Timeout (AbortController). */
async function httpFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();

  let testTopicId = null;
  try {
    // 1) Trainer 1 existiert?
    const trainerRes = await client.query(
      `SELECT id FROM public.trainer WHERE id = $1`,
      [TRAINER_ID]
    );
    if (trainerRes.rowCount === 0) {
      console.error(`Trainer ${TRAINER_ID} existiert nicht.`);
      process.exitCode = 1;
      return;
    }

    // 2) Temporären Test-Topic anlegen.
    const topic = await client.query(
      `INSERT INTO public.course_topics (name)
       VALUES ('__VERIFY__ Trainer-Topic')
       RETURNING id`
    );
    testTopicId = topic.rows[0].id;

    // 3) GET vor Zuordnung (leer erwarten).
    let res = await httpFetch(
      `${BASE}/api/trainer-topics?trainerId=${TRAINER_ID}`
    );
    if (!res.ok) return fail(`GET (leer) -> HTTP ${res.status}`);
    let body = await res.json();
    const initial = JSON.stringify(body);
    if (body.topicIds.length !== 0) {
      return fail(`GET initial sollte leer sein, war: ${initial}`);
    }
    console.log(`✓ GET initial -> HTTP 200, topicIds=[]`);

    // 4) PUT: Zuordnung setzen.
    res = await httpFetch(`${BASE}/api/trainer-topics`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trainerId: TRAINER_ID, topicIds: [testTopicId] }),
    });
    if (!res.ok) return fail(`PUT -> HTTP ${res.status}`);
    body = await res.json();
    if (body.topicIds.length !== 1 || body.topicIds[0] !== testTopicId) {
      return fail(`PUT Ergebnis unerwartet: ${JSON.stringify(body)}`);
    }
    console.log(`✓ PUT -> HTTP 200, topicIds=[${testTopicId}]`);

    // 5) GET nach Zuordnung (Erwartung: genau 1 Topic).
    res = await httpFetch(
      `${BASE}/api/trainer-topics?trainerId=${TRAINER_ID}`
    );
    if (!res.ok) return fail(`GET (nach PUT) -> HTTP ${res.status}`);
    body = await res.json();
    if (body.topicIds.length !== 1 || body.topicIds[0] !== testTopicId) {
      return fail(`GET nach PUT unerwartet: ${JSON.stringify(body)}`);
    }
    console.log(`✓ GET (nach PUT) -> HTTP 200, topicIds=[${testTopicId}]`);

    // 6) PUT: Zuordnung leeren (ersetzen ohne Themen).
    res = await httpFetch(`${BASE}/api/trainer-topics`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trainerId: TRAINER_ID, topicIds: [] }),
    });
    if (!res.ok) return fail(`PUT (leeren) -> HTTP ${res.status}`);
    body = await res.json();
    if (body.topicIds.length !== 0) {
      return fail(`PUT leeren unerwartet: ${JSON.stringify(body)}`);
    }
    console.log(`✓ PUT (leeren) -> HTTP 200, topicIds=[]`);

    // 7) Fehlerfall: ungültige trainerId.
    res = await httpFetch(`${BASE}/api/trainer-topics?trainerId=abc`);
    if (res.status !== 400) {
      return fail(
        `GET invalid -> HTTP ${res.status} (erwartet 400)`
      );
    }
    console.log(`✓ GET invalid trainerId -> HTTP 400`);

    console.log('✓ Alle API-Tests bestanden.');
  } catch (err) {
    fail(`Unerwarteter Fehler: ${err.message}`);
  } finally {
    // Aufräumen: Test-Topic entfernen (Cascade räumt trainer_topics auf).
    if (testTopicId !== null) {
      await client.query(
        `DELETE FROM public.course_topics WHERE id = $1`,
        [testTopicId]
      );
      console.log(`✓ Test-Topic ${testTopicId} entfernt.`);
    }
    await client.end();
  }
}

main();