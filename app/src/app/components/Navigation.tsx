'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  CalendarDays,
  CalendarRange,
  Users,
  RefreshCw,
  Check,
  TriangleAlert,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Kursplanung', icon: CalendarDays },
  { href: '/trainer/zeitplan', label: 'Dozenten-Planung', icon: CalendarRange },
  { href: '/trainer', label: 'Trainer verwalten', icon: Users },
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
        window.location.reload();
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
          : status === 'error'
            ? 'border-red-300 bg-red-50 text-red-700'
            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
      } disabled:opacity-60 disabled:cursor-not-allowed`}
    >
      <Icon
        className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''} ${
          status === 'success'
            ? 'text-green-600'
            : status === 'error'
              ? 'text-red-600'
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
      <nav className="flex items-center gap-1" aria-label="Hauptnavigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

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
      <SyncButton />
    </>
  );
}