/**
 * Logo-Slot für den Seiten-Header.
 *
 * Rendert direkt `/logo.png` – eine 1:1-Kopie der WBC-Originaldatei
 * (`wbc_logo-2026-trnsp-1007x145.png`) in `public/`. Da die Datei garantiert
 * existiert, entstehen beim initialen Laden im Browser keine 404-Netzwerkanfragen
 * und kein kaputtes Bild-Icon – auch nicht nach einem harten Refresh (F5).
 *
 * Hinweis: Soll das Logo ausgetauscht werden, genügt es, `public/logo.png` zu
 * ersetzen (bzw. die WBC-Originaldatei erneut dorthin zu kopieren). Eine
 * clientseitige onError-Fallback-Kette ist bewusst nicht mehr vorhanden.
 *
 * Die Höhe ist mit `h-10` (40 px) so gewählt, dass das Logo harmonisch zur
 * vergrößerten Titel-Schrift (text-2xl) danebensteht; das Seitenverhältnis
 * bleibt über `object-contain` erhalten.
 */
export default function HeaderLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- bewusst natives
    // <img>: Der Pfad zeigt auf eine in `public/` vorhandene Datei, ein
    // onError-Fallback ist nicht nötig.
    <img
      src="/logo.png"
      alt="Logo"
      width={240}
      height={60}
      className="h-10 w-auto object-contain"
    />
  );
}