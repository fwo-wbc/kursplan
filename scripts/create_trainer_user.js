// =============================================================================
// Hilfsskript: Test-/Portal-Zugang für einen bestehenden Trainer anlegen.
// -----------------------------------------------------------------------------
// - Vergibt einem Trainer eine portal_email und ein bcrypt-gehashtes Passwort.
// - Verbindet sich über Host-Port 5433 (siehe scripts/lib/portal_db.cjs).
// - Nutzt bcryptjs aus app/node_modules -> Skript aus app/ starten oder
//   NODE_PATH auf app/node_modules setzen.
//
// Nutzung:
//   node create_trainer_user.js --trainer-id 1 --email name@webinarcenter.de
//   node create_trainer_user.js --trainer-id 1 --email ... --password 'Geheim'
//   node create_trainer_user.js --email ... --password 'Geheim'   (erster freier Trainer)
//   Optional: --portal-active false deaktiviert den Zugang.
// =============================================================================
const path = require('path');
const crypto = require('crypto');
const { createPool, requireFromApp } = require('./lib/portal_db.cjs');
const bcrypt = requireFromApp('bcryptjs');

const BCRYPT_ROUNDS = 12;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email || process.env.PORTAL_EMAIL;
  let password = args.password || process.env.PORTAL_PASSWORD;
  const trainerId = args['trainer-id'] ? parseInt(args['trainer-id'], 10) : null;
  const portalActive = args['portal-active'] !== 'false';

  if (!email) {
    console.error('[FEHLER] --email <adresse> ist erforderlich.');
    process.exit(1);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`[FEHLER] Ungültige E-Mail-Adresse: ${email}`);
    process.exit(1);
  }

  let generated = false;
  if (!password) {
    password = crypto.randomBytes(9).toString('base64url');
    generated = true;
  }

  const pool = createPool();
  try {
    // 1. Trainer bestimmen
    let trainer;
    if (trainerId) {
      const { rows } = await pool.query(
        'SELECT id, vorname, nachname, kuerzel, is_active FROM public.trainer WHERE id = $1',
        [trainerId],
      );
      trainer = rows[0];
      if (!trainer) {
        console.error(`[FEHLER] Kein Trainer mit id=${trainerId} gefunden.`);
        process.exit(1);
      }
      if (trainer.is_active !== true) {
        console.error(`[FEHLER] Trainer ${trainerId} ist inaktiv (is_active=false).`);
        process.exit(1);
      }
    } else {
      const { rows } = await pool.query(
        `SELECT id, vorname, nachname, kuerzel, is_active
           FROM public.trainer
          WHERE portal_email IS NULL AND is_active = true
          ORDER BY id
          LIMIT 1`,
      );
      trainer = rows[0];
      if (!trainer) {
        console.error('[FEHLER] Kein aktiver Trainer ohne Portal-Mail verfügbar. --trainer-id angeben.');
        process.exit(1);
      }
    }

    // 2. E-Mail-Kollision verhindern (UNIQUE-Constraint)
    const { rows: clash } = await pool.query(
      'SELECT id FROM public.trainer WHERE lower(portal_email) = lower($1) AND id <> $2',
      [email, trainer.id],
    );
    if (clash.length > 0) {
      console.error(
        `[FEHLER] Die E-Mail ${email} ist bereits Trainer id=${clash[0].id} zugewiesen.`,
      );
      process.exit(1);
    }

    // 3. Passwort hashen und zuweisen (idempotent für dieselbe E-Mail)
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await pool.query(
      `UPDATE public.trainer
          SET portal_email = $1,
              password_hash = $2,
              portal_active = $3,
              updated_at = NOW()
        WHERE id = $4`,
      [email, hash, portalActive, trainer.id],
    );

    console.log('[OK] Portal-Zugang angelegt / aktualisiert:');
    console.log(`  Trainer-ID : ${trainer.id}`);
    console.log(`  Name       : ${trainer.vorname} ${trainer.nachname} (${trainer.kuerzel ?? '-'})`);
    console.log(`  E-Mail     : ${email}`);
    console.log(`  Aktiv      : ${portalActive}`);
    console.log(`  Kennwort   : ${generated ? password + ' (generiert)' : '(wie angegeben)'}`);
    console.log('  Passwort-Hash: steht als bcrypt-Hash in public.trainer.password_hash');
  } catch (err) {
    console.error(`[FEHLER] Anlegen fehlgeschlagen: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
