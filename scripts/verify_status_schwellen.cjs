// ---------------------------------------------------------------------------
// Verifikation der Schwellwertlogik für den Zuweisungsstatus der Trainer-
// verfügbarkeit (Fix: Status abhängig von der edoobox-Mindestteilnehmerzahl).
//
// Nachbildung der in den Routen umgesetzten Logik 1:1:
//   - app/src/app/api/trainer/zeitplan/route.ts      → kursStatus
//   - app/src/app/api/termine/route.ts               → effektiverZuweisungsstatus
//   - app/src/app/api/verfuegbarkeit/route.ts        → SQL-CASE (äquivalent)
//
// Regeln (Soll-Verhalten):
//   1) teilnehmer >= 1 && teilnehmer <= minTeilnehmer  → 'unter Vorbehalt'
//   2) teilnehmer >= minTeilnehmer + 1                 → 'bestätigt'
//   3) teilnehmer === 0                                 → bleibt 'reserviert'
//   minTeilnehmer = max(user_minimal ?? 1, 1)         (Fallback 1)
// ---------------------------------------------------------------------------

function minTeilnehmerFuer(userMinimal) {
  // Äquivalent zu: Math.max(Number(row.min_teilnehmer ?? 1), 1) bzw.
  // SQL: GREATEST(COALESCE(o.user_minimal, 1), 1)
  const wert = userMinimal == null ? 1 : Number(userMinimal);
  return Number.isFinite(wert) && wert >= 1 ? wert : 1;
}

// kursStatus aus trainer/zeitplan/route.ts (relevanter Automatik-Teil).
// Die Routen übergeben offerStatus/zuweisungStatus stets als String oder null
// (niemals undefined) – das bilden die Defaults hier identisch nach.
function kursStatus({ offerStatus = null, zuweisungStatus = null, teilnehmer, userMinimal }) {
  if (
    offerStatus === '0' ||
    offerStatus === '5' ||
    zuweisungStatus === 'abgesagt'
  ) {
    return 'abgesagt';
  }
  const minTeilnehmer = minTeilnehmerFuer(userMinimal);
  const automatischBerechtigt =
    zuweisungStatus === null || zuweisungStatus === 'reserviert';
  if (!automatischBerechtigt) {
    return zuweisungStatus;
  }
  if (teilnehmer >= minTeilnehmer + 1) return 'bestätigt';
  if (teilnehmer >= 1) return 'unter Vorbehalt';
  return 'reserviert';
}

// effektiverZuweisungsstatus aus termine/route.ts (relevanter Automatik-Teil).
function effektiverZuweisungsstatus({ offerStatus = null, teilnehmer, einnahmen, bisherigerStatus = null, userMinimal }) {
  if (
    offerStatus === '5' ||
    offerStatus === '0' ||
    (offerStatus === '3' && teilnehmer === 0 && einnahmen === 0)
  ) {
    return 'abgesagt';
  }
  const minTeilnehmer = minTeilnehmerFuer(userMinimal);
  const automatischBerechtigt =
    bisherigerStatus === null ||
    bisherigerStatus === 'keine Zuordnung' ||
    bisherigerStatus === 'reserviert';
  if (!automatischBerechtigt) {
    return bisherigerStatus ?? 'reserviert';
  }
  if (teilnehmer >= minTeilnehmer + 1) return 'bestätigt';
  if (teilnehmer >= 1) return 'unter Vorbehalt';
  return 'reserviert';
}

let fehler = 0;
function pruefe(name, ist, soll) {
  const ok = ist === soll;
  if (!ok) fehler += 1;
  console.log(
    `  [${ok ? 'OK ' : 'FEHLER'}] ${name.padEnd(52)} ist=${String(ist).padEnd(18)} soll=${soll}`
  );
}

console.log('=== kursStatus: minTeilnehmer = 1 (user_minimal = 1) ===');
pruefe('0 TN → reserviert', kursStatus({ teilnehmer: 0, userMinimal: 1 }), 'reserviert');
pruefe('1 TN → unter Vorbehalt', kursStatus({ teilnehmer: 1, userMinimal: 1 }), 'unter Vorbehalt');
pruefe('2 TN → bestätigt', kursStatus({ teilnehmer: 2, userMinimal: 1 }), 'bestätigt');

console.log('=== kursStatus: minTeilnehmer = 6 (user_minimal = 6) ===');
pruefe('0 TN → reserviert', kursStatus({ teilnehmer: 0, userMinimal: 6 }), 'reserviert');
pruefe('1 TN → unter Vorbehalt', kursStatus({ teilnehmer: 1, userMinimal: 6 }), 'unter Vorbehalt');
pruefe('5 TN → unter Vorbehalt', kursStatus({ teilnehmer: 5, userMinimal: 6 }), 'unter Vorbehalt');
pruefe('6 TN (= min) → unter Vorbehalt', kursStatus({ teilnehmer: 6, userMinimal: 6 }), 'unter Vorbehalt');
pruefe('7 TN (min+1) → bestätigt', kursStatus({ teilnehmer: 7, userMinimal: 6 }), 'bestätigt');

console.log('=== kursStatus: Fallback user_minimal = NULL / 0 (= 1) ===');
pruefe('user_minimal NULL, 1 TN → unter Vorbehalt', kursStatus({ teilnehmer: 1, userMinimal: null }), 'unter Vorbehalt');
pruefe('user_minimal NULL, 2 TN → bestätigt', kursStatus({ teilnehmer: 2, userMinimal: null }), 'bestätigt');
pruefe('user_minimal 0,   1 TN → unter Vorbehalt', kursStatus({ teilnehmer: 1, userMinimal: 0 }), 'unter Vorbehalt');

console.log('=== kursStatus: Schutzbedingung & Sonderfälle ===');
pruefe(
  'manueller Status bleibt (bestätigt, 0 TN)' ,
  kursStatus({ teilnehmer: 0, userMinimal: 6, zuweisungStatus: 'bestätigt' }),
  'bestätigt'
);
pruefe(
  'manueller Status bleibt (unter Vorbehalt, 8 TN)',
  kursStatus({ teilnehmer: 8, userMinimal: 6, zuweisungStatus: 'unter Vorbehalt' }),
  'unter Vorbehalt'
);
pruefe(
  'abgesagt (offerStatus 5) hat Vorrang',
  kursStatus({ teilnehmer: 9, userMinimal: 6, offerStatus: '5' }),
  'abgesagt'
);
pruefe(
  'offerStatus 2, 1 TN, min 2 → unter Vorbehalt',
  kursStatus({ teilnehmer: 1, userMinimal: 2, offerStatus: '2' }),
  'unter Vorbehalt'
);
pruefe(
  'offerStatus 2, 3 TN, min 2 → bestätigt',
  kursStatus({ teilnehmer: 3, userMinimal: 2, offerStatus: '2' }),
  'bestätigt'
);

console.log('=== effektiverZuweisungsstatus: minTeilnehmer = 3 ===');
pruefe('0 TN → reserviert', effektiverZuweisungsstatus({ teilnehmer: 0, userMinimal: 3, einnahmen: 0 }), 'reserviert');
pruefe('1 TN → unter Vorbehalt', effektiverZuweisungsstatus({ teilnehmer: 1, userMinimal: 3, einnahmen: 0 }), 'unter Vorbehalt');
pruefe('3 TN (= min) → unter Vorbehalt', effektiverZuweisungsstatus({ teilnehmer: 3, userMinimal: 3, einnahmen: 0 }), 'unter Vorbehalt');
pruefe('4 TN (min+1) → bestätigt', effektiverZuweisungsstatus({ teilnehmer: 4, userMinimal: 3, einnahmen: 0 }), 'bestätigt');
pruefe(
  'geschlossen ohne TN/Einnahmen → abgesagt',
  effektiverZuweisungsstatus({ teilnehmer: 0, userMinimal: 3, einnahmen: 0, offerStatus: '3' }),
  'abgesagt'
);
pruefe(
  'manuell gesetzt bleibt (reserviert-Ende)',
  effektiverZuweisungsstatus({ teilnehmer: 9, userMinimal: 3, einnahmen: 0, bisherigerStatus: 'abgesagt' }),
  'abgesagt'
);

console.log('');
if (fehler === 0) {
  console.log('ALLE ' + 26 + ' Prüfungen bestanden.');
  process.exit(0);
} else {
  console.log(fehler + ' Prüfung(en) fehlgeschlagen!');
  process.exit(1);
}
