'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Planung > Serien > Neu (L-05 Serienplaner)
// Formular zur Serien-Erstellung. Sendet die Eingaben an POST /api/course-series
// und leitet bei Erfolg (HTTP 201) auf das Konflikt-Dashboard weiter.
// ---------------------------------------------------------------------------

interface Thema {
  id: number;
  name: string;
}

interface FehlerBody {
  error?: string;
}

type PlanningMode = 'OFFICE_CAPACITY' | 'EXTERNAL_AVAILABILITY';

/** Heutiges Datum als YYYY-MM-DD (Browser-Zeitzone). */
function heuteIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const tag = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${tag}`;
}

export default function SerieNeuPage() {
  const router = useRouter();

  const [themen, setThemen] = useState<Thema[]>([]);
  const [topicId, setTopicId] = useState<string>('');
  const [planningMode, setPlanningMode] = useState<PlanningMode>('OFFICE_CAPACITY');
  const [coursePriority, setCoursePriority] = useState<string>('1');
  const [startDate, setStartDate] = useState<string>(heuteIso());
  const [intervalDays, setIntervalDays] = useState<string>('7');
  const [occurrences, setOccurrences] = useState<string>('4');

  const [ladeThemen, setLadeThemen] = useState(true);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  /** Lädt die Themenliste aus public.course_topics. */
  const loadThemen = useCallback(async () => {
    setLadeThemen(true);
    setFehler(null);
    try {
      const res = await fetch('/api/course-topics', { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as FehlerBody | null;
        throw new Error(body?.error ?? `Themen-Endpunkt antwortet mit HTTP ${res.status}.`);
      }
      const daten = (await res.json()) as Thema[];
      setThemen(daten);
      if (daten.length > 0) {
        setTopicId((vorher) => vorher || String(daten[0].id));
      }
    } catch (err: unknown) {
      setFehler(err instanceof Error ? err.message : 'Themen konnten nicht geladen werden.');
    } finally {
      setLadeThemen(false);
    }
  }, []);

  useEffect(() => {
    void loadThemen();
  }, [loadThemen]);

  /** Validiert das Formular und gibt einen lesbaren Fehler zurück (oder null). */
  function validiere(): string | null {
    if (!topicId) return 'Bitte ein Thema auswählen.';
    if (!startDate) return 'Bitte ein Startdatum angeben.';
    const interval = Number(intervalDays);
    if (!Number.isInteger(interval) || interval <= 0) {
      return 'Der Rhythmus muss eine positive ganze Zahl (Tage) sein.';
    }
    const anzahl = Number(occurrences);
    if (!Number.isInteger(anzahl) || anzahl <= 0) {
      return 'Die Anzahl der Termine muss eine positive ganze Zahl sein.';
    }
    const prioritaet = Number(coursePriority);
    if (planningMode === 'OFFICE_CAPACITY' && (!Number.isInteger(prioritaet) || prioritaet < 1 || prioritaet > 3)) {
      return 'Die Kurspriorität muss zwischen 1 und 3 liegen.';
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fehlerText = validiere();
    if (fehlerText) {
      setFehler(fehlerText);
      return;
    }

    setSpeichert(true);
    setFehler(null);
    try {
      const res = await fetch('/api/course-series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicId: Number(topicId),
          planningMode,
          coursePriority: planningMode === 'OFFICE_CAPACITY' ? Number(coursePriority) : undefined,
          startDate,
          intervalDays: Number(intervalDays),
          occurrences: Number(occurrences),
        }),
      });

      if (res.status === 201) {
        router.push('/planung/konflikte');
        return;
      }

      // Fehlerfall: Server-Meldung übernehmen. Bei HTTP 400 (z. B. kein
      // durchgehend verfügbarer Trainer bei EXTERNAL_AVAILABILITY) bleibt das
      // Formular stehen und zeigt die Meldung als roten Hinweis – der Nutzer
      // kann Startdatum oder Rhythmus direkt anpassen.
      const body = (await res.json().catch(() => null)) as FehlerBody | null;
      const meldung = body?.error ?? `Serie konnte nicht erstellt werden (HTTP ${res.status}).`;
      if (res.status === 400) {
        setFehler(meldung);
        setSpeichert(false);
        return;
      }
      throw new Error(meldung);
    } catch (err: unknown) {
      setFehler(err instanceof Error ? err.message : 'Unbekannter Fehler beim Erstellen der Serie.');
      setSpeichert(false);
    }
  }

  const inputClass =
    'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-100';

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Neue Serie planen</h1>
        <p className="mt-1 text-sm text-slate-600">
          Erstellt eine Termin-Serie (L-05) und meldet Konflikt-Tage im Dashboard.
        </p>
      </header>

      {fehler && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {fehler}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        {/* Thema */}
        <div>
          <label htmlFor="thema" className="block text-sm font-medium text-slate-700">
            Thema
          </label>
          <select
            id="thema"
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            disabled={ladeThemen || speichert}
            className={inputClass}
          >
            {ladeThemen ? (
              <option value="">Lade Themen …</option>
            ) : themen.length === 0 ? (
              <option value="">Keine Themen vorhanden</option>
            ) : (
              themen.map((thema) => (
                <option key={thema.id} value={thema.id}>
                  {thema.name}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Planungs-Modus */}
        <div>
          <label htmlFor="planungsmodus" className="block text-sm font-medium text-slate-700">
            Planungs-Modus
          </label>
          <select
            id="planungsmodus"
            value={planningMode}
            onChange={(e) => setPlanningMode(e.target.value as PlanningMode)}
            disabled={speichert}
            className={inputClass}
          >
            <option value="OFFICE_CAPACITY">OFFICE_CAPACITY</option>
            <option value="EXTERNAL_AVAILABILITY">EXTERNAL_AVAILABILITY</option>
          </select>
        </div>

        {/* Kurspriorität – nur bei OFFICE_CAPACITY */}
        {planningMode === 'OFFICE_CAPACITY' && (
          <div>
            <label htmlFor="kursprioritaet" className="block text-sm font-medium text-slate-700">
              Kurspriorität
            </label>
            <select
              id="kursprioritaet"
              value={coursePriority}
              onChange={(e) => setCoursePriority(e.target.value)}
              disabled={speichert}
              className={inputClass}
            >
              <option value="1">1 – hoch</option>
              <option value="2">2 – mittel</option>
              <option value="3">3 – niedrig</option>
            </select>
          </div>
        )}

        {/* Startdatum */}
        <div>
          <label htmlFor="startdatum" className="block text-sm font-medium text-slate-700">
            Startdatum
          </label>
          <input
            id="startdatum"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={speichert}
            className={inputClass}
          />
        </div>

        {/* Rhythmus in Tagen */}
        <div>
          <label htmlFor="rhythmus" className="block text-sm font-medium text-slate-700">
            Rhythmus (Tage zwischen den Terminen)
          </label>
          <input
            id="rhythmus"
            type="number"
            min={1}
            value={intervalDays}
            onChange={(e) => setIntervalDays(e.target.value)}
            disabled={speichert}
            className={inputClass}
          />
        </div>

        {/* Anzahl der Termine */}
        <div>
          <label htmlFor="anzahl" className="block text-sm font-medium text-slate-700">
            Anzahl der Termine
          </label>
          <input
            id="anzahl"
            type="number"
            min={1}
            max={100}
            value={occurrences}
            onChange={(e) => setOccurrences(e.target.value)}
            disabled={speichert}
            className={inputClass}
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.push('/planung/konflikte')}
            disabled={speichert}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={speichert || ladeThemen}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {speichert ? 'Wird gespeichert …' : 'Serie erstellen'}
          </button>
        </div>
      </form>
    </main>
  );
}