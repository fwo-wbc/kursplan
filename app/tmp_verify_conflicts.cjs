/**
 * Temporäre Laufzeit-Verifikation des Konflikt-Dashboards (Szenario 1).
 *
 * Ablauf:
 *   1. Testdaten anlegen (course_topics + course_events, Berliner Zeiten)
 *   2. GET  /api/course-events/conflicts            (Gruppierung + Join prüfen)
 *   3. PATCH /api/course-events/[id]/resolve         (new_trainer_id)
 *   4. PATCH /api/course-events/[id]/resolve         (new_start_time, +90 min)
 *   5. Fehlerfälle: beide Felder / kein Feld / unbekannte id
 *   6. Datenhaltung nach Auflösung (Flag false → aus GET verschwunden)
 *   7. Cleanup aller Testdaten
 *
 * Erwartet laufende App: node tmp_verify_conflicts.cjs mit API_BASE,
 * Standard: http://127.0.0.1:3005
 */
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

const BASE = process.env.API_BASE || 'http://127.0.0.1:3005';
const TEST_KURS_IDS = [999901, 999902, 999903];

let fehler = 0;
function check(bedingung, nachricht) {
  if (bedingung) {
    console.log(`  OK   ${nachricht}`);
  } else {
    console.error(`FEHLER ${nachricht}`);
    fehler++;
  }
}

async function api(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  let json = null;
  try {
    json = await res.json();
  } catch {
    // leere Antwort erlaubt
  }
  return { res, json };
}

async function cleanup(events, topicId) {
  await pool.query('DELETE FROM public.course_events WHERE id = ANY($1::bigint[])', [events]);
  await pool.query('DELETE FROM public.course_topics WHERE id = $1', [topicId]);
}

(async () => {
  let events = [];
  let topicId = null;

  try {
    // ---- Testdaten anlegen -------------------------------------------------
    const topicRes = await pool.query(
      `INSERT INTO public.course_topics (name) VALUES ('Test-Szenario-1') RETURNING id`
    );
    topicId = topicRes.rows[0].id;

    const trainerRes = await pool.query(
      `SELECT id, kuerzel FROM public.trainer ORDER BY id ASC LIMIT 1`
    );
    const trainerId = trainerRes.rows[0] ? trainerRes.rows[0].id : null;
    console.log(`Test-Trainer: ${trainerId} (${trainerRes.rows[0]?.kuerzel ?? '?'})`);

    const startZeiten = ['09:00', '11:00', '13:00'];
    for (let i = 0; i < startZeiten.length; i++) {
      const ins = await pool.query(
        `INSERT INTO public.course_events
           (course_id, topic_id, trainer_id, start_time, end_time, needs_conflict_resolution)
         VALUES
           ($1, $2, $3,
            ($4::timestamp AT TIME ZONE 'Europe/Berlin'),
            (($4::timestamp AT TIME ZONE 'Europe/Berlin') + INTERVAL '90 minutes'),
            true)
         RETURNING id`,
        [TEST_KURS_IDS[i], topicId, trainerId, `2026-10-28 ${startZeiten[i]}`]
      );
      events.push(ins.rows[0].id);
    }
    console.log(`Test-Termine angelegt: ${events.join(', ')}`);

    // ---- 1) GET /api/course-events/conflicts --------------------------------
    console.log('\n[1] GET /api/course-events/conflicts');
    let r = await api('/api/course-events/conflicts');
    check(r.res.status === 200, `HTTP ${r.res.status}`);
    const gruppen = Array.isArray(r.json) ? r.json : [];
    check(gruppen.length >= 1, `mind. eine Tagesgruppe vorhanden (${gruppen.length})`);

    const tage = gruppen.filter((g) =>
      Array.isArray(g.termine) && g.termine.some((t) =>
        TEST_KURS_IDS.includes(Number(t.course_id))
      )
    );
    check(tage.length === 1, `Test-Termine in genau einer Tagesgruppe (${tage.length})`);
    const tag = tage[0];
    check(tag && tag.anzahl === tag.termine.length, `anzahl=${tag?.anzahl} entspricht termine=${tag?.termine?.length}`);
    check(tag && tag.termine.length >= 3, `Konflikt-Tag mit ${tag?.termine?.length} Kursen`);
    check(tag && tag.termine.every((t) => t.topic_name === 'Test-Szenario-1'), 'Themennamen aus course_topics gejoint');
    check(tag && tag.termine.every((t) => t.trainer_name !== null), 'Trainername/-kürzel gejoint');

    // ---- 2) PATCH: Trainer neu zuweisen -------------------------------------
    console.log('\n[2] PATCH /api/course-events/[id]/resolve (new_trainer_id)');
    r = await api(`/api/course-events/${events[0]}/resolve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_trainer_id: trainerId }),
    });
    check(r.res.status === 200, `HTTP ${r.res.status}`);
    check(r.json?.resolved === true, 'Antwort enthält resolved=true');
    check(r.json?.termin?.needs_conflict_resolution === false, 'needs_conflict_resolution=false gesetzt');
    check(Number(r.json?.termin?.trainer_id) === trainerId, 'trainer_id aktualisiert');

    // ---- 3) PATCH: Termin verschieben (+90 min end_time) --------------------
    console.log('\n[3] PATCH /api/course-events/[id]/resolve (new_start_time)');
    r = await api(`/api/course-events/${events[1]}/resolve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_start_time: '2026-10-29T15:00' }),
    });
    check(r.res.status === 200, `HTTP ${r.res.status}`);
    // Erwartung: 2026-10-29 liegt nach dem DST-Wechsel (25.10.2026) → Berlin ist
    // UTC+1 (CET). 15:00 CET = 14:00Z, 16:30 CET = 15:30Z.
    check(r.json?.termin?.start_time === '2026-10-29T14:00:00.000Z', `start_time umgerechnet (${r.json?.termin?.start_time})`);
    check(r.json?.termin?.end_time === '2026-10-29T15:30:00.000Z', `end_time = start + 90 min (${r.json?.termin?.end_time})`);
    check(r.json?.termin?.needs_conflict_resolution === false, 'needs_conflict_resolution=false gesetzt');

    // ---- 4) Fehlerfälle ------------------------------------------------------
    console.log('\n[4] Validierungs-/Fehlerfälle');
    r = await api(`/api/course-events/${events[2]}/resolve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_trainer_id: trainerId, new_start_time: '2026-10-29T09:00' }),
    });
    check(r.res.status === 400, `beide Felder → HTTP ${r.res.status} (erwartet 400)`);

    r = await api(`/api/course-events/${events[2]}/resolve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    check(r.res.status === 400, `kein Feld → HTTP ${r.res.status} (erwartet 400)`);

    r = await api(`/api/course-events/999999999/resolve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_trainer_id: trainerId }),
    });
    check(r.res.status === 404, `unbekannte id → HTTP ${r.res.status} (erwartet 404)`);

    // ---- 5) Nach Auflösung nicht mehr im Konflikt-Load -----------------------
    console.log('\n[5] Datenhaltung nach Auflösung');
    r = await api('/api/course-events/conflicts');
    const gruppenF = Array.isArray(r.json) ? r.json : [];
    const idsOffen = gruppenF.flatMap((g) => g.termine.map((t) => Number(t.id)));
    check(!idsOffen.includes(Number(events[0])) && !idsOffen.includes(Number(events[1])),
      'gelöste Termine (1+2) nicht mehr in GET enthalten');
    check(idsOffen.includes(Number(events[2])), 'ungelöster Termin (3) weiterhin enthalten');
  } catch (err) {
    console.error('Skript-Fehler:', err.message);
    fehler++;
  } finally {
    // ---- 7) Cleanup ----------------------------------------------------------
    try {
      await cleanup(events, topicId);
      console.log('\nCleanup: Testdaten entfernt.');
    } catch (err) {
      console.error('Cleanup-Fehler:', err.message);
      fehler++;
    }
    await pool.end();
    console.log(fehler === 0 ? '\nERGEBNIS: alle Prüfungen OK' : `\nERGEBNIS: ${fehler} Prüfung(en) fehlgeschlagen`);
    process.exit(fehler === 0 ? 0 : 1);
  }
})();
