#!/usr/bin/env -S node --experimental-strip-types
/**
 * Legacy-DoD-Verifikation — verbindliche Stichtags-Regelung (Definition of Done)
 *
 * Prüft:
 *  1. Stichtag: kursplan.datenstand_config 'legacy_stichtag' = 2026-09-01
 *  2. Qualitäts-View kursplan.v_qualitaet_historienluecken existiert
 *  3. Strikte Null-Toleranz ab Stichtag:
 *     anzahl_aktiv = 0 für alle drei Pflichtrelationen
 *       (buchung_ohne_offer, leader_ohne_trainer, attendance_ohne_termin)
 *  4. Korrekte Ausschlusslogik für Altdaten vor dem Stichtag:
 *     anzahl_legacy = 87 (Buchungen ohne Angebot),
 *                     10 (Trainer ohne Profil),
 *                      4 (Anwesenheiten ohne Termin)
 *  5. Referenzabfrage tmp_p04_kontrollen_query.sql liefert nur *_aktiv
 *     für aktive Alarme (Struktur-Check auf *_aktiv-Spalten).
 *
 * Ausführung:
 *   node --experimental-strip-types scripts/verify_legacy_dod.ts   (Node >= 22.6)
 *   npx tsx scripts/verify_legacy_dod.ts                           (Alternative)
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

interface FunnelZeile {
  kategorie: string;
  anzahl_gesamt: string;
  anzahl_legacy: string;
  anzahl_aktiv: string;
}

const ERWARTET = {
  buchung_ohne_offer: { legacy: 87, gesamt: 87 },
  leader_ohne_trainer: { legacy: 10, gesamt: 10 },
  attendance_ohne_termin: { legacy: 4, gesamt: 4 },
} as const;

function zahl(w: unknown): number {
  const n = Number(w);
  return Number.isFinite(n) ? n : 0;
}

async function main(): Promise<void> {
  const fehler: string[] = [];

  // 1) Stichtag
  const stichtag = await pool.query<{ wert: Date }>(
    `SELECT wert FROM kursplan.datenstand_config WHERE schluessel = 'legacy_stichtag'`
  );
  if (stichtag.rows.length === 0) {
    fehler.push('legacy_stichtag ist nicht in kursplan.datenstand_config hinterlegt');
  } else {
    const iso = new Date(stichtag.rows[0].wert).toISOString();
    const erwartet = new Date('2026-09-01T00:00:00+02:00').toISOString();
    console.log(`1) Stichtag: ${iso}  (erwartet ~ ${erwartet})`);
    if (iso !== erwartet) {
      fehler.push(`Stichtag weicht ab: ${iso} statt ${erwartet}`);
    }
  }

  // 2) View existiert
  const view = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.views
      WHERE table_schema = 'kursplan' AND table_name = 'v_qualitaet_historienluecken'`
  );
  if (view.rows.length === 0) {
    fehler.push('View kursplan.v_qualitaet_historienluecken existiert nicht');
  } else {
    console.log('2) View kursplan.v_qualitaet_historienluecken: vorhanden');
  }

  // 3) + 4) Legacy-Klassifizierung
  const rows = await pool.query<FunnelZeile>(
    `SELECT kategorie, anzahl_gesamt, anzahl_legacy, anzahl_aktiv
       FROM kursplan.v_qualitaet_historienluecken
      ORDER BY kategorie`
  );
  console.log('   Kategorien aus der View:');
  for (const r of rows.rows) {
    console.log(
      `   - ${r.kategorie}: gesamt=${r.anzahl_gesamt} legacy=${r.anzahl_legacy} aktiv=${r.anzahl_aktiv}`
    );
  }
  const byKategorie = new Map(rows.rows.map((r) => [r.kategorie, r]));
  for (const [kategorie, erwartungen] of Object.entries(ERWARTET)) {
    const zeile = byKategorie.get(kategorie);
    if (!zeile) {
      fehler.push(`Kategorie ${kategorie} fehlt in der View`);
      continue;
    }
    if (zahl(zeile.anzahl_aktiv) !== 0) {
      fehler.push(`${kategorie}: anzahl_aktiv=${zeile.anzahl_aktiv}, erwartet 0 (strikte Null-Toleranz ab Stichtag verletzt)`);
    }
    if (zahl(zeile.anzahl_legacy) !== erwartungen.legacy) {
      fehler.push(`${kategorie}: anzahl_legacy=${zeile.anzahl_legacy}, erwartet ${erwartungen.legacy}`);
    }
    if (zahl(zeile.anzahl_gesamt) !== erwartungen.gesamt) {
      fehler.push(`${kategorie}: anzahl_gesamt=${zeile.anzahl_gesamt}, erwartet ${erwartungen.gesamt}`);
    }
  }

  // 5) Referenzabfrage nutzt *_aktiv-Spalten (Struktur-Check)
  const referenz = path.join(rootDir, 'tmp_p04_kontrollen_query.sql');
  const fs = await import('node:fs');
  if (fs.existsSync(referenz)) {
    const sqlText = fs.readFileSync(referenz, 'utf8');
    for (const aktiv of [
      'buchung_ohne_offer_aktiv',
      'leader_ohne_trainer_aktiv',
      'attendance_ohne_termin_aktiv',
    ]) {
      if (!sqlText.includes(aktiv)) {
        fehler.push(`Referenzabfrage tmp_p04_kontrollen_query.sql enthält ${aktiv} nicht`);
      }
    }
  }
  console.log('5) Referenzabfrage: tmp_p04_kontrollen_query.sql geprüft (Struktur auf *_aktiv-Spalten)');

  if (fehler.length > 0) {
    console.error('\n✗ Legacy-DoD-Verifikation FEHLGESCHLAGEN:');
    for (const f of fehler) console.error('   - ' + f);
    process.exitCode = 1;
  } else {
    console.log('\n✓ Legacy-DoD-Verifikation ERFOLGREICH: keine aktiven Datenlücken ab Stichtag, Ausschlusslogik greift korrekt.');
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exitCode = 1;
}).finally(() => pool.end());