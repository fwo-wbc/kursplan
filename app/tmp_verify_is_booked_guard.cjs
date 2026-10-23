/* Test: is_booked-Guard – Slot auf "gebucht" setzen, DELETE muss 409 liefern.
   Danach Testdaten aufräumen (physisches DELETE in public ist erlaubt). */
const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1', port: 5433, database: 'kursplan',
  user: 'kursplan_user', password: 'MeinAdmin2026',
});

(async () => {
  const SLOT_ID = 5169;

  await pool.query(
    `UPDATE public.trainer_verfuegbarkeit SET is_booked = true WHERE id = $1`,
    [SLOT_ID]
  );
  console.log('[SET] Slot', SLOT_ID, 'auf is_booked=true gesetzt.');

  const res = await fetch(`http://localhost:3000/api/trainer-availabilities?id=${SLOT_ID}`, {
    method: 'DELETE',
  });
  const body = await res.json();
  console.log('[DELETE] HTTP', res.status, JSON.stringify(body));

  const cleanup = await pool.query(
    `DELETE FROM public.trainer_verfuegbarkeit WHERE id = $1`,
    [SLOT_ID]
  );
  console.log('[CLEANUP] Testzeile entfernt, rowCount =', cleanup.rowCount);
})().then(() => pool.end()).catch((e) => {
  console.error('FEHLER:', e.message);
  process.exit(1);
});