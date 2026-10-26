#!/usr/bin/env -S node --experimental-strip-types
/**
 * O-7-Verifikation — edoobox_raw.sync_run (PK: run_id bigint)
 *
 * Prüft:
 *  1. Vorhandensein + Typ/Default der O-7-Spalten
 *     (alert_sent BOOLEAN NOT NULL DEFAULT FALSE, alert_sent_at TIMESTAMPTZ, alert_message TEXT)
 *  2. Schreib-/Lese-Roundtrip über `WHERE run_id = ...` in einer
 *     Transaktion auf einem frisch angelegten Testlauf (BEGIN ... ROLLBACK),
 *     ohne bestehende Läufe anzufassen.
 *
 * Ausführung:
 *   node --experimental-strip-types scripts/verify_o7_alert.ts   (Node >= 22.6)
 *   npx tsx scripts/verify_o7_alert.ts                           (Alternative)
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

async function main(): Promise<void> {
  // 1) Spaltenstruktur prüfen
  const columns = await pool.query<SpaltenZeile>(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'edoobox_raw' AND table_name = 'sync_run'
        AND column_name IN ('alert_sent', 'alert_sent_at', 'alert_message')
      ORDER BY column_name`
  );
  console.log('[CHECK] O-7-Spalten auf edoobox_raw.sync_run:');
  console.log(JSON.stringify(columns.rows, null, 2));

  if (columns.rows.length !== 3) {
    throw new Error('Nicht alle O-7-Spalten vorhanden (erwartet: 3, gefunden: ' + columns.rows.length + ')');
  }
  const byName: Record<string, SpaltenZeile> = Object.fromEntries(
    columns.rows.map((c) => [c.column_name, c])
  );
  if (byName.alert_sent.data_type !== 'boolean' || byName.alert_sent.is_nullable !== 'NO') {
    throw new Error('alert_sent muss BOOLEAN NOT NULL sein');
  }
  if ((byName.alert_sent.column_default ?? '').toLowerCase().indexOf('false') === -1) {
    throw new Error('alert_sent muss DEFAULT FALSE besitzen');
  }
  if (byName.alert_sent_at.data_type !== 'timestamp with time zone') {
    throw new Error('alert_sent_at muss TIMESTAMPTZ sein');
  }
  if (byName.alert_message.data_type !== 'text') {
    throw new Error('alert_message muss TEXT sein');
  }

  // 2) Roundtrip über WHERE run_id (BEGIN ... ROLLBACK)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query<{
      run_id: number;
      alert_sent: boolean;
      alert_sent_at: Date;
      alert_message: string;
    }>(
      // status/run_type mit gültigen Werten gemäß CHECK-Constraint sync_run_status_chk
      `INSERT INTO edoobox_raw.sync_run (run_type, status, abgleichsart, alert_sent, alert_sent_at, alert_message)
       VALUES ('P04', 'laeuft', 'verify_o7', TRUE, now(), 'O-7 Roundtrip')
       RETURNING run_id, alert_sent, alert_sent_at, alert_message`
    );
    const row = inserted.rows[0];
    console.log('[CHECK] Roundtrip-INSERT OK, run_id=' + row.run_id);
    if (row.alert_sent !== true || !row.alert_sent_at || row.alert_message !== 'O-7 Roundtrip') {
      throw new Error('Roundtrip-Werte inkonsistent: ' + JSON.stringify(row));
    }
    const read = await client.query(
      'SELECT run_id, status, alert_sent, alert_sent_at, alert_message FROM edoobox_raw.sync_run WHERE run_id = $1',
      [row.run_id]
    );
    if (read.rows.length !== 1) {
      throw new Error('Lauf nach INSERT nicht über WHERE run_id lesbar');
    }
    await client.query('ROLLBACK');
    client.release();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    throw err;
  }

  console.log('[OK] O-7 verifiziert: Spalten vorhanden und Roundtrip über WHERE run_id erfolgreich.');
}

main()
  .then(() => pool.end())
  .catch((err: Error) => {
    console.error('[FEHLER]', err.message);
    process.exit(1);
  });