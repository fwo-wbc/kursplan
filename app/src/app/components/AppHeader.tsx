'use client';

import type { ReactNode } from 'react';
import HeaderLogo from './HeaderLogo';
import Navigation from './Navigation';

/**
 * Einheitlicher Seiten-Header für ALLE Seiten der Kursplanung.
 *
 * Der Header ist in zwei Zeilen getrennt:
 *
 * 1. Brand-Row (oben, dunkelblau):
 *    - Links: das weiße Firmenlogo (HeaderLogo), danach ein dezenter
 *      vertikaler Trennstrich und der App-Titel „Kursplanung“ in Weiß.
 *    - Rechts: optionale Aktions-Buttons (z. B. „Sync“ und
 *      „Zuweisungen bereinigen“) über das `actions`-Prop – gestylt für
 *      den dunklen Hintergrund (dezente Glas-Optik).
 * 2. Navigation-Row (darunter, hell):
 *    - Die Hauptnavigation (Navigation) als eigene, dedizierte Leiste
 *      direkt unter der Titelzeile.
 */
interface AppHeaderProps {
  /** Optionale Aktions-Buttons, rechtsbündig in der Titelzeile. */
  actions?: ReactNode;
}

export default function AppHeader({ actions }: AppHeaderProps) {
  return (
    <header className="mb-2 flex flex-col gap-2">
      {/* Brand-Row: Logo + Titel links, Aktions-Buttons rechts */}
      <div className="flex items-center justify-between gap-3 rounded-lg bg-[#193C6F] py-2.5 px-4 sm:px-6">
        <div className="flex items-center min-w-0">
          <div className="shrink-0">
            <HeaderLogo />
          </div>
          <div className="h-6 w-px bg-white/20 mx-3 hidden sm:block" />
          <span className="text-lg font-medium text-white tracking-wide">
            Kursplanung
          </span>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {/* Navigation-Row: Menüpunkte auf einer Zeile */}
      <Navigation />
    </header>
  );
}
