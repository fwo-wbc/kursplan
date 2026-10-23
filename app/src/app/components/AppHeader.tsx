'use client';

import HeaderLogo from './HeaderLogo';
import Navigation from './Navigation';

/**
 * Einheitlicher Seiten-Header für ALLE Seiten der Kursplanung:
 *
 * - Ganz links steht der App-Titel „Kursplanung“, mit deutlicher Lücke
 *   (ml-[146px]) daneben das Firmenlogo (HeaderLogo) auf einer horizontalen,
 *   mittig zentrierten Linie.
 * - Rechts daneben sitzt die identische Hauptnavigation. Die aktive Seite
 *   wird über die hervorgehobene Menüschaltfläche (Hintergrund #285DAA,
 *   Icon und Schrift in Weiß) gekennzeichnet.
 */
export default function AppHeader() {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center">
        <h1 className="shrink-0 text-[34px] font-bold tracking-wide leading-tight text-slate-600">
          Kursplanung
        </h1>
        <div className="ml-[276px]">
          <HeaderLogo />
        </div>
      </div>
      <Navigation />
    </header>
  );
}
