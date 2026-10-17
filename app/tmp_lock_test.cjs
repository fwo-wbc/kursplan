/* Prüft, ob das UPDATE aktualisiereAbgesagteZuweisungen an einer Sperre
   hängt (lock_timeout) und zeigt blockierende DB-Aktivitäten. */
const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
});

const UPDATE_ABGESAGTE = `UPDATE public.trainer_zuweisung z
     SET status = 'abgesagt',
         updated_at = NOW()
     FROM edoobox_raw.offer_date od
     JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
     WHERE z.date_id = od.date_id
       AND (o.status IN ('3', '5')
            OR o.is_archived IS TRUE
            OR o.is_deleted IS TRUE
            OR od.is_deleted IS TRUE)
       AND z.status IN ('ausgeschrieben', 'unter Vorbehalt')`;

async function main() {
  // 1. Zeige aktive DB-Aktivitäten (laufende Queries / blockierende)
  try {
    const act = await pool.query(`
      SELECT pid, state, wait_event_type, wait_event,
             LEFT(query, 120) AS query
      FROM pg_stat_activity
      WHERE datname = 'kursplan'
        AND state <> 'idle'
      ORDER BY pid`);
    console.log('Aktive DB-Aktivitäten:');
    for (const r of act.rows) {
      console.log(`  pid=${r.pid} state=${r.state} wait=${r.wait_event_type}/${r.wait_event} query=${r.query}`);
    }
  } catch (e) {
    console.error('FEHLER beim Lesen von pg_stat_activity:', e.message);
  }

  // 2. UPDATE mit lock_timeout testen (ROLLBACK am Ende, keine Datenänderung)
  const client = await pool.connect();
  try {
    await client.query("SET lock_timeout = '5s'");
    await client.query('BEGIN');
    const res = await client.query(UPDATE_ABGESAGTE);
    console.log('UPDATE ok:', res.rowCount, 'Zeile(n) - kein Lock-Problem.');
    await client.query('ROLLBACK');
  } catch (err) {
    console.error('UPDATE fehlgeschlagen oder Lock-Timeout:');
    console.error('  Message:', err.message);
    console.error('  Code:', err.code);
    try {
      await client.query('ROLLBACK');
    } catch {}
  } finally {
    client.release();
  }

  await pool.end();
}

main();
