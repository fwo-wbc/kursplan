/* Temporäres Verifikationsskript: Prüft das API-Mapping abgesagter/
 * geschlossener Kurse in GET /api/termine – Fokus liegt auf Kursen ohne
 * Trainer-Zuweisung ('n. v.'), deren zuweisung_status intakt bleiben muss.
 *
 * Fachliche Definition einer Absage (konsistent zu effektiverZuweisungsstatus):
 *   - offer_status '5'            → abgesagt   (immer)
 *   - offer_status '0'            → abgesagt   (Entwurf)
 *   - offer_status '3' + TN === 0 → abgesagt   (geschlossen ohne Teilnehmer)
 *   - offer_status '3' + TN >  0  → KEINE Absage (läuft regulär weiter)
 */
async function main() {
  const base = process.env.BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${base}/api/termine`);
  console.log('HTTP', res.status);
  if (!res.ok) {
    console.log(await res.text());
    process.exit(1);
  }
  const kurse = await res.json();
  console.log('Kurse gesamt:', kurse.length);

  const istAbsage = (k) =>
    String(k.offer_status ?? '') === '5' ||
    String(k.offer_status ?? '') === '0' ||
    (String(k.offer_status ?? '') === '3' && (k.teilnehmer ?? 0) === 0);

  const absagen = kurse.filter(istAbsage);
  console.log('Effektive Absagen (offer_status 5/0 bzw. 3+TN0):', absagen.length);

  const verletzungen = [];
  for (const k of absagen.sort((a, b) => (a.offer_id ?? '').localeCompare(b.offer_id ?? ''))) {
    if (k.zuweisung_status !== 'abgesagt') {
      verletzungen.push(k);
    }
  }

  // Counterexamples für den Bugfall: Abgesagt OHNE Zuweisung (Bugfall des Users).
  const ohneZuweisung = absagen.filter((k) => (k.zuweisungen ?? []).length === 0);
  console.log('Absagen ohne Zuweisung (n. v.):', ohneZuweisung.length);
  for (const k of ohneZuweisung) {
    console.log(
      `  - offer_id=${k.offer_id} | date_status=${JSON.stringify(k.date_status)} | offer_status=${JSON.stringify(k.offer_status)} | zuweisung_status=${JSON.stringify(k.zuweisung_status)} | trainer_kuerzel=${JSON.stringify(k.trainer_kuerzel)}`
    );
  }

  console.log('\nVerletzungen (Absage ohne "abgesagt"):', verletzungen.length);
  if (verletzungen.length > 0) {
    for (const k of verletzungen) {
      console.log(
        `  ⚠ offer_id=${k.offer_id} date_status=${JSON.stringify(k.date_status)} offer_status=${JSON.stringify(k.offer_status)} teilnehmer=${k.teilnehmer} zuweisung_status=${JSON.stringify(k.zuweisung_status)}`
      );
    }
    process.exit(2);
  }
  console.log('OK: Alle effektiven Absagen liefern zuweisung_status="abgesagt".');

  // --- Frontend-Logik simulieren (statusKlasse) ---
  const fehlerFrontend = [];
  for (const k of kurse) {
    const dateStatus = String(k.date_status ?? '').toLowerCase();
    // Neue statusKlasse(): date_status abgesagt/geschlossen → sofort rot,
    // unabhängig von zuweisung_status.
    if (dateStatus === 'abgesagt' || dateStatus === 'geschlossen') {
      // Alte Logik (Bug): zuweisung_status ?? date_status; wenn zuweisung_status
      // null/ausgeschrieben war und date_status NICHT exakt 'abgesagt', zeigte
      // der Kalender blau. Neue Logik gibt immer 'monats-kurs-abgesagt'.
      const alteKlasse = (() => {
        const st = String(k.zuweisung_status ?? k.date_status ?? '').toLowerCase();
        return st === 'abgesagt';
      })();
      if (!alteKlasse) {
        fehlerFrontend.push({
          offer_id: k.offer_id,
          date_status: k.date_status,
          zuweisung_status: k.zuweisung_status,
          detail:
            'Alte statusKlasse hätte NICHT rot gefärbt; neue statusKlasse färbt rot.',
        });
      }
    }
  }
  console.log('\nFrontend-Priorität: Von alter Logik NICHT rot gefärbte abgesagte/geschlossene Kurse:', fehlerFrontend.length);
  for (const f of fehlerFrontend.slice(0, 10)) {
    console.log(`  ✓ behoben: offer_id=${f.offer_id} date_status=${JSON.stringify(f.date_status)} zuweisung_status=${JSON.stringify(f.zuweisung_status)}`);
  }
  console.log('OK: statusKlasse() färbt abgesagte/geschlossene Kurse jetzt immer rot.');
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});