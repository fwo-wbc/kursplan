'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, BookOpen } from 'lucide-react';
import AppHeader from '../components/AppHeader';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Ein Kursthema – identisch zur Struktur von GET /api/kursthemen. */
interface Kursthema {
  id: number;
  titel: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Konstanten / Styling
// ---------------------------------------------------------------------------

/** CD-Blau als feste Konstante (identisch zur übrigen Kursplanung). */
const CD_BLAU = '#285DAA';

/**
 * Formatiert den ISO-Zeitstempel in Europe/Berlin, lesbar für die Anzeige
 * (TT.MM.JJJJ HH:MM).
 */
function formatDatum(iso: string): string {
  const datum = new Date(iso);
  if (Number.isNaN(datum.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(datum);
}

// ---------------------------------------------------------------------------
// Seite
// ---------------------------------------------------------------------------

export default function Kursthemenmanagement() {
  const [themen, setThemen] = useState<Kursthema[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const loadThemen = useCallback(async () => {
    setLoading(true);
    setFehler(null);
    try {
      const res = await fetch('/api/kursthemen', { cache: 'no-store' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const data: Kursthema[] = await res.json();
      setThemen(data);
    } catch (err: unknown) {
      console.error('Fehler beim Laden der Kurstitel:', err);
      setFehler(err instanceof Error ? err.message : 'Unbekannter Fehler');
      setThemen([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadThemen();
  }, [loadThemen]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <AppHeader />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-white shrink-0"
              style={{ backgroundColor: CD_BLAU }}
            >
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                Kursthemenmanagement
              </h2>
              <p className="text-sm text-slate-500">
                Alle Kurstitel aus edoobox ({themen.length})
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadThemen()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: CD_BLAU }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Aktualisieren
          </button>
        </div>

        {fehler && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {fehler}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-6 py-16 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin" />
              Kurstitel werden geladen …
            </div>
          ) : themen.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">
              Keine Kurstitel vorhanden. Die Tabelle{' '}
              <span className="font-mono">public."Kursthemen"</span> ist leer.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr className="text-slate-600">
                    <th className="px-4 py-3 font-semibold">#</th>
                    <th className="px-4 py-3 font-semibold">Kurstitel</th>
                    <th className="px-4 py-3 font-semibold text-right">
                      angelegt am
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {themen.map((t, index) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-400 tabular-nums">
                        {index + 1}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">
                        {t.titel}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums whitespace-nowrap">
                        {formatDatum(t.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}