'use client';

// ---------------------------------------------------------------------------
// ReservierungsGruppeDialog: zentrale, wiederverwendbare Komponente für ALLE
// Reservierungs-Dialoge der Kursplan-App (public.trainer_reservierung, Welt B).
//
// Basis: der funktionierende Inline-Dialog der Trainerverfügbarkeits-Seite
// (app/src/app/trainer/verfuegbarkeit/page.tsx). Er wird hier vollständig
// ausgelagert und über Props gesteuert – ein gemeinsamer Dialog für:
//   * Trainerverfügbarkeiten (app/src/app/trainer/verfuegbarkeit/page.tsx)
//   * Reservierungen / Kursplanung (app/src/app/reservierungen/page.tsx)
//
// Modi (ableitbar aus den Props):
//   1. Neuanlage:            gruppeCode === null, editRes === null
//      – über initiale Werte (Trainer, Datum, Zeitfenster) vorbefüllt
//   2. Gruppen-Bearbeitung:  gruppeCode !== null
//      – lädt ALLE Termine des Codes (GET /api/trainer/reservierung?gruppe_code=…)
//        und speichert Stammfelder per Sammel-Update (PUT mit gruppe_code),
//        Einzeltermine per id (PUT/DELETE), neue Zeilen per POST (mit Code)
//   3. Einzeltermin-Bearbeitung: gruppeCode === null, editRes gesetzt
//      – Altbestand ohne Gruppencode: vorbefüllter Einzeltermin (PUT per id)
//
// Der rote Footer-Button „Reservierung löschen“ (Gruppen-Löschung) ist nur im
// Gruppen-Modus sichtbar und löscht nach Rückfrage ALLE Datensätze des Codes
// (DELETE /api/trainer/reservierung?gruppe_code=…).
//
// Nach erfolgreichem Speichern/Löschen werden onSuccess() (Re-Fetch der
// aufrufenden Seite) und danach onClose() aufgerufen – ohne Browser-Reload.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Trash2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

/** Eine Terminzeile innerhalb des Dialogs (Datum + Uhrzeitfenster). */
interface TerminZeile {
  datum: string;
  start: string;
  ende: string;
  /** DB-ID eines BESTEHENDEN Termins (null = neue Zeile). */
  id: number | null;
}

/** Trainer-Stammdaten aus GET /api/trainer (für die Dozenten-Auswahl). */
interface Trainer {
  id: number;
  vorname: string;
  nachname: string;
  kuerzel: string | null;
}

/**
 * Minimaldatensatz einer Trainer-Reservierung, wie ihn die API liefert.
 * Wird für den Einzeltermin-Bearbeiten-Modus (Altbestand ohne Gruppencode)
 * als editRes übergeben.
 */
export interface ReservierungRow {
  id: number;
  trainer_id: number;
  datum: string;
  start_time: string;
  end_time: string;
  kunde: string;
  bemerkung: string | null;
  thema: string | null;
  kd_nr: string | null;
  frist_ende: string | null;
  gruppe_code: string | null;
}

/** Props der Komponente. */
export interface ReservierungsGruppeDialogProps {
  /** true, solange das Modal sichtbar ist. */
  isOpen: boolean;
  /**
   * Reservierungs-Gruppencode (z. B. "RES-7K2PQ"). null = Neuanlage bzw.
   * Einzeltermin-Bearbeitung (editRes). Gesetzt = Gruppen-Bearbeitung, die
   * ALLE Termine des Codes lädt.
   */
  gruppeCode: string | null;
  /** Schließt den Dialog ohne Aktion (X / Abbrechen / nach Erfolg). */
  onClose: () => void;
  /** Wird nach erfolgreichem Speichern/Löschen aufgerufen – die aufrufende
   *  Seite triggert darüber ihren Daten-Re-Fetch. */
  onSuccess: () => void;
  // ----------------- Optional: Neuanlage -----------------
  /** Vorausgewählte Trainer-ID (string) für die Neuanlage. */
  initialTrainerId?: string;
  /** Start-Datum (YYYY-MM-DD) der ersten Terminzeile bei Neuanlage. */
  initialDatum?: string;
  /** Startzeit (HH:MM) der ersten Terminzeile bei Neuanlage. */
  initialStart?: string;
  /** Endzeit (HH:MM) der ersten Terminzeile bei Neuanlage. */
  initialEnde?: string;
  // ----------------- Optional: Einzeltermin ohne Gruppencode -----------------
  /** Einzeltermin zum Bearbeiten (Altbestand ohne gruppe_code). */
  editRes?: ReservierungRow | null;
}

// ---------------------------------------------------------------------------
// Konstanten & Helfer
// ---------------------------------------------------------------------------

/** Wochentags-Kürzel mit Punkt, passend zu Date.getUTCDay() (0=So … 6=Sa). */
const WOCHENTAGE_KURZ = [
  'So.',
  'Mo.',
  'Di.',
  'Mi.',
  'Do.',
  'Fr.',
  'Sa.',
];

/** Formatiert ein ISO-Datum (YYYY-MM-DD) als "Di. 10.11.2026". */
function formatDatum(datum: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return datum;
  const [y, m, t] = datum.split('-');
  const wochentag =
    WOCHENTAGE_KURZ[
      new Date(Date.UTC(Number(y), Number(m) - 1, Number(t))).getUTCDay()
    ];
  return `${wochentag} ${t}.${m}.${y}`;
}

/** Heutiges Datum als YYYY-MM-DD (lokal, ohne UTC-Versatz). */
function heuteIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${t}`;
}

/** Anzeige-Label eines Trainers: "Vorname Nachname (Kürzel)". */
function trainerLabel(trainer: Trainer): string {
  const name =
    `${trainer.vorname ?? ''} ${trainer.nachname ?? ''}`.trim() ||
    `Trainer #${trainer.id}`;
  return trainer.kuerzel ? `${name} (${trainer.kuerzel})` : name;
}

// ---------------------------------------------------------------------------
// Komponente
// ---------------------------------------------------------------------------

export default function ReservierungsGruppeDialog({
  isOpen,
  gruppeCode,
  onClose,
  onSuccess,
  initialTrainerId = '',
  initialDatum,
  initialStart = '09:00',
  initialEnde = '13:00',
  editRes = null,
}: ReservierungsGruppeDialogProps) {
  // Dynamische Terminliste (bestehende + neu hinzugefügte Zeilen).
  const [termine, setTermine] = useState<TerminZeile[]>([]);

  // Gemeinsame Stammfelder (gelten synchron für alle Termine des Codes).
  const [kunde, setKunde] = useState('');
  const [thema, setThema] = useState('');
  const [kdNr, setKdNr] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [fristEnde, setFristEnde] = useState('');

  // Trainer (string-ID, wie im Seiten-State der Verfügbarkeits-Seite).
  const [trainerId, setTrainerId] = useState<string>('');

  // Trainer-Stammdaten für die Dozenten-Auswahl (GET /api/trainer).
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [trainerLaden, setTrainerLaden] = useState(false);

  // Ursprüngliche Trainer-ID beim Öffnen – Vergleichsbasis für die
  // Sicherheitsabfrage beim Trainerwechsel.
  const [initialTrainerIdState, setInitialTrainerIdState] = useState<string>('');

  // true, solange die Termine des Gruppencodes geladen werden.
  const [gruppenLaden, setGruppenLaden] = useState(false);
  // true, solange die Löschung des gesamten Gruppencodes läuft.
  const [loeschtGruppe, setLoeschtGruppe] = useState(false);

  // Bereits aus der Liste entfernte, aber noch nicht persistierte
  // Löschungen (werden beim Speichern per DELETE versendet).
  const [entfernteTerminIds, setEntfernteTerminIds] = useState<number[]>([]);

  const [fehler, setFehler] = useState('');
  const [speichert, setSpeichert] = useState(false);

  // -------------------------------------------------------------------------
  // Laden beim Öffnen + Re-Initialisierung je Modus
  // -------------------------------------------------------------------------

  /** Lädt ALLE Termine eines Gruppencodes (GET ?gruppe_code=…) und ersetzt
   *  die Terminliste vollständig. Stammfelder werden vom ersten Datensatz
   *  übernommen. Fehler werden sichtbar gemeldet. */
  const ladeGruppenTermine = useCallback(async (code: string) => {
    setGruppenLaden(true);
    setFehler('');
    try {
      const res = await fetch(
        `/api/trainer/reservierung?gruppe_code=${encodeURIComponent(code)}`
      );
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          errData?.error
            ? String(errData.error)
            : `Gruppencode ${code} konnte nicht geladen werden.`
        );
      }
      const data = (await res.json()) as {
        reservierungen?: ReservierungRow[];
      };
      const liste = data?.reservierungen ?? [];
      if (liste.length === 0) {
        throw new Error(
          `Keine Termine für Gruppencode ${code} gefunden (trainer_reservierung).`
        );
      }

      // Erstes Element liefert die Sammel-Stammdaten des Codes.
      const stamm = liste[0];
      setKunde(stamm.kunde ?? '');
      setThema(stamm.thema ?? '');
      setKdNr(stamm.kd_nr ?? '');
      setBemerkung(stamm.bemerkung ?? '');
      setFristEnde(stamm.frist_ende ?? '');
      setTrainerId(String(stamm.trainer_id));
      setInitialTrainerIdState(String(stamm.trainer_id));

      // Alle Termine nach Datum, dann Startzeit sortiert in die lokale Liste
      // übernehmen – in public.trainer_reservierung gibt es keine Slot-Codes.
      const geladen: TerminZeile[] = [...liste]
        .sort(
          (a, b) =>
            a.datum.localeCompare(b.datum) ||
            a.start_time.localeCompare(b.start_time)
        )
        .map((t) => ({
          datum: t.datum,
          start: t.start_time,
          ende: t.end_time,
          id: t.id,
        }));
      setTermine(geladen);
      setEntfernteTerminIds([]);
    } catch (err: unknown) {
      console.error('Fehler beim Laden der Reservierungsgruppe:', err);
      setFehler(
        err instanceof Error
          ? err.message
          : 'Fehler beim Laden der Reservierungsgruppe.'
      );
    } finally {
      setGruppenLaden(false);
    }
  }, []);

  /** Vorbefüllt den Dialog für einen Einzeltermin ohne Gruppencode (editRes). */
  const initialisiereEinzeltermin = useCallback((res: ReservierungRow) => {
    setTrainerId(String(res.trainer_id));
    setInitialTrainerIdState(String(res.trainer_id));
    setTermine([
      {
        datum: res.datum,
        start: res.start_time,
        ende: res.end_time,
        id: res.id,
      },
    ]);
    setKunde(res.kunde);
    setThema(res.thema ?? '');
    setKdNr(res.kd_nr ?? '');
    setBemerkung(res.bemerkung ?? '');
    setFristEnde(res.frist_ende ?? '');
    setEntfernteTerminIds([]);
    setFehler('');
  }, []);

  /** Initialisiert die Neuanlage (gruppeCode === null, editRes === null). */
  const initialisiereNeuanlage = useCallback(() => {
    setTrainerId(initialTrainerId);
    setInitialTrainerIdState(initialTrainerId);
    setTermine([
      { datum: initialDatum || heuteIso(), start: initialStart, ende: initialEnde, id: null },
    ]);
    setKunde('');
    setThema('');
    setKdNr('');
    setBemerkung('');
    setFristEnde('');
    setEntfernteTerminIds([]);
    setFehler('');
  }, [initialTrainerId, initialDatum, initialStart, initialEnde]);

  useEffect(() => {
    if (!isOpen) return;
    // Grundzustand je Öffnen zurücksetzen.
    setFehler('');
    setSpeichert(false);
    setLoeschtGruppe(false);
    setEntfernteTerminIds([]);

    if (gruppeCode) {
      // Modi 2: Gruppen-Bearbeitung – alle Termine des Codes laden.
      setTermine([]);
      void ladeGruppenTermine(gruppeCode);
    } else if (editRes) {
      // Modi 3: Einzeltermin ohne Gruppencode bearbeiten.
      initialisiereEinzeltermin(editRes);
    } else {
      // Modi 1: Neuanlage.
      initialisiereNeuanlage();
    }
  }, [isOpen, gruppeCode, editRes, ladeGruppenTermine, initialisiereEinzeltermin, initialisiereNeuanlage]);

  // Trainer-Stammdaten für die Dozenten-Auswahl laden (einmalig beim Öffnen).
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setTrainerLaden(true);
    (async () => {
      try {
        const res = await fetch('/api/trainer');
        if (!res.ok) throw new Error('Trainer konnten nicht geladen werden.');
        const liste = (await res.json()) as Trainer[];
        if (active) setTrainers(liste);
      } catch {
        // Trainer-Liste bleibt leer – das Dropdown zeigt dann nur den
        // aktuellen Trainer der Gruppe.
      } finally {
        if (active) setTrainerLaden(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isOpen]);

  // Modal barrierefrei schließen: ESC-Taste.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // -------------------------------------------------------------------------
  // Terminliste: hinzufügen / entfernen / editieren
  // -------------------------------------------------------------------------

  function fuegeZeileHinzu() {
    setTermine((prev) => {
      const letzte = prev[prev.length - 1];
      const naechstesDatum = letzte?.datum ? letzte.datum : heuteIso();
      const d = new Date(`${naechstesDatum}T00:00:00`);
      if (!Number.isNaN(d.getTime())) {
        d.setDate(d.getDate() + 1);
      }
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const t = String(d.getDate()).padStart(2, '0');
      return [
        ...prev,
        {
          datum: Number.isNaN(d.getTime())
            ? naechstesDatum
            : `${y}-${m}-${t}`,
          start: letzte?.start ?? '09:00',
          ende: letzte?.ende ?? '13:00',
          id: null,
        },
      ];
    });
    setFehler('');
  }

  function entferneZeile(index: number) {
    const zuEntfernen = termine[index];
    if (zuEntfernen?.id != null) {
      setEntfernteTerminIds((prev) =>
        prev.includes(Number(zuEntfernen.id))
          ? prev
          : [...prev, Number(zuEntfernen.id)]
      );
    }
    setTermine((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)
    );
  }

  function aktualisiereZeile(index: number, patch: Partial<TerminZeile>) {
    setTermine((prev) =>
      prev.map((t, i) => (i === index ? { ...t, ...patch } : t))
    );
  }

  // -------------------------------------------------------------------------
  // Speichern (alle drei Modi – Logik identisch zum Referenz-Dialog)
  // -------------------------------------------------------------------------

  async function speichern() {
    if (!trainerId) {
      setFehler('Bitte einen Trainer auswählen.');
      return;
    }
    if (termine.length === 0) {
      setFehler('Bitte mindestens einen Termin angeben.');
      return;
    }
    if (termine.some((t) => !t.datum || !t.start || !t.ende)) {
      setFehler('Bitte für jeden Termin Datum und Uhrzeit (von/bis) ausfüllen.');
      return;
    }

    // Sicherheitsabfrage beim Trainerwechsel: Wenn sich die Trainer-ID
    // gegenüber dem Öffnen des Dialogs geändert hat, explizit bestätigen
    // lassen. Bricht der Nutzer ab, wird nicht gespeichert.
    if (trainerId !== initialTrainerIdState) {
      const bestaetigt = window.confirm(
        'Sind Sie sicher, dass Sie den Trainer für diese Reservierung(en) wechseln möchten?'
      );
      if (!bestaetigt) return;
    }

    setSpeichert(true);
    setFehler('');
    try {
      const trainerIdNummer = Number(trainerId);

      // ------------------------------------------------------------------ //
      // Gruppen-Bearbeitung (gruppe_code gesetzt): public.trainer_reservierung
      // ------------------------------------------------------------------ //
      if (gruppeCode) {
        // 1) Stammfelder (kunde, bemerkung, frist_ende) für ALLE Datensätze
        //    des Codes aktualisieren (Sammel-Update in der API).
        const stammRes = await fetch('/api/trainer/reservierung', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gruppe_code: gruppeCode,
            // Trainerwechsel: überschreibt trainer_id für ALLE Termine der
            // Gruppe (Sammel-Update in der API).
            trainer_id: trainerIdNummer,
            kunde: kunde.trim(),
            thema: thema.trim() || null,
            kd_nr: kdNr.trim() || null,
            bemerkung: bemerkung || null,
            frist_ende: fristEnde || null,
          }),
        });
        if (!stammRes.ok) {
          const fehl = (await stammRes.json().catch(() => null)) as {
            error?: unknown;
          } | null;
          throw new Error(
            fehl?.error
              ? String(fehl.error)
              : 'Stammdaten der Gruppe konnten nicht gespeichert werden.'
          );
        }

        // 2) Aus der Gruppe entfernte Termine unwiderruflich löschen.
        for (const id of entfernteTerminIds) {
          const loeschRes = await fetch(
            `/api/trainer/reservierung?id=${encodeURIComponent(String(id))}`,
            { method: 'DELETE' }
          );
          if (!loeschRes.ok) {
            throw new Error(
              'Mindestens ein entfernter Termin konnte nicht gelöscht werden.'
            );
          }
        }

        // 3) Vorhandene Termine aktualisieren (id != null) bzw. neue Termine
        //    mit identischem Gruppencode anlegen (id == null).
        for (const termin of termine) {
          const grundDaten = {
            trainer_id: trainerIdNummer,
            datum: termin.datum,
            start_time: termin.start,
            end_time: termin.ende,
            kunde: kunde.trim(),
            thema: thema.trim() || null,
            kd_nr: kdNr.trim() || null,
            bemerkung: bemerkung || null,
            frist_ende: fristEnde || null,
          };
          const terminRes =
            termin.id != null
              ? await fetch(
                  `/api/trainer/reservierung?id=${encodeURIComponent(String(termin.id))}`,
                  {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(grundDaten),
                  }
                )
              : await fetch('/api/trainer/reservierung', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ...grundDaten,
                    gruppe_code: gruppeCode,
                  }),
                });
          if (!terminRes.ok) {
            const fehl = (await terminRes.json().catch(() => null)) as {
              error?: unknown;
            } | null;
            throw new Error(
              fehl?.error
                ? String(fehl.error)
                : 'Ein Termin der Gruppe konnte nicht gespeichert werden.'
            );
          }
        }

        onSuccess();
        onClose();
        return;
      }

      // ------------------------------------------------------------------ //
      // Einzeltermin-Bearbeitung ohne Gruppencode (Altbestand) – PUT per id
      // ------------------------------------------------------------------ //
      const istEinzelBearbeiten = editRes !== null && editRes !== undefined;
      const url = istEinzelBearbeiten
        ? `/api/trainer/reservierung?id=${encodeURIComponent(String(editRes.id))}`
        : '/api/trainer/reservierung';

      const res = await fetch(url, {
        method: istEinzelBearbeiten ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          istEinzelBearbeiten
            ? {
                trainer_id: trainerIdNummer,
                datum: termine[0]?.datum,
                start_time: termine[0]?.start,
                end_time: termine[0]?.ende,
                kunde: kunde.trim(),
                thema: thema.trim() || null,
                kd_nr: kdNr.trim() || null,
                bemerkung: bemerkung || null,
                frist_ende: fristEnde || null,
              }
            : {
                trainer_id: trainerIdNummer,
                kunde: kunde.trim(),
                thema: thema.trim() || null,
                kd_nr: kdNr.trim() || null,
                bemerkung: bemerkung || null,
                frist_ende: fristEnde || null,
                // Neuanlage ohne übergebenen Code: der Server erzeugt einen
                // neuen Gruppencode (POST generiert automatisch RES-XXXXX).
                gruppe_code: null,
                termine: termine.map((t) => ({
                  datum: t.datum,
                  start_time: t.start,
                  end_time: t.ende,
                })),
              }
        ),
      });

      if (!res.ok) {
        // Fehlermeldung der API sauber im Dialog anzeigen (z. B. 409-Kollision).
        const data = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          data?.error ? String(data.error) : res.statusText || 'Unbekannter Fehler'
        );
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      console.error('Fehler beim Speichern der Reservierung:', err);
      setFehler(
        err instanceof Error ? err.message : 'Unbekannter Fehler beim Speichern.'
      );
    } finally {
      setSpeichert(false);
    }
  }

  // -------------------------------------------------------------------------
  // Gesamten Code löschen (roter Footer-Button mit Rückfrage; nur Gruppe)
  // -------------------------------------------------------------------------

  async function loescheGruppe() {
    if (!gruppeCode) return;
    const bestaetigt = window.confirm(
      `Möchtest du wirklich alle Termine des Reservierungscodes ${gruppeCode} unwiderruflich löschen?`
    );
    if (!bestaetigt) return;

    setLoeschtGruppe(true);
    setFehler('');
    try {
      const res = await fetch(
        `/api/trainer/reservierung?gruppe_code=${encodeURIComponent(gruppeCode)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const fehl = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          fehl?.error
            ? String(fehl.error)
            : 'Löschen der Reservierungsgruppe fehlgeschlagen.'
        );
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      console.error('Fehler beim Löschen der Reservierungsgruppe:', err);
      setFehler(
        err instanceof Error ? err.message : 'Löschen der Reservierungsgruppe fehlgeschlagen.'
      );
    } finally {
      setLoeschtGruppe(false);
    }
  }

  if (!isOpen) return null;

  // Titel je Modus (identisch zum Referenz-Dialog der Verfügbarkeits-Seite).
  const istBearbeiten = gruppeCode !== null || editRes !== null;
  const istGruppe = gruppeCode !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reservierung-gruppe-titel"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Kopfbereich */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2
              id="reservierung-gruppe-titel"
              className="text-lg font-bold text-slate-800"
            >
              {istBearbeiten ? 'Reservierung bearbeiten' : 'Reservierung anlegen'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {istGruppe ? (
                <>
                  Alle Termine der Reservierungsgruppe{' '}
                  <span className="font-mono font-semibold text-slate-700">
                    {gruppeCode}
                  </span>{' '}
                  – Stammfelder gelten für alle Termine gemeinsam.
                </>
              ) : (
                'Unverbindliche Reservierung für eine Firmenanfrage – noch kein Kurs in edoobox.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-lg p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
          >
            ✕
          </button>
        </div>

        {gruppenLaden ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-cd-blue" />
            Termine der Reservierungsgruppe werden geladen…
          </div>
        ) : (
          <div className="max-h-[65vh] space-y-3 overflow-y-auto">
            {/* Trainer-Auswahl: editierbar – ein Wechsel wird beim Speichern
                per Sicherheitsabfrage bestätigt und überschreibt trainer_id
                für ALLE Termine der Gruppe. */}
            <div>
              <label
                htmlFor="res-trainer"
                className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
              >
                Trainer
              </label>
              <select
                id="res-trainer"
                value={trainerId}
                onChange={(e) => setTrainerId(e.target.value)}
                disabled={speichert || gruppenLaden}
                className="w-full text-sm font-medium border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
              >
                {trainerLaden ? (
                  <option value="">Lade Dozenten…</option>
                ) : trainers.length === 0 ? (
                  <option value={trainerId}>Trainer #{trainerId}</option>
                ) : (
                  trainers.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {trainerLabel(t)}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Dynamische Terminliste: jede Zeile = Datum + Zeitfenster.
                Alle Zeilen werden mit demselben gruppe_code angelegt. Im
                Bearbeiten-Modus einer Gruppe werden ALLE Termine des Codes
                angezeigt und jeder Termin ist editierbar. */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">
                  Termine ({termine.length})
                </span>
                {gruppenLaden && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Gruppe wird geladen…
                  </span>
                )}
                <button
                  type="button"
                  onClick={fuegeZeileHinzu}
                  disabled={speichert}
                  title="Weiteren Termin mit denselben Zeiten hinzufügen"
                  className="rounded-md border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:border-slate-400 transition disabled:opacity-60"
                >
                  + Weiteren Termin hinzufügen
                </button>
              </div>
              <div className="space-y-2">
                {termine.map((termin, index) => (
                  <div
                    key={`${index}-${termin.datum}-${termin.start}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Termin {index + 1}
                        {termin.id !== null && (
                          <span className="ml-1 normal-case tracking-normal text-slate-400">
                            ({formatDatum(termin.datum)})
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => entferneZeile(index)}
                        disabled={termine.length <= 1 || speichert}
                        title={
                          termine.length <= 1
                            ? 'Mindestens ein Termin muss verbleiben'
                            : 'Termin entfernen'
                        }
                        aria-label="Termin entfernen"
                        className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded border border-slate-300 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div>
                        <label
                          htmlFor={`res-zeile-datum-${index}`}
                          className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-0.5"
                        >
                          Datum
                        </label>
                        <input
                          id={`res-zeile-datum-${index}`}
                          type="date"
                          value={termin.datum}
                          onChange={(e) =>
                            aktualisiereZeile(index, { datum: e.target.value })
                          }
                          disabled={speichert}
                          className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`res-zeile-start-${index}`}
                          className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-0.5"
                        >
                          Uhrzeit von
                        </label>
                        <input
                          id={`res-zeile-start-${index}`}
                          type="time"
                          value={termin.start}
                          onChange={(e) =>
                            aktualisiereZeile(index, { start: e.target.value })
                          }
                          disabled={speichert}
                          className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`res-zeile-ende-${index}`}
                          className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-0.5"
                        >
                          Uhrzeit bis
                        </label>
                        <input
                          id={`res-zeile-ende-${index}`}
                          type="time"
                          value={termin.ende}
                          onChange={(e) =>
                            aktualisiereZeile(index, { ende: e.target.value })
                          }
                          disabled={speichert}
                          className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Gemeinsame Stammfelder */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="res-kunde"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
                >
                  Kunde (Pflichtfeld)
                </label>
                <input
                  id="res-kunde"
                  type="text"
                  value={kunde}
                  onChange={(e) => setKunde(e.target.value)}
                  placeholder="z. B. Firma XYZ"
                  disabled={speichert}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                />
              </div>
              <div>
                <label
                  htmlFor="res-kdnr"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
                >
                  KD-Nr. (optional)
                </label>
                <input
                  id="res-kdnr"
                  type="text"
                  value={kdNr}
                  onChange={(e) => setKdNr(e.target.value)}
                  placeholder="z. B. KD-10482"
                  disabled={speichert}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                />
              </div>
              <div>
                <label
                  htmlFor="res-thema"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
                >
                  Thema (optional)
                </label>
                <input
                  id="res-thema"
                  type="text"
                  value={thema}
                  onChange={(e) => setThema(e.target.value)}
                  placeholder="z. B. Excel Grundlagen"
                  disabled={speichert}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                />
              </div>
              <div>
                <label
                  htmlFor="res-frist"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
                >
                  Reservierungsfrist (optional)
                </label>
                <input
                  id="res-frist"
                  type="date"
                  value={fristEnde}
                  onChange={(e) => setFristEnde(e.target.value)}
                  disabled={speichert}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="res-bemerkung"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
                >
                  Bemerkung (optional)
                </label>
                <textarea
                  id="res-bemerkung"
                  value={bemerkung}
                  onChange={(e) => setBemerkung(e.target.value)}
                  rows={2}
                  disabled={speichert}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                />
              </div>
            </div>

            {/* Gruppencode-Hinweis im Gruppen-Modus */}
            {istGruppe && (
              <p className="text-[11px] text-slate-500">
                Teil der Reservierungsgruppe{' '}
                <span className="font-mono font-semibold text-slate-700">
                  {gruppeCode}
                </span>{' '}
                – der Code bleibt beim Speichern identisch.
              </p>
            )}

            {fehler && (
              <p className="text-xs text-red-600">{fehler}</p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
          {/* Lösch-Button nur im Gruppen-Modus (Reservierung löschen):
              Icon (= Trash2) zwingend weiß. */}
          {istGruppe ? (
            <button
              type="button"
              onClick={() => void loescheGruppe()}
              disabled={speichert || gruppenLaden || loeschtGruppe}
              className="mr-auto inline-flex items-center gap-1.5 rounded-lg bg-[#6D1717] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#5A1212] transition disabled:opacity-60"
            >
              {loeschtGruppe ? (
                <Loader2 className="h-4 w-4 animate-spin text-white stroke-white fill-none" />
              ) : (
                <Trash2 className="h-4 w-4 text-white stroke-white fill-none" />
              )}
              Reservierung löschen
            </button>
          ) : (
            <span aria-hidden="true" />
          )}

          <button
            type="button"
            onClick={onClose}
            disabled={speichert}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50 transition disabled:opacity-60"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => void speichern()}
            disabled={speichert || gruppenLaden}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#285DAA] text-white text-sm font-medium hover:bg-[#1E4A87] transition disabled:opacity-60"
          >
            {speichert && <Loader2 className="h-4 w-4 animate-spin" />}
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}