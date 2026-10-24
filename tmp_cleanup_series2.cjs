/**
 * Cleanup der Testserien aus der Szenario-2-Verifikation:
 *   - Entfernt die generierten Test-Events (IDs 17..46) aus public.course_events
 *   - Entfernt die Test-Serienvorlagen (serie 3, 4) aus public.series_templates
 *   - Setzt die temporär gesetzte Haupttrainer-Markierung von Trainer 22 /
 *     Thema 7 zurück (is_primary = false)
 *
 * public-Tabellen dürfen physisch bereinigt werden (edoobox_raw ist tabu).
 * Idempotent: fehlende Zeilen sind unkritisch.
 */
const path = require('path');
function requirePg() {
  try {
    return require('pg');
  } catch {
    return require(path.join(__dirname, 'app', 'node_modules', 'pg'));
  }
}
const { Pool } = requirePg();

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

(async () => {
  try {
    const eventIds = Array.from({ length: 30 }, (_, i) => 17 + i); // 17..46
    const ev = await pool.query(
      'DELETE FROM public.course_events WHERE id = ANY($1::int[])',
      [eventIds]
    );
    console.log(`✓ ${ev.rowCount} Test-Termine entfernt.`);

    const st = await pool.query(
      'DELETE FROM public.series_templates WHERE id = ANY(ARRAY[3, 4]::int[])'
    );
    console.log(`✓ ${st.rowCount} Test-Serienvorlagen entfernt.`);

    const prio = await pool.query(
      `UPDATE public.trainer_topics SET is_primary = false
       WHERE trainer_id = 22 AND topic_id = 7`
    );
    console.log(`✓ Trainer-22-Priorität für Thema 7 zurückgesetzt (${prio.rowCount} Zeile).`);
  } catch (err) {
    console.error('Fehler beim Cleanup:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
