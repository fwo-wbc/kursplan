'use client';

// =============================================================================
// PortalHeader – einheitlicher Header für alle /portal/*-Seiten (außer Login).
// -----------------------------------------------------------------------------
// - Brand-Row in Unternehmensblau (#193C6F) mit Logo, Trennstrich und Titel.
// - Rechts die Anzeige des angemeldeten Trainers (GET /portal/api/auth/me)
//   sowie der Abmelden-Button (POST /portal/api/auth/logout → /portal/login).
// - Bewusst KEINE zweite Navigationsleiste und keine Tabs – die Navigation im
//   Portal übernimmt ausschließlich die jeweilige Seite selbst.
// =============================================================================

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

interface TrainerInfo {
  id: number;
  vorname: string;
  nachname: string;
  email: string;
}

export default function PortalHeader() {
  const router = useRouter();
  const [trainer, setTrainer] = useState<TrainerInfo | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  // Trainer-Stammdaten für die Begrüßung laden. Schlägt das fehl (keine/ungültige
  // Session), bleibt die Begrüßung dezent ausgeblendet – die Seite selbst prüft
  // ihre geschützten API-Routen und leitet bei HTTP 401 zum Login um.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/portal/api/auth/me', { method: 'GET' });
        if (!res.ok) return;
        const data = (await res.json()) as TrainerInfo;
        if (active) setTrainer(data);
      } catch {
        // Server nicht erreichbar – Header bleibt ohne Begrüßung nutzbar.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch('/portal/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/portal/login');
    }
  }

  return (
    <header className="bg-[#193C6F] py-2.5 px-4 sm:px-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        {/* Linke Gruppe: Logo + Trennstrich + Titel */}
        <div className="flex items-center min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/webinarcenter_logo_header.png"
            alt="Webinarcenter Logo"
            className="h-10 sm:h-11 w-auto object-contain shrink-0"
          />
          <div className="h-6 w-px bg-white/20 mx-3 hidden sm:block" aria-hidden="true" />
          <span className="text-lg font-medium text-white tracking-wide shrink-0">
            Trainerportal
          </span>
        </div>

        {/* Rechte Gruppe: Begrüßung + Abmelden */}
        <div className="flex items-center gap-2 min-w-0">
          {trainer && (
            <span className="hidden md:inline text-sm text-white/80 truncate">
              Angemeldet als: {trainer.vorname} {trainer.nachname}
            </span>
          )}
          {trainer && (
            <span className="md:hidden text-sm text-white/80 truncate">
              {trainer.vorname} {trainer.nachname}
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-sm px-3 py-1.5 rounded border border-white/20 transition-colors disabled:opacity-60"
          >
            <LogOut className="w-4 h-4 text-white shrink-0 mr-1.5" aria-hidden="true" />
            {loggingOut ? 'Abmelden …' : 'Abmelden'}
          </button>
        </div>
      </div>
    </header>
  );
}
