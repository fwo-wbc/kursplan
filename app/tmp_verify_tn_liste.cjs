/**
 * Laufzeit-Verifikation der Badge-Logik „TN-Liste vorhanden?“.
 * Bildet die Bedingung aus src/app/page.tsx (tnListeHinweis) exakt nach.
 */
function tnListeHinweis(kurs) {
  const erweitert = kurs;
  const nummer =
    kurs.kursnr?.trim() ||
    erweitert.kursnummer?.trim() ||
    erweitert.nummer?.trim() ||
    erweitert.offer_number?.trim() ||
    '';
  const istFirmenkurs = /^2/.test(nummer);
  const teilnehmer = Number(
    erweitert.teilnehmer_anzahl ??
      kurs.teilnehmer ??
      erweitert.buchungen ??
      erweitert.participants ??
      0
  );
  if (!istFirmenkurs || teilnehmer !== 1) return null;
  return { text: 'TN-Liste vorhanden?', className: 'bg-amber-100 text-amber-800 border-amber-300' };
}

let fehler = 0;
function pruefe(name, kurs, erwartet) {
  const ergebnis = tnListeHinweis(kurs);
  const ok = erwartet ? ergebnis !== null : ergebnis === null;
  if (!ok) fehler++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${name} | kursnr=${kurs.kursnr} teilnehmer=${kurs.teilnehmer} -> ${ergebnis ? ergebnis.text : 'kein Badge'}`
  );
}

// a) Firmenkurse (Kursnummer startet mit "2") mit genau 1 TN -> Badge
pruefe('Firmenkurs 2xxx, 1 TN', { kursnr: '2250-ABC-1026-1', teilnehmer: 1 }, true);
pruefe('Firmenkurs 2xxx, 1 TN (teilnehmer_anzahl)', { kursnr: '2250-ABC-1026-1', teilnehmer_anzahl: 1 }, true);
pruefe('Firmenkurs 2xxx, 1 TN (offer_number)', { offer_number: '2250-ABC-1026-1', teilnehmer: 1 }, true);

// b) Firmenkurse mit 0 oder mehr als 1 TN -> KEIN Badge
pruefe('Firmenkurs 2xxx, 0 TN', { kursnr: '2250-ABC-1026-1', teilnehmer: 0 }, false);
pruefe('Firmenkurs 2xxx, 2 TN', { kursnr: '2250-ABC-1026-1', teilnehmer: 2 }, false);
pruefe('Firmenkurs 2xxx, 5 TN', { kursnr: '2250-ABC-1026-1', teilnehmer: 5 }, false);

// c) Coachings ("9...") und offene Kurse -> KEIN Badge in keinem Fall
pruefe('Coaching 9xxx, 1 TN', { kursnr: '9123-XYZ-1026-1', teilnehmer: 1 }, false);
pruefe('Coaching 9xxx, 1 TN (teilnehmer_anzahl)', { kursnr: '9123-XYZ-1026-1', teilnehmer_anzahl: 1 }, false);
pruefe('Offener Kurs (Buchstabe), 1 TN', { kursnr: 'ABC-1026-1', teilnehmer: 1 }, false);
pruefe('Offener Kurs (Buchstabe), 1 TN (offer_number)', { offer_number: 'ABC-1026-1', teilnehmer: 1 }, false);

// Randfälle
pruefe('Leere Kursnummer, 1 TN', { kursnr: '', teilnehmer: 1 }, false);
pruefe('Firmenkurs 2xxx, null TN', { kursnr: '2250-ABC-1026-1', teilnehmer: null }, false);

console.log(fehler === 0 ? '\nALLE TESTS BESTANDEN' : `\n${fehler} TEST(S) FEHLGESCHLAGEN`);
process.exit(fehler === 0 ? 0 : 1);
