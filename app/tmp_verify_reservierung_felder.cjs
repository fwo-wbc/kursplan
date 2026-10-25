// Temporärer Laufzeit-Test: Prüft, ob GET /api/termine für Reservierungen
// die neuen Felder reservation_code, thema, kunde, frist_ende liefert.
const BASE = process.argv[2] ?? 'http://localhost:3001';

async function main() {
  const res = await fetch(`${BASE}/api/termine`, { cache: 'no-store' });
  console.log(`HTTP ${res.status}`);
  if (!res.ok) {
    const text = await res.text();
    console.log(text.slice(0, 500));
    process.exit(1);
  }
  const data = await res.json();
  const reservierungen = (Array.isArray(data) ? data : data.kurse ?? [])
    .filter((k) => String(k.date_status ?? '').toLowerCase() === 'reservierung');
  console.log(`Reservierungs-Kurse gesamt: ${reservierungen.length}`);

  if (reservierungen.length === 0) {
    console.log('Keine Reservierungen vorhanden – Felder können nicht geprüft werden.');
    return;
  }

  let geprueft = 0;
  for (const kurs of reservierungen.slice(0, 5)) {
    const hatCode = typeof kurs.reservation_code === 'string';
    // thema darf null sein (Welt B hat kein Thema -> Frontend zeigt '-'),
    // darf aber NIE der String "undefined" sein.
    const hatThema =
      typeof kurs.thema === 'string' || kurs.thema === null;
    const keinUndefined = kurs.thema !== 'undefined';
    const hatKunde = typeof kurs.kunde === 'string';
    const hatFrist = typeof kurs.frist_ende === 'string';
    geprueft += 1;
    console.log(
      `- offer_id=${kurs.offer_id} code=${JSON.stringify(kurs.reservation_code)} thema=${JSON.stringify(kurs.thema)} kunde=${JSON.stringify(kurs.kunde)} frist=${JSON.stringify(kurs.frist_ende)}`
    );
    if (!hatCode || !hatThema || !keinUndefined || !hatKunde || !hatFrist) {
      console.log(`FEHLER: Felder unvollständig (code=${hatCode}, thema=${hatThema}, keinUndefined=${keinUndefined}, kunde=${hatKunde}, frist=${hatFrist})`);
      process.exit(1);
    }
  }
  console.log(`OK: Alle ${geprueft} geprüften Reservierungen liefern die neuen Felder.`);
}

main().catch((err) => {
  console.error('Test fehlgeschlagen:', err);
  process.exit(1);
});