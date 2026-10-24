// Temporäres Seed-Skript für die Sandbox-Verifikation:
// legt 2 Module (mit Abhängigkeit) und 1 Blocker-Tag an.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

(async () => {
  try {
    // Module nur anlegen, wenn noch keine existieren.
    const vorhanden = await pool.query('SELECT COUNT(*)::int AS n FROM public.course_modules');
    if (Number(vorhanden.rows[0].n) === 0) {
      const m1 = await pool.query(
        `INSERT INTO public.course_modules (name, position, takt_wochen, prio)
         VALUES ('Sandbox-Modul 1', 1, 4, 1) RETURNING id`
      );
      const m2 = await pool.query(
        `INSERT INTO public.course_modules (name, position, takt_wochen, prio, abhaengigkeit_von, abhaengigkeit_offset_tage)
         VALUES ('Sandbox-Modul 2', 2, 4, 1, $1, 7) RETURNING id`,
        [m1.rows[0].id]
      );
      console.log(`Module angelegt: Modul 1 (id=${m1.rows[0].id}), Modul 2 (id=${m2.rows[0].id})`);
    } else {
      console.log('Module existieren bereits, kein Seed nötig.');
    }

    // Blocker: Weihnachten 2026 (nur wenn nicht vorhanden).
    const blocker = await pool.query(
      `INSERT INTO public.calendar_blockers (date, reason)
       SELECT '2026-12-25', 'Weihnachten (Feiertag)'
       WHERE NOT EXISTS (SELECT 1 FROM public.calendar_blockers WHERE date = '2026-12-25')
       RETURNING date, reason`
    );
    if (blocker.rows.length > 0) {
      console.log(`Blocker angelegt: ${blocker.rows[0].date} – ${blocker.rows[0].reason}`);
    } else {
      console.log('Blocker 2026-12-25 existiert bereits.');
    }
  } catch (err) {
    console.error('FEHLER:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();