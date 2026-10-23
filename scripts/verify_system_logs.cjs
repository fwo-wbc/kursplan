/**
 * Laufzeit-Verifikation des Logging-Systems.
 *
 * 1. Prüft das Schema von public.system_logs (gezielt, nur diese Tabelle).
 * 2. Führt einen Insert-Roundtrip exakt so aus, wie logEvent() in
 *    app/src/lib/logger.ts es tut (level, source, message, details::jsonb).
 * 3. Entfernt den Testeintrag wieder, damit keine Testdaten im Bestand bleiben.
 */
const path = require('path');

/** Lädt 'pg' – zuerst regulär, sonst aus den node_modules der App. */
function requirePg() {
  try {
    return require('pg');
  } catch {
    return require(path.join(__dirname, '..', 'app', 'node_modules', 'pg'));
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

const DETAILS_TEST = JSON.stringify({ test: 'verify', nested: { okay: true } });

(async () => {
  const client = await pool.connect();
  try {
    const schema = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'system_logs'
        ORDER BY ordinal_position`
    );
    console.log('Spalten von public.system_logs:');
    for (const col of schema.rows) {
      console.log(
        `  - ${col.column_name}: ${col.data_type}${col.is_nullable === 'NO' ? ' NOT NULL' : ''}${col.column_default ? ` DEFAULT ${col.column_default}` : ''}`
      );
    }
    if (schema.rows.length === 0) {
      throw new Error('Tabelle public.system_logs existiert nicht oder hat keine Spalten.');
    }

    const ins = await client.query(
      `INSERT INTO public.system_logs (level, source, message, details)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, created_at, level, source, message, details`,
      ['INFO', 'SYSTEM', 'VERIFY-Roundtrip: Logging funktioniert.', DETAILS_TEST]
    );
    const row = ins.rows[0];
    console.log('Testeintrag geschrieben:', {
      id: row.id,
      created_at: row.created_at.toISOString(),
      level: row.level,
      source: row.source,
      message: row.message,
      details: row.details,
    });

    if (row.details?.nested?.okay !== true) {
      throw new Error('JSONB-Details wurden nicht korrekt gespeichert.');
    }

    const del = await client.query(
      `DELETE FROM public.system_logs WHERE message LIKE 'VERIFY-Roundtrip:%'`
    );
    console.log(`Testeintrag entfernt (${del.rowCount} Zeile(n)).`);
    console.log('✓ Logger-Pfad (Insert in public.system_logs) funktioniert zur Laufzeit.');
  } catch (err) {
    console.error('Verifikation fehlgeschlagen:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();