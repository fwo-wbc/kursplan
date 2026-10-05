'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  Plus,
  X,
  Lock,
  Pencil,
  Copy,
  Wand2,
  AlertTriangle,
} from 'lucide-react';
import Navigation from '../../components/Navigation';
import { slotZeit } from '@/lib/umwandlung';

// ---------------------------------------------------------------------------
// Typsicherheit (Spiegel der API-Antworten)
// ---------------------------------------------------------------------------

/** Trainer-Kürzel-Stammdaten aus GET /api/trainer. */
interface Trainer {
  id: number;
  vorname: string;
  nachname: string;
  kuerzel: string | null;
}

/** Zeitslot der Planungsansicht. */
type SlotCode = 'KT1' | 'KT2' | 'KT3';

/** Einheitlicher Zuweisungsstatus eines belegten Kurses. */
type KursStatus = 'ausgeschrieben' | 'unter Vorbehalt' | 'bestätigt' | 'abgesagt';

/** Belegter edoobox-Kurs eines Tages innerhalb eines Slots. */
interface KursEintrag {
  slot: SlotCode;
  kursname: string | null;
  status: KursStatus;
  teilnehmer: number;
  /** date_id der Zuweisung (für Statuswechsel per PATCH). */
  date_id: string;
}

/** Vor-Reservierung innerhalb eines Tages. */
interface ReservierungEintrag {
  id: number;
  slot_code: string;
  kd_nr: string;
  thema: string;
  frist_ende: string;
  status: string;
  notiz: string | null;
}

/** Anzeige-Feiertag eines Tages. */
interface FeiertagEintrag {
  name: string;
  laenderLabel: string;
  label: string;
}

/** Betriebliche Schließzeit, die einen Tag betrifft. */
interface BetriebsferienEintrag {
  id: number;
  bezeichnung: string;
  von: string;
  bis: string;
  gesperrt: boolean;
}

/** Eine Zeile des chronologischen Kalenders (ein Tag). */
interface TagEintrag {
  datum: string;
  wochenende: boolean;
  freigabe: boolean;
  kurse: KursEintrag[];
  reservierungen: ReservierungEintrag[];
  feiertag: FeiertagEintrag | null;
  betriebsferien: BetriebsferienEintrag[];
}

/** Antwort von GET /api/trainer/zeitplan. */
interface ZeitplanAntwort {
  trainer: {
    id: number;
    vorname: string;
    nachname: string;
    kuerzel: string | null;
  };
  von: string;
  bis: string;
  tage: TagEintrag[];
}

/** Eine Terminzeile der dynamischen Reservierungsliste. */
interface TerminZeile {
  datum: string;
  slot_code: string;
}

/** Zustand des Reservierungs-Dialogs. */
interface DialogState {
  open: boolean;
  editing: ReservierungEintrag | null;
  termine: TerminZeile[];
  kd_nr: string;
  thema: string;
  frist_ende: string;
  status: string;
  notiz: string;
}

/** Kurstemplate aus GET /api/edoobox/vorlagen. */
interface Kurstemplate {
  template_id: string;
  name: string;
  kuerzel: string;
  kategorie: string | null;
}

/** Zustand des Umwandlungs-Dialogs. */
interface UmwandlungState {
  open: boolean;
  reservierung: ReservierungEintrag | null;
  datum: string;
  templateId: string;
  firmenname: string;
  kursnr: string;
  anmeldeschluss: string;
  freigebenAlternativen: boolean;
}

/** Ergebnis der Entwickler-Bereinigung aus POST /api/admin/clean-test-data. */
interface CleanResult {
  geloeschte_reservierungen_verwaist: number;
  geloeschte_reservierungen_altstatus: number;
  geloeschte_zuweisungen: number;
  geloeschte_date_leader: number;
  geloeschte_ausnahmen: number;
  geloeschte_termine: number;
  geloeschte_angebote: number;
}

// ---------------------------------------------------------------------------
// Konstanten & Render-Helfer
// ---------------------------------------------------------------------------

const WOCHENTAG_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Slot-Definitionen für die sechs Spalten KT1..KT-Info 3. */
const SLOT_CONFIG: { code: SlotCode; sub: string }[] = [
  { code: 'KT1', sub: 'VM' },
  { code: 'KT2', sub: 'NM' },
  { code: 'KT3', sub: 'Abend' },
];

const SLOT_OPTIONEN = [
  { value: 'KT1', label: 'KT1 – Vormittag' },
  { value: 'KT2', label: 'KT2 – Nachmittag' },
  { value: 'KT3', label: 'KT3 – Abend' },
  { value: 'ganztags', label: 'Ganztags' },
];

const STATUS_OPTIONEN = [
  { value: 'angeboten', label: 'angeboten' },
  { value: 'bestaetigt', label: 'bestätigt' },
];

/** CSS-Klassen je Kurs-Status (Farbkodierung). */
const AMPEL_KLASSEN: Record<KursStatus, string> = {
  ausgeschrieben: 'bg-blue-100 border-blue-300 text-blue-900',
  'unter Vorbehalt': 'bg-amber-100 border-amber-300 text-amber-900',
  bestätigt: 'bg-emerald-100 border-emerald-300 text-emerald-900',
  abgesagt: 'bg-rose-100 border-rose-300 text-rose-900 line-through',
};

const AMPEL_DOT: Record<KursStatus, string> = {
  ausgeschrieben: 'bg-blue-500',
  'unter Vorbehalt': 'bg-amber-400',
  bestätigt: 'bg-emerald-500',
  abgesagt: 'bg-rose-500',
};

/** Statusoptionen für das Aktionsmenü am Kursblock. */
const STATUS_MENU_OPTIONEN: { value: KursStatus; label: string }[] = [
  { value: 'ausgeschrieben', label: 'Ausgeschrieben' },
  { value: 'unter Vorbehalt', label: 'Unter Vorbehalt' },
  { value: 'bestätigt', label: 'Bestätigt' },
  { value: 'abgesagt', label: 'Abgesagt' },
];

/** Kräftige, satte Volltonfarbe je Monat (Index 0 = Januar). */
const MONAT_FARBEN: string[] = [
  'bg-[#1e3a8a]', // Januar – kräftiges Dunkelblau
  'bg-[#0f766e]', // Februar – sattes Petrol
  'bg-[#15803d]', // März – kräftiges Grün
  'bg-[#b45309]', // April – sattes Bernstein
  'bg-[#0369a1]', // Mai – kräftiges Himmelblau
  'bg-[#4338ca]', // Juni – sattes Indigo
  'bg-[#7c2d12]', // Juli – kräftiges Braun
  'bg-[#c2410c]', // August – sattes Orange
  'bg-[#6b21a8]', // September – kräftiges Violett
  'bg-[#047857]', // Oktober – sattes Smaragdgrün
  'bg-[#be123c]', // November – kräftiges Rubinrot
  'bg-[#1e293b]', // Dezember – sattes Anthrazit
];

/** Formatiert ein lokales Date als YYYY-MM-DD. */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${t}`;
}

/** Formatiert ein ISO-Datum als "Do, 19.11.26". */
function formatDatumDisplay(datum: string): string {
  const d = new Date(`${datum}T00:00:00`);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${WOCHENTAG_KURZ[d.getDay()]}, ${dd}.${mm}.${yy}`;
}

/** Voller Monatsname, z. B. "Oktober". */
function monatName(datum: string): string {
  const d = new Date(`${datum}T00:00:00`);
  return new Intl.DateTimeFormat('de-DE', { month: 'long' }).format(d);
}

/** ISO-8601-Kalenderwoche eines lokalen Datums. */
function isoWoche(datum: string): number {
  const d = new Date(`${datum}T00:00:00`);
  const copy = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  return Math.ceil((((copy.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Monats-Schlüssel "YYYY-MM" für Gruppierungswechsel. */
function monatSchluessel(datum: string): string {
  return datum.slice(0, 7);
}

/** Ampel für ein Fristende nach Restzeit (neutral / bald / fällig). */
type FristAmpel = 'neutral' | 'bald' | 'faellig';

/** Resttage bis zum Fristende (negativ = abgelaufen, 0 = heute fällig). */
function fristRestTage(frist_ende: string): number {
  const heute = new Date(`${toDateStr(new Date())}T00:00:00`);
  const frist = new Date(`${frist_ende}T00:00:00`);
  return Math.round((frist.getTime() - heute.getTime()) / 86400000);
}

function fristAmpel(res: ReservierungEintrag): FristAmpel {
  const rest = fristRestTage(res.frist_ende);
  if (rest <= 0) return 'faellig';
  if (rest <= 2) return 'bald';
  return 'neutral';
}

/** true, wenn ein Tag gesperrt (Feiertag oder gesperrte Schließzeit) ist. */
function istGesperrt(tag: TagEintrag): boolean {
  if (tag.feiertag) return true;
  return tag.betriebsferien.some((f) => f.gesperrt);
}

// ---------------------------------------------------------------------------
// Komponente
// ---------------------------------------------------------------------------

export default function ZeitplanPage() {
  const [trainers, setTrainers] = useState<Trainer[]>([]);

  // Dozenten- und Zeitraumwahl aus URL-Query-Parametern lesen, damit die
  // Auswahl nach einem Reload oder nach dem Schließen eines Dialogs erhalten bleibt.
  function readStartDate(): Date {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const start = p.get('start');
      const m = /^(\d{4})-(\d{2})$/.exec(start ?? '');
      if (m) {
        return new Date(Number(m[1]), Number(m[2]) - 1, 1);
      }
    }
    const jetzt = new Date();
    return new Date(jetzt.getFullYear(), jetzt.getMonth(), 1);
  }

  function readPeriodMonths(): number {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const n = Number(p.get('zeitraum'));
      if ([1, 3, 6, 12].includes(n)) return n;
    }
    return 3;
  }

  function readTrainerFromUrl(): string {
    if (typeof window === 'undefined') return '';
    const p = new URLSearchParams(window.location.search);
    return p.get('trainer') ?? '';
  }

  const [selectedTrainerId, setSelectedTrainerId] = useState<string>(readTrainerFromUrl);

  const [startDate, setStartDate] = useState<Date>(readStartDate);
  const [periodMonths, setPeriodMonths] = useState<number>(readPeriodMonths);

  // Verhindert Hydration-Mismatch: URL-abhängige Werte (start/zeitraum) werden
  // erst nach dem Mount angezeigt, da der Server die URL nicht kennt.
  const [isMounted, setIsMounted] = useState<boolean>(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const [tage, setTage] = useState<TagEintrag[]>([]);
  const [trainer, setTrainer] = useState<ZeitplanAntwort['trainer'] | null>(null);

  const [isTrainerLoading, setIsTrainerLoading] = useState<boolean>(true);
  const [isGridLoading, setIsGridLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<DialogState>({
    open: false,
    editing: null,
    termine: [],
    kd_nr: '',
    thema: '',
    frist_ende: '',
    status: 'angeboten',
    notiz: '',
  });
  const [dialogSaving, setDialogSaving] = useState<boolean>(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [umwandlung, setUmwandlung] = useState<UmwandlungState>({
    open: false,
    reservierung: null,
    datum: '',
    templateId: '',
    firmenname: '',
    kursnr: '',
    anmeldeschluss: '',
    freigebenAlternativen: true,
  });
  const [vorlagen, setVorlagen] = useState<Kurstemplate[]>([]);
  const [vorlagenLoading, setVorlagenLoading] = useState<boolean>(false);
  const [umwandlungSaving, setUmwandlungSaving] = useState<boolean>(false);
  const [umwandlungError, setUmwandlungError] = useState<string | null>(null);

  const [cleanModalOpen, setCleanModalOpen] = useState<boolean>(false);
  const [cleanLoading, setCleanLoading] = useState<boolean>(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null);

  // Offenes Status-Aktionsmenü an einem Kursblock (Datum + Slot + Index).
  const [statusMenu, setStatusMenu] = useState<{
    datum: string;
    slot: SlotCode;
    index: number;
  } | null>(null);

  // -------------------------------------------------------------------------
  // Zeitraumberechnung
  // -------------------------------------------------------------------------
  const von = useMemo(() => toDateStr(startDate), [startDate]);
  const bis = useMemo(() => {
    const ende = new Date(
      startDate.getFullYear(),
      startDate.getMonth() + periodMonths,
      0
    );
    return toDateStr(ende);
  }, [startDate, periodMonths]);

  // Trainer- und Zeitraumwahl in der URL konservieren (ohne Reload).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (selectedTrainerId) params.set('trainer', selectedTrainerId);
    else params.delete('trainer');
    params.set('zeitraum', String(periodMonths));
    params.set('start', von.slice(0, 7));
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', next);
  }, [selectedTrainerId, periodMonths, von]);

  // -------------------------------------------------------------------------
  // Dozenten laden
  // -------------------------------------------------------------------------
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/trainer');
        if (!res.ok) throw new Error('Trainer konnten nicht geladen werden.');
        const liste = (await res.json()) as Trainer[];
        if (!active) return;
        setTrainers(liste);
        if (liste.length > 0) {
          const ausUrl = liste.find((t) => String(t.id) === selectedTrainerId);
          if (!ausUrl) {
            setSelectedTrainerId(String(liste[0].id));
          }
        }
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setIsTrainerLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Zeitplan laden
  // -------------------------------------------------------------------------
  const loadZeitplan = useCallback(async () => {
    if (!selectedTrainerId) return;

    setIsGridLoading(true);
    setLoadError(false);
    setSaveError(null);

    try {
      const res = await fetch(
        `/api/trainer/zeitplan?trainerId=${encodeURIComponent(selectedTrainerId)}&von=${von}&bis=${bis}`
      );
      if (!res.ok) throw new Error('Endpunkt antwortete mit einem Fehler.');
      const data = (await res.json()) as ZeitplanAntwort;
      setTage(data.tage);
      setTrainer(data.trainer);
    } catch (err: unknown) {
      console.error('Fehler beim Laden des Zeitplans:', err);
      setLoadError(true);
    } finally {
      setIsGridLoading(false);
    }
  }, [selectedTrainerId, von, bis]);

  useEffect(() => {
    loadZeitplan();
  }, [loadZeitplan]);

  // -------------------------------------------------------------------------
  // Freigabe toggeln
  // -------------------------------------------------------------------------
  const toggleFreigabe = useCallback(
    async (tag: TagEintrag) => {
      const naechster = !tag.freigabe;
      setTage((prev) =>
        prev.map((t) =>
          t.datum === tag.datum ? { ...t, freigabe: naechster } : t
        )
      );
      setSaveError(null);

      try {
        const res = await fetch('/api/verfuegbarkeit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trainerId: Number(selectedTrainerId),
            datum: tag.datum,
            vm: naechster,
            nm: naechster,
          }),
        });
        if (!res.ok) throw new Error('Freigabe konnte nicht gespeichert werden.');
      } catch (err: unknown) {
        console.error('Fehler beim Speichern der Freigabe:', err);
        setSaveError('Freigabe konnte nicht gespeichert werden.');
        setTage((prev) =>
          prev.map((t) =>
            t.datum === tag.datum ? { ...t, freigabe: tag.freigabe } : t
          )
        );
      }
    },
    [selectedTrainerId]
  );

  // -------------------------------------------------------------------------
  // Reservierungs-Dialog
  // -------------------------------------------------------------------------
  function nextTerminDatum(datum: string): string {
    const d = new Date(`${datum}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return toDateStr(d);
  }

  function openNewReservation(datum: string, slotCode: string) {
    setDialog({
      open: true,
      editing: null,
      termine: [{ datum, slot_code: slotCode }],
      kd_nr: '',
      thema: '',
      frist_ende: '',
      status: 'angeboten',
      notiz: '',
    });
    setDialogError(null);
  }

  function openEditReservation(res: ReservierungEintrag, datum: string) {
    setDialog({
      open: true,
      editing: res,
      termine: [{ datum, slot_code: res.slot_code }],
      kd_nr: res.kd_nr,
      thema: res.thema,
      frist_ende: res.frist_ende,
      status: res.status,
      notiz: res.notiz ?? '',
    });
    setDialogError(null);
  }

  function openCopyReservation(res: ReservierungEintrag, datum: string) {
    setDialog({
      open: true,
      editing: null,
      termine: [{ datum, slot_code: res.slot_code }],
      kd_nr: res.kd_nr,
      thema: res.thema,
      frist_ende: res.frist_ende,
      status: res.status,
      notiz: res.notiz ?? '',
    });
    setDialogError(null);
  }

  function closeDialog() {
    setDialog((prev) => ({ ...prev, open: false }));
    setDialogError(null);
  }

  function addTermin() {
    setDialog((prev) => {
      const letzter = prev.termine[prev.termine.length - 1];
      const datum = letzter ? nextTerminDatum(letzter.datum) : von;
      const slot_code = letzter ? letzter.slot_code : 'KT1';
      return { ...prev, termine: [...prev.termine, { datum, slot_code }] };
    });
  }

  function updateTermin(index: number, patch: Partial<TerminZeile>) {
    setDialog((prev) => ({
      ...prev,
      termine: prev.termine.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));
  }

  function removeTermin(index: number) {
    setDialog((prev) => ({
      ...prev,
      termine: prev.termine.filter((_, i) => i !== index),
    }));
  }

  async function saveReservation() {
    if (!dialog.kd_nr.trim() || !dialog.thema.trim() || !dialog.frist_ende) {
      setDialogError('Bitte KD-Nr., Thema und Fristende ausfüllen.');
      return;
    }
    if (dialog.termine.length === 0) {
      setDialogError('Bitte mindestens einen Termin angeben.');
      return;
    }
    if (dialog.termine.some((t) => !t.datum || !t.slot_code)) {
      setDialogError('Bitte für jeden Termin Datum und Slot ausfüllen.');
      return;
    }

    setDialogSaving(true);
    setDialogError(null);

    const stamm = {
      trainer_id: Number(selectedTrainerId),
      kd_nr: dialog.kd_nr.trim(),
      thema: dialog.thema.trim(),
      frist_ende: dialog.frist_ende,
      status: dialog.status,
      notiz: dialog.notiz.trim() || null,
    };

    try {
      let res: Response;
      if (dialog.editing) {
        // Bestehende Reservierung bleibt ein Einzeldatensatz (PUT).
        res = await fetch('/api/reservierung', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...stamm,
            id: dialog.editing.id,
            datum: dialog.termine[0].datum,
            slot_code: dialog.termine[0].slot_code,
          }),
        });
      } else if (dialog.termine.length === 1) {
        res = await fetch('/api/reservierung', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...stamm,
            datum: dialog.termine[0].datum,
            slot_code: dialog.termine[0].slot_code,
          }),
        });
      } else {
        res = await fetch('/api/reservierung', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...stamm, termine: dialog.termine }),
        });
      }

      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(errData?.error ? String(errData.error) : 'Speichern fehlgeschlagen.');
      }
      closeDialog();
      loadZeitplan();
    } catch (err: unknown) {
      console.error('Fehler beim Speichern der Reservierung:', err);
      setDialogError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setDialogSaving(false);
    }
  }

  async function deleteReservation(id: number) {
    setDialogSaving(true);
    setDialogError(null);
    try {
      const res = await fetch(`/api/reservierung?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Löschen fehlgeschlagen.');
      closeDialog();
      loadZeitplan();
    } catch (err: unknown) {
      console.error('Fehler beim Löschen der Reservierung:', err);
      setDialogError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    } finally {
      setDialogSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Kursstatus manuell setzen (Disposition: bestätigt / abgesagt / …)
  // -------------------------------------------------------------------------
  async function setKursStatus(kurs: KursEintrag, neuerStatus: KursStatus) {
    setStatusMenu(null);
    setSaveError(null);
    try {
      const res = await fetch('/api/trainer/zeitplan/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_id: kurs.date_id, status: neuerStatus }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          errData?.error ? String(errData.error) : 'Status konnte nicht gespeichert werden.'
        );
      }
      await loadZeitplan();
    } catch (err: unknown) {
      console.error('Fehler beim Setzen des Kursstatus:', err);
      setSaveError(
        err instanceof Error ? err.message : 'Status konnte nicht gespeichert werden.'
      );
    }
  }

  // Statusmenü schließen, sobald außerhalb geklickt wird.
  useEffect(() => {
    if (!statusMenu) return;
    function handleClick() {
      setStatusMenu(null);
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [statusMenu]);

  // -------------------------------------------------------------------------
  // Entwickler-Funktion: Test-Termine bereinigen
  // -------------------------------------------------------------------------
  async function runCleanup() {
    setCleanLoading(true);
    setCleanError(null);
    setCleanResult(null);
    try {
      const res = await fetch('/api/admin/clean-test-data', { method: 'POST' });
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          errData?.error ? String(errData.error) : 'Bereinigung fehlgeschlagen.'
        );
      }
      const data = (await res.json()) as CleanResult;
      setCleanResult(data);
      await loadZeitplan();
    } catch (err: unknown) {
      console.error('Fehler bei der Bereinigung:', err);
      setCleanError(
        err instanceof Error ? err.message : 'Bereinigung fehlgeschlagen.'
      );
    } finally {
      setCleanLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Umwandlungs-Dialog (Reservierung -> edoobox-Angebot)
  // -------------------------------------------------------------------------

  async function ladeVorlagen() {
    if (vorlagenLoading || vorlagen.length > 0) return;
    setVorlagenLoading(true);
    try {
      const res = await fetch('/api/edoobox/vorlagen');
      if (!res.ok) throw new Error('Kurstemplates konnten nicht geladen werden.');
      const data = (await res.json()) as { vorlagen: Kurstemplate[] };
      setVorlagen(data.vorlagen ?? []);
    } catch (err: unknown) {
      console.error('Fehler beim Laden der Kurstemplates:', err);
      setUmwandlungError('Kurstemplates konnten nicht geladen werden.');
    } finally {
      setVorlagenLoading(false);
    }
  }

  async function berechneVorschau(reservierungId: number, templateId: string) {
    if (!templateId) {
      setUmwandlung((p) => ({ ...p, kursnr: '', anmeldeschluss: '' }));
      return;
    }
    try {
      const res = await fetch(
        `/api/reservierung/umwandeln?reservierung_id=${encodeURIComponent(reservierungId)}&template_id=${encodeURIComponent(templateId)}`
      );
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(errData?.error ? String(errData.error) : 'Vorschau fehlgeschlagen.');
      }
      const data = (await res.json()) as { kursnr?: string; anmeldeschluss?: string };
      setUmwandlung((p) => ({
        ...p,
        kursnr: data.kursnr ?? '',
        anmeldeschluss: data.anmeldeschluss ?? '',
      }));
    } catch (err: unknown) {
      console.error('Fehler bei der Kursnummer-Vorschau:', err);
      setUmwandlungError(err instanceof Error ? err.message : 'Vorschau fehlgeschlagen.');
    }
  }

  function openUmwandlung(res: ReservierungEintrag, datum: string) {
    setUmwandlung({
      open: true,
      reservierung: res,
      datum,
      templateId: '',
      firmenname: '',
      kursnr: '',
      anmeldeschluss: '',
      freigebenAlternativen: true,
    });
    setUmwandlungError(null);
    ladeVorlagen();
  }

  function closeUmwandlung() {
    setUmwandlung((p) => ({ ...p, open: false }));
    setUmwandlungError(null);
  }

  async function submitUmwandlung() {
    if (!umwandlung.reservierung || !umwandlung.templateId) {
      setUmwandlungError('Bitte ein Kurstemplate auswählen.');
      return;
    }
    if (!umwandlung.firmenname.trim()) {
      setUmwandlungError('Bitte den Firmennamen angeben.');
      return;
    }
    if (!umwandlung.kursnr || !umwandlung.anmeldeschluss) {
      setUmwandlungError('Kursnummer konnte noch nicht berechnet werden.');
      return;
    }

    setUmwandlungSaving(true);
    setUmwandlungError(null);

    try {
      const res = await fetch('/api/reservierung/umwandeln', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservierung_id: umwandlung.reservierung.id,
          template_id: umwandlung.templateId,
          firmenname: umwandlung.firmenname.trim(),
          kursnr: umwandlung.kursnr,
          anmeldeschluss: umwandlung.anmeldeschluss,
          freigeben_alternativen: umwandlung.freigebenAlternativen,
        }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(errData?.error ? String(errData.error) : 'Umwandlung fehlgeschlagen.');
      }
      closeUmwandlung();
      await loadZeitplan();
    } catch (err: unknown) {
      console.error('Fehler bei der Umwandlung:', err);
      setUmwandlungError(err instanceof Error ? err.message : 'Umwandlung fehlgeschlagen.');
    } finally {
      setUmwandlungSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Zeilen-Metadaten (Monat/KW-Wechsel) vorberechnen
  // -------------------------------------------------------------------------
  const zeilenMeta = useMemo(() => {
    const n = tage.length;
    const monatKeys = tage.map((t) => monatSchluessel(t.datum));
    const kwKeys = tage.map((t) => isoWoche(t.datum));

    // Monats-Spans: wie viele aufeinanderfolgende Tage zum selben Monat gehören.
    const monatRowSpan: number[] = new Array<number>(n).fill(1);
    const istMonatStart: boolean[] = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (i === 0 || monatKeys[i] !== monatKeys[i - 1]) {
        istMonatStart[i] = true;
        let j = i;
        while (j < n && monatKeys[j] === monatKeys[i]) j += 1;
        for (let k = i; k < j; k += 1) monatRowSpan[k] = j - i;
      }
    }

    // KW-Spans innerhalb eines Monats: eine KW wird pro Monat separat verbunden.
    const kwRowSpan: number[] = new Array<number>(n).fill(1);
    const istKwStart: boolean[] = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) {
      const key = `${monatKeys[i]}-${kwKeys[i]}`;
      const prevKey = i > 0 ? `${monatKeys[i - 1]}-${kwKeys[i - 1]}` : null;
      if (i === 0 || key !== prevKey) {
        istKwStart[i] = true;
        let j = i;
        while (j < n && `${monatKeys[j]}-${kwKeys[j]}` === key) j += 1;
        for (let k = i; k < j; k += 1) kwRowSpan[k] = j - i;
      }
    }

    const meta: {
      monatLabel: string | null;
      monatFarbe: string | null;
      kwLabel: string | null;
      monatRowSpan: number;
      kwRowSpan: number;
      istMonatStart: boolean;
      istKwStart: boolean;
    }[] = [];

    for (let i = 0; i < n; i++) {
      const tag = tage[i];
      const monatIdx = new Date(`${tag.datum}T00:00:00`).getMonth();
      meta.push({
        monatLabel: istMonatStart[i] ? monatName(tag.datum) : null,
        monatFarbe: istMonatStart[i] ? MONAT_FARBEN[monatIdx] : null,
        kwLabel: istKwStart[i] ? String(kwKeys[i]) : null,
        monatRowSpan: monatRowSpan[i],
        kwRowSpan: kwRowSpan[i],
        istMonatStart: istMonatStart[i],
        istKwStart: istKwStart[i],
      });
    }

    return meta;
  }, [tage]);

  // -------------------------------------------------------------------------
  // Kurs-Bausteine einer Zeile
  // -------------------------------------------------------------------------
  function kurseFuerSlot(tag: TagEintrag, slot: SlotCode): KursEintrag[] {
    return tag.kurse.filter((k) => k.slot === slot);
  }

  function slotDot(tag: TagEintrag, slot: SlotCode): KursStatus | null {
    const kurse = kurseFuerSlot(tag, slot);
    if (kurse.length === 0) return null;
    if (kurse.some((k) => k.status === 'abgesagt')) return 'abgesagt';
    if (kurse.some((k) => k.status === 'bestätigt')) return 'bestätigt';
    if (kurse.some((k) => k.status === 'unter Vorbehalt')) return 'unter Vorbehalt';
    return 'ausgeschrieben';
  }

  function trainerLabel(t: Trainer): string {
    const name = `${t.vorname ?? ''} ${t.nachname ?? ''}`.trim() || `Trainer #${t.id}`;
    return t.kuerzel ? `${name} (${t.kuerzel})` : name;
  }

  // Heutiges Datum als Vergleichswert für die „Heute“-Hervorhebung.
  const heuteStr = toDateStr(new Date());

  return (
    <main className="h-screen flex flex-col overflow-hidden bg-slate-50 text-slate-800">
      <div className="max-w-[1500px] w-full mx-auto px-4 pt-4 flex flex-col flex-1 min-h-0">
        {/* Kopfzeile */}
        <header className="mb-4 shrink-0 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <CalendarRange className="w-5 h-5 text-blue-600" />
              Dozenten-Planung
            </h1>
            <p className="text-xs text-slate-500">
              Chronologische Kalender- und Planungsansicht (eine Zeile pro Tag).
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setCleanModalOpen(true);
              setCleanError(null);
              setCleanResult(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition"
          >
            ⚠️ Entwickler-Funktion: Test-Termine bereinigen
          </button>
        </header>

        {/* Toolbar: Dozent + Zeitraum */}
        <div className="mb-4 shrink-0 grid grid-cols-1 gap-3 lg:grid-cols-12 items-end">
          <div className="lg:col-span-4">
            <label
              htmlFor="trainer-select-zeitplan"
              className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
            >
              Dozent
            </label>
            <select
              id="trainer-select-zeitplan"
              value={selectedTrainerId}
              onChange={(e) => setSelectedTrainerId(e.target.value)}
              disabled={isTrainerLoading}
              className="w-full text-sm font-medium border border-slate-300 rounded px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
            >
              {isTrainerLoading ? (
                <option value="">Lade Dozenten…</option>
              ) : trainers.length === 0 ? (
                <option value="">Keine Dozenten vorhanden</option>
              ) : (
                trainers.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {trainerLabel(t)}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="lg:col-span-8 flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">
                  Zeitraum
                </label>
                <select
                  value={String(periodMonths)}
                  onChange={(e) => setPeriodMonths(Number(e.target.value))}
                  className="text-sm border border-slate-300 rounded px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="1">1 Monat</option>
                  <option value="3">3 Monate (Quartal)</option>
                  <option value="6">6 Monate</option>
                  <option value="12">12 Monate (Jahr)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">
                  Sprungmarke (Monat)
                </label>
                <input
                  type="month"
                  value={von.slice(0, 7)}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const [y, m] = e.target.value.split('-').map(Number);
                    setStartDate(new Date(y, m - 1, 1));
                  }}
                  suppressHydrationWarning
                  className="text-sm border border-slate-300 rounded px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setStartDate(
                      (prev) =>
                        new Date(prev.getFullYear(), prev.getMonth() - periodMonths, 1)
                    )
                  }
                  aria-label="Vorheriger Zeitraum"
                  className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-100 transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setStartDate(
                      (prev) =>
                        new Date(prev.getFullYear(), prev.getMonth() + periodMonths, 1)
                    )
                  }
                  aria-label="Nächster Zeitraum"
                  className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-100 transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const jetzt = new Date();
                    setStartDate(new Date(jetzt.getFullYear(), jetzt.getMonth(), 1));
                  }}
                  className="ml-1 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm hover:bg-slate-100 transition"
                >
                  Heute
                </button>
              </div>
            </div>

            <div className="text-xs text-slate-500">
              Zeitraum:{' '}
              <span className="font-semibold text-slate-700" suppressHydrationWarning>
                {isMounted
                  ? `${formatDatumDisplay(von)} – ${formatDatumDisplay(bis)}`
                  : '\u00A0'}
              </span>
            </div>
          </div>
        </div>

        {/* Scrollbarer Inhaltsbereich (Warnhinweis + Tabelle) */}
        <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Warnhinweis */}
        {saveError && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4" />
            {saveError}
          </div>
        )}

        {/* Lade-/Fehlerzustand */}
        {isGridLoading && selectedTrainerId ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Lade Zeitplan…</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-500">
            <AlertCircle className="w-6 h-6 text-rose-500" />
            <p className="text-sm">Zeitplan konnte nicht geladen werden.</p>
            <button
              type="button"
              onClick={loadZeitplan}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
            >
              Erneut versuchen
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full border-separate border-spacing-0 text-xs min-w-[1280px]">
              <thead className="sticky top-0 z-30 bg-slate-100 shadow-sm">
                <tr className="text-slate-500 uppercase tracking-wider">
                  <th className="bg-slate-100 w-8 min-w-[32px] max-w-[36px] p-0 text-center select-none font-semibold border-b border-slate-200">M</th>
                  <th className="bg-slate-100 p-2 text-left font-semibold border-b border-slate-200 w-10">KW</th>
                  <th className="bg-slate-100 p-2 text-left font-semibold border-b border-slate-200 w-28">Datum</th>
                  <th className="bg-slate-100 p-2 text-center font-semibold border-b border-slate-200 w-24">Freigabe</th>
                  <th className="bg-slate-100 p-2 text-center font-semibold border-b border-slate-200 w-12">KT1</th>
                  <th className="bg-slate-100 p-2 text-left font-semibold border-b border-slate-200 min-w-[120px]">KT-Info 1</th>
                  <th className="bg-slate-100 p-2 text-center font-semibold border-b border-slate-200 w-12">KT2</th>
                  <th className="bg-slate-100 p-2 text-left font-semibold border-b border-slate-200 min-w-[120px]">KT-Info 2</th>
                  <th className="bg-slate-100 p-2 text-center font-semibold border-b border-slate-200 w-12">KT3</th>
                  <th className="bg-slate-100 p-2 text-left font-semibold border-b border-slate-200 min-w-[120px]">KT-Info 3</th>
                  <th className="bg-slate-100 p-2 text-left font-semibold border-b border-slate-200 min-w-[150px]">Reservierungen</th>
                  <th className="bg-slate-100 p-2 text-left font-semibold border-b border-slate-200 w-28">Fristende</th>
                  <th className="bg-slate-100 p-2 text-left font-semibold border-b border-slate-200 min-w-[180px]">Kommentare / Abwesenheiten / Feiertage</th>
                </tr>
              </thead>
              <tbody>
                {tage.map((tag, index) => {
                  const meta = zeilenMeta[index] ?? {
                    monatLabel: null,
                    monatFarbe: null,
                    kwLabel: null,
                    monatRowSpan: 1,
                    kwRowSpan: 1,
                    istMonatStart: false,
                    istKwStart: false,
                  };

                  // -----------------------------------------------------------------
                  // Reine blaue Tagesbänderung: durchgehender Wechsel aus zwei hellen
                  // Blautönen über den globalen Zeilenindex aller gerenderten Tage
                  // (Mo–So). Wochenenden nehmen regulär teil. Gesetzliche Feiertage
                  // erhalten als einzige Ausnahme ein neutrales Grau mit abgetöntem Text.
                  // -----------------------------------------------------------------
                  const globalRowIndex = index;
                  const bgClass =
                    globalRowIndex % 2 === 0 ? 'bg-blue-50' : 'bg-blue-100';

                  let rowBg: string;
                  if (tag.feiertag) {
                    rowBg = 'bg-slate-100/80';
                  } else {
                    rowBg = bgClass;
                  }

                  // Gemeinsamer unterer Zellrand als konstante Trennlinie,
                  // da `border-separate` Rahmeneigenschaften am <tr> ignoriert.
                  const zellRand = 'border-b-[0.75px] border-[#666666]';

                  const istHeute = tag.datum === heuteStr;

                  return (
                    <tr
                      key={tag.datum}
                      className={`${tag.feiertag ? 'text-slate-400' : ''} h-[76px]`}
                    >
                      {/* Spalte 1: Monat (verbunden über alle Tage des Monats) */}
                      {meta.istMonatStart && (
                        <td
                          rowSpan={meta.monatRowSpan}
                          className={`${meta.monatFarbe ?? rowBg} ${zellRand} border-r-[0.75px] border-[#666666] w-8 min-w-[32px] max-w-[36px] p-0 text-center select-none align-middle`}
                        >
                          <div className="flex h-full items-center justify-center">
                            <span className="-rotate-90 select-none whitespace-nowrap text-xs font-bold tracking-wider text-white drop-shadow-sm">
                              {meta.monatLabel}
                            </span>
                          </div>
                        </td>
                      )}

                      {/* Spalte 2: KW (verbunden über die Tage der KW im Monat) */}
                      {meta.istKwStart && (
                        <td
                          rowSpan={meta.kwRowSpan}
                          className={`${rowBg} ${zellRand} border-r-[0.75px] border-[#666666] p-2 align-middle text-slate-500 font-medium hover:bg-blue-200/50`}
                        >
                          <div className="flex h-full items-center justify-center">
                            <span className="whitespace-nowrap">{meta.kwLabel}</span>
                          </div>
                        </td>
                      )}

                      {/* Spalte 3: Datum (Wochentag) – Ende des Kalenderblocks */}
                      <td
                        className={`${rowBg} ${zellRand} border-r-[1.5px] border-[#666666] p-2 align-middle font-medium whitespace-nowrap ${
                          istHeute ? 'border-l-[3px] border-l-blue-600' : ''
                        } ${tag.feiertag ? 'text-slate-400' : 'text-slate-700'}`}
                      >
                        <span className={istHeute ? 'font-bold text-blue-700' : ''}>
                          {formatDatumDisplay(tag.datum)}
                        </span>
                      </td>

                      {/* Spalte 4: Freigabe (Toggle) */}
                      <td className={`${rowBg} ${zellRand} p-1 align-middle text-center hover:bg-blue-200/50`}>
                        <button
                          type="button"
                          onClick={() => toggleFreigabe(tag)}
                          title="Klicken: Freigabe toggeln"
                          className={`w-full px-2 py-1 rounded-md text-xs font-bold border transition ${
                            tag.freigabe
                              ? 'bg-blue-500 border-blue-600 text-white'
                              : 'bg-white border-slate-200 text-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {tag.freigabe ? (trainer?.kuerzel ?? '✓') : '—'}
                        </button>
                      </td>

                      {/* Spalten 5–10: Slots je Tagesabschnitt */}
                      {SLOT_CONFIG.map((config) => {
                        const kurse = kurseFuerSlot(tag, config.code);
                        const dot = slotDot(tag, config.code);

                        return (
                          <React.Fragment key={config.code}>
                            <td className={`${rowBg} ${zellRand} p-1 align-middle text-center hover:bg-blue-200/50`}>
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-[10px] font-semibold text-slate-400">
                                  {config.code}
                                </span>
                                <span
                                  className={`inline-block w-2.5 h-2.5 rounded-full ${
                                    dot ? AMPEL_DOT[dot] : 'bg-slate-200'
                                  }`}
                                />
                              </div>
                            </td>
                            <td
                              className={`${rowBg} ${zellRand} p-1 align-middle hover:bg-blue-200/50 ${
                                config.code === 'KT3'
                                  ? 'border-r-[1.5px] border-[#666666]'
                                  : ''
                              }`}
                            >
                              <div className="flex flex-col gap-0.5">
                                {kurse.length === 0 ? (
                                  <span className="text-slate-300">–</span>
                                ) : (
                                  kurse.slice(0, 3).map((kurs, i) => (
                                    <div
                                      key={`${config.code}-${i}`}
                                      className="relative flex items-center gap-0.5"
                                    >
                                      <span
                                        className={`flex-1 min-w-0 inline-block rounded-md border px-1.5 py-0.5 text-[10px] leading-tight font-medium truncate ${AMPEL_KLASSEN[kurs.status]}`}
                                        title={kurs.kursname ?? 'Kurs'}
                                      >
                                        {kurs.kursname ?? 'Kurs'}
                                        {kurs.teilnehmer > 0 ? ` · ${kurs.teilnehmer} TN` : ''}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setStatusMenu((prev) =>
                                            prev?.datum === tag.datum &&
                                            prev.slot === config.code &&
                                            prev.index === i
                                              ? null
                                              : { datum: tag.datum, slot: config.code, index: i }
                                          );
                                        }}
                                        title="Status ändern"
                                        aria-label="Status ändern"
                                        className="shrink-0 rounded border border-slate-300 bg-white px-0.5 text-slate-500 hover:bg-slate-100 transition"
                                      >
                                        <ChevronDown className="w-2.5 h-2.5" />
                                      </button>
                                      {statusMenu?.datum === tag.datum &&
                                        statusMenu.slot === config.code &&
                                        statusMenu.index === i && (
                                          <div
                                            className="absolute right-0 top-full z-50 mt-0.5 w-40 rounded-md border border-slate-200 bg-white shadow-lg"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            {STATUS_MENU_OPTIONEN.map((opt) => (
                                              <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setKursStatus(kurs, opt.value)}
                                                className={`block w-full text-left px-2 py-1 text-[10px] hover:bg-slate-50 transition ${
                                                  kurs.status === opt.value ? 'font-bold' : ''
                                                }`}
                                              >
                                                {opt.label}
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                    </div>
                                  ))
                                )}
                                {kurse.length > 3 && (
                                  <span className="text-[10px] text-slate-400 px-1">
                                    +{kurse.length - 3} weitere
                                  </span>
                                )}
                              </div>
                            </td>
                          </React.Fragment>
                        );
                      })}

                      {/* Spalte 11: Reservierungen */}
                      <td className={`${rowBg} ${zellRand} p-1 align-top hover:bg-blue-200/50`}>
                        <div className="flex flex-col gap-1">
                          {tag.reservierungen.slice(0, 2).map((res) => (
                            <div key={res.id} className="flex items-stretch gap-0.5">
                              <button
                                type="button"
                                onClick={() => openEditReservation(res, tag.datum)}
                                title={`${res.kd_nr} · ${res.thema}`}
                                className="min-w-0 flex-1 text-left rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] leading-tight text-amber-900 hover:bg-amber-100 transition truncate"
                              >
                                <span className="font-semibold">{res.kd_nr}</span>
                                {' · '}
                                {res.thema}
                              </button>
                              <button
                                type="button"
                                onClick={() => openCopyReservation(res, tag.datum)}
                                title="Reservierung kopieren / Mehrfach-Termine"
                                aria-label="Reservierung kopieren"
                                className="shrink-0 rounded-md border border-slate-300 bg-white px-1 text-slate-600 hover:bg-slate-100 transition"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openUmwandlung(res, tag.datum)}
                                title="In Kurs umwandeln"
                                aria-label="In Kurs umwandeln"
                                className="shrink-0 rounded-md border border-blue-300 bg-blue-50 px-1 text-blue-700 hover:bg-blue-100 transition"
                              >
                                <Wand2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                          {tag.reservierungen.length < 2 && (
                            <button
                              type="button"
                              onClick={() => openNewReservation(tag.datum, 'KT1')}
                              title="Neue Reservierung anlegen"
                              className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-600 hover:border-slate-400 transition"
                            >
                              <Plus className="w-3 h-3" />
                              Reservierung
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Spalte 12: Fristende (Fristenampel) */}
                      <td className={`${rowBg} ${zellRand} p-1 align-top hover:bg-blue-200/50`}>
                        <div className="flex flex-col gap-1">
                          {tag.reservierungen.length === 0 && (
                            <span className="text-slate-300">–</span>
                          )}
                          {tag.reservierungen.slice(0, 2).map((res) => {
                            const rest = fristRestTage(res.frist_ende);
                            const ampel = fristAmpel(res);
                            return (
                              <div
                                key={res.id}
                                className={`rounded-md border px-1.5 py-0.5 text-[10px] leading-tight ${
                                  ampel === 'faellig'
                                    ? 'border-red-300 bg-red-50 text-red-800 font-medium'
                                    : ampel === 'bald'
                                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                                      : 'border-slate-300 bg-slate-100 text-slate-700'
                                }`}
                              >
                                <div className="font-semibold whitespace-nowrap">
                                  {formatDatumDisplay(res.frist_ende)}
                                </div>
                                {ampel === 'faellig' && (
                                  <div className="text-[9px] font-bold text-red-600">
                                    {rest < 0 ? 'Frist abgelaufen' : 'Heute fällig'}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </td>

                      {/* Spalte 13: Kommentare / Abwesenheiten / Feiertage */}
                      <td className={`${rowBg} ${zellRand} p-1 align-middle hover:bg-blue-200/50`}>
                        <div className="flex flex-col gap-1">
                          {tag.feiertag && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] leading-tight text-slate-600">
                              <Lock className="w-3 h-3 shrink-0" />
                              {tag.feiertag.label}
                            </span>
                          )}
                          {tag.betriebsferien.map((f) => (
                            <span
                              key={f.id}
                              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] leading-tight ${
                                f.gesperrt
                                  ? 'border-slate-400 bg-slate-100 text-slate-600'
                                  : 'border-slate-200 bg-slate-50 text-slate-500'
                              }`}
                            >
                              {f.gesperrt && <Lock className="w-3 h-3 shrink-0" />}
                              {f.bezeichnung}
                            </span>
                          ))}
                          {!tag.feiertag && tag.betriebsferien.length === 0 && (
                            <span className="text-slate-300">–</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </div>

        {/* Legende */}
        <div className="mt-4 shrink-0 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded bg-blue-500" />
            Ausgeschrieben
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded bg-amber-400" />
            Unter Vorbehalt (ab 1 TN)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded bg-emerald-500" />
            Bestätigt
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded bg-rose-500" />
            Abgesagt
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded bg-slate-200 border border-slate-300" />
            Feiertag / Schließzeit (gesperrt)
          </span>
        </div>
      </div>

      {/* Reservierungs-Dialog */}
      {dialog.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reservierung bearbeiten"
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-slate-200 p-5">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Pencil className="w-4 h-4 text-blue-600" />
                {dialog.editing ? 'Reservierung bearbeiten' : 'Neue Reservierung'}
              </h2>
              <button
                type="button"
                onClick={closeDialog}
                aria-label="Schließen"
                className="rounded-lg p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Kopfbereich: gilt für alle hinzugefügten Termine identisch */}
            <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">KD-Nr.</label>
                <input
                  value={dialog.kd_nr}
                  onChange={(e) => setDialog((p) => ({ ...p, kd_nr: e.target.value }))}
                  placeholder="KD-10482"
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Dozent</label>
                <div className="w-full text-sm font-medium text-slate-700 px-2.5 py-2">
                  {trainer
                    ? `${trainer.vorname} ${trainer.nachname}${
                        trainer.kuerzel ? ` (${trainer.kuerzel})` : ''
                      }`.trim()
                    : '–'}
                </div>
              </div>

              <div className="col-span-2">
                <label className="text-xs font-semibold text-slate-500 block mb-1">Thema</label>
                <input
                  value={dialog.thema}
                  onChange={(e) => setDialog((p) => ({ ...p, thema: e.target.value }))}
                  placeholder="Excel Grundlagen"
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Fristende</label>
                <input
                  type="date"
                  value={dialog.frist_ende}
                  onChange={(e) => setDialog((p) => ({ ...p, frist_ende: e.target.value }))}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Status</label>
                <select
                  value={dialog.status}
                  onChange={(e) => setDialog((p) => ({ ...p, status: e.target.value }))}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {STATUS_OPTIONEN.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="text-xs font-semibold text-slate-500 block mb-1">Notiz</label>
                <input
                  value={dialog.notiz}
                  onChange={(e) => setDialog((p) => ({ ...p, notiz: e.target.value }))}
                  placeholder="optional"
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
            </div>

            {/* Dynamische Terminliste */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500">Termine</label>
                {!dialog.editing && (
                  <button
                    type="button"
                    onClick={addTermin}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition"
                  >
                    <Plus className="w-3 h-3" />
                    Weiteren Termin hinzufügen
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {dialog.termine.map((termin, index) => (
                  <div
                    key={index}
                    className="flex items-end gap-2 rounded-lg border border-slate-200 bg-white p-2"
                  >
                    <div className="flex-1">
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Datum
                      </label>
                      <input
                        type="date"
                        value={termin.datum}
                        onChange={(e) =>
                          updateTermin(index, { datum: e.target.value })
                        }
                        className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Slot
                      </label>
                      <select
                        value={termin.slot_code}
                        onChange={(e) =>
                          updateTermin(index, { slot_code: e.target.value })
                        }
                        className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {SLOT_OPTIONEN.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {dialog.termine.length > 1 && !dialog.editing && (
                      <button
                        type="button"
                        onClick={() => removeTermin(index)}
                        title="Termin entfernen"
                        aria-label="Termin entfernen"
                        className="shrink-0 rounded-md border border-slate-300 px-1.5 py-1.5 text-slate-400 hover:border-rose-300 hover:text-rose-600 transition"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {dialogError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <AlertCircle className="w-4 h-4" />
                {dialogError}
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              {dialog.editing && (
                <button
                  type="button"
                  onClick={() => deleteReservation(dialog.editing!.id)}
                  disabled={dialogSaving}
                  className="mr-auto px-3 py-2 rounded-lg border border-rose-300 bg-rose-50 text-rose-700 text-sm font-medium hover:bg-rose-100 transition disabled:opacity-60"
                >
                  Löschen
                </button>
              )}
              <button
                type="button"
                onClick={closeDialog}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50 transition"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={saveReservation}
                disabled={dialogSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition disabled:opacity-60"
              >
                {dialogSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Umwandlungs-Dialog */}
      {umwandlung.open && umwandlung.reservierung && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="In Kurs umwandeln"
        >
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 p-5">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-blue-600" />
                In Kurs umwandeln
              </h2>
              <button
                type="button"
                onClick={closeUmwandlung}
                aria-label="Schließen"
                className="rounded-lg p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Eckdaten */}
            <div className="mb-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs">
              <div>
                <div className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  Datum
                </div>
                <div className="font-semibold text-slate-700">
                  {formatDatumDisplay(umwandlung.datum)}
                </div>
              </div>
              <div>
                <div className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  Slot
                </div>
                <div className="font-semibold text-slate-700">
                  {umwandlung.reservierung.slot_code}{' '}
                  <span className="font-normal text-slate-500">
                    {slotZeit(umwandlung.reservierung.slot_code).von}–
                    {slotZeit(umwandlung.reservierung.slot_code).bis} Uhr
                  </span>
                </div>
              </div>
              <div>
                <div className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  Dozent
                </div>
                <div className="font-semibold text-slate-700">
                  {trainer?.kuerzel ?? '–'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">
                  Kurstemplate
                </label>
                <select
                  value={umwandlung.templateId}
                  onChange={(e) => {
                    const templateId = e.target.value;
                    setUmwandlung((p) => ({ ...p, templateId }));
                    if (umwandlung.reservierung) {
                      berechneVorschau(umwandlung.reservierung.id, templateId);
                    }
                  }}
                  disabled={vorlagenLoading}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                >
                  {vorlagenLoading ? (
                    <option value="">Lade Vorlagen…</option>
                  ) : vorlagen.length === 0 ? (
                    <option value="">Keine Vorlagen vorhanden</option>
                  ) : (
                    <>
                      <option value="">Bitte Vorlage wählen…</option>
                      {vorlagen.map((v) => (
                        <option key={v.template_id} value={v.template_id}>
                          {v.name} ({v.kuerzel})
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">
                  Firmenname
                </label>
                <input
                  value={umwandlung.firmenname}
                  onChange={(e) =>
                    setUmwandlung((p) => ({ ...p, firmenname: e.target.value }))
                  }
                  placeholder="Deutsche Rück"
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Unterkategorie „{umwandlung.reservierung.kd_nr}{' '}
                  {umwandlung.firmenname.trim() || '(Firmenname)'}“ wird automatisch gebildet.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">
                  Generierte Kursnummer
                </label>
                <input
                  value={umwandlung.kursnr}
                  readOnly
                  placeholder="z. B. 2250-xls-gl-m1-1026-1"
                  className="w-full text-sm font-mono border border-slate-300 bg-slate-50 rounded px-2.5 py-2 text-slate-600"
                />
                {umwandlung.anmeldeschluss && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    Anmeldeschluss: {umwandlung.anmeldeschluss.replace('T', ' ')}
                  </p>
                )}
              </div>

              <label className="flex items-start gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={umwandlung.freigebenAlternativen}
                  onChange={(e) =>
                    setUmwandlung((p) => ({
                      ...p,
                      freigebenAlternativen: e.target.checked,
                    }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Weitere Alternativ-Reservierungen dieser KD-Nr. automatisch freigeben
              </label>
            </div>

            {umwandlungError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <AlertCircle className="w-4 h-4" />
                {umwandlungError}
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeUmwandlung}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50 transition"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={submitUmwandlung}
                disabled={umwandlungSaving || !umwandlung.templateId || !umwandlung.kursnr}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition disabled:opacity-60"
              >
                {umwandlungSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Verbindlich in edoobox anlegen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Entwickler-Funktion: Test-Termine bereinigen */}
      {cleanModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Test-Termine bereinigen"
        >
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 p-5">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-base font-bold flex items-center gap-2 text-amber-800">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Entwickler-Funktion: Test-Termine bereinigen
              </h2>
              <button
                type="button"
                onClick={() => setCleanModalOpen(false)}
                aria-label="Schließen"
                className="rounded-lg p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Diese Aktion entfernt unwiderruflich:
              <ul className="mt-2 list-disc pl-5 space-y-1">
                <li>bestätigte Reservierungen ohne gültige edoobox-Verknüpfung</li>
                <li>Reservierungen mit Status „storniert“ / „abgelaufen“</li>
                <li>Dozentenzuweisungen ohne aktiven edoobox-Termin</li>
                <li>gespiegelte edoobox-Termine und -Angebote mit Löschmarkierung</li>
              </ul>
              <p className="mt-2 font-semibold">Möchten Sie fortfahren?</p>
            </div>

            {cleanError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <AlertCircle className="w-4 h-4" />
                {cleanError}
              </div>
            )}

            {cleanResult && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <div className="font-semibold mb-1">Bereinigung abgeschlossen:</div>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>Verwaiste Reservierungen: {cleanResult.geloeschte_reservierungen_verwaist}</li>
                  <li>Reservierungen (Altstatus): {cleanResult.geloeschte_reservierungen_altstatus}</li>
                  <li>Dozentenzuweisungen: {cleanResult.geloeschte_zuweisungen}</li>
                  <li>Termin-Leiter: {cleanResult.geloeschte_date_leader}</li>
                  <li>Kostenausnahmen: {cleanResult.geloeschte_ausnahmen}</li>
                  <li>Gelöschte Termine: {cleanResult.geloeschte_termine}</li>
                  <li>Gelöschte Angebote: {cleanResult.geloeschte_angebote}</li>
                </ul>
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCleanModalOpen(false)}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50 transition"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={runCleanup}
                disabled={cleanLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition disabled:opacity-60"
              >
                {cleanLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {cleanLoading ? 'Bereinige…' : 'Jetzt bereinigen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}