'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// ---------------------------------------------------------------------------
// Konflikt-Dashboard (Szenario 1, L-05 Serienplaner)
//
// Split-Screen:
//   links  – Liste der Konflikt-Tage (GET /api/course-events/conflicts)
//   rechts – Detailkarten der Kurse des ausgewählten Tages.
//
// Pro Karte stehen zwei Lösungswege bereit:
//   – Trainer-Neuzuweisung (Drop down über GET /api/trainer)
//   – Termin-Verschiebung (Date-Picker, 1,5-Stunden-Slots)
// Beide münden in PATCH /api/course-events/[id]/resolve; nach Erfolg wird der
// Termin lokal aus dem State entfernt (Card verschwindet), danach ggf. der Tag.
// ---------------------------------------------------------------------------

interface KonfliktTermin {
  id: number;
  course_id: number | null;
  topic_id: number | null;
  topic_name: string | null;
  trainer_id: number | null;
  trainer_kuerzel: string | null;
  trainer_name: string | null;
  start_time: string;
  end_time: string | null;
}

interface Konflikttag {
  datum: string;
  anzahl: number;
  termine: KonfliktTermin[];
}

interface TrainerOption {
  id: number;
  vorname: string;
  nachname: string;
  kuerzel: string | null;
}

/** Formatiert "YYYY-MM-DD" als lesbares deutsches Datum. */
function formatDatum(datum: string): string {
  const d = new Date(`${datum}T00:00:00`);
  if (Number.isNaN(d.getTime())) return datum;
  return d.toLocaleDateString('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Formatiert einen ISO-Zeitstempel in Berliner Lokalzeit. */
function formatUhrzeit(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Eine einzelne Konflikt-Karte mit Trainer-Dropdown und Date-Picker. */
function KonfliktKarte({
  termin,
  trainerOptionen,
  aufLoesen,
  wirdGeloest,
}: {
  termin: KonfliktTermin;
  trainerOptionen: TrainerOption[];
  aufLoesen: (id: number, body: { new_trainer_id?: number; new_start_time?: string }) => Promise<void>;
  wirdGeloest: boolean;
}) {
  const [gewaehlterTrainer, setGewaehlterTrainer] = useState('');
  const [gewaehlteZeit, setGewaehlteZeit] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);

  const trainerGewaehlt = gewaehlterTrainer !== '';
  const zeitGewaehlt = gewaehlteZeit !== '';
  const kannLoesen = (trainerGewaehlt || zeitGewaehlt) && !wirdGeloest;

  async function loesen() {
    setFehler(null);
    try {
      if (trainerGewaehlt) {
        await aufLoesen(termin.id, { new_trainer_id: Number(gewaehlterTrainer) });
      } else if (zeitGewaehlt) {
        await aufLoesen(termin.id, { new_start_time: gewaehlteZeit });
      }
    } catch (err: unknown) {
      setFehler(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <article className="border border-slate-200 rounded-xl bg-white shadow-sm p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">
            {termin.topic_name ?? 'Thema unbekannt'}
          </h3>
          <p className="text-sm text-slate-500">
            Kurs-ID: {termin.course_id ?? '–'} · Termin-ID: {termin.id}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
          Konflikt
        </span>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="text-slate-500">Termin</dt>
          <dd className="font-medium text-slate-800">
            {formatUhrzeit(termin.start_time)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Trainer</dt>
          <dd className="font-medium text-slate-800">
            {termin.trainer_name ?? termin.trainer_kuerzel ?? 'n. v.'}
          </dd>
        </div>
      </dl>

      <div className="border-t border-slate-100 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Trainer neu zuweisen</span>
          <select
            value={gewaehlterTrainer}
            onChange={(e) => {
              setGewaehlterTrainer(e.target.value);
              if (e.target.value !== '') setGewaehlteZeit('');
            }}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-300"
          >
            <option value="">– Trainer wählen –</option>
            {trainerOptionen.map((t) => (
              <option key={t.id} value={t.id}>
                {t.kuerzel ?? `${t.vorname} ${t.nachname}`.trim()}
                {t.kuerzel ? ` (${t.vorname} ${t.nachname})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Termin verschieben</span>
          <input
            type="datetime-local"
            step={900}
            value={gewaehlteZeit}
            onChange={(e) => {
              setGewaehlteZeit(e.target.value);
              if (e.target.value !== '') setGewaehlterTrainer('');
            }}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-300"
          />
        </label>
      </div>

      {fehler && <p className="text-sm text-red-600">{fehler}</p>}

      <button
        type="button"
        onClick={loesen}
        disabled={!kannLoesen}
        className="self-end rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {wirdGeloest ? 'Wird gelöst …' : 'Konflikt lösen'}
      </button>
    </article>
  );
}

export default function KonfliktePage() {
  const [tage, setTage] = useState<Konflikttag[] | null>(null);
  const [ausgewaehltesDatum, setAusgewaehltesDatum] = useState<string | null>(null);
  const [trainer, setTrainer] = useState<TrainerOption[]>([]);
  const [ladeFehler, setLadeFehler] = useState<string | null>(null);
  const [loesendId, setLoesendId] = useState<number | null>(null);
  const [erfolgsMeldung, setErfolgsMeldung] = useState<string | null>(null);

  const laden = useCallback(async () => {
    setLadeFehler(null);
    try {
      const [konfliktRes, trainerRes] = await Promise.all([
        fetch('/api/course-events/conflicts', { cache: 'no-store' }),
        fetch('/api/trainer', { cache: 'no-store' }),
      ]);
      if (!konfliktRes.ok) throw new Error(`Konflikt-Endpunkt antwortet mit HTTP ${konfliktRes.status}.`);
      if (!trainerRes.ok) throw new Error(`Trainer-Endpunkt antwortet mit HTTP ${trainerRes.status}.`);

      const konflikte = (await konfliktRes.json()) as Konflikttag[];
      const trainerDaten = (await trainerRes.json()) as TrainerOption[];

      setTage(konflikte);
      setTrainer(trainerDaten);
      setAusgewaehltesDatum((aktuell) => {
        if (aktuell) {
          // Auswahl beibehalten, falls der Tag noch existiert.
          return konflikte.some((t) => t.datum === aktuell) ? aktuell : (konflikte[0]?.datum ?? null);
        }
        return konflikte[0]?.datum ?? null;
      });
    } catch (err: unknown) {
      setLadeFehler(err instanceof Error ? err.message : String(err));
      setTage([]);
    }
  }, []);

  useEffect(() => {
    void laden();
  }, [laden]);

  const aktuellerTag = useMemo(
    () => tage?.find((t) => t.datum === ausgewaehltesDatum) ?? null,
    [tage, ausgewaehltesDatum]
  );

  /** PATCH an die Resolve-Route; entfernt die gelöste Card lokal aus dem State. */
  async function loeseKonflikt(
    id: number,
    body: { new_trainer_id?: number; new_start_time?: string }
  ) {
    setErfolgsMeldung(null);
    setLoesendId(id);
    try {
      const res = await fetch(`/api/course-events/${id}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Konflikt konnte nicht gelöst werden (HTTP ${res.status}).`);
      }

      // Lokales Entfernen: Card verschwindet, geleerte Tage werden gelöscht.
      setTage((aktuell) => {
        if (!aktuell) return aktuell;
        const bereinigt = aktuell
          .map((tag) => ({
            ...tag,
            termine: tag.termine.filter((t) => t.id !== id),
            anzahl: tag.termine.filter((t) => t.id !== id).length,
          }))
          .filter((tag) => tag.termine.length > 0);
        setAusgewaehltesDatum((aktuellesDatum) => {
          if (aktuellesDatum && !bereinigt.some((t) => t.datum === aktuellesDatum)) {
            return bereinigt[0]?.datum ?? null;
          }
          return aktuellesDatum;
        });
        return bereinigt;
      });
      setErfolgsMeldung('Konflikt erfolgreich aufgelöst – Termin aus dem Dashboard entfernt.');
    } finally {
      setLoesendId(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Konflikt-Dashboard</h1>
        <p className="text-sm text-slate-600">
          Serienplanung (Szenario 1) · Tage mit drei oder mehr gleichzeitig geplanten Kursen
        </p>
      </header>

      {ladeFehler && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {ladeFehler}
        </div>
      )}

      {erfolgsMeldung && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {erfolgsMeldung}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
        {/* Links: Konflikt-Tage */}
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Konflikt-Tage
          </h2>
          {tage === null ? (
            <p className="text-sm text-slate-400">Lade Konflikte …</p>
          ) : tage.length === 0 ? (
            <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
              Keine offenen Konflikte – alle Termine sauber geplant.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tage.map((tag) => {
                const aktiv = tag.datum === ausgewaehltesDatum;
                return (
                  <li key={tag.datum}>
                    <button
                      type="button"
                      onClick={() => setAusgewaehltesDatum(tag.datum)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                        aktiv
                          ? 'border-red-300 bg-red-50 text-red-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="font-medium">{formatDatum(tag.datum)}</span>
                      <span
                        className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white"
                        title={`${tag.anzahl} betroffene Kurse`}
                      >
                        {tag.anzahl}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Rechts: Detailansicht des ausgewählten Tages */}
        <section className="min-w-0">
          {aktuellerTag ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">
                  {formatDatum(aktuellerTag.datum)}
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {aktuellerTag.anzahl} {aktuellerTag.anzahl === 1 ? 'Kurs' : 'Kurse'}
                  </span>
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {aktuellerTag.termine.map((termin) => (
                  <KonfliktKarte
                    key={termin.id}
                    termin={termin}
                    trainerOptionen={trainer}
                    aufLoesen={loeseKonflikt}
                    wirdGeloest={loesendId === termin.id}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-sm text-slate-400">
              {tage && tage.length > 0
                ? 'Bitte links einen Konflikt-Tag auswählen.'
                : 'Kein Tag ausgewählt.'}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
