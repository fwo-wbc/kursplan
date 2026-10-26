#!/usr/bin/env -S node --experimental-strip-types
/**
 * P05-Verifikation — edoobox_raw.sync_run (PK: run_id bigint)
 *
 * Prüft:
 *  1. Vorhandensein + Typ/Default der P05-Retry-Spalten
 *     (retry_count INT NOT NULL DEFAULT 0, retry_of_run_id BIGINT NULL
 *      FK -> sync_run(run_id), retry_status TEXT NULL)
 *  2. FK sync_run_retry_of_run_id_fkey (informativ)
 *  3. Retry-Status-Wechsel in einer Transaktion (BEGIN ... ROLLBACK)
 *     auf frisch angelegten Testläufen, ohne bestehende Läufe anzufassen:
 *     - Kandidatenabfrage (48h-Fenster, fehler | laeuft+2h, retry_*-Bedingungen)
 *     - in_progress-Markierung + retry_count-Inkrement
 *     - resolved- sowie failed-Wechsel inkl. Fehlertext-Anhang
 *     - Ausschlussregeln (retry_count 3, erfolgreicher Lauf, >48h alt)
 *     - FK-Verhalten (gültige Referenz akzeptiert, ungültige -> 23503)
 *
 * Ausführung:
 *   node --experimental-strip-types scripts/verify_p05_retry.ts   (Node >= 22.6)
 *   npx tsx scripts/verify_p05_retry.ts                           (Alternative)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

let pg: unknown;
try {
  pg = require('pg');
} catch {
  pg = require(path.join(rootDir, 'app', 'node_modules', 'pg'));
}
const { Pool } = pg as typeof import('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

interface SpaltenZeile {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

// Exakt die Kandidatenbedingungen des P05-Workflows ("P05 Kandidaten suchen").
const KANDIDATEN_SQL = `
SELECT run_id, status, retry_count, retry_status
FROM edoobox_raw.sync_run
WHERE started_at >= (now() - INTERVAL '48 hours')
  AND ( status = 'fehler'
        OR (status = 'laeuft' AND started_at < (now() - INTERVAL '2 hours')) )
  AND ( retry_status IS NULL OR retry_status = 'pending' )
  AND retry_count < 3
ORDER BY started_at ASC;`;

async function main(): Promise<void> {
  // 1) Spaltenstruktur prüfen
  const columns = await pool.query<SpaltenZeile>(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'edoobox_raw' AND table_name = 'sync_run'
        AND column_name IN ('retry_count', 'retry_of_run_id', 'retry_status')
      ORDER BY column_name`
  );
  console.log('[CHECK] P05-Retry-Spalten auf edoobox_raw.sync_run:');
  console.log(JSON.stringify(columns.rows, null, 2));

  if (columns.rows.length !== 3) {
    throw new Error('Nicht alle P05-Spalten vorhanden (erwartet: 3, gefunden: ' + columns.rows.length + ')');
  }
  const byName: Record<string, SpaltenZeile> = Object.fromEntries(
    columns.rows.map((c) => [c.column_name, c])
  );
  if (byName.retry_count.data_type !== 'integer' || byName.retry_count.is_nullable !== 'NO') {
    throw new Error('retry_count muss INT NOT NULL sein');
  }
  if ((byName.retry_count.column_default ?? '').toLowerCase().indexOf('0') === -1) {
    throw new Error('retry_count muss DEFAULT 0 besitzen');
  }
  if (byName.retry_of_run_id.data_type !== 'bigint') {
    throw new Error('retry_of_run_id muss BIGINT sein');
  }
  if (byName.retry_status.data_type !== 'text') {
    throw new Error('retry_status muss TEXT sein');
  }

  // 2) FK (informativ — Spalte kann bei vorbestehender Tabelle ohne FK existieren)
  const fk = await pool.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conrelid = 'edoobox_raw.sync_run'::regclass
        AND contype = 'f'
        AND conname = 'sync_run_retry_of_run_id_fkey'`
  );
  console.log(
    '[CHECK] FK sync_run_retry_of_run_id_fkey:',
    fk.rowCount ? fk.rows[0].def : 'NICHT GEFUNDEN (Spalte ggf. vorbestehend)'
  );

  // 3) Transaktionaler Testlauf (BEGIN ... ROLLBACK)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // A: frischer Fehler-Lauf (muss Kandidat sein)
    const a = await client.query<{ run_id: string; retry_count: number; retry_status: string | null }>(
      `INSERT INTO edoobox_raw.sync_run (run_type, status, abgleichsart)
       VALUES ('P05', 'fehler', 'verify_p05_a')
       RETURNING run_id, retry_count, retry_status`
    );
    const aId = Number(a.rows[0].run_id);
    console.log('[CHECK] Alt-Lauf A (fehler) angelegt, run_id=' + aId +
      ', retry_count=' + a.rows[0].retry_count + ', retry_status=' + a.rows[0].retry_status);
    if (Number(a.rows[0].retry_count) !== 0 || a.rows[0].retry_status !== null) {
      throw new Error('Neuer Lauf muss retry_count=0 und retry_status=NULL haben');
    }

    // B: bereits 3 Versuche; C: erfolgreich; D: außerhalb 48h-Fenster — alle dürfen NICHT Kandidat sein
    const b = await client.query<{ run_id: string }>(
      `INSERT INTO edoobox_raw.sync_run (run_type, status, abgleichsart, retry_count)
       VALUES ('P05', 'fehler', 'verify_p05_b', 3)
       RETURNING run_id`
    );
    const bId = Number(b.rows[0].run_id);
    const c = await client.query<{ run_id: string }>(
      `INSERT INTO edoobox_raw.sync_run (run_type, status, abgleichsart)
       VALUES ('P05', 'erfolgreich', 'verify_p05_c')
       RETURNING run_id`
    );
    const cId = Number(c.rows[0].run_id);
    const d = await client.query<{ run_id: string }>(
      `INSERT INTO edoobox_raw.sync_run (run_type, status, abgleichsart, started_at)
       VALUES ('P05', 'fehler', 'verify_p05_d', now() - INTERVAL '50 hours')
       RETURNING run_id`
    );
    const dId = Number(d.rows[0].run_id);

    const kandidaten1 = await client.query<{ run_id: string }>(KANDIDATEN_SQL);
    const ids1 = new Set(kandidaten1.rows.map((r) => Number(r.run_id)));
    console.log('[CHECK] Kandidatenabfrage enthaelt A=' + ids1.has(aId) +
      ', B=' + ids1.has(bId) + ', C=' + ids1.has(cId) + ', D=' + ids1.has(dId) + ' (nur A erwartet)');
    if (!ids1.has(aId)) throw new Error('Frischer Fehler-Lauf A fehlt in den Kandidaten');
    for (const x of [bId, cId, dId]) {
      if (ids1.has(x)) throw new Error('Lauf ' + x + ' darf kein Kandidat sein (Ausschlussregel verletzt)');
    }

    // 3.1 in_progress-Markierung + retry_count-Inkrement (wie P05-Knoten)
    const mark = await client.query<{ run_id: number; retry_count: number; retry_status: string }>(
      `UPDATE edoobox_raw.sync_run s
       SET retry_status = 'in_progress', retry_count = s.retry_count + 1
       WHERE s.run_id = $1
       RETURNING run_id, retry_count, retry_status`,
      [aId]
    );
    console.log('[CHECK] in_progress-Markierung:', JSON.stringify(mark.rows[0]));
    if (mark.rows[0].retry_status !== 'in_progress' || Number(mark.rows[0].retry_count) !== 1) {
      throw new Error('in_progress-Markierung oder Inkrement fehlerhaft');
    }
    const kandidaten2 = await client.query<{ run_id: string }>(KANDIDATEN_SQL);
    if (kandidaten2.rows.some((r) => Number(r.run_id) === aId)) {
      throw new Error('in_progress-Lauf A darf kein Kandidat mehr sein');
    }

    // 3.2 Erfolgspfad: retry_status = 'resolved'
    const ok = await client.query(
      `UPDATE edoobox_raw.sync_run SET retry_status = 'resolved'
       WHERE run_id = $1
       RETURNING run_id, retry_status, retry_count`,
      [aId]
    );
    console.log('[CHECK] Erfolgspfad resolved:', JSON.stringify(ok.rows[0]));
    if (ok.rows[0].retry_status !== 'resolved') throw new Error('resolved-Wechsel fehlgeschlagen');

    // 3.3 Fehlerpfad: neuer Lauf E -> in_progress -> failed inkl. Fehlertext-Anhang
    const e = await client.query<{ run_id: string }>(
      `INSERT INTO edoobox_raw.sync_run (run_type, status, abgleichsart)
       VALUES ('P05', 'fehler', 'verify_p05_e')
       RETURNING run_id`
    );
    const eId = Number(e.rows[0].run_id);
    await client.query(
      `UPDATE edoobox_raw.sync_run s
       SET retry_status = 'in_progress', retry_count = s.retry_count + 1
       WHERE s.run_id = $1`,
      [eId]
    );
    const fail = await client.query<{ run_id: number; retry_count: number; retry_status: string; error_text: string | null }>(
      `UPDATE edoobox_raw.sync_run
       SET retry_status = 'failed',
           error_text = left(coalesce(error_text, '') || E'\n[P05] Wiederanlauf in ' || 'P02' || ' fehlgeschlagen: ' || 'Testfehler', 4000)
       WHERE run_id = $1
       RETURNING run_id, retry_count, retry_status, error_text`,
      [eId]
    );
    console.log('[CHECK] Fehlerpfad failed:', JSON.stringify(fail.rows[0]));
    if (fail.rows[0].retry_status !== 'failed' || Number(fail.rows[0].retry_count) !== 1) {
      throw new Error('failed-Setzung oder Inkrement fehlerhaft');
    }
    if (String(fail.rows[0].error_text).indexOf('[P05] Wiederanlauf') === -1) {
      throw new Error('error_text-Anhang im Fehlerpfad fehlt');
    }

    // 3.4 FK-Verhalten: gültige Referenz akzeptiert, ungültige abgelehnt (23503)
    await client.query(
      `INSERT INTO edoobox_raw.sync_run (run_type, status, abgleichsart, retry_of_run_id)
       VALUES ('P05', 'laeuft', 'verify_p05_f', $1)`,
      [eId]
    );
    console.log('[CHECK] FK: Retry-Lauf mit gueltiger retry_of_run_id akzeptiert');
    try {
      await client.query(
        `INSERT INTO edoobox_raw.sync_run (run_type, status, abgleichsart, retry_of_run_id)
         VALUES ('P05', 'laeuft', 'verify_p05_g', 999999999)`
      );
      throw new Error('FK-Verletzung wurde nicht erkannt');
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== '23503') {
        throw new Error('Unerwarteter Fehlercode statt 23503: ' + code);
      }
      console.log('[CHECK] FK: ungueltige retry_of_run_id wird abgelehnt (23503)');
    }

    await client.query('ROLLBACK');
    client.release();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    throw err;
  }

  console.log('[OK] P05 verifiziert: Schema korrekt, Retry-Status-Wechsel und FK-Verhalten konsistent.');
}

main()
  .then(() => pool.end())
  .catch((err: Error) => {
    console.error('[FEHLER]', err.message);
    process.exit(1);
  });