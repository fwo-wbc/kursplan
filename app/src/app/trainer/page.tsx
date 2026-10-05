'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Search,
  CloudDownload,
  Info,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Navigation from '../components/Navigation';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Trainer-Kürzel-Stammdaten aus GET /api/trainer. */
interface Trainer {
  id: number;
  kuerzel: string | null;
  is_active: boolean;
  edoobox_admin_id: string | null;
  tagessatz: number;
  halbtagessatz: number;
  stundensatz: number;
  reduzierter_satz: number;
}

/** Antwort des POST-Sync-Endpunkts. */
interface SyncResponse {
  synced?: number;
  neu_uebernommen?: number;
  error?: string;
}

/** Dezent angezeigte Erfolgs-/Fehlermeldung. */
interface Feedback {
  type: 'success' | 'error';
  text: string;
}

// ---------------------------------------------------------------------------
// Formatierung der Währungsbeträge
// ---------------------------------------------------------------------------

const betragFormatter = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formatiert einen Betrag als Euro-Währung, z. B. „€ 0,00“. */
function formatEuros(wert: number): string {
  return `€ ${betragFormatter.format(wert ?? 0)}`;
}

/** Formatiert einen Stundenhonorar, z. B. „€ 45,00 / Std.“. */
function formatStundensatz(wert: number): string {
  return `€ ${betragFormatter.format(wert ?? 0)} / Std.`;
}

/** Liefert den Wert als editierbaren Eingabetext (Punkt-Dezimaltrennzeichen). */
function toInputValue(wert: number): string {
  return String(wert ?? 0);
}

// ---------------------------------------------------------------------------
// Komponente
// ---------------------------------------------------------------------------

export default function TrainerPage() {
  const [trainer, setTrainer] = useState<Trainer[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Inline-Bearbeitung der Vergütungssätze.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{
    tagessatz: string;
    halbtagessatz: string;
    stundensatz: string;
    reduzierter_satz: string;
  } | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  // Dezentrale Meldung anzeigen und nach 4 s automatisch ausblenden.
  const showFeedback = useCallback((type: Feedback['type'], text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4000);
  }, []);

  // Alle Trainer-Kürzel laden.
  const loadTrainer = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trainer');
      if (!res.ok) {
        throw new Error('Endpunkt antwortete mit einem Fehler.');
      }
      const data = (await res.json()) as Trainer[];
      setTrainer(data);
    } catch (err: unknown) {
      console.error('Fehler beim Laden der Trainer:', err);
      setError('Die Trainer konnten nicht geladen werden. Bitte Verbindung zur Datenbank prüfen.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrainer();
  }, [loadTrainer]);

  // Edoobox-Sync auslösen und Liste anschließend aktualisieren.
  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    setError(null);
    try {
      const res = await fetch('/api/trainer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as SyncResponse | null;
        throw new Error(errBody?.error ?? 'Sync fehlgeschlagen.');
      }

      await loadTrainer();
      showFeedback('success', 'Daten erfolgreich aus edoobox gespiegelt und abgeglichen');
    } catch (err: unknown) {
      console.error('Fehler beim Edoobox-Sync:', err);
      showFeedback('error', err instanceof Error ? err.message : 'Sync fehlgeschlagen.');
    } finally {
      setIsSyncing(false);
    }
  }, [loadTrainer, showFeedback]);

  // Inline-Bearbeitung starten.
  const handleStartEdit = useCallback((t: Trainer) => {
    setEditingId(t.id);
    setEditDraft({
      tagessatz: toInputValue(t.tagessatz),
      halbtagessatz: toInputValue(t.halbtagessatz),
      stundensatz: toInputValue(t.stundensatz),
      reduzierter_satz: toInputValue(t.reduzierter_satz),
    });
  }, []);

  // Inline-Bearbeitung abbrechen.
  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditDraft(null);
  }, []);

  // Vergütungssätze speichern (PUT /api/trainer).
  const handleSaveEdit = useCallback(
    async (trainerId: number) => {
      if (!editDraft) return;

      const tagessatz = Number(editDraft.tagessatz.replace(',', '.'));
      const halbtagessatz = Number(editDraft.halbtagessatz.replace(',', '.'));
      const stundensatz = Number(editDraft.stundensatz.replace(',', '.'));
      const reduzierter_satz = Number(editDraft.reduzierter_satz.replace(',', '.'));

      if (
        !Number.isFinite(tagessatz) ||
        tagessatz < 0 ||
        !Number.isFinite(halbtagessatz) ||
        halbtagessatz < 0 ||
        !Number.isFinite(stundensatz) ||
        stundensatz < 0 ||
        !Number.isFinite(reduzierter_satz) ||
        reduzierter_satz < 0
      ) {
        showFeedback('error', 'Bitte gültige, nicht-negative Beträge eingeben.');
        return;
      }

      setSavingId(trainerId);
      try {
        const res = await fetch('/api/trainer', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: trainerId, tagessatz, halbtagessatz, stundensatz, reduzierter_satz }),
        });

        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errBody?.error ?? 'Speichern fehlgeschlagen.');
        }

        const updated = (await res.json()) as Trainer;
        setTrainer((prev) => prev.map((t) => (t.id === trainerId ? updated : t)));
        setEditingId(null);
        setEditDraft(null);
        showFeedback('success', 'Vergütungssätze gespeichert.');
      } catch (err: unknown) {
        console.error('Fehler beim Speichern der Sätze:', err);
        showFeedback('error', err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
      } finally {
        setSavingId(null);
      }
    },
    [editDraft, showFeedback]
  );

  // Gefilterte Liste basierend auf Suche (Kürzel / Admin-ID).
  const gefilterteTrainer = useMemo(() => {
    const such = searchTerm.trim().toLowerCase();

    return trainer.filter((t) => {
      if (such) {
        const haystack = `${t.kuerzel ?? ''} ${t.edoobox_admin_id ?? ''}`.toLowerCase();
        if (!haystack.includes(such)) return false;
      }

      return true;
    });
  }, [trainer, searchTerm]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-800 sm:p-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Trainerkürzel
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Übersicht der gespiegelten Trainerkürzel aus edoobox. Kürzel und Status werden
            über edoobox gesteuert, die Vergütungssätze lokal gepflegt.
          </p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <Navigation />
          <Image
            src="/wbc_logo-2026-trnsp-1007x145.png"
            alt="Logo"
            width={240}
            height={60}
            className="h-12 w-auto object-contain"
            priority
          />
        </div>
      </header>

      {/* Feedback-Banner */}
      {feedback && (
        <div
          role="status"
          className={`mb-4 p-3 rounded-lg text-sm font-medium border flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
              : 'bg-rose-50 border-rose-300 text-rose-800'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              feedback.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'
            }`}
          />
          {feedback.text}
        </div>
      )}

      {/* Header-Aktionen: Sync + Suche */}
      <div className="flex flex-col lg:flex-row lg:items-end gap-3 mb-6">
        <button
          type="button"
          onClick={handleSync}
          disabled={isSyncing}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-sm font-semibold rounded-lg transition whitespace-nowrap"
        >
          {isSyncing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CloudDownload className="w-4 h-4" />
          )}
          {isSyncing ? 'Spiegele Daten aus edoobox…' : 'Aus edoobox aktualisieren'}
        </button>

        <div className="flex-1">
          <label htmlFor="trainer-suche" className="block text-xs font-semibold text-slate-500 mb-1">
            Trainer suchen
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="trainer-suche"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Kürzel oder Admin-ID…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Lade Trainer…</span>
        </div>
      ) : error ? (
        <div className="p-4 rounded-lg border border-rose-300 bg-rose-50 text-rose-800 text-sm flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadTrainer}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Erneut versuchen
          </button>
        </div>
      ) : trainer.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <Users className="w-5 h-5" />
          <span className="text-sm">Keine Trainer vorhanden.</span>
        </div>
      ) : gefilterteTrainer.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <Search className="w-5 h-5" />
          <span className="text-sm">Keine Trainer entsprechen den aktiven Filtern.</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm min-w-[1080px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-3 py-3 font-semibold">Kürzel</th>
                <th className="px-3 py-3 font-semibold">
                  <span
                    className="inline-flex items-center gap-1"
                    title="Wird über edoobox gesteuert"
                  >
                    Status
                    <Info className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                </th>
                <th className="px-3 py-3 font-semibold text-right">
                  <span
                    className="inline-flex items-center gap-1"
                    title="Lokal gepflegter Tageshonorarsatz (netto)"
                  >
                    Tagessatz
                    <Info className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                </th>
                <th className="px-3 py-3 font-semibold text-right">
                  <span
                    className="inline-flex items-center gap-1"
                    title="Lokal gepflegter Halbtageshonorarsatz (netto)"
                  >
                    Halbtagessatz
                    <Info className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                </th>
                <th className="px-3 py-3 font-semibold text-right">
                  <span
                    className="inline-flex items-center gap-1"
                    title="Lokal gepflegter Stundenhonorarsatz (netto)"
                  >
                    Stundensatz
                    <Info className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                </th>
                <th className="px-3 py-3 font-semibold text-right">
                  <span
                    className="inline-flex items-center gap-1"
                    title="Lokal gepflegter reduzierter Honorarsatz (Sonderfall 1 Teilnehmer)"
                  >
                    Reduzierter Satz
                    <Info className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                </th>
                <th className="px-3 py-3 font-semibold text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {gefilterteTrainer.map((t) => {
                const isEditing = editingId === t.id;
                const isSaving = savingId === t.id;

                return (
                  <tr
                    key={t.id}
                    className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60 align-middle"
                  >
                    {/* Kürzel – prominent hervorgehoben (schreibgeschützt) */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="inline-block px-2.5 py-1 rounded-md bg-blue-600 font-mono text-sm font-semibold text-white">
                        {t.kuerzel ?? '–'}
                      </span>
                    </td>

                    {/* Status-Badge (schreibgeschützt, über edoobox gesteuert) */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
                          t.is_active
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {t.is_active ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    </td>

                    {/* Tagessatz – lokal pflegbar */}
                    <td className="px-3 py-3 whitespace-nowrap text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          aria-label={`Tagessatz für ${t.kuerzel ?? t.id}`}
                          value={editDraft?.tagessatz ?? ''}
                          onChange={(e) =>
                            setEditDraft((prev) =>
                              prev ? { ...prev, tagessatz: e.target.value } : prev
                            )
                          }
                          className="w-24 px-2 py-1 text-sm text-right border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="tabular-nums font-medium">{formatEuros(t.tagessatz)}</span>
                      )}
                    </td>

                    {/* Halbtagessatz – lokal pflegbar */}
                    <td className="px-3 py-3 whitespace-nowrap text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          aria-label={`Halbtagessatz für ${t.kuerzel ?? t.id}`}
                          value={editDraft?.halbtagessatz ?? ''}
                          onChange={(e) =>
                            setEditDraft((prev) =>
                              prev ? { ...prev, halbtagessatz: e.target.value } : prev
                            )
                          }
                          className="w-24 px-2 py-1 text-sm text-right border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="tabular-nums font-medium">{formatEuros(t.halbtagessatz)}</span>
                      )}
                    </td>

                    {/* Stundensatz – lokal pflegbar */}
                    <td className="px-3 py-3 whitespace-nowrap text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          aria-label={`Stundensatz für ${t.kuerzel ?? t.id}`}
                          value={editDraft?.stundensatz ?? ''}
                          onChange={(e) =>
                            setEditDraft((prev) =>
                              prev ? { ...prev, stundensatz: e.target.value } : prev
                            )
                          }
                          className="w-24 px-2 py-1 text-sm text-right border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="tabular-nums font-medium">{formatStundensatz(t.stundensatz)}</span>
                      )}
                    </td>

                    {/* Reduzierter Satz – lokal pflegbar */}
                    <td className="px-3 py-3 whitespace-nowrap text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          aria-label={`Reduzierter Satz für ${t.kuerzel ?? t.id}`}
                          value={editDraft?.reduzierter_satz ?? ''}
                          onChange={(e) =>
                            setEditDraft((prev) =>
                              prev ? { ...prev, reduzierter_satz: e.target.value } : prev
                            )
                          }
                          className="w-24 px-2 py-1 text-sm text-right border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="tabular-nums font-medium">{formatEuros(t.reduzierter_satz)}</span>
                      )}
                    </td>

                    {/* Aktionen */}
                    <td className="px-3 py-3 whitespace-nowrap text-right">
                      {isEditing ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(t.id)}
                            disabled={isSaving}
                            title="Speichern"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition"
                          >
                            {isSaving ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            Speichern
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            disabled={isSaving}
                            title="Abbrechen"
                            className="inline-flex items-center justify-center p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition disabled:opacity-50"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(t)}
                          title="Vergütungssätze bearbeiten"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-600 hover:text-blue-700 hover:bg-blue-50 text-xs font-semibold rounded-lg transition"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Bearbeiten
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}