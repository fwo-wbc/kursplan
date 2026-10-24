'use client';

import { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Zwischenplanung (Sandbox) – Kurstransfer-Board
//
//   Oben  : Button "Neuen Entwurf generieren" → POST /api/planung/drafts
//           (Regel-Engine schreibt Termine in public.planning_drafts).
//   Mitte : Tabellarische Übersicht der Entwürfe (GET /api/planung/drafts).
//           Pro Zeile ist das Datum per Date-Picker manuell korrigierbar und
//           der Status per Dropdown änderbar (PATCH /api/planung/drafts/[id]).
//   Unten : Button "Planung abschließen" → POST /api/planung/abschliessen
//           (übernimmt genehmigte Entwürfe in public.course_events; der
//           edoobox-Transfer P90 wird später hier angedockt).
// ---------------------------------------------------------------------------

interface Entwurf {
  id: number;
  module_id: number;
  modul_name: string;
  modul_position: number;
  modul_prio: number;
  modul_takt: number;
  trainer_id: number | null;
  trainer_kuerzel: string | null;
  trainer_vorname: string | null;
  trainer_nachname: string | null;
  proposed_date: string; // YYYY-MM-DD
  status: 'draft' | 'conflict' | 'approved';
  created_at: string;
  updated_at: string;
}

interface Regelpruefung {
  status: 'draft' | 'conflict' | 'approved';
  warnungen: string[];
}

const STATUS_LABELS: Record<Entwurf['status'], string> = {
  draft: 'Entwurf',
  conflict: 'Konflikt',
  approved: 'Genehmigt',
};

const STATUS_FARBEN: Record<Entwurf['status'], string> = {
  draft: 'bg-slate-100 text-slate-700',
  conflict: 'bg-red-100 text-red-700',
  approved: 'bg-green-100 text-green-700',
};

/** Formatiert "YYYY-MM-DD" als deutsches Datum. */
function formatDatum(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function SandboxPage() {
  const [entwuerfe, setEntwuerfe] = useState<Entwurf[]>([]);
  const [ladeFehler, setLadeFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [generiert, setGeneriert] = useState(false);
  const [abgeschlossen, setAbgeschlossen] = useState(false);
  const [warnungen, setWarnungen] = useState<Record<number, string[]>>({});

  async function ladeEntwuerfe() {
    try {
      const res = await fetch('/api/planung/drafts');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
      setEntwuerfe(body.entwuerfe ?? []);
      setLadeFehler(null);
    } catch (err) {
      setLadeFehler(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void ladeEntwuerfe();
  }, []);

  /** Generiert neue Entwürfe über die Regel-Engine. */
  async function generieren() {
    setMeldung(null);
    setGeneriert(true);
    try {
      const res = await fetch('/api/planung/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMeldung(
        `${body.generiert ?? 0} Entwurf/-würfe generiert. Konflikte bitte manuell prüfen.`
      );
      await ladeEntwuerfe();
    } catch (err) {
      setMeldung(`Fehler beim Generieren: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGeneriert(false);
    }
  }

  /** Speichert eine manuelle Korrektur (Datum und/oder Status). */
  async function korrigieren(entwurf: Entwurf, neuesDatum: string, neuerStatus: string) {
    setMeldung(null);
    try {
      const res = await fetch(`/api/planung/drafts/${entwurf.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposed_date: neuesDatum, status: neuerStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      if (body.regelpruefung) {
        const rp: Regelpruefung = body.regelpruefung;
        setWarnungen((prev) => ({ ...prev, [entwurf.id]: rp.warnungen }));
      }
      setMeldung(`Entwurf ${entwurf.id} gespeichert.`);
      await ladeEntwuerfe();
    } catch (err) {
      setMeldung(`Fehler beim Speichern: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Schließt die Planung ab (genehmigte Entwürfe → course_events). */
  async function abschliessen() {
    setMeldung(null);
    setAbgeschlossen(true);
    try {
      const res = await fetch('/api/planung/abschliessen', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMeldung(
        `${body.uebernommen ?? 0} genehmigte Entwürfe in die Kursplanung übernommen.`
      );
    } catch (err) {
      setMeldung(`Fehler beim Abschließen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAbgeschlossen(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Zwischenplanung (Sandbox)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Kursentwürfe werden von der Regel-Engine generiert und können hier manuell
          nachkorrigiert werden, bevor sie in die Kursplanung übernommen werden.
        </p>
      </header>

      {ladeFehler && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {ladeFehler}
        </div>
      )}

      {meldung && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {meldung}
        </div>
      )}

      {/* Oben: Generieren */}
      <section className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={generieren}
          disabled={generiert}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {generiert ? 'Generiere …' : 'Neuen Entwurf generieren'}
        </button>
        <span className="text-xs text-slate-400">
          Die Regel-Engine prüft Blocker-Tage, Wochentags-Rotation, Modul-Abhängigkeiten
          und Prio-Konflikte.
        </span>
      </section>

      {/* Mitte: Tabellarische Übersicht */}
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Modul</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Prio</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Trainer</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Vorgeschlagenes Datum</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Hinweise</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entwuerfe.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Noch keine Entwürfe vorhanden. Klicken Sie auf „Neuen Entwurf generieren“.
                </td>
              </tr>
            )}
            {entwuerfe.map((e) => (
              <tr key={e.id} className={e.status === 'conflict' ? 'bg-red-50/40' : undefined}>
                <td className="px-3 py-2">
                  <span className="font-medium text-slate-900">{e.modul_name}</span>
                  <span className="block text-xs text-slate-400">
                    Pos. {e.modul_position} · Takt {e.modul_takt} Wo.
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${e.modul_prio === 1 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                    Prio {e.modul_prio}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {e.trainer_kuerzel
                    ? `${e.trainer_kuerzel}${e.trainer_nachname ? ` · ${e.trainer_nachname}` : ''}`
                    : '–'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={e.proposed_date}
                      onChange={(ev) => void korrigieren(e, ev.target.value, e.status)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                    <span className="text-xs text-slate-400">{formatDatum(e.proposed_date)}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={e.status}
                    onChange={(ev) => void korrigieren(e, e.proposed_date, ev.target.value)}
                    className={`rounded-md border border-slate-300 px-2 py-1 text-sm ${STATUS_FARBEN[e.status]}`}
                  >
                    <option value="draft">Entwurf</option>
                    <option value="conflict">Konflikt</option>
                    <option value="approved">Genehmigt</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  {(warnungen[e.id] ?? []).length > 0 ? (
                    <ul className="list-disc pl-3 text-xs text-amber-700">
                      {(warnungen[e.id] ?? []).map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-slate-400">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Unten: Abschließen */}
      <section className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={abschliessen}
          disabled={abgeschlossen}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
        >
          {abgeschlossen ? 'Schließe ab …' : 'Planung abschließen'}
        </button>
        <span className="text-xs text-slate-400">
          Übernimmt genehmigte Entwürfe in die Kursplanung (course_events). Der
          edoobox-Transfer (P90) wird später hier angedockt.
        </span>
      </section>
    </main>
  );
}