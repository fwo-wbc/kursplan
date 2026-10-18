'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  CalendarRange,
  Users,
  RefreshCw,
  Check,
  TriangleAlert,
  ArrowRightLeft,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/trainer/verfuegbarkeit', label: 'Trainerverfügbarkeiten', icon: CalendarRange },
  { href: '/trainer', label: 'Trainer verwalten', icon: Users },
  {
    href: '/Kurstransfer/index.html',
    label: 'Kurstransfer',
    icon: ArrowRightLeft,
    external: true,
  },
];

type SyncStatus = 'idle' | 'loading' | 'success' | 'error';

function SyncButton() {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [resetTimer, setResetTimer] = useState<ReturnType<typeof setTimeout> | null>(
    null
  );

  async function handleSync() {
    if (status === 'loading') return;

    setStatus('loading');
    try {
      const response = await fetch('/api/sync/p90', {
        method: 'POST',
        // Festes Timeout, damit der Button bei hängendem n8n-Webhook nicht ewig lädt.
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        throw new Error(`Sync fehlgeschlagen (Status ${response.status})`);
      }
      setStatus('success');
      // Die Hauptseite (page.tsx) lädt ihre Kursdaten clientseitig in den
      // lokalen React-State (loadData -> fetch /api/termine). router.refresh()
      // aktualisiert nur Server-Component-Payloads, nicht diesen Client-State.
      // Deshalb garantierter Voll-Reload nach kurzer Verzögerung, damit der
      // Nutzer kurz das grüne Erfolgs-Icon sieht.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('kursplan:reload-silent'));
      }, 600);
    } catch {
      // Fehler oder Timeout: Ladezustand zuverlässig beenden.
      setStatus('error');
    }

    // Nach kurzem Feedback zurück in den Ruhezustand.
    if (resetTimer) clearTimeout(resetTimer);
    setResetTimer(
      setTimeout(() => {
        setStatus('idle');
        setResetTimer(null);
      }, 2500)
    );
  }

  // Auf den Hintergrund-Sync-Auslöser aus page.tsx reagieren
  // (kursplan:trigger-sync) und den bestehenden Sync automatisch starten.
  useEffect(() => {
    const onTriggerSync = () => {
      void handleSync();
    };
    window.addEventListener('kursplan:trigger-sync', onTriggerSync);
    return () => window.removeEventListener('kursplan:trigger-sync', onTriggerSync);
  }, [handleSync]);

  const isLoading = status === 'loading';
  const Icon =
    status === 'success' ? Check : status === 'error' ? TriangleAlert : RefreshCw;
  const label =
    status === 'loading'
      ? 'Synchronisiere...'
      : status === 'success'
        ? 'Synchronisiert'
        : status === 'error'
          ? 'Fehler beim Sync'
          : 'Sync';

  return (
    <button
      type="button"
      onClick={handleSync}
      disabled={isLoading}
      aria-label="edoobox synchronisieren"
      title="edoobox synchronisieren"
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border transition ${
        status === 'success'
          ? 'border-green-300 bg-green-50 text-green-700'
          : status === 'loading' || status === 'error'
            ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'
            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
      } disabled:opacity-60 disabled:cursor-not-allowed`}
    >
      <Icon
        className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''} ${
          status === 'success'
            ? 'text-green-600'
            : status === 'loading' || status === 'error'
              ? 'text-white'
              : 'text-slate-500'
        }`}
      />
      {label}
    </button>
  );
}

export default function Navigation() {
  const pathname = usePathname();

  return (
    <>
      <SyncButton />
      <nav className="flex items-center gap-1" aria-label="Hauptnavigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          // Statische HTML-Datei (Kurstransfer) liegt außerhalb der Next.js-Routen
          // und wird deshalb als normales <a>-Element gerendert.
          if (item.external) {
            return (
              <a
                key={item.href}
                href={item.href}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </a>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}