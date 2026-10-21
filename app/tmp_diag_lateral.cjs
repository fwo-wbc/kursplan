/* Diagnose: Welche Teiländerung erzeugt "syntax error at or near WHERE"?
 * Varianten werden einzeln gegen die DB geparst/ausgeführt.
 */
const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
});

const slotJson = JSON.stringify([
  { code: 'KT1', von: '08:00:00', bis: '16:00:00' },
]);

const varianten = {
  V1_CROSS_exakt: `
    SELECT tr.id, (tr.datum + slot.von) AT TIME ZONE 'Europe/Berlin' AS date_start
    FROM public.termin_reservierung tr
    LEFT JOIN public.trainer t ON t.id = tr.trainer_id
    CROSS JOIN LATERAL (
      SELECT (z->>'von')::time AS von, (z->>'bis')::time AS bis
      FROM jsonb_array_elements($1::jsonb) AS z
      WHERE z->>'code' = tr.slot_code
    ) slot
    WHERE tr.status = 'angeboten'`,
  V2_LEFT_exakt: `
    SELECT tr.id, (tr.datum + slot.von) AT TIME ZONE 'Europe/Berlin' AS date_start
    FROM public.termin_reservierung tr
    LEFT JOIN public.trainer t ON t.id = tr.trainer_id
    LEFT JOIN LATERAL (
      SELECT (z->>'von')::time AS von, (z->>'bis')::time AS bis
      FROM jsonb_array_elements($1::jsonb) AS z
      WHERE z->>'code' = tr.slot_code
    ) slot
    WHERE tr.status = 'angeboten'`,
  V3_LEFT_LOWER: `
    SELECT tr.id, (tr.datum + slot.von) AT TIME ZONE 'Europe/Berlin' AS date_start
    FROM public.termin_reservierung tr
    LEFT JOIN public.trainer t ON t.id = tr.trainer_id
    LEFT JOIN LATERAL (
      SELECT (z->>'von')::time AS von, (z->>'bis')::time AS bis
      FROM jsonb_array_elements($1::jsonb) AS z
      WHERE LOWER(z->>'code') = LOWER(tr.slot_code)
    ) slot
    WHERE tr.status = 'angeboten'`,
  V4_LEFT_LOWER_COALESCE: `
    SELECT
      tr.id,
      (tr.datum + COALESCE(slot.von, TIME '09:00:00'))
        AT TIME ZONE 'Europe/Berlin' AS date_start
    FROM public.termin_reservierung tr
    LEFT JOIN public.trainer t ON t.id = tr.trainer_id
    LEFT JOIN LATERAL (
      SELECT (z->>'von')::time AS von, (z->>'bis')::time AS bis
      FROM jsonb_array_elements($1::jsonb) AS z
      WHERE LOWER(z->>'code') = LOWER(tr.slot_code)
    ) slot
    WHERE tr.status = 'angeboten'`,
};

(async () => {
  for (const [name, sql] of Object.entries(varianten)) {
    try {
      const r = await pool.query(sql, [slotJson]);
      console.log(`${name}: OK (${r.rows.length} Zeile(n))`);
    } catch (err) {
      console.log(`${name}: FEHLER -> ${err.message} (Position ${err.position ?? '-'})`);
    }
  }
  await pool.end();
})().catch((err) => {
  console.error('UNERWARTET:', err);
  process.exit(1);
});
