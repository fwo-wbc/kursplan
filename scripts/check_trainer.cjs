// Diagnose: Warum zeigt die App weiterhin einen Trainer (inkl. "Bestätigt"),
// obwohl in edoobox keiner eingetragen ist?
//
// Prüft für die betroffenen Kurse #out-gl-1026 und #ppt-gl-komp-1026:
//   a) payload von edoobox_raw.offer_date (instructors / instructor_id / leader)
//   b) edoobox_raw.date_leader (gespiegelte Leiter)
//   c) public.trainer_zuweisung (lokale Zuweisungen inkl. Status)
//   d) public.trainer (Stammdaten der zugewiesenen Trainer)
//
// Direkter PostgreSQL-Zugriff (Port 5433) - keine neue Dependency.
const { Client } = require('../app/node_modules/pg');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  database: 'kursplan',
  user: 'kursplan_user',
  password: 'MeinAdmin2026',
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
};

const SUCHBEGRIFFE = ['%out-gl-1026%', '%ppt-gl-komp-1026%'];

async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();

  try {
    // 1) Betroffene Termine über die Kursnummer (offer_number) finden.
    const terminResult = await client.query(
      `SELECT od.date_id,
              o.offer_id,
              o.offer_number,
              o.name,
              to_char(od.date_start AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') AS date_start,
              o.payload
       FROM edoobox_raw.offer_date od
       JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
       WHERE o.offer_number ILIKE ANY($1::text[])
         AND od.is_deleted IS NOT TRUE
         AND o.is_deleted IS NOT TRUE
       ORDER BY od.date_start`,
      [SUCHBEGRIFFE]
    );

    if (terminResult.rows.length === 0) {
      console.log('Keine Termine zu den Suchbegriffen gefunden.');
      return;
    }

    for (const row of terminResult.rows) {
      const dateId = row.date_id;
      console.log('='.repeat(90));
      console.log(`Termin: ${dateId} | Kurs: ${row.offer_number} | ${row.name} | Start: ${row.date_start}`);

      // a) Trainer-/Instructor-Felder im payload von offer.
      const payload = row.payload ?? {};
      const trainerKeys = Object.keys(payload).filter((k) =>
        /instr|leader|trainer|dozent/i.test(k)
      );
      console.log('--- a) payload-Felder (offer) mit Trainer-Bezug ---');
      if (trainerKeys.length === 0) {
        console.log('  (keine Felder mit instructor/leader/trainer/dozent im payload)');
      }
      for (const key of trainerKeys) {
        console.log(`  ${key} = ${JSON.stringify(payload[key])}`);
      }
      // Zusätzlich gezielt die bekannten Pfade anzeigen (auch wenn leer/null).
      for (const pfad of ['instructors', 'instructor_id', 'leader', 'leaders']) {
        const wert = payload[pfad];
        if (wert !== undefined) {
          console.log(`  [gezielt] payload->'${pfad}' = ${JSON.stringify(wert)}`);
        }
      }
      // Alle Top-Level-Keys des payloads anzeigen (um abweichende Feldnamen
      // wie responsible/assigned_to/user_id zu erkennen).
      const alleKeys = Object.keys(payload);
      console.log(`  [Top-Level-Keys gesamt: ${alleKeys.length}]`);
      console.log(`  ${JSON.stringify(alleKeys.slice(0, 40))}`);

      // b) Gespiegelte Leiter aus edoobox_raw.date_leader (n:m, juengster Lauf).
      const leaderResult = await client.query(
        `SELECT dl.*,
                ta.shortcut,
                pt.vorname,
                pt.nachname
         FROM edoobox_raw.date_leader dl
         LEFT JOIN edoobox_raw.trainer_admin ta ON ta.admin_id = dl.admin_id
         LEFT JOIN public.trainer pt ON pt.edoobox_admin_id = dl.admin_id
         WHERE dl.date_id = $1
         ORDER BY dl.last_synced_at DESC`,
        [dateId]
      );
      console.log('--- b) edoobox_raw.date_leader (gespiegelte Leiter, alle Spalten) ---');
      if (leaderResult.rows.length === 0) {
        console.log('  (keine Leiter-Zeilen vorhanden)');
      }
      for (const l of leaderResult.rows) {
        const relevant = {
          admin_id: l.admin_id,
          shortcut: l.shortcut,
          vorname: l.vorname,
          nachname: l.nachname,
          last_synced_at: l.last_synced_at,
          is_deleted: l.is_deleted,
          is_archived: l.is_archived,
        };
        console.log(`  ${JSON.stringify(relevant)}`);
      }

      // c) Lokale Zuweisungen aus public.trainer_zuweisung.
      const zuwResult = await client.query(
        `SELECT tz.id,
                tz.trainer_id,
                tz.status,
                tz.notiz,
                tz.honorar_manuell,
                tz.updated_at,
                t.vorname,
                t.nachname,
                t.kuerzel,
                t.edoobox_admin_id
         FROM public.trainer_zuweisung tz
         LEFT JOIN public.trainer t ON t.id = tz.trainer_id
         WHERE tz.date_id = $1
         ORDER BY tz.id`,
        [dateId]
      );
      console.log('--- c) public.trainer_zuweisung (lokale Zuweisungen) ---');
      if (zuwResult.rows.length === 0) {
        console.log('  (keine lokalen Zuweisungen vorhanden)');
      }
      for (const z of zuwResult.rows) {
        console.log(
          `  zuweisung_id=${z.id} | trainer_id=${z.trainer_id} | ${z.vorname} ${z.nachname} (${z.kuerzel}) | status=${z.status} | edoobox_admin_id=${z.edoobox_admin_id} | updated_at=${z.updated_at}`
        );
        if (z.notiz) console.log(`    notiz: ${z.notiz}`);
        if (z.honorar_manuell !== null) console.log(`    honorar_manuell: ${z.honorar_manuell}`);
      }

      // d) Zuordnung: Passt der lokale Trainer zum edoobox-Leiter?
      const leiterAdminIds = leaderResult.rows.map((l) => l.admin_id);
      const lokaleAdminIds = zuwResult.rows
        .map((z) => z.edoobox_admin_id)
        .filter((v) => v !== null);
      console.log('--- d) Abgleich lokal vs. edoobox ---');
      console.log(`  edoobox-Leiter admin_ids: ${JSON.stringify(leiterAdminIds)}`);
      console.log(`  lokale Trainer admin_ids: ${JSON.stringify(lokaleAdminIds)}`);
      if (leiterAdminIds.length === 0 && lokaleAdminIds.length > 0) {
        console.log(
          '  => KEIN edoobox-Leiter vorhanden, ABER lokale Zuweisung existiert.'
        );
        console.log(
          '     Die API zeigt die lokale Zuweisung als Fallback an (edoo_admin_id IS NULL).'
        );
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});