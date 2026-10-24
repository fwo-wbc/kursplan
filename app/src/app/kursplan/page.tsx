'use client';

// ---------------------------------------------------------------------------
// /kursplan – Planungsansicht (Ablösung der Excel-Planungstabellen)
//
// - Bereichs-Auswahl (MS-Office, MS365, SQL, werner-sql-lo-office)
// - Zeitraum-Auswahl (von/bis, Standard: heute bis Ende Planungsjahr)
// - Tabelle der geplanten Termine je Bereich mit 3-Fach-Belegung (Prio 1–3)
// - Anlagen/Bearbeiten/Löschen von Terminen (API /api/kursplan)
// - Batch-Transfer markierter Termine an B01 (/api/kursplan/batch-transfer)
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';

interface KursplanTermin {
  id: number;
  planungsbereich: string;
  datum: string;
  beginn: string;
  prio: number;
  topic_id: number;
  thema: string;
  kurs_code: string | null;
  kategorie_name: string | null;
  hinweis: string | null;
  freigabe: boolean;
  sync_status: string;
  edoobox_offer_id: string | null;
}

interface CourseTopic {
  id: number;
  name: string;
  kurs_code: string | null;
  planungsbereich: string | null;
  prioritaet: number | null;
}

const BEREICHE = ['MS-Office', 'MS365', 'SQL', 'werner-sql-lo-office'];

const PRIO_LABEL: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3' };
const PRIO_FARBE: Record<number, string> = {
  1: 'bg-red-100 text-red-700 border-red-200',
  2: 'bg-amber-100 text-amber-700 border-amber-200',
  3: 'bg-blue-100 text-blue-700 border-blue-200',
};
const STATUS_LABEL: Record<string, string> = {
  offen: 'Offen',
  uebertragen: 'Übertragen',
  fehler: 'Fehler',
};
const STATUS_FARBE: Record<string, string> = {
  offen: 'bg-slate-100 text-slate-600',
  uebertragen: 'bg-green-100 text-green-700',
  fehler: 'bg-red-100 text-red-700',
};

function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const tag = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${tag}`;
}

function jahresendeISO(): string {
  return `${new Date().getFullYear()}-12-31`;
}

export default function KursplanPage() {
  const [bereich, setBereich] = useState<string>('MS-Office');
  const [von, setVon] = useState<string>(todayISO());
  const [bis, setBis] = useState<string>(jahresendeISO());
  const [termine, setTermine] = useState<KursplanTermin[]>([]);
  const [topics, setTopics] = useState<CourseTopic[]>([]);
  const [loading, setLoading] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  // Formular (Anlegen/Bearbeiten)
  const [showForm, setShowForm] = useState(false);
  const [bearbeiteId, setBearbeiteId] = useState<number | null>(null);
  const [form, setForm] = useState({
    datum: todayISO(),
    beginn: '09:00',
    topic_id: '',
    prio: '1',
    hinweis: '',
  });

  // Batch-Auswahl
  const [auswahl, setAuswahl] = useState<Set<number>>(new Set());
  const [transferLaeuft, setTransferLaeuft] = useState(false);

  const laden = useCallback(async () => {
    setLoading(true);
    setFehler(null);
    try {
      const url = `/api/kursplan?planungsbereich=${encodeURIComponent(bereich)}&von=${von}&bis=${bis}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: KursplanTermin[] = await res.json();
      setTermine(data);
      // Nicht mehr vorhandene Termine aus der Auswahl entfernen.
      setAuswahl((prev) => {
        const ids = new Set(data.map((t) => t.id));
        return new Set([...prev].filter((id) => ids.has(id)));
      });
    } catch (err) {
      setFehler(`Termine konnten nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [bereich, von, bis]);

  const ladenThemen = useCallback(async () => {
    try {
      const res = await fetch('/api/course-topics?includeInactive=1');
      if (!res.ok) return;
      const data: CourseTopic[] = await res.json();
      setTopics(data);
    } catch {
      // Themen sind optional – die Tabelle funktioniert auch ohne Filter.
    }
  }, []);

  useEffect(() => {
    void laden();
  }, [laden]);

  useEffect(() => {
    void ladenThemen();
  }, [ladenThemen]);

  const themenImBereich = useMemo(
    () =>
      topics.filter(
        (t) =>
          t.planungsbereich === bereich &&
          t.kurs_code &&
          t.prioritaet !== null
      ),
    [topics, bereich]
  );

  // -------------------------------------------------------------------------
  // Termin anlegen / aktualisieren
  // -------------------------------------------------------------------------
  const formAbsenden = async (e: React.FormEvent) => {
    e.preventDefault();
    setFehler(null);
    setMeldung(null);
    const topicId = Number(form.topic_id);
    if (!Number.isInteger(topicId) || topicId <= 0) {
      setFehler('Bitte ein Thema auswählen.');
      return;
    }
    const prio = Number(form.prio);
    const body = {
      planungsbereich: bereich,
      datum: form.datum,
      beginn: form.beginn,
      topic_id: topicId,
      prio,
      hinweis: form.hinweis || null,
    };
    const url = bearbeiteId ? `/api/kursplan/${bearbeiteId}` : '/api/kursplan';
    const method = bearbeiteId ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFehler(
          (data as { error?: string }).error ?? `Fehler (${res.status}) beim Speichern.`
        );
        return;
      }
      setShowForm(false);
      setBearbeiteId(null);
      setForm({ datum: todayISO(), beginn: '09:00', topic_id: '', prio: '1', hinweis: '' });
      setMeldung(bearbeiteId ? 'Termin aktualisiert.' : 'Termin angelegt.');
      await laden();
    } catch (err) {
      setFehler(`Speichern fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const editieren = (t: KursplanTermin) => {
    setBearbeiteId(t.id);
    setForm({
      datum: t.datum,
      beginn: t.beginn.slice(0, 5),
      topic_id: String(t.topic_id),
      prio: String(t.prio),
      hinweis: t.hinweis ?? '',
    });
    setShowForm(true);
    setFehler(null);
  };

  const loeschen = async (id: number) => {
    if (!window.confirm('Diesen Termin wirklich löschen?')) return;
    try {
      const res = await fetch(`/api/kursplan/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMeldung('Termin gelöscht.');
      await laden();
    } catch (err) {
      setFehler(`Löschen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const abbrechen = () => {
    setShowForm(false);
    setBearbeiteId(null);
    setForm({ datum: todayISO(), beginn: '09:00', topic_id: '', prio: '1', hinweis: '' });
    setFehler(null);
  };

  // -------------------------------------------------------------------------
  // Batch-Transfer an B01
  // -------------------------------------------------------------------------
  const batchTransfer = async () => {
    const ids = [...auswahl];
    if (ids.length === 0) {
      setFehler('Bitte mindestens einen Termin markieren.');
      return;
    }
    setTransferLaeuft(true);
    setFehler(null);
    setMeldung(null);
    try {
      const res = await fetch('/api/kursplan/batch-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFehler(
          (data as { error?: string }).error ??
            `Transfer fehlgeschlagen (${res.status}).`
        );
        return;
      }
      const d = data as { anzahl?: number; fehlend?: number[] };
      setMeldung(
        `${d.anzahl ?? 0} Termin(e) an edoobox übertragen.` +
          (d.fehlend && d.fehlend.length ? ` ${d.fehlend.length} übersprungen (unvollständig).` : '')
      );
      setAuswahl(new Set());
      await laden();
    } catch (err) {
      setFehler(`Transfer fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTransferLaeuft(false);
    }
  };

  const toggleAuswahl = (id: number) => {
    setAuswahl((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">Kursplanung</h1>
        <p className="text-sm text-slate-500">
          Planungstermine je Bereich – Ablösung der Excel-Planungstabellen.
        </p>
      </header>

      {/* Filterleiste */}
      <div className="flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-xl p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600 font-medium">Bereich</span>
          <select
            value={bereich}
            onChange={(e) => setBereich(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          >
            {BEREICHE.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600 font-medium">Von</span>
          <input
            type="date"
            value={von}
            onChange={(e) => setVon(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600 font-medium">Bis</span>
          <input
            type="date"
            value={bis}
            onChange={(e) => setBis(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => void laden()}
          className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium"
        >
          Aktualisieren
        </button>
        <div className="flex-1" />
        <button
          onClick={() => {
            setBearbeiteId(null);
            setForm({ datum: todayISO(), beginn: '09:00', topic_id: '', prio: '1', hinweis: '' });
            setShowForm(true);
            setFehler(null);
          }}
          className="bg-cd-blue hover:bg-cd-blue/90 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
        >
          + Termin anlegen
        </button>
      </div>

      {fehler && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {fehler}
        </div>
      )}
      {meldung && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
          {meldung}
        </div>
      )}

      {/* Anlage-/Bearbeitungsformular */}
      {showForm && (
        <form
          onSubmit={(e) => void formAbsenden(e)}
          className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
        >
          <h2 className="font-semibold text-slate-800">
            {bearbeiteId ? 'Termin bearbeiten' : 'Neuen Termin anlegen'}
            {bearbeiteId ? ` (ID ${bearbeiteId})` : ` – Bereich ${bereich}`}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600">Datum</span>
              <input
                type="date"
                required
                value={form.datum}
                onChange={(e) => setForm({ ...form, datum: e.target.value })}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600">Beginn</span>
              <input
                type="time"
                required
                value={form.beginn}
                onChange={(e) => setForm({ ...form, beginn: e.target.value })}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600">Priorität</span>
              <select
                value={form.prio}
                onChange={(e) => setForm({ ...form, prio: e.target.value })}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="1">1 (Hauptkurs)</option>
                <option value="2">2</option>
                <option value="3">3 (Zusatzkurs)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span className="text-slate-600">Thema</span>
              <select
                required
                value={form.topic_id}
                onChange={(e) => setForm({ ...form, topic_id: e.target.value })}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">– Thema wählen –</option>
                {themenImBereich
                  .slice()
                  .sort((a, b) => (a.prioritaet ?? 9) - (b.prioritaet ?? 9) || a.name.localeCompare(b.name))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.kurs_code} · {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-3">
              <span className="text-slate-600">Hinweis</span>
              <input
                type="text"
                value={form.hinweis}
                onChange={(e) => setForm({ ...form, hinweis: e.target.value })}
                placeholder="Optional"
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="bg-cd-blue hover:bg-cd-blue/90 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Speichern
            </button>
            <button
              type="button"
              onClick={abbrechen}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {/* Batch-Transfer-Leiste */}
      {auswahl.size > 0 && (
        <div className="flex items-center gap-3 bg-cd-blue/5 border border-cd-blue/30 rounded-xl px-4 py-3">
          <span className="text-sm text-slate-700 font-medium">
            {auswahl.size} Termin(e) markiert
          </span>
          <div className="flex-1" />
          <button
            onClick={() => void batchTransfer()}
            disabled={transferLaeuft}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {transferLaeuft ? 'Transfer läuft…' : 'An edoobox übertragen (B01)'}
          </button>
          <button
            onClick={() => setAuswahl(new Set())}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm"
          >
            Auswahl aufheben
          </button>
        </div>
      )}

      {/* Termintabelle */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium"> </th>
              <th className="px-3 py-2 font-medium">Datum</th>
              <th className="px-3 py-2 font-medium">Beginn</th>
              <th className="px-3 py-2 font-medium">Prio</th>
              <th className="px-3 py-2 font-medium">Thema</th>
              <th className="px-3 py-2 font-medium">Hinweis</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  Lade Termine…
                </td>
              </tr>
            ) : termine.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  Keine Termine im gewählten Zeitraum. Lege einen neuen Termin an.
                </td>
              </tr>
            ) : (
              termine.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={auswahl.has(t.id)}
                      onChange={() => toggleAuswahl(t.id)}
                      disabled={t.sync_status === 'uebertragen'}
                      title={
                        t.sync_status === 'uebertragen'
                          ? 'Bereits übertragen'
                          : 'Für Batch-Transfer markieren'
                      }
                      className="accent-cd-blue"
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-800">{t.datum}</td>
                  <td className="px-3 py-2 text-slate-600">{t.beginn}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium border ${PRIO_FARBE[t.prio] ?? ''}`}
                    >
                      {PRIO_LABEL[t.prio] ?? t.prio}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-slate-800 font-medium">{t.thema}</div>
                    {t.kurs_code && (
                      <div className="text-xs text-slate-400">{t.kurs_code}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{t.hinweis ?? ''}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_FARBE[t.sync_status] ?? 'bg-slate-100 text-slate-600'}`}
                    >
                      {STATUS_LABEL[t.sync_status] ?? t.sync_status}
                    </span>
                    {t.edoobox_offer_id && (
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {t.edoobox_offer_id}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      onClick={() => editieren(t)}
                      className="text-cd-blue hover:underline mr-2"
                    >
                      Bearbeiten
                    </button>
                    <button
                      onClick={() => void loeschen(t.id)}
                      className="text-red-600 hover:underline"
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}