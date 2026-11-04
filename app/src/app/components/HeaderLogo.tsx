/**
 * Logo-Slot für den Seiten-Header.
 *
 * Hochauflösendes PNG (Retina-Prinzip) statt Inline-SVG:
 * Die PNG-Datei liegt unter /public/webinarcenter_logo_header.png und wird
 * responsiv über Tailwind skaliert (h-10 sm:h-11, Breite automatisch,
 * Seitenverhältnis bleibt durch object-contain unverzerrt).
 */
export default function HeaderLogo() {
  return (
    <img
      src="/webinarcenter_logo_header.png"
      alt="webinarcenter.de"
      className="h-10 sm:h-11 w-auto object-contain shrink-0"
      loading="eager"
      decoding="sync"
    />
  );
}
