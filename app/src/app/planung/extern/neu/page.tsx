'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '../../../components/AppHeader';

// ---------------------------------------------------------------------------
// Planung > Externe Kurse > Neu (Szenario 2 – EXTERNAL_AVAILABILITY)
// „Serienplanung": Termine für externe Kurse anhand der freien Trainer-
// Verfügbarkeiten planen (flexibler Rhythmus, keine festen Intervalle).
//
// Das Formular enthält bewusst NUR Kursthema, Startdatum und Anzahl der
// Termine. Feste Rhythmen (intervalDays) und interne Kursprioritäten
// (coursePriority) sind in diesem Szenario nicht relevant und werden weder
// angezeigt noch gesendet. Der planningMode wird hart auf
// 'EXTERNAL_AVAILABILITY' gesetzt.
// ---------------------------------------------------------------------------

interface Thema {
  id: number;
  name: string;
}

interface FehlerBody {
  error?: string;
}

/** Heutiges Datum als YYYY-MM-DD (Browser-Zeitzone). */
function heuteIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const tag = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${tag}`;
}

export default function ExterneSerieNeuPage() {
  const router = useRouter();

  const [themen, setThemen] = useState<Thema[]>([]);
  const [topicId, setTopicId] = useState<string>('');
  const [startDate, setStartDate] = useState<string>(heuteIso());
  const [occurrences, setOccurrences] = useState<string>('4');

  const [ladeThemen, setLadeThemen] = useState(true);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  /** Lädt die aktiven Themen aus public.course_topics (GET /api/course-topics). */
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
    if (!topicId) return 'Bitte ein Kursthema auswählen.';
    if (!startDate) return 'Bitte ein Startdatum angeben.';
    const anzahl = Number(occurrences);
    if (!Number.isInteger(anzahl) || anzahl <= 0) {
      return 'Die Anzahl der Termine muss eine positive ganze Zahl sein.';
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
          // Szenario 2: Planungsmodus hart auf „externe Verfügbarkeit" gesetzt.
          planningMode: 'EXTERNAL_AVAILABILITY',
          startDate,
          occurrences: Number(occurrences),
          // bewusst kein intervalDays / coursePriority im Body
        }),
      });

      if (res.status === 201) {
        // Erfolg: Zum Kalender weiterleiten und dort die Erfolgsmeldung anzeigen.
        router.push('/kalender?erfolg=serie');
        return;
      }

      // Fehlerfall: Server-Meldung übernehmen. Bei HTTP 400 (kein durchgehend
      // verfügbarer Trainer) bleibt das Formular stehen und zeigt die Meldung
      // als rotes Hinweis-Banner direkt über dem Formular.
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
    <main className="min-h-screen bg-slate-50 p-4 text-slate-800 sm:p-6">
      <AppHeader />

      <div className="mx-auto mt-6 max-w-2xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Serienplanung</h1>
          <p className="mt-1 text-sm text-slate-600">
            Plant eine Termin-Serie für externe Kurse anhand der freien
            Verfügbarkeiten der Trainer (flexibler Rhythmus).
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
          {/* Kursthema */}
          <div>
            <label htmlFor="thema" className="block text-sm font-medium text-slate-700">
              Kursthema
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
            <p className="mt-1 text-xs text-slate-500">
              Frühester Termin für die Suche nach freien Trainer-Verfügbarkeiten.
            </p>
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
              onClick={() => router.push('/kalender')}
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
              {speichert ? 'Wird geplant …' : 'Serie planen'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}