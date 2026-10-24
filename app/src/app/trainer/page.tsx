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
  Tags,
  Plus,
  Settings2,
  Trash2,
  RotateCcw,
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
}

/** Antwort des POST-Sync-Endpunkts. */
interface SyncResponse {
  synced?: number;
  neu_uebernommen?: number;
  error?: string;
}

/** Kursthema aus GET /api/course-topics (public.course_topics). */
interface Topic {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
}

/** Antwort von GET / PUT /api/trainer-topics. */
interface TrainerTopicsResponse {
  trainerId: number;
  topicIds: number[];
  primaryTopicIds?: number[];
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

  // Themen-Zuordnung (Voraussetzung L-05 Puzzle-Logik).
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsByTrainer, setTopicsByTrainer] = useState<
    Record<number, number[]>
  >({});
  const [topicsModalTrainerId, setTopicsModalTrainerId] = useState<
    number | null
  >(null);
  const [topicDraft, setTopicDraft] = useState<number[]>([]);
  // Haupttrainer-Themen je Trainer (Szenario 2: Trainer-Priorität pro Thema).
  const [primaryTopicsByTrainer, setPrimaryTopicsByTrainer] = useState<
    Record<number, number[]>
  >({});
  const [primaryTopicDraft, setPrimaryTopicDraft] = useState<number[]>([]);
  const [isSavingTopics, setIsSavingTopics] = useState<boolean>(false);

  // Themen-Verwaltung (Kursthemen-Stamm inkl. Löschvermerk/Soft-Delete).
  const [isTopicManageOpen, setIsTopicManageOpen] = useState<boolean>(false);
  const [manageTopics, setManageTopics] = useState<Topic[]>([]);
  const [isLoadingManage, setIsLoadingManage] = useState<boolean>(false);
  const [newTopicName, setNewTopicName] = useState<string>('');
  const [isCreatingTopic, setIsCreatingTopic] = useState<boolean>(false);
  const [editingTopicId, setEditingTopicId] = useState<number | null>(null);
  const [editingTopicDraft, setEditingTopicDraft] = useState<string>('');
  const [savingTopicId, setSavingTopicId] = useState<number | null>(null);
  // Filter im Verwaltungs-Modal: Standard deaktiviert -> nur aktive Themen.
  const [showInactiveTopics, setShowInactiveTopics] = useState<boolean>(false);

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

  // Alle Kursthemen aus public.course_topics laden.
  const loadTopics = useCallback(async () => {
    try {
      const res = await fetch('/api/course-topics');
      if (!res.ok) {
        throw new Error('Endpunkt antwortete mit einem Fehler.');
      }
      const data = (await res.json()) as Topic[];
      setTopics(data);
    } catch (err: unknown) {
      console.error('Fehler beim Laden der Themen:', err);
      setTopics([]);
    }
  }, []);

  useEffect(() => {
    loadTrainer();
    loadTopics();
  }, [loadTrainer, loadTopics]);

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

  // Themen-Auswahl für einen Trainer öffnen und bestehende Zuordnung laden.
  const handleOpenTopics = useCallback(
    async (t: Trainer) => {
      setTopicsModalTrainerId(t.id);

      const vorhanden = topicsByTrainer[t.id];
      const vorhandenePrimary = primaryTopicsByTrainer[t.id];
      if (vorhanden !== undefined && vorhandenePrimary !== undefined) {
        setTopicDraft(vorhanden);
        setPrimaryTopicDraft(vorhandenePrimary);
        return;
      }

      // Noch nicht gecacht -> aus der Datenbank laden.
      try {
        const res = await fetch(`/api/trainer-topics?trainerId=${t.id}`);
        if (!res.ok) {
          throw new Error('Endpunkt antwortete mit einem Fehler.');
        }
        const data = (await res.json()) as TrainerTopicsResponse;
        setTopicsByTrainer((prev) => ({ ...prev, [t.id]: data.topicIds }));
        setPrimaryTopicsByTrainer((prev) => ({
          ...prev,
          [t.id]: data.primaryTopicIds ?? [],
        }));
        setTopicDraft(data.topicIds);
        setPrimaryTopicDraft(data.primaryTopicIds ?? []);
      } catch (err: unknown) {
        console.error('Fehler beim Laden der Themen-Zuordnung:', err);
        showFeedback('error', 'Themen-Zuordnung konnte nicht geladen werden.');
        setTopicsModalTrainerId(null);
      }
    },
    [topicsByTrainer, primaryTopicsByTrainer, showFeedback]
  );

  // Themen-Auswahl im Modal schließen (ohne Speichern).
  const handleCloseTopics = useCallback(() => {
    setTopicsModalTrainerId(null);
    setTopicDraft([]);
    setPrimaryTopicDraft([]);
  }, []);

  // Ein Thema an-/abwählen. Neu angehakte Themen gelten zunächst als
  // Haupttrainer-Thema (konservativer Default für die Puzzle-Logik).
  const handleToggleTopic = useCallback((topicId: number) => {
    setTopicDraft((prev) => {
      const istDabei = prev.includes(topicId);
      if (istDabei) {
        setPrimaryTopicDraft((p) => p.filter((id) => id !== topicId));
        return prev.filter((id) => id !== topicId);
      }
      setPrimaryTopicDraft((p) =>
        p.includes(topicId) ? p : [...p, topicId]
      );
      return [...prev, topicId];
    });
  }, []);

  // Priorität eines zugewiesenen Themas setzen (Haupttrainer / temporär).
  const handleSetTopicPriority = useCallback(
    (topicId: number, isPrimary: boolean) => {
      setPrimaryTopicDraft((prev) =>
        isPrimary
          ? prev.includes(topicId)
            ? prev
            : [...prev, topicId]
          : prev.filter((id) => id !== topicId)
      );
    },
    []
  );

  // Auswahl speichern (PUT /api/trainer-topics ersetzt die Zuordnung).
  const handleSaveTopics = useCallback(async () => {
    if (topicsModalTrainerId === null) return;

    const trainerId = topicsModalTrainerId;
    setIsSavingTopics(true);
    try {
      const res = await fetch('/api/trainer-topics', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trainerId,
          topicIds: topicDraft,
          primaryTopicIds: primaryTopicDraft,
        }),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(errBody?.error ?? 'Speichern fehlgeschlagen.');
      }

      const updated = (await res.json()) as TrainerTopicsResponse;
      setTopicsByTrainer((prev) => ({
        ...prev,
        [trainerId]: updated.topicIds,
      }));
      setPrimaryTopicsByTrainer((prev) => ({
        ...prev,
        [trainerId]: updated.primaryTopicIds ?? [],
      }));
      setTopicsModalTrainerId(null);
      setTopicDraft([]);
      setPrimaryTopicDraft([]);
      showFeedback('success', 'Themen-Zuordnung gespeichert.');
    } catch (err: unknown) {
      console.error('Fehler beim Speichern der Themen-Zuordnung:', err);
      showFeedback(
        'error',
        err instanceof Error ? err.message : 'Speichern fehlgeschlagen.'
      );
    } finally {
      setIsSavingTopics(false);
    }
  }, [topicsModalTrainerId, topicDraft, primaryTopicDraft, showFeedback]);

  // -------------------------------------------------------------------------
  // Kursthemen-Verwaltung (anlegen, umbenennen, Löschvermerk setzen/entfernen)
  // -------------------------------------------------------------------------

  // Kursthemen laden – je nach Filter-Toggle nur aktive oder inkl. Löschvermerk.
  const loadManageTopics = useCallback(async (includeInactive: boolean) => {
    try {
      const url = includeInactive
        ? '/api/course-topics?includeInactive=1'
        : '/api/course-topics';
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Endpunkt antwortete mit einem Fehler.');
      }
      const data = (await res.json()) as Topic[];
      setManageTopics(data);
    } catch (err: unknown) {
      console.error('Fehler beim Laden aller Kursthemen:', err);
      setManageTopics([]);
    }
  }, []);

  // Nach einer Stamm-Änderung beide Listen neu laden (aktive für die
  // Checkboxen-Zuordnung, Kursthemen für das Modal inkl. Filter-Zustand).
  const reloadTopicLists = useCallback(async () => {
    await Promise.all([loadTopics(), loadManageTopics(showInactiveTopics)]);
  }, [loadTopics, loadManageTopics, showInactiveTopics]);

  // Verwaltungs-Modal öffnen.
  const handleOpenTopicManage = useCallback(() => {
    setIsTopicManageOpen(true);
    setNewTopicName('');
    setEditingTopicId(null);
    setEditingTopicDraft('');
    setIsLoadingManage(true);
    loadManageTopics(showInactiveTopics).finally(() => setIsLoadingManage(false));
  }, [loadManageTopics, showInactiveTopics]);

  // Filter „Gelöschte Kurse anzeigen": Toggle-Stand setzen und Liste neu laden.
  const handleToggleShowInactive = useCallback(
    async (value: boolean) => {
      setShowInactiveTopics(value);
      setIsLoadingManage(true);
      await loadManageTopics(value).finally(() => setIsLoadingManage(false));
    },
    [loadManageTopics]
  );

  // Verwaltungs-Modal schließen (ohne Speichern).
  const handleCloseTopicManage = useCallback(() => {
    setIsTopicManageOpen(false);
    setNewTopicName('');
    setEditingTopicId(null);
    setEditingTopicDraft('');
  }, []);

  // Neues Thema anlegen (POST /api/course-topics).
  const handleCreateTopic = useCallback(async () => {
    const name = newTopicName.trim();
    if (!name) {
      showFeedback('error', 'Bitte einen Themennamen eingeben.');
      return;
    }
    setIsCreatingTopic(true);
    try {
      const res = await fetch('/api/course-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(errBody?.error ?? 'Anlegen fehlgeschlagen.');
      }
      setNewTopicName('');
      await reloadTopicLists();
      showFeedback('success', `Thema „${name}“ angelegt.`);
    } catch (err: unknown) {
      console.error('Fehler beim Anlegen des Kursthemas:', err);
      showFeedback(
        'error',
        err instanceof Error ? err.message : 'Anlegen fehlgeschlagen.'
      );
    } finally {
      setIsCreatingTopic(false);
    }
  }, [newTopicName, reloadTopicLists, showFeedback]);

  // Thema umbenennen (PATCH /api/course-topics).
  const handleRenameTopic = useCallback(
    async (topic: Topic) => {
      const name = editingTopicDraft.trim();
      if (!name) {
        showFeedback('error', 'Der Themenname darf nicht leer sein.');
        return;
      }
      if (name === topic.name) {
        setEditingTopicId(null);
        setEditingTopicDraft('');
        return;
      }
      setSavingTopicId(topic.id);
      try {
        const res = await fetch('/api/course-topics', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: topic.id, name }),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(errBody?.error ?? 'Umbenennen fehlgeschlagen.');
        }
        setEditingTopicId(null);
        setEditingTopicDraft('');
        await reloadTopicLists();
        showFeedback('success', `Thema in „${name}“ umbenannt.`);
      } catch (err: unknown) {
        console.error('Fehler beim Umbenennen des Kursthemas:', err);
        showFeedback(
          'error',
          err instanceof Error ? err.message : 'Umbenennen fehlgeschlagen.'
        );
      } finally {
        setSavingTopicId(null);
      }
    },
    [editingTopicDraft, reloadTopicLists, showFeedback]
  );

  // Löschvermerk setzen (deaktivieren) bzw. entfernen (reaktivieren).
  const handleToggleTopicActive = useCallback(
    async (topic: Topic) => {
      setSavingTopicId(topic.id);
      try {
        const res = await fetch('/api/course-topics', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: topic.id, is_active: !topic.is_active }),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(errBody?.error ?? 'Aktualisierung fehlgeschlagen.');
        }
        await reloadTopicLists();
        showFeedback(
          'success',
          topic.is_active
            ? `Thema „${topic.name}“ deaktiviert (Löschvermerk gesetzt).`
            : `Thema „${topic.name}“ reaktiviert (Löschvermerk entfernt).`
        );
      } catch (err: unknown) {
        console.error('Fehler beim Setzen des Löschvermerks:', err);
        showFeedback(
          'error',
          err instanceof Error ? err.message : 'Aktualisierung fehlgeschlagen.'
        );
      } finally {
        setSavingTopicId(null);
      }
    },
    [reloadTopicLists, showFeedback]
  );

  // Verwaltungs-Modal barrierefrei schließen: ESC-Taste.
  useEffect(() => {
    if (!isTopicManageOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCloseTopicManage();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTopicManageOpen, handleCloseTopicManage]);

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

      {/* Erklärungstext + rechtsbündige Aktionsgruppe (Kurskategorien verwalten)
          in einer Zeile unmittelbar unter dem Hauptmenü – analog Kursmanagement */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Übersicht der gespiegelten Trainerkürzel aus edoobox. Kürzel und Status werden
          über edoobox gesteuert, die Vergütungssätze lokal gepflegt.
        </p>
        <div className="flex items-center gap-4 ml-auto">
          <button
            type="button"
            onClick={handleOpenTopicManage}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg transition whitespace-nowrap"
          >
            <Settings2 className="w-4 h-4" />
            Kurskategorien verwalten
          </button>
        </div>
      </div>

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
                    title="Themen, die dieser Trainer übernehmen kann (Grundlage der L-05 Puzzle-Logik)"
                  >
                    Themen
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
                          className="w-24 px-2 py-1 text-sm text-right border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="tabular-nums font-medium">{formatEuros(t.honorar_90min)}</span>
                      )}
                    </td>

                    {/* Themen-Zuordnung (L-05 Puzzle-Logik) */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenTopics(t)}
                          title="Themen-Zuordnung bearbeiten"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-600 hover:text-blue-700 hover:bg-blue-50 text-xs font-semibold rounded-lg transition border border-slate-200 hover:border-blue-300"
                        >
                          <Tags className="w-3.5 h-3.5" />
                          Themen
                        </button>
                        <span
                          className={`inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full text-xs font-semibold ${
                            (topicsByTrainer[t.id]?.length ?? 0) > 0
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                          title={`${
                            topicsByTrainer[t.id]?.length ?? 0
                          } zugewiesene Themen`}
                        >
                          {topicsByTrainer[t.id]?.length ?? 0}
                        </span>
                      </div>
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

      {/* Modal: Themen-Zuordnung für einen Trainer */}
      {topicsModalTrainerId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Themen-Zuordnung"
          onClick={handleCloseTopics}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-xl bg-white shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Kopfbereich */}
            <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-200">
              <Tags className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-bold text-slate-800">
                Themen-Zuordnung
              </h2>
              <span className="ml-auto inline-block px-2 py-0.5 rounded-md bg-blue-600 font-mono text-xs font-semibold text-white">
                {trainer.find((tr) => tr.id === topicsModalTrainerId)?.kuerzel ??
                  `Trainer #${topicsModalTrainerId}`}
              </span>
              <button
                type="button"
                onClick={handleCloseTopics}
                disabled={isSavingTopics}
                title="Schließen"
                className="inline-flex items-center justify-center p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Themen-Checkboxen */}
            <div className="px-5 py-4 overflow-y-auto">
              {topics.length === 0 ? (
                <p className="flex items-start gap-2 text-sm text-slate-500">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Noch keine Themen vorhanden. Bitte zuerst unter{' '}
                    <span className="font-mono">public.course_topics</span>{' '}
                    Themen anlegen, bevor Sie einem Trainer Themen zuweisen.
                  </span>
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {topics.map((topic) => {
                    const checked = topicDraft.includes(topic.id);
                    const isPrimary = primaryTopicDraft.includes(topic.id);
                    return (
                      <div
                        key={topic.id}
                        className={`rounded-lg border transition ${
                          checked
                            ? 'bg-blue-50 border-blue-300'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleTopic(topic.id)}
                            className="w-4 h-4 accent-blue-600"
                          />
                          <span className="text-sm text-slate-700">
                            {topic.name}
                          </span>
                        </label>

                        {checked && (
                          <div
                            className="flex items-center gap-1.5 px-3 pb-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Priorität
                            </span>
                            <div className="inline-flex rounded-md overflow-hidden border border-slate-300 bg-white text-[11px] font-semibold">
                              <button
                                type="button"
                                onClick={() =>
                                  handleSetTopicPriority(topic.id, true)
                                }
                                className={`px-2 py-1 transition ${
                                  isPrimary
                                    ? 'bg-blue-600 text-white'
                                    : 'text-slate-600 hover:bg-slate-100'
                                }`}
                                title="Haupttrainer für dieses Thema"
                              >
                                Haupttrainer
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleSetTopicPriority(topic.id, false)
                                }
                                className={`px-2 py-1 transition ${
                                  isPrimary
                                    ? 'text-slate-600 hover:bg-slate-100'
                                    : 'bg-slate-200 text-slate-700'
                                }`}
                                title="Temporärer Trainer für dieses Thema"
                              >
                                Temporär
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Fußbereich */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-200">
              <span className="text-xs text-slate-500">
                {topicDraft.length} von {topics.length} Themen ausgewählt
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCloseTopics}
                  disabled={isSavingTopics}
                  className="px-3 py-2 text-slate-600 hover:bg-slate-100 text-xs font-semibold rounded-lg transition disabled:opacity-50"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={handleSaveTopics}
                  disabled={isSavingTopics}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition"
                >
                  {isSavingTopics ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  {isSavingTopics ? 'Speichere…' : 'Speichern'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Kurskategorien verwalten (anlegen, umbenennen, Löschvermerk) */}
      {isTopicManageOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Kurskategorien verwalten"
          onClick={handleCloseTopicManage}
        >
          <div
            className="w-full max-w-xl max-h-[80vh] overflow-hidden rounded-xl bg-white shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Kopfbereich */}
            <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-200">
              <Settings2 className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-bold text-slate-800">
                Kurskategorien verwalten
              </h2>
              <button
                type="button"
                onClick={handleCloseTopicManage}
                disabled={isCreatingTopic || savingTopicId !== null}
                title="Schließen"
                className="ml-auto inline-flex items-center justify-center p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filter: nur aktive bzw. inkl. gelöschter (Löschvermerk) Kurse */}
            <div className="px-5 pt-4 flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showInactiveTopics}
                  onChange={(e) => void handleToggleShowInactive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="relative w-10 h-5 bg-slate-300 rounded-full transition-colors peer-checked:bg-blue-600">
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5" />
                </div>
                <span className="text-xs font-semibold text-slate-600">
                  Gelöschte Kurse anzeigen
                </span>
              </label>
              <span className="text-xs text-slate-400">
                {showInactiveTopics ? 'Inkl. Löschvermerk' : 'Nur aktive Kategorien'}
              </span>
            </div>

            {/* Neue Kategorie anlegen */}
            <div className="px-5 pt-4">
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleCreateTopic();
                }}
              >
                <div className="flex-1">
                  <label
                    htmlFor="neues-thema"
                    className="block text-xs font-semibold text-slate-500 mb-1"
                  >
                    Neue Kategorie anlegen
                  </label>
                  <input
                    id="neues-thema"
                    type="text"
                    value={newTopicName}
                    onChange={(e) => setNewTopicName(e.target.value)}
                    placeholder="Kategoriename…"
                    maxLength={120}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isCreatingTopic || newTopicName.trim().length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition"
                >
                  {isCreatingTopic ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  {isCreatingTopic ? 'Lege an…' : 'Anlegen'}
                </button>
              </form>
            </div>

            {/* Kategorienliste (inkl. deaktivierter, farblich ausgegraut) */}
            <div className="px-5 py-4 overflow-y-auto">
              {isLoadingManage ? (
                <div className="flex items-center justify-center py-8 text-slate-400 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Lade Kategorien…</span>
                </div>
              ) : manageTopics.length === 0 ? (
                <p className="flex items-start gap-2 text-sm text-slate-500">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Noch keine Kategorien vorhanden.</span>
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                  {manageTopics.map((topic) => {
                    const isEditing = editingTopicId === topic.id;
                    const isSaving = savingTopicId === topic.id;
                    return (
                      <li
                        key={topic.id}
                        className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${
                          topic.is_active ? 'bg-white' : 'bg-slate-50'
                        }`}
                      >
                        <span
                          className={`flex-1 min-w-[120px] text-sm ${
                            topic.is_active
                              ? 'text-slate-700'
                              : 'text-slate-400 line-through'
                          }`}
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              value={editingTopicDraft}
                              onChange={(e) => setEditingTopicDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void handleRenameTopic(topic);
                                }
                                if (e.key === 'Escape') {
                                  setEditingTopicId(null);
                                  setEditingTopicDraft('');
                                }
                              }}
                              maxLength={120}
                              autoFocus
                              className="w-full px-2 py-1 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : (
                            topic.name
                          )}
                        </span>

                        {!topic.is_active && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-slate-200 text-slate-500">
                            Löschvermerk
                          </span>
                        )}

                        <div className="flex items-center gap-1.5">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleRenameTopic(topic)}
                                disabled={isSaving}
                                title="Umbenennung speichern"
                                className="inline-flex items-center justify-center p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition disabled:opacity-50"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTopicId(null);
                                  setEditingTopicDraft('');
                                }}
                                disabled={isSaving}
                                title="Abbrechen"
                                className="inline-flex items-center justify-center p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg transition disabled:opacity-50"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTopicId(topic.id);
                                setEditingTopicDraft(topic.name);
                              }}
                              disabled={savingTopicId !== null}
                              title="Thema umbenennen"
                              className="inline-flex items-center justify-center p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition disabled:opacity-50"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => void handleToggleTopicActive(topic)}
                            disabled={savingTopicId !== null}
                            title={
                              topic.is_active
                                ? 'Löschvermerk setzen (Thema deaktivieren)'
                                : 'Löschvermerk entfernen (Thema reaktivieren)'
                            }
                            className={`inline-flex items-center justify-center p-1.5 rounded-lg transition disabled:opacity-50 ${
                              topic.is_active
                                ? 'text-slate-500 hover:text-red-600 hover:bg-red-50'
                                : 'text-slate-500 hover:text-emerald-600 hover:bg-emerald-50'
                            }`}
                          >
                            {isSaving ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : topic.is_active ? (
                              <Trash2 className="w-4 h-4" />
                            ) : (
                              <RotateCcw className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Fußbereich */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-200">
              <span className="text-xs text-slate-500">
                {manageTopics.filter((t) => t.is_active).length} von{' '}
                {manageTopics.length} Kategorien aktiv
              </span>
              <button
                type="button"
                onClick={handleCloseTopicManage}
                className="px-3 py-2 text-slate-600 hover:bg-slate-100 text-xs font-semibold rounded-lg transition"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}