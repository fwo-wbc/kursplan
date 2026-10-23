/* Temporäre Laufzeit-Verifikation „Trainerwechsel → edoobox-Modultitel":
   - Vorher-Zustand: bisheriges Trainerkürzel je date_id wird VOR dem Upsert
     gelesen (exakt die neue SQL-Logik aus bulk/route.ts und route.ts).
   - Payload-Bildung: offer_id, titel (o.name), trainer_kuerzel, altes_kuerzel
     werden exakt wie in notifyTrainerSync zusammengestellt.
   - Regex: die exakt im P95-Code-Node verwendete Titelersetzung.
   - HTTP: PATCH /api/zuweisung/bulk liefert weiterhin 200 (nur künstliche
     Test-dates, cleanup läuft automatisch; kein edoobox-Webhook, weil die
     Test-dates nicht in edoobox_raw.offer_date liegen).
   Read: nur public.trainer_zuweisung / edoobox_raw (kein DELETE). */
const { Pool } = require('pg');
const assert = require('assert');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
});

// Exakt die Titel-Ersetzung aus dem P95-Code-Node „P95 Auftraege aufbereiten".
function titelErsetzen(titel, altesKuerzel, neuesKuerzel) {
  let neuerTitel = titel;
  let titelGeaendert = false;
  if (titel && altesKuerzel && neuesKuerzel && altesKuerzel !== neuesKuerzel) {
    const ersetzt = titel.replace(
      new RegExp('\\s*\\(?\\b' + altesKuerzel + '\\b\\)?$'),
      ' (' + neuesKuerzel + ')'
    );
    if (ersetzt !== titel) {
      neuerTitel = ersetzt;
      titelGeaendert = true;
    }
  }
  return { neuerTitel, titelGeaendert };
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('✓ DB-Verbindung (Port 5433) besteht.\n');

    // ---- 1) Regex-Core (identisch mit Workflow) -------------------------
    const f1 = titelErsetzen('Kurs FW', 'FW', 'DH');
    assert.strictEqual(f1.neuerTitel, 'Kurs (DH)', 'nacktes Kürzel wird geklammert ersetzt');
    assert.strictEqual(f1.titelGeaendert, true);
    console.log('✓ Regex: "Kurs FW"  ->', f1.neuerTitel);

    const f2 = titelErsetzen('Kurs (FW)', 'FW', 'DH');
    assert.strictEqual(f2.neuerTitel, 'Kurs (DH)', 'geklammertes Kürzel wird ersetzt');
    console.log('✓ Regex: "Kurs (FW)" ->', f2.neuerTitel);

    const f3 = titelErsetzen('Yoga am Morgen', 'FW', 'DH');
    assert.strictEqual(f3.neuerTitel, 'Yoga am Morgen');
    assert.strictEqual(f3.titelGeaendert, false, 'kein Muster → kein Update');
    console.log('✓ Regex: "Yoga am Morgen" -> unverändert (kein Update)');

    const f4 = titelErsetzen('Kurs FW', 'FW', 'FW');
    assert.strictEqual(f4.titelGeaendert, false, 'kein echter Wechsel → kein Update');
    console.log('✓ Regex: altes==neues Kürzel -> unverändert\n');

    // ---- 2) Vorher-Zustand + Payload-Bildung gegen echte Daten ----------
    // Bekannte date_id mit Zuweisung FW aus der GET-/api/zuweisung-Antwort.
    const dateId = 'date_2b68594ac204_31115688885';
    const [bestehend] = (
      await client.query(
        `SELECT tz.date_id::text AS date_id, tz.trainer_id, t.kuerzel
         FROM public.trainer_zuweisung tz
         INNER JOIN public.trainer t ON t.id = tz.trainer_id
         WHERE tz.date_id = $1`,
        [dateId]
      )
    ).rows;
    assert(bestehend, 'Ausgangszuweisung vorhanden');
    console.log(`✓ Bestand: ${dateId} -> Trainer ${bestehend.trainer_id} (${bestehend.kuerzel})`);

    // Neuer Trainer (z. B. Dirk Heine id=30 / DH) als ZIEL.
    const ziel = (
      await client.query(
        `SELECT id, kuerzel FROM public.trainer
         WHERE id IS DISTINCT FROM $1::int AND is_active IS TRUE
         ORDER BY id LIMIT 1`,
        [bestehend.trainer_id]
      )
    ).rows[0];
    assert(ziel);
    console.log(`✓ Ziel-Trainer: ${ziel.id} (${ziel.kuerzel})`);

    // Exakt die neue „Vorher-Abfrage" aus der Route.
    const vorher = await client.query(
      `SELECT tz.date_id::text AS date_id, t.kuerzel
       FROM public.trainer_zuweisung tz
       INNER JOIN public.trainer t ON t.id = tz.trainer_id
       WHERE tz.date_id = ANY($1::text[])
         AND tz.trainer_id IS DISTINCT FROM $2::int`,
      [[dateId], ziel.id]
    );
    const alteMap = {};
    for (const row of vorher.rows) if (row.kuerzel) alteMap[row.date_id] = row.kuerzel;
    assert.strictEqual(alteMap[dateId], bestehend.kuerzel, 'Vorher-Zustand liefert altes Kürzel');
    console.log(`✓ Vorher-Abfrage: altes_kuerzel=${alteMap[dateId]} (trainer_id IS DISTINCT FROM ${ziel.id})`);

    // Exakt die neue offer/titel-Abfrage aus notifyTrainerSync.
    const offerRes = await client.query(
      `SELECT
         o.offer_id::text AS offer_id,
         o.name AS titel,
         array_agg(DISTINCT d.date_id::text ORDER BY d.date_id::text) AS date_ids
       FROM edoobox_raw.offer o
       INNER JOIN edoobox_raw.offer_date d ON d.offer_id = o.offer_id
       WHERE d.is_deleted IS NOT TRUE
         AND o.offer_id IN (
           SELECT DISTINCT offer_id
           FROM edoobox_raw.offer_date
           WHERE date_id::text = ANY($1::text[])
         )
       GROUP BY o.offer_id, o.name`,
      [[dateId]]
    );
    assert(offerRes.rows.length >= 1, 'offer für date_id existiert');
    const offer = offerRes.rows[0];
    console.log(`✓ offer_id=${offer.offer_id} | titel="${offer.titel}" | date_ids=${offer.date_ids.length} Stk.`);

    // Payload wie in der Route zusammenbauen.
    const alteKuerzel =
      [
        ...new Set(
          offer.date_ids
            .map((id) => (alteMap[id] || '').trim())
            .filter((k) => k !== '')
        ),
      ][0] ?? null;
    const payload = {
      offer_id: offer.offer_id,
      date_ids: offer.date_ids,
      titel: offer.titel,
      trainer_id: ziel.id,
      trainer_kuerzel: ziel.kuerzel,
      altes_kuerzel: alteKuerzel,
      edoobox_admin_id: null,
    };
    assert.strictEqual(payload.altes_kuerzel, bestehend.kuerzel);
    console.log(`✓ Payload enthält altes_kuerzel="${payload.altes_kuerzel}" und titel="${payload.titel}"`);
    const { neuerTitel, titelGeaendert } = titelErsetzen(payload.titel, payload.altes_kuerzel, payload.trainer_kuerzel);
    console.log(`✓ Titel-Update: "${payload.titel}" -> "${neuerTitel}" (geändert=${titelGeaendert})\n`);

    // ---- 3) HTTP: PATCH /api/zuweisung/bulk (künstliche Test-dates) -----
    const http = require('http');
    const suffix = `${Date.now()}`;
    const testDateIds = [`tmp_ver_tts_${suffix}_1`, `tmp_ver_tts_${suffix}_2`];
    const patch = (body) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: 'localhost',
            port: 3000,
            path: '/api/zuweisung/bulk',
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }));
          }
        );
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
      });

    await patch({ date_ids: testDateIds, trainer_id: bestehend.trainer_id, status: 'ausgeschrieben' });
    const r2 = await patch({ date_ids: testDateIds, trainer_id: ziel.id, status: 'bestätigt' });
    assert.strictEqual(r2.status, 200, 'PATCH bulk -> 200');
    assert.strictEqual(r2.data.zuweisungen.length, 2);
    console.log(`✓ HTTP PATCH /api/zuweisung/bulk -> ${r2.status}, ${r2.data.zuweisungen.length} Zeilen (Trainerwechsel ${bestehend.trainer_id}->${ziel.id})`);

    // Cleanup Test-dates.
    await client.query(
      `DELETE FROM public.trainer_zuweisung WHERE date_id LIKE 'tmp_ver_tts_%'`
    );
    console.log('✓ Cleanup der Test-dates abgeschlossen.');

    console.log('\nAlle Prüfungen erfolgreich.');
  } finally {
    await client.end();
    await pool.end();
  }
})().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});
