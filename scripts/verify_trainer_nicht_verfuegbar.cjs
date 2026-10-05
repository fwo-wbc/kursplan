// ---------------------------------------------------------------------------
// Verifikation: Hinweis-Badge "Trainer nicht verfügbar" in der Kursplanung.
//
// Vorgehen:
//   1. GET /api/termine aufrufen (HTTP-Status 200 vorausgesetzt).
//   2. Zählen, bei wie vielen Kursen trainer_verfuegbar === false ist
//      (dort schlägt der Hinweis "Trainer nicht verfügbar" an).
//   3. Ein konkretes Beispiel ausgeben (Kurs, Termine, zugewiesener Trainer).
//   4. DB-Gegenprüfung: Verfügbarkeitszeilen des Trainers für die Kurstage
//      des Beispiels anzeigen, um die Ursache (fehlende 'frei'-Einträge)
//      nachzuvollziehen.
// ---------------------------------------------------------------------------
// pg liegt in den node_modules der App; der Pfad wird explizit aufgelöst,
// damit das Skript unabhängig vom Aufrufverzeichnis funktioniert.
const path = require('path');
const { Pool } = require(path.join(__dirname, '..', 'app', 'node_modules', 'pg'));

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'kursplan',
  user: process.env.DB_USER || 'kursplan_user',
  password: process.env.DB_PASSWORD || 'MeinAdmin2026',
});

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

async function main() {
  // 1) HTTP-Aufruf der Termin-Route.
  const url = `${API_BASE}/api/termine`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.log(
      `FEHLER: HTTP-Aufruf ${url} fehlgeschlagen (${err.message}).\n` +
        'Läuft der Next.js-Dev-Server (npm run dev im app/-Verzeichnis)?'
    );
    process.exitCode = 1;
    return;
  }

  const body = await res.json();
  if (res.status !== 200) {
    console.log(`FEHLER: HTTP ${res.status} von ${url}`);
    console.log(JSON.stringify(body, null, 2));
    process.exitCode = 1;
    return;
  }

  const kurse = Array.isArray(body) ? body : [];
  console.log(`HTTP ${res.status}: ${kurse.length} Kurse geladen.`);

  // 2) Zählung nach trainer_verfuegbar.
  const mitHinweis = kurse.filter((k) => k.trainer_verfuegbar === false);
  const verfuegbar = kurse.filter((k) => k.trainer_verfuegbar === true);
  const ohnePruefung = kurse.filter((k) => k.trainer_verfuegbar === null);
  const ohneFeld = kurse.filter((k) => !('trainer_verfuegbar' in k));

  console.log('\n--- Zählung trainer_verfuegbar ---');
  console.log(`  false (Hinweis "Trainer nicht verfügbar"): ${mitHinweis.length}`);
  console.log(`  true  (Trainer verfügbar):                  ${verfuegbar.length}`);
  console.log(`  null  (keine Prüfung nötig):                ${ohnePruefung.length}`);
  if (ohneFeld.length > 0) {
    console.log(`  FEHLER: ${ohneFeld.length} Kurse ohne Feld trainer_verfuegbar!`);
  }

  // 3) Konkretes Beispiel (erster Kurs mit Hinweis).
  const beispiel = mitHinweis[0];
  if (!beispiel) {
    console.log('\nERGEBNIS: Kein Kurs mit trainer_verfuegbar=false gefunden.');
    console.log('Der Hinweis schlägt aktuell bei 0 Kursen an.');
    process.exitCode = mitHinweis.length === 0 ? 0 : 1;
    return;
  }

  console.log('\n--- Beispiel (erster Kurs mit Hinweis) ---');
  console.log(`  Kurs:      ${beispiel.offer_name ?? '–'} (#${beispiel.kursnr ?? '–'})`);
  console.log(`  Status:    ${beispiel.date_status ?? '–'}`);
  console.log(`  Termine:   ${beispiel.termine.length}`);
  for (const t of beispiel.termine) {
    console.log(`    - ${t.date_start ?? '–'} bis ${t.date_end ?? '–'} (${t.date_id})`);
  }
  console.log(`  Zuweisungen:`);
  for (const z of beispiel.zuweisungen ?? []) {
    const verf =
      beispiel.trainer_verfuegbarkeit?.[String(z.trainer_id)] === true
        ? 'verfügbar'
        : 'NICHT verfügbar';
    console.log(
      `    - trainer_id=${z.trainer_id} (${z.trainer?.kuerzel ?? '–'}), ` +
        `status='${z.status ?? '–'}', quelle=${z.quelle ?? '–'} -> ${verf}`
    );
  }
  console.log(`  trainer_verfuegbar: ${beispiel.trainer_verfuegbar}`);

  // 4) DB-Gegenprüfung: Verfügbarkeitszeilen des zugewiesenen Trainers für
  //    die Kurstage des Beispiels.
  const trainerIds = (beispiel.zuweisungen ?? [])
    .filter((z) => z.trainer_id !== null && z.status !== 'keine Zuordnung')
    .map((z) => z.trainer_id);
  const daten = (beispiel.termine ?? [])
    .map((t) => {
      const d = t.date_start ? new Date(t.date_start) : null;
      if (!d || Number.isNaN(d.getTime())) return null;
      return d.toISOString().split('T')[0];
    })
    .filter(Boolean);

  if (trainerIds.length > 0 && daten.length > 0) {
    const verfRes = await pool.query(
      `SELECT trainer_id,
              to_char(datum, 'YYYY-MM-DD') AS datum,
              slot_code,
              status
       FROM public.trainer_verfuegbarkeit
       WHERE trainer_id = ANY($1::int[])
         AND datum = ANY($2::date[])
         AND slot_code = ANY($3::text[])
       ORDER BY trainer_id, datum, slot_code`,
      [trainerIds, daten, ['HT', 'K1', 'K2', 'K3', 'K4']]
    );
    console.log('\n--- DB-Gegenprüfung: Verfügbarkeitszeilen (public.trainer_verfuegbarkeit) ---');
    if (verfRes.rows.length === 0) {
      console.log('  Keine Verfügbarkeitszeilen für die Kurstage vorhanden (Ursache bestätigt).');
    } else {
      for (const row of verfRes.rows) {
        console.log(
          `  trainer_id=${row.trainer_id} datum=${row.datum} slot=${row.slot_code} status='${row.status}'`
        );
      }
    }
  }

  const ok = mitHinweis.length > 0 && ohneFeld.length === 0;
  console.log(
    ok
      ? `\nERGEBNIS: OK – Hinweis schlägt bei ${mitHinweis.length} Kurs(en) an.`
      : '\nERGEBNIS: FEHLER – Erwartung nicht erfüllt.'
  );
  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((err) => {
    console.error('Skriptfehler:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
