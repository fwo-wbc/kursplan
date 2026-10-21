/* Temporäre Laufzeit-Verifikation der geänderten ladeReservierungen()-SQL
 * in app/src/app/api/termine/route.ts:
 *   - LEFT JOIN LATERAL statt CROSS JOIN LATERAL
 *   - COALESCE-Fallback auf 09:00:00 / 17:00:00 am gebuchten Datum
 *   - case-insensitive Slot-Prüfung via LOWER()
 */
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

const SQL = `
SELECT
  tr.id::text            AS reservierung_id,
  tr.slot_code,
  (tr.datum + COALESCE(slot.von, TIME '09:00:00'))
    AT TIME ZONE 'Europe/Berlin' AS date_start,
  (tr.datum + COALESCE(slot.bis, TIME '17:00:00'))
    AT TIME ZONE 'Europe/Berlin' AS date_end
FROM public.termin_reservierung tr
LEFT JOIN public.trainer t ON t.id = tr.trainer_id
LEFT JOIN LATERAL (
  SELECT (z->>'von')::time AS von,
         (z->>'bis')::time AS bis
  FROM jsonb_array_elements($2::jsonb) AS z
  WHERE LOWER(z->>'code') = LOWER(tr.slot_code)
) slot ON TRUE
WHERE tr.status = 'angeboten'
  AND tr.datum >= COALESCE(
        $1::date,
        (NOW() - ($3::int * INTERVAL '1 day'))::date
      )
ORDER BY tr.datum ASC, tr.id ASC`;

function jsonVonCodes(codes, von, bis) {
  return JSON.stringify(codes.map((code) => ({ code, von, bis })));
}

(async () => {
  const umumfangTage = 365;

  // 1) Tatsächlich in der DB vorhandene aktive slot_codes ermitteln.
  const codesRs = await pool.query(
    `SELECT DISTINCT slot_code
       FROM public.termin_reservierung
      WHERE status = 'angeboten'
      ORDER BY 1`
  );
  const codes = codesRs.rows.map((r) => String(r.slot_code));

  if (codes.length === 0) {
    console.log('KEINE aktiven Reservierungen (status=angeboten) vorhanden.');
  } else {
    console.log('DB-Slot-Codes aktiver Reservierungen:', codes.join(', '));
    console.log('-----------------------------------------------------');

    // --- Szenario A: Voll-JSON mit exakter Großschreibung ---
    const a = await pool.query(SQL, [null, jsonVonCodes(codes, '08:00:00', '16:00:00'), umumfangTage]);
    console.log(`A) Voll-Abgleich (exakte Codes): ${a.rows.length} Reservierung(en)`);
    for (const r of a.rows) {
      console.log(
        `   #${r.reservierung_id} slot=${r.slot_code} -> ${r.date_start instanceof Date ? r.date_start.toISOString() : r.date_start} | ${r.date_end instanceof Date ? r.date_end.toISOString() : r.date_end}`
      );
    }
    console.log('-----------------------------------------------------');

    // --- Szenario B: ein Slot-Code wird aus dem JSON entfernt ---
    // Der matcht dann nicht -> Zeile muss erhalten bleiben und
    // COALESCE-Fallback 09:00/17:00 (Berlin) liefern.
    const codesOhneLetzten = codes.slice(0, -1);
    const b = await pool.query(SQL, [null, jsonVonCodes(codesOhneLetzten, '08:00:00', '16:00:00'), umumfangTage]);
    console.log(`B) Letzter Code "${codes[codes.length - 1]}" entfernt: ${b.rows.length} Reservierung(en) (erwartet: ${a.rows.length}, keine Eliminierung)`);
    for (const r of b.rows) {
      const start = r.date_start instanceof Date ? r.date_start.toISOString() : r.date_start;
      const ende = r.date_end instanceof Date ? r.date_end.toISOString() : r.date_end;
      const startFallback = start.includes('07:00:00') || start.includes('09:00:00') ? 'FALLBACK-OK' : '';
      const endeFallback = ende.includes('17:00:00Z') ? '' : '';
      console.log(
        `   #${r.reservierung_id} slot=${r.slot_code} -> ${start} | ${ende} ${startFallback}`
      );
    }
    console.log('-----------------------------------------------------');

    // --- Szenario C: alle Codes kleingeschrieben + abweichende Zeiten ---
    // LOWER-Match muss greifen: date_start/date_end müssen die abweichenden
    // (klein geschriebenen) Zeiten 07:00-14:00 tragen, NICHT den 09:00-17:00-Fallback.
    const c = await pool.query(SQL, [null, jsonVonCodes(codes.map((x) => x.toLowerCase()), '07:00:00', '14:00:00'), umumfangTage]);
    console.log(`C) Codes kleingeschrieben (Zeiten 07:00-14:00): ${c.rows.length} Reservierung(en) (erwartet: ${a.rows.length})`);
    let lowerGreift = 0;
    for (const r of c.rows) {
      const start = r.date_start instanceof Date ? r.date_start.toISOString() : r.date_start;
      const ende = r.date_end instanceof Date ? r.date_end.toISOString() : r.date_end;
      if (start.includes('07:00:00') || start.includes('05:00:00Z') || start.includes('06:00:00Z')) lowerGreift++;
      console.log(`   #${r.reservierung_id} slot=${r.slot_code} -> ${start} | ${ende}`);
    }
    console.log(`   -> LOWER-Match ${lowerGreift} von ${c.rows.length} Zeile(n) mit 07:00-Uhrzeit (Fallback waere 09:00)`);
  }

  await pool.end();
})().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});
