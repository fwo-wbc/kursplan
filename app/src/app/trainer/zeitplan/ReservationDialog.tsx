'use client';

// ---------------------------------------------------------------------------
// ReservationDialog: Modal zur Verwaltung einer Sammel-Reservierung.
//
// Funktionalität:
//  * Frei editierbares Themenfeld (gemeinsames Stammfeld aller Termine).
//  * Beim Öffnen werden ALLE Termine mit demselben reservation_code nachgeladen
//    (GET /api/reservations/by-code/[code]) und als Tabelle dargestellt
//    (Datum, Uhrzeit, Trainer, Status).
//  * Einzeltermine: inline bearbeiten (PUT /api/reservations/[id]) und mit
//    Bestätigung entfernen (DELETE /api/reservations/[id]).
//  * "Weiteren Termin hinzufügen" legt einen neuen Termin unter demselben
//    reservation_code an (POST /api/reservations/by-code/[code]/item bzw.
//    für Neuanlagen POST /api/reservierung mit termine-Liste).
//  * Gemeinsame Felder (KD-Nr./Kunde, Thema, Fristende) werden über
//    PUT /api/reservations/by-code/[code] synchron für ALLE Termine gesetzt.
//  * Auffälliger roter Lösch-Button für den GESAMTEN Code (Footer) mit
//    Sicherheitsabfrage (DELETE /api/reservations/by-code/[code]).
//  * Ausklappbares Änderungsprotokoll (reservation_logs) je Code.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { slotZeit } from '@/lib/umwandlung';

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

/** Reservierungs-Datensatz, wie er von der Zeitplan-Zelle übergeben wird. */
export interface ReservierungEintrag {
  id: number;
  reservation_code: string | null;
  slot_code: string;
  kd_nr: string;
  thema: string;
  frist_ende: string;
  status: string;
  notiz: string | null;
}

/** Ein Termin des Codes, wie ihn GET /api/reservations/by-code liefert. */
interface CodeTermin {
  id: number;
  thema: string | null;
  kunde: string;
  frist: string;
  trainer: string | null;
  datum: string;
  slot_code: string;
  status: string;
  notiz: string | null;
}

/** Protokolleintrag aus public.reservation_logs. */
interface ReservierungLog {
  id: number;
  reservation_code: string;
  reservation_id: number | null;
  action: string;
  changed_fields: unknown;
  details: string | null;
  created_at: string;
}

/** Zeile in der dynamischen Terminliste des Dialogs. */
interface DialogTermin {
  /** null = neue Zeile, noch nicht persistiert. */
  id: number | null;
  datum: string;
  slot_code: string;
  status: string;
  trainer: string | null;
}

/** Props der Komponente. */
export interface ReservationDialogProps {
  open: boolean;
  /** Die angeklickte Reservierung oder null bei Neuanlage. */
  editingRes: ReservierungEintrag | null;
  /** Ausgangsdatum der geöffneten Zelle. */
  datum: string;
  /** Ausgangs-Slot der geöffneten Zelle. */
  slot: string;
  /** ID des aktuell ausgewählten Trainers (string, wie im Zeitplan-State). */
  trainerId: string;
  /** Anzeigename des Trainers, z. B. "Max Mustermann (KUERZEL)". */
  trainerLabel: string;
  onClose: () => void;
  /** Wird nach erfolgreichem Speichern/Löschen aufgerufen (lädt Zeitplan neu). */
  onSaved: () => void;
}

// ---------------------------------------------------------------------------
// Konstanten & Helfer
// ---------------------------------------------------------------------------

const SLOT_OPTIONEN = [
  { value: 'KT1', label: 'KT1 – Vormittag (09–13 Uhr)' },
  { value: 'KT2', label: 'KT2 – Nachmittag (13–17 Uhr)' },
  { value: 'KT3', label: 'KT3 – Abend (17–21 Uhr)' },
  { value: 'ganztags', label: 'Ganztags' },
];

const STATUS_OPTIONEN = [
  { value: 'angeboten', label: 'angeboten' },
  { value: 'bestaetigt', label: 'bestätigt' },
];

const WOCHENTAG_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Formatiert ein ISO-Datum (YYYY-MM-DD) als "Do, 19.11.26". */
function formatDatumDisplay(datum: string): string {
  const d = new Date(`${datum}T00:00:00`);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${WOCHENTAG_KURZ[d.getDay()]}, ${dd}.${mm}.${yy}`;
}

/** Nächster Tag (YYYY-MM-DD) eines ISO-Datums. */
function naechsterTag(datum: string): string {
  const d = new Date(`${datum}T00:00:00`);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${t}`;
}

/** Formatiert created_at (ISO-String) als "TT.MM.JJJJ HH:MM". */
function formatZeitstempel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()} ${hh}:${min}`;
}

/** Extrahiert einen JSON-freundlichen Text aus changed_fields für die Anzeige. */
function changedFieldsText(fields: unknown): string {
  if (fields == null) return '–';
  try {
    const obj =
      typeof fields === 'string' ? (JSON.parse(fields) as unknown) : fields;
    if (obj && typeof obj === 'object') {
      const teile = Object.entries(obj as Record<string, unknown>).map(
        ([key, wert]) => {
          if (wert && typeof wert === 'object') {
            const w = wert as Record<string, unknown>;
            return `${key}: ${String(w.vorher ?? '∅')} → ${String(w.nachher ?? '∅')}`;
          }
          return `${key}: ${String(wert)}`;
        }
      );
      return teile.join('; ');
    }
    return String(obj);
  } catch {
    return String(fields);
  }
}

/** Übersetzt eine Log-Action in ein deutsches Label. */
function actionLabel(action: string): string {
  switch (action) {
    case 'CREATED':
      return 'Angelegt';
    case 'UPDATED':
      return 'Aktualisiert';
    case 'DELETED':
      return 'Gelöscht';
    case 'APPOINTMENT_ADDED':
      return 'Termin hinzugefügt';
    default:
      return action;
  }
}

/** Entfernt den Dozenten-Namen und liefert nur das Kürzel (Fallback: ganze Zeile). */
function trainerKurz(label: string | null): string {
  if (!label) return '–';
  const m = /\(([^)]+)\)$/.exec(label.trim());
  return m ? m[1] : label.trim();
}

/** Zeilen-Schlüssel für die Terminliste (stabil über Render-Durchläufe). */
function zeilenKey(t: DialogTermin): string {
  return t.id === null ? `neu_${t.datum}_${t.slot_code}` : `id_${t.id}`;
}

// ---------------------------------------------------------------------------
// Komponente
// ---------------------------------------------------------------------------

export default function ReservationDialog({
  open,
  editingRes,
  datum,
  slot,
  trainerId,
  trainerLabel,
  onClose,
  onSaved,
}: ReservationDialogProps) {
  // Aktiver Sammel-Code (null = Neuanlage bzw. Einzeltermin ohne Code).
  const [reservationCode, setReservationCode] = useState<string | null>(null);

  // Gemeinsame Stammfelder (gelten synchron für alle Termine des Codes).
  const [kdNr, setKdNr] = useState('');
  const [thema, setThema] = useState('');
  const [fristEnde, setFristEnde] = useState('');
  const [notiz, setNotiz] = useState('');

  // Dynamische Terminliste (bestehende + neu hinzugefügte Zeilen).
  const [termine, setTermine] = useState<DialogTermin[]>([]);

  // Bereits per Bestätigung aus der Liste entfernte, aber noch nicht
  // persistierte Löschungen (werden beim Speichern per DELETE versendet).
  const [geloeschteIds, setGeloeschteIds] = useState<number[]>([]);

  // Audit-Log des Codes.
  const [logs, setLogs] = useState<ReservierungLog[]>([]);
  const [zeigeLogs, setZeigeLogs] = useState(false);

  // Lokaler Bearbeitungsmodus pro Zeile.
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editDatum, setEditDatum] = useState('');
  const [editSlot, setEditSlot] = useState('KT1');
  const [editStatus, setEditStatus] = useState('angeboten');

  // Bestätigungsdialoge.
  const [loescheCodeBestatigt, setLoescheCodeBestatigt] = useState(false);
  const [einzelLoeschId, setEinzelLoeschId] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Laden beim Öffnen: alle Termine des reservation_code nachladen.
  // -------------------------------------------------------------------------
  const lade = useCallback(async () => {
    setError(null);
    setLogs([]);
    setZeigeLogs(false);
    setLoescheCodeBestatigt(false);
    setEinzelLoeschId(null);
    setGeloeschteIds([]);
    setEditKey(null);

    if (!editingRes) {
      // Neuanlage: ein leeres Terminfeld, noch kein Code.
      setReservationCode(null);
      setKdNr('');
      setThema('');
      setFristEnde('');
      setNotiz('');
      setTermine([
        {
          id: null,
          datum,
          slot_code: slot,
          status: 'angeboten',
          trainer: trainerLabel,
        },
      ]);
      setLoading(false);
      return;
    }

    const code = editingRes.reservation_code;
    setReservationCode(code);

    if (!code) {
      // Einzeltermin ohne Sammel-Code (Altbestand): nur dieser Termin.
      setKdNr(editingRes.kd_nr);
      setThema(editingRes.thema);
      setFristEnde(editingRes.frist_ende);
      setNotiz(editingRes.notiz ?? '');
      setTermine([
        {
          id: editingRes.id,
          datum,
          slot_code: editingRes.slot_code,
          status: editingRes.status,
          trainer: trainerLabel,
        },
      ]);
      setLoading(false);
      return;
    }

    // Code vorhanden: Gruppe nachladen (Termine + Audit-Log).
    setLoading(true);
    try {
      const res = await fetch(
        `/api/reservations/by-code/${encodeURIComponent(code)}`
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          data?.error ? String(data.error) : 'Sammel-Reservierung konnte nicht geladen werden.'
        );
      }
      const data = (await res.json()) as {
        reservierungen: CodeTermin[];
        logs: ReservierungLog[];
      };
      const erster = data.reservierungen[0];
      setKdNr(erster?.kunde ?? editingRes.kd_nr);
      setThema(erster?.thema ?? editingRes.thema);
      setFristEnde(erster?.frist ?? editingRes.frist_ende);
      setNotiz(erster?.notiz ?? editingRes.notiz ?? '');
      setTermine(
        data.reservierungen.map((t) => ({
          id: t.id,
          datum: t.datum,
          slot_code: t.slot_code,
          status: t.status,
          trainer: t.trainer,
        }))
      );
      setLogs(data.logs ?? []);
    } catch (err: unknown) {
      console.error('Fehler beim Laden der Sammel-Reservierung:', err);
      setError(
        err instanceof Error ? err.message : 'Sammel-Reservierung konnte nicht geladen werden.'
      );
      setTermine([]);
    } finally {
      setLoading(false);
    }
  }, [editingRes, datum, slot, trainerLabel]);

  useEffect(() => {
    if (open) {
      void lade();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingRes]);

  // -------------------------------------------------------------------------
  // Terminliste: hinzufügen / editieren / entfernen
  // -------------------------------------------------------------------------

  function addTermin() {
    setTermine((prev) => {
      const letzter = prev[prev.length - 1];
      return [
        ...prev,
        {
          id: null,
          datum: letzter ? naechsterTag(letzter.datum) : datum,
          slot_code: letzter?.slot_code ?? 'KT1',
          status: 'angeboten',
          trainer: trainerLabel,
        },
      ];
    });
  }

  function updateNeuZeile(key: string, patch: Partial<DialogTermin>) {
    setTermine((prev) =>
      prev.map((t) => (zeilenKey(t) === key ? { ...t, ...patch } : t))
    );
  }

  function removeNeuZeile(key: string) {
    setTermine((prev) => prev.filter((t) => zeilenKey(t) !== key));
  }

  /** Startet den Inline-Edit einer bestehenden Zeile. */
  function startEdit(t: DialogTermin) {
    setEditKey(zeilenKey(t));
    setEditDatum(t.datum);
    setEditSlot(t.slot_code);
    setEditStatus(t.status);
  }

  /** Übernimmt die Inline-Werte in die Zeile und beendet den Edit. */
  function confirmEdit(key: string) {
    setTermine((prev) =>
      prev.map((t) =>
        zeilenKey(t) === key
          ? { ...t, datum: editDatum, slot_code: editSlot, status: editStatus }
          : t
      )
    );
    setEditKey(null);
  }

  /** Entfernt einen bestehenden Termin (nach Bestätigung) aus der Liste und
   *  merkt sich die ID für das spätere DELETE beim Speichern. */
  function confirmRemoveEinzel() {
    if (einzelLoeschId === null) return;
    setGeloeschteIds((prev) => [...prev, einzelLoeschId]);
    setTermine((prev) => prev.filter((t) => t.id !== einzelLoeschId));
    setEinzelLoeschId(null);
  }

  // -------------------------------------------------------------------------
  // Speichern
  // -------------------------------------------------------------------------

  async function saveReservation() {
    if (!kdNr.trim() || !thema.trim() || !fristEnde) {
      setError('Bitte KD-Nr., Thema und Fristende ausfüllen.');
      return;
    }
    if (termine.length === 0) {
      setError('Bitte mindestens einen Termin angeben.');
      return;
    }
    if (termine.some((t) => !t.datum || !t.slot_code)) {
      setError('Bitte für jeden Termin Datum und Slot ausfüllen.');
      return;
    }

    setSaving(true);
    setError(null);

    const stamm = {
      trainer_id: Number(trainerId),
      kd_nr: kdNr.trim(),
      thema: thema.trim(),
      frist_ende: fristEnde,
      notiz: notiz.trim() || null,
    };

    try {
      if (!reservationCode) {
        // -------------------------------------------------------------
        // Neuanlage (oder Einzeltermin ohne Code): POST /api/reservierung
        // -------------------------------------------------------------
        if (editingRes && !editingRes.reservation_code) {
          // Altbestand ohne Code: Einzeltermin aktualisieren (PUT).
          const termin = termine[0];
          const res = await fetch('/api/reservierung', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...stamm,
              id: editingRes.id,
              datum: termin.datum,
              slot_code: termin.slot_code,
              status: termin.status,
            }),
          });
          if (!res.ok) {
            const errData = (await res.json().catch(() => null)) as {
              error?: unknown;
            } | null;
            throw new Error(
              errData?.error ? String(errData.error) : 'Speichern fehlgeschlagen.'
            );
          }
        } else if (termine.length === 1) {
          const termin = termine[0];
          const res = await fetch('/api/reservierung', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...stamm,
              datum: termin.datum,
              slot_code: termin.slot_code,
              status: termin.status,
            }),
          });
          if (!res.ok) {
            const errData = (await res.json().catch(() => null)) as {
              error?: unknown;
            } | null;
            throw new Error(
              errData?.error ? String(errData.error) : 'Speichern fehlgeschlagen.'
            );
          }
        } else {
          const res = await fetch('/api/reservierung', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...stamm,
              termine: termine.map((t) => ({
                datum: t.datum,
                slot_code: t.slot_code,
              })),
            }),
          });
          if (!res.ok) {
            const errData = (await res.json().catch(() => null)) as {
              error?: unknown;
            } | null;
            throw new Error(
              errData?.error ? String(errData.error) : 'Speichern fehlgeschlagen.'
            );
          }
        }
      } else {
        // -------------------------------------------------------------
        // Bestehender Code
        // -------------------------------------------------------------

        // 1) Gemeinsame Felder (KD-Nr., Thema, Fristende) synchron für ALLE
        //    Termine des Codes aktualisieren.
        const gemRes = await fetch(
          `/api/reservations/by-code/${encodeURIComponent(reservationCode)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              frist: fristEnde,
              thema: thema.trim(),
              kunde: kdNr.trim(),
            }),
          }
        );
        if (!gemRes.ok) {
          const errData = (await gemRes.json().catch(() => null)) as {
            error?: unknown;
          } | null;
          throw new Error(
            errData?.error
              ? String(errData.error)
              : 'Gemeinsame Felder konnten nicht gespeichert werden.'
          );
        }

        // 2) Vorher bestätigte Einzel-Löschungen per DELETE persistieren.
        for (const id of geloeschteIds) {
          const res = await fetch(`/api/reservations/${id}`, {
            method: 'DELETE',
          });
          if (!res.ok) {
            const errData = (await res.json().catch(() => null)) as {
              error?: unknown;
            } | null;
            throw new Error(
              errData?.error ? String(errData.error) : 'Termin konnte nicht entfernt werden.'
            );
          }
        }

        // 3) Bestehende Termine (alle, inkl. Edits) per PUT aktualisieren.
        for (const t of termine) {
          if (t.id === null) continue;
          const res = await fetch(`/api/reservations/${t.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              datum: t.datum,
              slot_code: t.slot_code,
              status: t.status,
            }),
          });
          if (!res.ok) {
            const errData = (await res.json().catch(() => null)) as {
              error?: unknown;
            } | null;
            throw new Error(
              errData?.error
                ? String(errData.error)
                : 'Termin konnte nicht aktualisiert werden.'
            );
          }
        }

        // 4) Neue Zeilen (id === null) per item-POST ergänzen.
        for (const t of termine) {
          if (t.id !== null) continue;
          const res = await fetch(
            `/api/reservations/by-code/${encodeURIComponent(reservationCode)}/item`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                datum: t.datum,
                slot_code: t.slot_code,
                status: t.status,
              }),
            }
          );
          if (!res.ok) {
            const errData = (await res.json().catch(() => null)) as {
              error?: unknown;
            } | null;
            throw new Error(
              errData?.error
                ? String(errData.error)
                : 'Neuer Termin konnte nicht angelegt werden.'
            );
          }
        }
      }

      onSaved();
      onClose();
    } catch (err: unknown) {
      console.error('Fehler beim Speichern der Sammel-Reservierung:', err);
      setError(
        err instanceof Error ? err.message : 'Speichern fehlgeschlagen.'
      );
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Gesamten Code löschen (roter Footer-Button)
  // -------------------------------------------------------------------------

  async function loescheCode() {
    if (!reservationCode) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/reservations/by-code/${encodeURIComponent(reservationCode)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          errData?.error ? String(errData.error) : 'Löschen fehlgeschlagen.'
        );
      }
      setLoescheCodeBestatigt(false);
      onSaved();
      onClose();
    } catch (err: unknown) {
      console.error('Fehler beim Löschen der Sammel-Reservierung:', err);
      setError(
        err instanceof Error ? err.message : 'Löschen fehlgeschlagen.'
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Reservierung bearbeiten"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-2xl border border-slate-200 p-5">
        {/* Kopfbereich */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Pencil className="w-4 h-4 text-cd-blue" />
              {editingRes ? 'Sammel-Reservierung bearbeiten' : 'Neue Reservierung'}
            </h2>
            {reservationCode && (
              <p className="mt-1 text-[11px] font-mono text-slate-500">
                Reservierungscode:{' '}
                <span className="font-semibold text-slate-700">{reservationCode}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-lg p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-cd-blue" />
            Termine der Sammel-Reservierung werden geladen…
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {/* Trainerauswahl */}
            <div className="mb-4">
              <label className="text-xs font-semibold text-slate-500 block mb-1">
                Trainer
              </label>
              <div className="w-full text-sm font-medium text-slate-700 px-2.5 py-2">
                {trainerLabel || '–'}
              </div>
            </div>

            {/* Terminliste des Codes */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500">
                  Termine ({termine.length})
                </label>
                <button
                  type="button"
                  onClick={addTermin}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition disabled:opacity-60"
                >
                  <Plus className="w-3 h-3" />
                  Weiteren Termin hinzufügen
                </button>
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2 font-semibold">Datum</th>
                      <th className="px-3 py-2 font-semibold">Uhrzeit</th>
                      <th className="px-3 py-2 font-semibold">Trainer</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold text-right">Aktionen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {termine.map((t) => {
                      const key = zeilenKey(t);
                      const editierbar = editKey === key && t.id !== null;
                      const neu = t.id === null;
                      const slotInfo = slotZeit(t.slot_code);
                      return (
                        <tr
                          key={key}
                          className={neu ? 'bg-blue-50/60 align-middle' : 'bg-white align-middle'}
                        >
                          <td className="px-3 py-1.5">
                            {editierbar ? (
                              <input
                                type="date"
                                value={editDatum}
                                onChange={(e) => setEditDatum(e.target.value)}
                                className="w-full text-sm border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            ) : neu ? (
                              <input
                                type="date"
                                value={t.datum}
                                onChange={(e) =>
                                  updateNeuZeile(key, { datum: e.target.value })
                                }
                                className="w-full text-sm border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            ) : (
                              <span className="font-medium text-slate-700">
                                {formatDatumDisplay(t.datum)}
                              </span>
                            )}
                          </td>

                          <td className="px-3 py-1.5">
                            {editierbar ? (
                              <select
                                value={editSlot}
                                onChange={(e) => setEditSlot(e.target.value)}
                                className="w-full text-sm border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                {SLOT_OPTIONEN.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            ) : neu ? (
                              <select
                                value={t.slot_code}
                                onChange={(e) =>
                                  updateNeuZeile(key, { slot_code: e.target.value })
                                }
                                className="w-full text-sm border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                {SLOT_OPTIONEN.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-slate-600">
                                {slotInfo.von}–{slotInfo.bis} Uhr
                              </span>
                            )}
                          </td>

                          <td className="px-3 py-1.5 text-slate-600">
                            {trainerKurz(t.trainer)}
                          </td>

                          <td className="px-3 py-1.5">
                            {editierbar ? (
                              <select
                                value={editStatus}
                                onChange={(e) => setEditStatus(e.target.value)}
                                className="w-full text-sm border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                {STATUS_OPTIONEN.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                  t.status === 'bestaetigt'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {t.status === 'bestaetigt' ? 'bestätigt' : 'angeboten'}
                              </span>
                            )}
                          </td>

                          <td className="px-3 py-1.5">
                            <div className="flex items-center justify-end gap-1">
                              {editierbar ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => confirmEdit(key)}
                                    className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 transition"
                                  >
                                    OK
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditKey(null)}
                                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 transition"
                                  >
                                    Abbruch
                                  </button>
                                </>
                              ) : neu ? (
                                <button
                                  type="button"
                                  onClick={() => removeNeuZeile(key)}
                                  title="Neuen Termin verwerfen"
                                  aria-label="Neuen Termin verwerfen"
                                  className="shrink-0 rounded-md border border-slate-300 px-1.5 py-1 text-slate-400 hover:border-red-300 hover:text-red-600 transition"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startEdit(t)}
                                    title="Termin bearbeiten"
                                    aria-label="Termin bearbeiten"
                                    className="shrink-0 rounded-md border border-slate-300 px-1.5 py-1 text-slate-500 hover:bg-slate-100 transition"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEinzelLoeschId(t.id)}
                                    title="Termin entfernen"
                                    aria-label="Termin entfernen"
                                    className="shrink-0 rounded-md border border-slate-300 px-1.5 py-1 text-slate-400 hover:border-red-300 hover:text-red-600 transition"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {termine.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-400">
                          Keine Termine vorhanden. Über den Button oben einen
                          Termin hinzufügen.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {reservationCode && termine.length > 1 && (
                <p className="mt-1 text-[10px] text-slate-400">
                  Geänderte Einzeltermine werden beim Speichern per PUT
                  aktualisiert; neu hinzugefügte Zeilen per POST ergänzt.
                </p>
              )}
            </div>

            {/* Stammfelder (gelten für alle Termine des Codes) */}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-slate-500 block mb-1">
                  Kunde*
                </label>
                <input
                  value={kdNr}
                  onChange={(e) => setKdNr(e.target.value)}
                  placeholder="KD-10482"
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">
                  Thema*
                </label>
                <input
                  value={thema}
                  onChange={(e) => setThema(e.target.value)}
                  placeholder="Excel Grundlagen"
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">
                  Reservierungsfrist*
                </label>
                <input
                  type="date"
                  value={fristEnde}
                  onChange={(e) => setFristEnde(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-slate-500 block mb-1">
                  Bemerkung
                </label>
                <input
                  value={notiz}
                  onChange={(e) => setNotiz(e.target.value)}
                  placeholder="optional"
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
            </div>

            {/* Änderungsprotokoll (Audit-Log) */}
            <div className="mt-4 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setZeigeLogs((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <span className="flex items-center gap-2">
                  <History className="w-4 h-4 text-cd-blue" />
                  Änderungsprotokoll
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    {logs.length}
                  </span>
                </span>
                {zeigeLogs ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {zeigeLogs && (
                <div className="max-h-56 overflow-y-auto border-t border-slate-100 px-3 py-2">
                  {logs.length === 0 ? (
                    <p className="py-3 text-center text-sm text-slate-400">
                      Für diesen Reservierungscode sind noch keine
                      Protokoll-Einträge vorhanden.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {logs.map((l) => (
                        <li
                          key={l.id}
                          className="flex items-start gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs"
                        >
                          <div className="shrink-0">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${
                                l.action === 'DELETED'
                                  ? 'bg-red-100 text-red-700'
                                  : l.action === 'CREATED'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : l.action === 'APPOINTMENT_ADDED'
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              {actionLabel(l.action)}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-slate-500">
                              {formatZeitstempel(l.created_at)}
                            </div>
                            {l.details && (
                              <div className="mt-0.5 text-slate-600">
                                {l.details}
                              </div>
                            )}
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              Geändert: {changedFieldsText(l.changed_fields)}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Bestätigung: Einzeltermin entfernen */}
            {einzelLoeschId !== null && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="mb-2 text-sm text-amber-900">
                  Soll der ausgewählte Termin wirklich aus diesem
                  Reservierungscode entfernt werden?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={confirmRemoveEinzel}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition"
                  >
                    Ja, Termin entfernen
                  </button>
                  <button
                    type="button"
                    onClick={() => setEinzelLoeschId(null)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 transition"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            )}

            {/* Bestätigung: gesamten Code löschen */}
            {loescheCodeBestatigt && reservationCode && (
              <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3">
                <p className="mb-2 text-sm text-red-900">
                  Möchtest du wirklich alle {termine.length} Termine des
                  Reservierungscodes{' '}
                  <span className="font-mono font-semibold">{reservationCode}</span>{' '}
                  unwiderruflich löschen?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void loescheCode()}
                    disabled={saving}
                    className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 transition disabled:opacity-60"
                  >
                    {saving ? 'Wird gelöscht…' : 'Ja, komplette Reservierung löschen'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoescheCodeBestatigt(false)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 transition"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
          {reservationCode && (
            <button
              type="button"
              onClick={() => setLoescheCodeBestatigt(true)}
              disabled={saving}
              className="mr-auto inline-flex items-center gap-1.5 rounded-lg bg-[#6D1717] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#5A1212] transition disabled:opacity-60"
            >
              <Trash2 className="w-4 h-4" />
              Reservierung löschen
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-black hover:bg-slate-50 transition disabled:opacity-60"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => void saveReservation()}
            disabled={saving || loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#285DAA] text-white text-sm font-medium hover:bg-[#1E4A87] transition disabled:opacity-60"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}