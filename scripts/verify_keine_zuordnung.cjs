// ---------------------------------------------------------------------------
// Verifikation: Neuer Zuweisungsstatus 'keine Zuordnung'
//   1. DB-Test:  CHECK-Constraint akzeptiert 'keine Zuordnung' (ROLLBACK)
//   2. API-Test: POST /api/zuweisung mit 'keine Zuordnung' -> 200,
//                ungültiger Status -> 400, danach Originalstatus wiederherstellen
// ---------------------------------------------------------------------------
const path = require('path');
const pgPath = path.join(__dirname, '..', 'app', 'node_modules', 'pg');
const { Client } = require(pgPath);

const BASE = 'http://localhost:3000';

async function dbTest() {
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5433,
    database: process.env.DB_NAME || 'kursplan',
    user: process.env.DB_USER || 'kursplan_user',
    password: process.env.DB_PASSWORD || 'MeinAdmin2026',
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT date_id, trainer_id, status
       FROM public.trainer_zuweisung
       LIMIT 1`
    );
    if (r.rows.length === 0) {
      console.log('DB-Test: keine Zuweisung vorhanden – Constraint-Test übersprungen.');
      return;
    }
    const row = r.rows[0];
    await client.query(
      `UPDATE public.trainer_zuweisung
       SET status = 'keine Zuordnung'
       WHERE date_id = $1 AND trainer_id = $2`,
      [row.date_id, row.trainer_id]
    );
    const check = await client.query(
      `SELECT status FROM public.trainer_zuweisung
       WHERE date_id = $1 AND trainer_id = $2`,
      [row.date_id, row.trainer_id]
    );
    console.log(
      'DB-Test: Constraint akzeptiert "keine Zuordnung" ->',
      check.rows[0].status
    );
    await client.query('ROLLBACK');
    console.log('DB-Test: ROLLBACK ausgeführt (keine Datenänderung).');
  } finally {
    await client.end();
  }
}

async function apiTest() {
  const res = await fetch(`${BASE}/api/termine`);
  const kurse = await res.json();
  let ziel = null;
  for (const kurs of kurse) {
    const z = kurs.zuweisungen && kurs.zuweisungen[0];
    if (z && z.trainer_id !== null) {
      ziel = { kurs, z };
      break;
    }
  }
  if (!ziel) {
    console.log('API-Test: kein Kurs mit Zuweisung gefunden.');
    return;
  }
  const dateIds = ziel.kurs.termine
    .map((t) => t.date_id)
    .filter((id) => id && id.trim() !== '');
  const trainerId = ziel.z.trainer_id;
  const altStatus = ziel.z.status || 'ausgeschrieben';
  console.log(
    'API-Test: Kurs =',
    ziel.kurs.offer_name,
    '| date_ids =',
    dateIds.length,
    '| trainer =',
    trainerId,
    '| altStatus =',
    altStatus
  );

  // 1) Ungültiger Status -> 400 (Validierung greift vor DB-Zugriff)
  const r1 = await fetch(`${BASE}/api/zuweisung`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date_ids: dateIds,
      trainer_id: trainerId,
      status: 'ungueltig',
    }),
  });
  console.log('API-Test: POST status=ungueltig -> HTTP', r1.status, '(erwartet 400)');

  // 2) 'keine Zuordnung' -> 200 (Validierung + DB-Constraint)
  const r2 = await fetch(`${BASE}/api/zuweisung`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date_ids: dateIds,
      trainer_id: trainerId,
      status: 'keine Zuordnung',
    }),
  });
  const b2 = await r2.json();
  const gespeichert =
    b2.zuweisungen && b2.zuweisungen[0] ? b2.zuweisungen[0].status : null;
  console.log(
    'API-Test: POST status="keine Zuordnung" -> HTTP',
    r2.status,
    '| gespeichert:',
    gespeichert
  );

  // 3) Originalstatus wiederherstellen
  const r3 = await fetch(`${BASE}/api/zuweisung`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date_ids: dateIds,
      trainer_id: trainerId,
      status: altStatus,
    }),
  });
  console.log('API-Test: Zurücksetzen auf', altStatus, '-> HTTP', r3.status);
}

async function main() {
  await dbTest();
  await apiTest();
}

main().catch((err) => {
  console.error('Verifikation fehlgeschlagen:', err.message);
  process.exit(1);
});