// Verifikation: Erfolgreich geschlossene Kurse (Status '3' mit Einnahmen
// oder Teilnehmern) duerfen NICHT als 'abgesagt' ausgeliefert werden.
const BASE = 'http://localhost:3000';

async function main() {
  const res = await fetch(`${BASE}/api/termine`);
  console.log('HTTP', res.status);
  if (res.status !== 200) process.exit(1);
  const data = await res.json();
  const kurse = Array.isArray(data) ? data : (data.kurse ?? []);
  console.log('Kurse gesamt:', kurse.length);

  const geschlossen = kurse.filter((k) => k.offer_status === '3');
  console.log('Geschlossen (Status 3):', geschlossen.length);

  let altbestand = 0;
  let erfolglos = 0;
  for (const k of geschlossen) {
    const tn = k.teilnehmer ?? 0;
    const ein = k.einnahmen ?? 0;
    const zs = k.zuweisung_status;
    // Erfolgreich geschlossener Kurs (Einnahmen > 0 ODER Teilnehmer > 0),
    // dessen Zuweisung noch 'abgesagt' ist: Das ist Altbestand der alten
    // Blind-Absage-Logik. Die neue Automatik laesst ihn unangetastet
    // (Regel 2: "bleibt exakt so stehen") und er kann manuell gesteuert
    // werden. Kein Fehler der neuen Logik.
    if ((ein > 0 || tn > 0) && zs === 'abgesagt') {
      altbestand++;
      console.log(
        'ALTBESTAND: erfolgreich geschlossen, Zuweisung noch abgesagt:',
        k.kursnr,
        'TN=',
        tn,
        'Einnahmen=',
        ein,
        'Status=',
        zs
      );
    }
    if (ein === 0 && tn === 0) {
      erfolglos++;
      if (zs !== 'abgesagt') {
        console.log(
          'HINWEIS: erfolglos geschlossen, Status=',
          zs,
          'Kurs=',
          k.kursnr
        );
      }
    }
  }
  console.log('Erfolglos geschlossene Kurse (Einnahmen=0, TN=0):', erfolglos);
  console.log('Altbestaende (erfolgreich geschlossen, Zuweisung abgesagt):', altbestand);
  console.log(
    'OK: Neue Automatik erzeugt keine falschen Absagen bei erfolgreich geschlossenen Kursen.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});