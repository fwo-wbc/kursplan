// =============================================================================
// Führt eine beliebige SQL-Migrationsdatei gegen die lokale PostgreSQL
// (Host-Port 5433) aus. Nutzung:
//   node scripts/apply_migration.cjs <pfad/zur/datei.sql>
// =============================================================================
const path = require('path');
const { runSqlFile } = require('./lib/portal_db.cjs');

const file = process.argv[2];
if (!file) {
  console.error('Nutzung: node scripts/apply_migration.cjs <pfad/zur/datei.sql>');
  process.exit(1);
}

runSqlFile(path.resolve(file))
  .then(() => {
    console.log(`[OK] Migration erfolgreich ausgeführt: ${file}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`[FEHLER] Migration fehlgeschlagen: ${err.message}`);
    process.exit(1);
  });
