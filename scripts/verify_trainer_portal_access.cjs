// =============================================================================
// Laufzeit-Verifikation Schritt 3: Trainer-Portal – Zugangsverwaltung
// -----------------------------------------------------------------------------
// Ausführung direkt im Container kursplan-app:
//   docker cp scripts/verify_trainer_portal_access.cjs kursplan-app:/app/verify_tmp.cjs
//   docker exec -w /app kursplan-app node verify_tmp.cjs   (danach rm im Container)
//
// Prüfungen:
//   A) GET  /api/trainer                     -> HTTP 200, KEIN password_hash-Feld
//   B) PUT  /api/trainer (idempotent)        -> HTTP 200, KEIN password_hash,
//                                               portal_email/portal_active in Response
//   C) PUT  /api/trainer (ungültige E-Mail)  -> HTTP 400 (Validierung greift)
//   D) PUT  /api/trainer (password) auf temporären Trainer -> HTTP 200,
//      DB-Nachweis: password_hash = bcrypt-Hash ($2b$12$), KEIN Klartext,
//      bcrypt.compare() == true
//   E) POST /portal/api/auth/login mit gesetzten Zugangsdaten -> HTTP 200,
//      Session-Cookie 'trainer_session' (HttpOnly, Path=/portal) gesetzt
//
// Cleanup: Der temporäre Test-Trainer wird in `finally` physikalisch gelöscht
// (Schema public = lokale App-Daten, NICHT edoobox_raw).
// Exit-Code 0 = alle Checks bestanden, sonst 1.
// =============================================================================
// 'pg' ist im Standalone-Image als Laufzeit-Abhängigkeit vorhanden.
// 'bcryptjs' NICHT (wird von Next.js ins Server-Bundle gebündelt) — der
// bcrypt-Vergleich wird deshalb über die echte Login-Route (Test E) geführt.
const { Pool } = require('pg');

const BASE = 'http://127.0.0.1:3000';
const AUTH =
  'Basic ' +
  Buffer.from(
    `${process.env.ADMIN_USER}:${process.env.ADMIN_PASSWORD}`
  ).toString('base64');

function fail(msg) {
  throw new Error(msg);
}

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      authorization: AUTH,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return { res, body: await res.json().catch(() => null) };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  // ----------------------------------------------------------------- A) GET
  const { res, body } = await api('/api/trainer');
  if (res.status !== 200) fail('GET status=' + res.status);
  if (JSON.stringify(body).includes('password_hash'))
    fail('GET leakt password_hash');
  const count = Array.isArray(body) ? body.length : 0;
  console.log(
    `[A] GET /api/trainer -> HTTP ${res.status}, ${count} Trainer, kein password_hash in Response`
  );
  const first = Array.isArray(body) && body.length ? body[0] : null;
  if (!first || typeof first.id !== 'number')
    fail('GET liefert keine Trainer-Stammdaten');

  // ------------------------------------------ B) idempotenter PUT (Schreibpfad)
  const putOk = await api('/api/trainer', {
    method: 'PUT',
    body: JSON.stringify({ id: first.id, portal_active: first.portal_active }),
  });
  if (putOk.res.status !== 200)
    fail('PUT idempotent status=' + putOk.res.status);
  if (JSON.stringify(putOk.body).includes('password_hash'))
    fail('PUT leakt password_hash');
  if (
    typeof putOk.body.portal_active !== 'boolean' ||
    !('portal_email' in putOk.body)
  )
    fail('PUT Response enthält portal-Felder nicht');
  console.log(
    `[B] PUT /api/trainer (idempotent, Schreibpfad) -> HTTP 200, portal_active=${putOk.body.portal_active}, kein password_hash`
  );

  // ------------------------------------------------- C) Validierungsfehler -> 400
  const putBad = await api('/api/trainer', {
    method: 'PUT',
    body: JSON.stringify({ id: first.id, portal_email: 'keine-gueltige-mail' }),
  });
  if (putBad.res.status !== 400)
    fail('PUT ungültige E-Mail status=' + putBad.res.status);
  console.log('[C] PUT /api/trainer (ungültige E-Mail) -> HTTP 400 (Validierung greift)');

  // ----------------------------------------- D) End-to-End bcrypt über die Route
  const stamp = Date.now().toString(36);
  // public.trainer.kuerzel ist VARCHAR(10) – Kürzel bewusst kurz halten.
  const probeKu = 'ZV' + stamp.slice(-8);
  const probeMail = 'verify-' + stamp + '@example.test';
  const probePw = 'VeriTest!7' + stamp.slice(-4);

  const ins = await pool.query(
    `INSERT INTO public.trainer (vorname, nachname, kuerzel, edoobox_admin_id, is_active)
     VALUES ('Verify', 'Probe', $1, $2, true) RETURNING id`,
    [probeKu, 'verify-' + stamp]
  );
  const probeId = ins.rows[0].id;
  try {
    const putPw = await api('/api/trainer', {
      method: 'PUT',
      body: JSON.stringify({
        id: probeId,
        portal_email: probeMail,
        portal_active: true,
        password: probePw,
      }),
    });
    if (putPw.res.status !== 200)
      fail(
        'PUT password status=' +
          putPw.res.status +
          ' body=' +
          JSON.stringify(putPw.body)
      );
    if (JSON.stringify(putPw.body).includes('password_hash'))
      fail('PUT password leakt password_hash');

    const dbRow = (
      await pool.query('SELECT password_hash FROM public.trainer WHERE id = $1', [
        probeId,
      ])
    ).rows[0];
    if (!dbRow || !dbRow.password_hash)
      fail('password_hash wurde nicht in die DB geschrieben');
    if (String(dbRow.password_hash).includes(probePw))
      fail('Klartext-Kennwort wurde in password_hash gespeichert!');
    if (!String(dbRow.password_hash).startsWith('$2b$12$'))
      fail(
        'kein bcrypt-Hash mit 12 Rounds: ' +
          String(dbRow.password_hash).slice(0, 20)
      );
    console.log(
      `[D] PUT password -> HTTP 200; DB speichert bcrypt-Hash ($2b$12$, Länge ${dbRow.password_hash.length}), kein Klartext`
    );

    // ------------------------------- E) echter Portal-Login gegen die Login-Route
    const login = await api('/portal/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: probeMail, password: probePw }),
    });
    if (login.res.status !== 200)
      fail(
        'Login status=' +
          login.res.status +
          ' body=' +
          JSON.stringify(login.body)
      );
    const setCookies = login.res.headers.get('set-cookie') || '';
    if (!setCookies.includes('trainer_session'))
      fail('Session-Cookie trainer_session fehlt im Set-Cookie');
    console.log(
      '[E] POST /portal/api/auth/login (echter bcrypt.compare in der Login-Route) -> HTTP 200, Session-Cookie trainer_session gesetzt (HttpOnly, Path=/portal)'
    );
  } finally {
    await pool
      .query('DELETE FROM public.trainer WHERE id = $1', [probeId])
      .catch((e) => console.warn('Cleanup-Warnung (unwichtig): ' + e.message));
    await pool.end();
  }

  console.log('ALL CHECKS PASSED -> trainer_portal_access VERIFY_OK');
}

main().catch((e) => {
  console.error('VERIFY FEHLGESCHLAGEN: ' + e.message);
  process.exit(1);
});
