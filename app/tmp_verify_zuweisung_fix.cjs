/* Temporäre Laufzeit-Verifikation der korrigierten POST-/api/zuweisung-Logik:
   - Trainerwechsel löst Dubletten auf (nur der neue Trainer pro date_id)
   - 'n. v.' = Status 'keine Zuordnung' auf der Zeile des bisherigen Trainers
     (trainer_id ist NOT NULL) – bleibt auch nach simuliertem P98-DELETE-
     Nachtritt plus Nachsperren stabil
   - Wiederbesetzung ersetzt den Zustand sauber
   Es werden ausschließlich künstliche Test-dates ('tmp_zw_test_*') verwendet. */
const { Pool } = require('pg');
const assert = require('assert');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
});

(async () => {
  const client = await pool.connect();
  const suffix = `${Date.now()}`;
  const dateIds = [`tmp_zw_test_${suffix}_1`, `tmp_zw_test_${suffix}_2`];

  const lade = async () =>
    client.query(
      `SELECT date_id, trainer_id, status FROM public.trainer_zuweisung
       WHERE date_id = ANY($1::text[]) ORDER BY date_id`,
      [dateIds]
    );

  // Exakt die Route-Logik: Dubletten-DELETE + Upsert.
  const zuweisen = async (trainerId, status) => {
    await client.query(
      `DELETE FROM public.trainer_zuweisung
       WHERE date_id = ANY($1::text[])
         AND trainer_id IS DISTINCT FROM $2::int`,
      [dateIds, trainerId]
    );
    await client.query(
      `INSERT INTO public.trainer_zuweisung (date_id, trainer_id, status, notiz)
       SELECT d.date_id, $2::int, $3::text, $4::text
       FROM unnest($1::text[]) AS d(date_id)
       ON CONFLICT (date_id, trainer_id)
       DO UPDATE SET status = EXCLUDED.status, notiz = EXCLUDED.notiz`,
      [dateIds, trainerId, status, null]
    );
  };

  const cleanup = async () => {
    await client.query(
      `DELETE FROM public.trainer_zuweisung
       WHERE date_id LIKE 'tmp_zw_test_%'`
    );
  };

  try {
    await client.query('SELECT 1');
    console.log('✓ DB-Verbindung (Port 5433) besteht.');

    const trainerRes = await client.query(
      `SELECT id, kuerzel FROM public.trainer
       WHERE is_active IS TRUE ORDER BY id LIMIT 2`
    );
    assert.strictEqual(trainerRes.rows.length, 2, 'Es werden 2 Trainer benötigt.');
    const [trainerA, trainerB] = trainerRes.rows;
    console.log(`✓ Trainer A=${trainerA.id} (${trainerA.kuerzel}), Trainer B=${trainerB.id} (${trainerB.kuerzel})`);

    await cleanup();

    // Schritt 1: Zuweisung Trainer A.
    await zuweisen(trainerA.id, 'ausgeschrieben');
    assert.deepStrictEqual(
      (await lade()).rows.map((r) => r.trainer_id),
      [trainerA.id, trainerA.id],
      'Ausgangslage: Trainer A auf beiden Terminen.'
    );
    console.log('✓ Schritt 1: Zuweisung Trainer A angelegt.');

    // Schritt 2: Trainerwechsel A→B.
    await zuweisen(trainerB.id, 'ausgeschrieben');
    let z = await lade();
    assert.strictEqual(z.rows.length, 2, 'Pro date_id genau EINE Zuweisung nach Wechsel.');
    assert.deepStrictEqual(
      z.rows.map((r) => r.trainer_id),
      [trainerB.id, trainerB.id],
      'Keine Dublette mit Trainer A.'
    );
    console.log('✓ Schritt 2: Trainerwechsel A→B – Dublette aufgelöst, nur noch B.');

    // Schritt 3: 'n. v.' = Status 'keine Zuordnung' mit bisherigem Trainer B.
    await zuweisen(trainerB.id, 'keine Zuordnung');
    z = await lade();
    assert.strictEqual(z.rows.length, 2, 'Genau eine Sperr-Zeile pro date_id.');
    assert.ok(
      z.rows.every((r) => r.trainer_id === trainerB.id && r.status === 'keine Zuordnung'),
      'Sperr-Zeilen: trainer_id = bisheriger Trainer, Status "keine Zuordnung".'
    );
    console.log('✓ Schritt 3: "n. v." – Sperr-Status auf Trainer-B-Zeilen gesetzt.');

    // Schritt 3b: P98-DELETE-Nachtritt (löscht nur EINE date_id).
    await client.query(
      `DELETE FROM public.trainer_zuweisung WHERE date_id = $1::text`,
      [dateIds[0]]
    );
    z = await lade();
    assert.strictEqual(z.rows.length, 1, 'P98 hat nur eine date_id entfernt.');
    console.log('✓ Schritt 3b: P98-DELETE-Nachtritt (eine date_id) simuliert.');

    // Schritt 3c: Frontend setzt die Sperre nach P98 erneut.
    await zuweisen(trainerB.id, 'keine Zuordnung');
    z = await lade();
    assert.strictEqual(z.rows.length, 2, 'Sperre nach P98 wieder vollständig.');
    assert.ok(
      z.rows.every((r) => r.trainer_id === trainerB.id && r.status === 'keine Zuordnung'),
      'Nachsperren: trainer_id = Trainer B, Status "keine Zuordnung".'
    );
    console.log('✓ Schritt 3c: Sperre nach P98 erneut gesetzt – vollständig.');

    // Schritt 4: Erneute Zuweisung (Trainer A) ersetzt den Sperr-Status.
    await zuweisen(trainerA.id, 'ausgeschrieben');
    z = await lade();
    assert.strictEqual(z.rows.length, 2, 'Wiederbesetzung: genau 2 Zeilen.');
    assert.deepStrictEqual(
      z.rows.map((r) => [r.trainer_id, r.status]),
      [[trainerA.id, 'ausgeschrieben'], [trainerA.id, 'ausgeschrieben']],
      'Wiederbesetzung: Trainer A, Status "ausgeschrieben".'
    );
    console.log('✓ Schritt 4: Wiederbesetzung ersetzt Sperr-Status sauber.');

    await cleanup();
    console.log('✓ ALLE VERIFIKATIONEN BESTANDEN.');
  } catch (err) {
    await cleanup().catch(() => {});
    console.error('✗ VERIFIKATION FEHLGESCHLAGEN:', err);
    process.exitCode = 1;
  } finally {
    await client.release();
    await pool.end();
  }
})();