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
  KeyRound,
  Mail,
  ShieldCheck,
  ShieldAlert,
  Eye,
  EyeOff,
  Shuffle,
} from 'lucide-react';
import AppHeader from '../components/AppHeader';

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
  honorar_90min: number;
  /** Portal-E-Mail für das Trainerportal (Login /portal/login). */
  portal_email: string | null;
  /** Portal-Zugang aktiv/deaktiviert (unabhängig von is_active). */
  portal_active: boolean;
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
    honorar_90min: string;
  } | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  // Zugangsverwaltung Trainerportal (Modal-Dialog).
  const [zugangId, setZugangId] = useState<number | null>(null);
  const [zugangDraft, setZugangDraft] = useState<{
    portal_email: string;
    portal_active: boolean;
    neuesKennwort: string;
    kennwortSichtbar: boolean;
  } | null>(null);
  const [speichereZugangId, setSpeichereZugangId] = useState<number | null>(null);

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
      honorar_90min: toInputValue(t.honorar_90min),
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
      const honorar_90min = Number(editDraft.honorar_90min.replace(',', '.'));

      if (
        !Number.isFinite(tagessatz) ||
        tagessatz < 0 ||
        !Number.isFinite(halbtagessatz) ||
        halbtagessatz < 0 ||
        !Number.isFinite(stundensatz) ||
        stundensatz < 0 ||
        !Number.isFinite(reduzierter_satz) ||
        reduzierter_satz < 0 ||
        !Number.isFinite(honorar_90min) ||
        honorar_90min < 0
      ) {
        showFeedback('error', 'Bitte gültige, nicht-negative Beträge eingeben.');
        return;
      }

      setSavingId(trainerId);
      try {
        const res = await fetch('/api/trainer', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: trainerId, tagessatz, halbtagessatz, stundensatz, reduzierter_satz, honorar_90min }),
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

  // -------------------------------------------------------------------------
  // Zugangsverwaltung Trainerportal
  // -------------------------------------------------------------------------

  /**
   * Erzeugt ein kryptographisch sicheres Zufallskennwort für die einmalige
   * Weitergabe an den Trainer (Zeichen ohne Verwechslungsgefahr wie O/0, I/l).
   */
  const generiereZufallsKennwort = useCallback((laenge = 16): string => {
    const zeichen = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
    const bytes = new Uint32Array(laenge);
    crypto.getRandomValues(bytes);
    let pw = '';
    for (let i = 0; i < laenge; i++) {
      pw += zeichen[bytes[i] % zeichen.length];
    }
    return pw;
  }, []);

  /** Öffnet den Zugangs-Dialog für einen Trainer. */
  const handleOpenZugang = useCallback((t: Trainer) => {
    setZugangId(t.id);
    setZugangDraft({
      portal_email: t.portal_email ?? '',
      portal_active: t.portal_active,
      neuesKennwort: '',
      kennwortSichtbar: false,
    });
  }, []);

  /** Schließt den Zugangs-Dialog ohne zu speichern. */
  const handleCloseZugang = useCallback(() => {
    setZugangId(null);
    setZugangDraft(null);
    setSpeichereZugangId(null);
  }, []);

  /** Übernimmt ein frisch generiertes Zufallskennwort ins Kennwort-Feld. */
  const handleZufallskennwort = useCallback(() => {
    setZugangDraft((prev) =>
      prev ? { ...prev, neuesKennwort: generiereZufallsKennwort(16) } : prev
    );
  }, [generiereZufallsKennwort]);

  /** Speichert Portal-E-Mail, Aktiv-Status und optional das neue Kennwort. */
  const handleSaveZugang = useCallback(async () => {
    if (!zugangId || !zugangDraft) return;

    const portal_email = zugangDraft.portal_email.trim();
    if (!portal_email) {
      showFeedback('error', 'Bitte eine Portal-E-Mail angeben.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(portal_email)) {
      showFeedback('error', 'Bitte eine gültige E-Mail-Adresse angeben.');
      return;
    }
    if (zugangDraft.neuesKennwort.trim() !== '' && zugangDraft.neuesKennwort.length < 8) {
      showFeedback('error', 'Das Kennwort muss mindestens 8 Zeichen lang sein.');
      return;
    }

    setSpeichereZugangId(zugangId);
    try {
      const res = await fetch('/api/trainer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: zugangId,
          portal_email,
          portal_active: zugangDraft.portal_active,
          ...(zugangDraft.neuesKennwort.trim() !== ''
            ? { password: zugangDraft.neuesKennwort }
            : {}),
        }),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(errBody?.error ?? 'Speichern fehlgeschlagen.');
      }

      const updated = (await res.json()) as Trainer;
      setTrainer((prev) => prev.map((t) => (t.id === zugangId ? updated : t)));
      handleCloseZugang();
      showFeedback('success', 'Portal-Zugang gespeichert.');
    } catch (err: unknown) {
      console.error('Fehler beim Speichern des Portal-Zugangs:', err);
      showFeedback('error', err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSpeichereZugangId(null);
    }
  }, [zugangId, zugangDraft, showFeedback, handleCloseZugang]);

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
      <AppHeader />

      {/* Feedback-Banner */}
      {feedback && (
        <div
          role="status"
          className={`mb-4 p-3 rounded-lg text-sm font-medium border flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
              : 'bg-red-50 border-red-300 text-red-800'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              feedback.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'
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
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#285DAA] hover:bg-[#1E4A87] disabled:bg-slate-300 text-white text-sm font-semibold rounded-lg transition whitespace-nowrap"
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
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#285DAA]"
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
        <div className="p-4 rounded-lg border border-red-300 bg-red-50 text-red-800 text-sm flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadTrainer}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition"
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
                <th className="px-3 py-3 font-semibold text-right">
                  <span
                    className="inline-flex items-center gap-1"
                    title="Lokal gepflegter Honorarsatz für Einzeltermine bis 90 Minuten"
                  >
                    90-Min.-Satz
                    <Info className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                </th>
                <th className="px-3 py-3 font-semibold">
                  <span
                    className="inline-flex items-center gap-1"
                    title="Portal-Zugang für externe Trainer (Login /portal/login)"
                  >
                    Portal-Zugang
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
                      <span className="inline-block px-2.5 py-1 rounded-md bg-[#285DAA] font-mono text-sm font-semibold text-white">
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
                          className="w-24 px-2 py-1 text-sm text-right border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#285DAA]"
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
                          className="w-24 px-2 py-1 text-sm text-right border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#285DAA]"
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
                          className="w-24 px-2 py-1 text-sm text-right border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#285DAA]"
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
                          className="w-24 px-2 py-1 text-sm text-right border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#285DAA]"
                        />
                      ) : (
                        <span className="tabular-nums font-medium">{formatEuros(t.reduzierter_satz)}</span>
                      )}
                    </td>

                    {/* 90-Min.-Satz – lokal pflegbar */}
                    <td className="px-3 py-3 whitespace-nowrap text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          aria-label={`90-Min.-Satz für ${t.kuerzel ?? t.id}`}
                          value={editDraft?.honorar_90min ?? ''}
                          onChange={(e) =>
                            setEditDraft((prev) =>
                              prev ? { ...prev, honorar_90min: e.target.value } : prev
                            )
                          }
                          className="w-24 px-2 py-1 text-sm text-right border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#285DAA]"
                        />
                      ) : (
                        <span className="tabular-nums font-medium">{formatEuros(t.honorar_90min)}</span>
                      )}
                    </td>

                    {/* Portal-Zugang – Badge + E-Mail */}
                    <td className="px-3 py-3 whitespace-nowrap align-middle">
                      {t.portal_active && t.portal_email ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Portal aktiv
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border bg-slate-100 text-slate-600 border-slate-200">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          Kein Zugang
                        </span>
                      )}
                      {t.portal_email && (
                        <span
                          className="block mt-1 text-xs text-slate-500 max-w-[180px] truncate"
                          title={t.portal_email}
                        >
                          {t.portal_email}
                        </span>
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
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(t)}
                            title="Vergütungssätze bearbeiten"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-600 hover:text-[#285DAA] hover:bg-[#285DAA]/10 text-xs font-semibold rounded-lg transition"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenZugang(t)}
                            title="Portal-Zugang verwalten"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 text-xs font-semibold rounded-lg transition"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Zugang
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Zugangsverwaltung Trainerportal (Modal) */}
      {zugangId !== null && zugangDraft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Portal-Zugang verwalten"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[#285DAA]" />
                <h2 className="text-base font-semibold text-slate-800">
                  Portal-Zugang verwalten
                </h2>
              </div>
              <button
                type="button"
                onClick={handleCloseZugang}
                disabled={speichereZugangId !== null}
                title="Schließen"
                className="inline-flex items-center justify-center p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {(() => {
                const current = trainer.find((t) => t.id === zugangId);
                return current ? (
                  <p className="text-xs text-slate-500">
                    Trainer:{' '}
                    <span className="font-mono font-semibold text-slate-700">
                      {current.kuerzel ?? '–'}
                    </span>
                    {current.edoobox_admin_id
                      ? ` · Edoobox-ID ${current.edoobox_admin_id}`
                      : ''}
                  </p>
                ) : null;
              })()}

              <div>
                <label htmlFor="portal-email" className="block text-xs font-semibold text-slate-500 mb-1">
                  Portal-E-Mail
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    id="portal-email"
                    type="email"
                    autoComplete="off"
                    value={zugangDraft.portal_email}
                    onChange={(e) =>
                      setZugangDraft((prev) =>
                        prev ? { ...prev, portal_email: e.target.value } : prev
                      )
                    }
                    placeholder="trainer@beispiel.de"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#285DAA]"
                  />
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Zugangsadresse für das Trainerportal (Login via /portal/login).
                </p>
              </div>

              <div>
                <label htmlFor="portal-active" className="block text-xs font-semibold text-slate-500 mb-1">
                  Portal-Zugang
                </label>
                <select
                  id="portal-active"
                  value={zugangDraft.portal_active ? 'aktiv' : 'inaktiv'}
                  onChange={(e) =>
                    setZugangDraft((prev) =>
                      prev
                        ? { ...prev, portal_active: e.target.value === 'aktiv' }
                        : prev
                    )
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#285DAA]"
                >
                  <option value="aktiv">Aktiv (Login erlaubt)</option>
                  <option value="inaktiv">Deaktiviert (kein Login)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <label htmlFor="neues-kennwort" className="block text-xs font-semibold text-slate-500">
                    Neues Kennwort
                  </label>
                  <button
                    type="button"
                    onClick={handleZufallskennwort}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#285DAA] hover:text-[#1E4A87]"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    Zufallskennwort generieren
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="neues-kennwort"
                    type={zugangDraft.kennwortSichtbar ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={zugangDraft.neuesKennwort}
                    onChange={(e) =>
                      setZugangDraft((prev) =>
                        prev ? { ...prev, neuesKennwort: e.target.value } : prev
                      )
                    }
                    placeholder="mind. 8 Zeichen – leer lassen = unverändert"
                    className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#285DAA]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setZugangDraft((prev) =>
                        prev
                          ? { ...prev, kennwortSichtbar: !prev.kennwortSichtbar }
                          : prev
                      )
                    }
                    title={zugangDraft.kennwortSichtbar ? 'Kennwort verbergen' : 'Kennwort anzeigen'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition"
                  >
                    {zugangDraft.kennwortSichtbar ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Wird serverseitig mit bcrypt gehasht und niemals im Klartext
                  gespeichert. Bitte einmalig sicher übermitteln.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200">
              <button
                type="button"
                onClick={handleCloseZugang}
                disabled={speichereZugangId !== null}
                className="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleSaveZugang}
                disabled={speichereZugangId !== null}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-sm font-semibold rounded-lg transition"
              >
                {speichereZugangId !== null ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}