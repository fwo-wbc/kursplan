'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import React from 'react';
import {
  LayoutGrid,
  List,
  Loader2,
  AlertTriangle,
  RefreshCw,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  Pencil,
  X,
} from 'lucide-react';
import AppHeader from '../components/AppHeader';
import ReservierungsGruppeDialog from '../../components/ReservierungsGruppeDialog';

// ---------------------------------------------------------------------------
// Typsicherheit (Teilmenge der Felder aus GET /api/termine)
// ---------------------------------------------------------------------------

/** Ein einzelner Termin (offer_date) eines Kurses. */
interface KursTermin {
  date_id: string;
  date_start: string | null;
  date_end: string | null;
}

/** Trainer-Kurzprofil innerhalb einer Zuweisung. */
interface TrainerKurz {
  vorname: string | null;
  nachname: string | null;
  kuerzel: string | null;
}

/** Eine Trainer-Zuweisung (nur die hier relevanten Felder). */
interface Zuweisung {
  trainer: TrainerKurz | null;
}

/** Ein Kurs/Angebot aus GET /api/termine (Teilmenge der Felder). */
interface Kurs {
  offer_id: string | null;
  termine: KursTermin[];
  date_status: string | null;
  offer_name: string | null;
  kursnr: string | null;
  zuweisungen: Zuweisung[];
  /** Aktuelles Trainerkürzel der ersten Zuweisung ('n. v.' wenn keiner). */
  trainer_kuerzel?: string | null;
  /** Reservierungscode (Welt A: reservation_code, Welt B: gruppe_code). */
  reservation_code?: string | null;
  /** Thema der Reservierung (Welt A: termin_reservierung.thema). */
  thema?: string | null;
  /** Kundenbezug (Welt A: kd_nr, Welt B: kunde). */
  kunde?: string | null;
  /** Reservierungsfrist als ISO-Datum (YYYY-MM-DD). */
  frist_ende?: string | null;
}

/** Ein Datensatz der Reservierungen-Seite (eine Zeile je Termin). */
interface ReservierungZeile {
  kurs: Kurs;
  termin: KursTermin;
}

/** Ein Kalendertag innerhalb des Monatsrasters. */
interface KalenderTag {
  datum: Date;
  /** true, wenn der Tag zum angezeigten Monat gehört (sonst Überhang). */
  imMonat: boolean;
}

/** Eine Kalenderwoche (Mo–So) mit ihrer ISO-8601-Kalenderwoche. */
interface KalenderWoche {
  kw: number;
  tage: KalenderTag[];
}

/** Ein Reservierungs-Eintrag innerhalb einer Tageszelle. */
interface TagEintrag {
  kurs: Kurs;
  termin: KursTermin;
  startZeit: string;
}

/** Verfügbare Ansichtsmodi der Seite. */
type Ansicht = 'liste' | 'monat';

/** Ein aktiver Klick-Filter der Listenansicht. */
interface AktiverFilter {
  label: string;
  wert: string;
  entfernen: () => void;
}

// ---------------------------------------------------------------------------
// Konstanten & Formatierung
// ---------------------------------------------------------------------------

/** Fallback-Text, wenn kein Trainer zugewiesen ist. */
const KEIN_TRAINER = 'n.v.';

/** Fallback-Text für leere Zellen. */
const KEIN_WERT = '–';

/** Spaltenköpfe: Montag bis Sonntag (ISO 8601, Wochenbeginn Montag). */
const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Deutsche Monatsnamen (Index 0 = Januar). */
const MONATSNAMEN = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

/** Deutsche Monatskürzel für Überhang-Tage (z. B. „31. Okt“ / „1. Dez“). */
const MONATSKUERZEL = [
  'Jan',
  'Feb',
  'Mär',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez',
];

/** Maximale Anzahl sichtbarer Einträge pro Tageszelle in der Monatsübersicht. */
const MAX_KURSE_PRO_TAG = 4;

/** Formatiert einen ISO-Zeitstempel als Uhrzeit "HH:MM" in Europe/Berlin. */
const zeitFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Formatiert einen ISO-Zeitstempel als Datum "TT.MM.JJJJ" in Europe/Berlin. */
const datumFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Formatiert einen ISO-Zeitstempel als Wochentag ("Di.") in Europe/Berlin. */
const wochentagFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  weekday: 'short',
});

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

/**
 * Liefert das Wochentags-Kürzel mit Punkt ("Di."). Falls die Runtime bereits
 * einen Punkt liefert (de-DE: "Di."), wird er beibehalten, sonst ergänzt.
 */
function wochentagKurz(date: Date): string {
  const kuerzel = wochentagFormatter.format(date);
  return kuerzel.endsWith('.') ? kuerzel : `${kuerzel}.`;
}

/** Wandelt einen ISO-String in ein Date um (null bei ungültigem Wert). */
function toDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Formatiert ein Datum als ISO-Tag (YYYY-MM-DD) für lexikografische Vergleiche. */
function toIsoDate(date: Date): string {
  const jahr = date.getFullYear();
  const monat = String(date.getMonth() + 1).padStart(2, '0');
  const tag = String(date.getDate()).padStart(2, '0');
  return `${jahr}-${monat}-${tag}`;
}

/**
 * Formatiert ein reines ISO-Datum (YYYY-MM-DD) als "Di. 10.11.2026".
 * Bewusst zeitzonenunabhängig (kein new Date() mit lokaler/UTC-Konvertierung,
 * sondern Date.UTC), damit die Frist nie durch UTC/Berlin-Verschiebungen auf
 * den Folgetag kippt. Leere Werte → '–'.
 */
function formatDatumIso(iso: string | null | undefined): string {
  if (typeof iso !== 'string' || iso.trim() === '') return KEIN_WERT;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return KEIN_WERT;
  const wochentag =
    WOCHENTAGE_KURZ[
      new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      ).getUTCDay()
    ];
  return `${wochentag} ${match[3]}.${match[2]}.${match[1]}`;
}

/** Ermittelt die ISO-8601-Kalenderwoche eines Datums (1–53). */
function getIsoWeek(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Erzeugt das Kalender-Raster eines Monats (0-basiert: Januar = 0).
 * Die erste Woche beginnt am Montag der Woche, in der der 1. liegt; die letzte
 * Woche endet am Sonntag der Woche, in der der letzte Monatstag liegt.
 * Überhang-Tage aus Vor- und Folgemonat füllen die erste bzw. letzte Woche.
 */
function monatsRaster(jahr: number, monat: number): KalenderWoche[] {
  const erster = new Date(jahr, monat, 1);
  const letzter = new Date(jahr, monat + 1, 0);

  // Wochentag des 1. (JS: 0 = So … 6 = Sa) auf Montag-basiert (0 = Mo) mappen.
  const offset = (erster.getDay() + 6) % 7;
  const start = new Date(jahr, monat, 1 - offset);

  const wochen: KalenderWoche[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());

  while (true) {
    const tage: KalenderTag[] = [];
    for (let i = 0; i < 7; i += 1) {
      tage.push({
        datum: new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()),
        imMonat: cursor.getMonth() === monat && cursor.getFullYear() === jahr,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    wochen.push({ kw: getIsoWeek(tage[0].datum), tage });

    // Abbruch, sobald der letzte Monatstag in der Woche enthalten war.
    if (tage[6].datum.getTime() >= letzter.getTime()) break;
  }

  return wochen;
}

/** Formatiert den Start bis Ende eines Termins: "Di. 10.11.2026, HH:MM–HH:MM Uhr". */
function formatTermin(termin: KursTermin): string {
  const start = toDate(termin.date_start);
  const ende = toDate(termin.date_end);
  if (!start) return 'Datum n. v.';
  const datum = `${wochentagKurz(start)} ${datumFormatter.format(start)}`;
  const von = zeitFormatter.format(start);
  const bis = ende ? zeitFormatter.format(ende) : '--:--';
  return `${datum}, ${von}–${bis} Uhr`;
}

/**
 * Liefert den Namen des zugewiesenen Trainers (Vorname Nachname bzw.
 * Kürzel). Falls keine Zuweisung vorhanden ist, wird der am Kurs
 * durchgereichte Trainer-Kürzel (mit 'n. v.'-Sonderfall) geprüft.
 */
function trainerAnzeige(kurs: Kurs): string {
  const zuweisung = kurs.zuweisungen?.[0];
  const trainer = zuweisung?.trainer;
  if (trainer) {
    const vor = trainer.vorname?.trim();
    const nach = trainer.nachname?.trim();
    if (vor || nach) return [vor, nach].filter(Boolean).join(' ');
    const kuerzel = trainer.kuerzel?.trim();
    if (kuerzel && kuerzel !== 'n. v.' && kuerzel !== 'n.v.') return kuerzel;
  }
  const kuerzel = kurs.trainer_kuerzel?.trim();
  if (kuerzel && kuerzel !== 'n. v.' && kuerzel !== 'n.v.') return kuerzel;
  return KEIN_TRAINER;
}

/** Liefert das Trainerkürzel für die Monatsübersicht (Fallback 'n.v.'). */
function trainerKuerzel(kurs: Kurs): string {
  const kuerzel = kurs.trainer_kuerzel?.trim();
  if (kuerzel && kuerzel !== 'n. v.' && kuerzel !== 'n.v.') return kuerzel;
  return KEIN_TRAINER;
}

/** Liefert den Reservierungscode einer Zeile (Fallback '–'). */
function reservierungsCode(kurs: Kurs): string {
  const code = kurs.reservation_code?.trim();
  return code ? code : KEIN_WERT;
}

/** Liefert den Kundenbezug einer Zeile (Welt A: kd_nr, Welt B: kunde). */
function kundenAnzeige(kurs: Kurs): string {
  const kunde = kurs.kunde?.trim();
  return kunde ? kunde : KEIN_WERT;
}

/** Liefert die Kundennummer einer Zeile (kursnr = kd_nr; Fallback '–'). */
function kdNrAnzeige(kurs: Kurs): string {
  const kdnr = kurs.kursnr?.trim();
  return kdnr ? kdnr : KEIN_WERT;
}

/** Liefert das Thema einer Reservierung (Fallback '–' wenn leer). */
function themaAnzeige(kurs: Kurs): string {
  const thema = kurs.thema?.trim();
  return thema ? thema : KEIN_WERT;
}

/** Liefert die Reservierungsfrist als "TT.MM.JJJJ" (Fallback '–'). */
function fristAnzeige(kurs: Kurs): string {
  return formatDatumIso(kurs.frist_ende);
}

/** Liefert den frühesten Termin-Start eines Kurses als Zeitstempel (Sortierung). */
function ersterTerminStart(kurs: Kurs): number {
  const start = toDate(kurs.termine[0]?.date_start);
  return start ? start.getTime() : Number.MAX_SAFE_INTEGER;
}

/**
 * Kürzt einen Angebotstitel für die Kalenderanzeige: Alles ab dem ersten
 * Doppelpunkt (inkl. des Doppelpunkts) entfällt; der Rest wird getrimmt.
 */
function kuerzeTitel(titel: string | null): string {
  return titel ? titel.split(':')[0].trim() : '';
}

// ---------------------------------------------------------------------------
// Seite
// ---------------------------------------------------------------------------

export default function ReservierungenPage() {
  const [ansicht, setAnsicht] = useState<Ansicht>('liste');

  const [reservierungen, setReservierungen] = useState<ReservierungZeile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [fehler, setFehler] = useState<string | null>(null);

  // Aktive Klick-Filter der Listenansicht (Kunde / Trainer / Reservierungscode).
  const [filterKunde, setFilterKunde] = useState<string | null>(null);
  const [filterTrainer, setFilterTrainer] = useState<string | null>(null);
  const [filterCode, setFilterCode] = useState<string | null>(null);

  // Reservierungscode (bzw. gruppe_code der Welt B) der Zeile, deren
  // Bearbeiten-Dialog gerade geöffnet ist (null = Dialog geschlossen).
  const [bearbeitungsCode, setBearbeitungsCode] = useState<string | null>(null);

  // Angezeigter Monat (0-basiert) der Monatsübersicht – initial der aktuelle Monat.
  const jetzt = new Date();
  const [jahr, setJahr] = useState<number>(jetzt.getFullYear());
  const [monat, setMonat] = useState<number>(jetzt.getMonth());

  const ladeReservierungen = useCallback(async () => {
    try {
      const res = await fetch('/api/termine', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as Kurs[];

      // Defense-in-Depth: Nur vollständige Kurse verarbeiten und danach
      // zwingend ausschließlich Reservierungen (date_status case-insensitive)
      // herausfiltern. Die API liefert hier beide Welten (Welt A:
      // public.termin_reservierung, Welt B: public.trainer_reservierung).
      const zeilen: ReservierungZeile[] = [];
      for (const kurs of data) {
        if (kurs === null || !Array.isArray(kurs.termine)) continue;
        if (kurs.date_status?.toLowerCase() !== 'reservierung') continue;
        for (const termin of kurs.termine) {
          zeilen.push({ kurs, termin });
        }
      }

      // Aufsteigend nach Datum/Zeit sortieren (frühester Termin zuerst).
      zeilen.sort(
        (a, b) =>
          ersterTerminStart(a.kurs) - ersterTerminStart(b.kurs) ||
          (a.termin.date_id < b.termin.date_id ? -1 : 1)
      );
      setReservierungen(zeilen);
      setFehler(null);
    } catch (err) {
      console.error('Fehler beim Laden der Reservierungen:', err);
      setFehler(
        err instanceof Error ? err.message : 'Unbekannter Fehler beim Laden.'
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void ladeReservierungen();
  }, [ladeReservierungen]);

  // Kalender-Raster für den ausgewählten Monat (inkl. Überhang-Tagen).
  const raster = useMemo(() => monatsRaster(jahr, monat), [jahr, monat]);

  // Reservierungen je ISO-Tag gruppiert, innerhalb des Tages nach Startzeit
  // sortiert – Grundlage der eigenständigen Monatsübersicht.
  const eintraegeProTag = useMemo(() => {
    const map: Record<string, TagEintrag[]> = {};
    for (const zeile of reservierungen) {
      const start = toDate(zeile.termin.date_start);
      if (!start) continue;
      const iso = toIsoDate(start);
      if (!map[iso]) map[iso] = [];
      map[iso].push({
        kurs: zeile.kurs,
        termin: zeile.termin,
        startZeit: zeitFormatter.format(start),
      });
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.startZeit.localeCompare(b.startZeit));
    }
    return map;
  }, [reservierungen]);

  // Monatsweise vor-/zurückblättern (Jahreswechsel werden korrekt behandelt).
  const monatWechseln = useCallback(
    (delta: number) => {
      const ziel = new Date(jahr, monat + delta, 1);
      setJahr(ziel.getFullYear());
      setMonat(ziel.getMonth());
    },
    [jahr, monat]
  );

  // Zurück zum aktuellen Monat springen.
  const zuHeute = useCallback(() => {
    const n = new Date();
    setJahr(n.getFullYear());
    setMonat(n.getMonth());
  }, []);

  const neuLaden = useCallback(() => {
    setIsRefreshing(true);
    void ladeReservierungen();
  }, [ladeReservierungen]);

  // -------------------------------------------------------------------------
  // Bearbeiten-Dialog (Stift-Icon je Zeile)
  // -------------------------------------------------------------------------

  /** Öffnet den Reservierungs-Bearbeiten-Dialog für den Code einer Zeile. */
  const oeffneBearbeiten = useCallback((code: string) => {
    setBearbeitungsCode(code);
  }, []);

  /** Schließt den Dialog ohne Aktion. */
  const schliesseBearbeiten = useCallback(() => {
    setBearbeitungsCode(null);
  }, []);

  /** Nach erfolgreichem Speichern/Löschen: Dialog schließen und die Liste
   *  im Hintergrund neu laden (ohne Browser-Reload). */
  const nachBearbeitenGespeichert = useCallback(() => {
    setBearbeitungsCode(null);
    void ladeReservierungen();
  }, [ladeReservierungen]);

  // -------------------------------------------------------------------------
  // Klick-Filter der Listenansicht
  // -------------------------------------------------------------------------

  /** Setzt den Kunde-Filter auf den angeklickten Kundenbezug. */
  const setzeKundeFilter = useCallback((kunde: string) => {
    setFilterKunde(kunde);
  }, []);

  /** Setzt den Trainer-Filter auf den angeklickten Trainernamen. */
  const setzeTrainerFilter = useCallback((trainer: string) => {
    setFilterTrainer(trainer);
  }, []);

  /** Setzt den Code-Filter auf den angeklickten Reservierungscode. */
  const setzeCodeFilter = useCallback((code: string) => {
    setFilterCode(code);
  }, []);

  /** Entfernt alle aktiven Filter. */
  const filterZuruecksetzen = useCallback(() => {
    setFilterKunde(null);
    setFilterTrainer(null);
    setFilterCode(null);
  }, []);

  /** Liste der aktiven Filter für die Filterleiste. */
  const aktiveFilter: AktiverFilter[] = [];
  if (filterKunde) {
    aktiveFilter.push({
      label: 'Kunde',
      wert: filterKunde,
      entfernen: () => setFilterKunde(null),
    });
  }
  if (filterTrainer) {
    aktiveFilter.push({
      label: 'Trainer',
      wert: filterTrainer,
      entfernen: () => setFilterTrainer(null),
    });
  }
  if (filterCode) {
    aktiveFilter.push({
      label: 'Reservierungscode',
      wert: filterCode,
      entfernen: () => setFilterCode(null),
    });
  }

  /**
   * Gefilterte Zeilen der Listenansicht. Die Monatsübersicht arbeitet
   * weiterhin mit der ungefilterten Liste (reservierungen).
   */
  const gefilterteReservierungen = useMemo(() => {
    if (!filterKunde && !filterTrainer && !filterCode) return reservierungen;
    return reservierungen.filter((zeile) => {
      if (filterKunde && kundenAnzeige(zeile.kurs) !== filterKunde) {
        return false;
      }
      if (filterTrainer && trainerAnzeige(zeile.kurs) !== filterTrainer) {
        return false;
      }
      if (filterCode && reservierungsCode(zeile.kurs) !== filterCode) {
        return false;
      }
      return true;
    });
  }, [reservierungen, filterKunde, filterTrainer, filterCode]);

  const heuteIso = toIsoDate(new Date());
  const monatsTitel = `${MONATSNAMEN[monat]} ${jahr}`;

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-800 sm:p-6">
      <AppHeader />
      <p className="mb-6 text-xs text-slate-500">
        Alle angefragten Firmenkurse und Trainer-Reservierungen im Status
        „Reservierung“ – als Liste oder in der eigenen Monatsübersicht.
      </p>

      {/* Ansicht-Toggle: Listenansicht / Monatsübersicht */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setAnsicht('liste')}
            aria-pressed={ansicht === 'liste'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${ansicht === 'liste'
              ? 'bg-cd-blue text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <List className="w-4 h-4" />
            Listenansicht
          </button>
          <button
            type="button"
            onClick={() => setAnsicht('monat')}
            aria-pressed={ansicht === 'monat'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${ansicht === 'monat'
              ? 'bg-cd-blue text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            Monatsübersicht
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {reservierungen.length === 1
              ? '1 Reservierung'
              : `${reservierungen.length} Reservierungen`}
          </span>
          <button
            type="button"
            onClick={neuLaden}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-60"
          >
            <RefreshCw
              className={`w-4 h-4 text-cd-blue ${isRefreshing ? 'animate-spin' : ''}`}
            />
            Aktualisieren
          </button>
        </div>
      </div>

      {/* Laden / Fehlerzustand */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin text-cd-blue" />
          Reservierungen werden geladen…
        </div>
      )}

      {!isLoading && fehler && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500" />
          <p className="text-sm text-slate-600">
            Reservierungen konnten nicht geladen werden ({fehler}).
          </p>
          <button
            type="button"
            onClick={neuLaden}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
          >
            <RefreshCw
              className={`w-4 h-4 text-cd-blue ${isRefreshing ? 'animate-spin' : ''}`}
            />
            Erneut versuchen
          </button>
        </div>
      )}

      {/* ====== Ansicht: Listenansicht ====== */}
      {!isLoading && !fehler && ansicht === 'liste' && (
        <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
            <p className="text-sm font-medium text-slate-700">
              {gefilterteReservierungen.length === 1
                ? '1 Reservierung'
                : `${gefilterteReservierungen.length} Reservierungen`}
              {aktiveFilter.length > 0 && (
                <span className="ml-2 text-xs text-slate-500">
                  (gefiltert von {reservierungen.length})
                </span>
              )}
            </p>
          </div>

          {/* Leiste der aktiven Filter inkl. „Filter zurücksetzen“ */}
          {aktiveFilter.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-200 bg-blue-50/50">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <Filter className="w-3.5 h-3.5 text-cd-blue" />
                Aktive Filter:
              </span>
              {aktiveFilter.map((filter) => (
                <span
                  key={filter.label}
                  className="inline-flex items-center gap-1.5 rounded-full bg-cd-blue/10 px-2.5 py-0.5 text-xs font-medium text-cd-blue"
                >
                  {filter.label}: {filter.wert}
                  <button
                    type="button"
                    onClick={filter.entfernen}
                    aria-label={`Filter ${filter.label} entfernen`}
                    title={`Filter ${filter.label} entfernen`}
                    className="inline-flex items-center justify-center w-4 h-4 rounded-full text-cd-blue hover:bg-cd-blue/20 hover:text-cd-blue/80"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={filterZuruecksetzen}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="w-3 h-3" />
                Filter zurücksetzen
              </button>
            </div>
          )}

          {gefilterteReservierungen.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-slate-500">
              {aktiveFilter.length > 0
                ? 'Keine Reservierungen entsprechen den aktiven Filtern.'
                : 'Aktuell sind keine Reservierungen vorhanden.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 uppercase tracking-wide border-b border-slate-200">
                    <th className="px-4 py-2.5 font-semibold">Reservierungscode</th>
                    <th className="px-4 py-2.5 font-semibold">Datum & Uhrzeit</th>
                    <th className="px-4 py-2.5 font-semibold">Thema</th>
                    <th className="px-4 py-2.5 font-semibold">KD-Nr.</th>
                    <th className="px-4 py-2.5 font-semibold">Kunde</th>
                    <th className="px-4 py-2.5 font-semibold">Trainer</th>
                    <th className="px-4 py-2.5 font-semibold">Frist</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {gefilterteReservierungen.map((zeile, index) => {
                    const { kurs, termin } = zeile;
                    const code = reservierungsCode(kurs);
                    const kunde = kundenAnzeige(kurs);
                    const trainer = trainerAnzeige(kurs);
                    return (
                      <tr
                        key={`${kurs.offer_id ?? 'kurs'}-${termin.date_id}`}
                        className={`border-b border-slate-100 ${index % 2 === 1 ? 'bg-slate-50/60' : ''}`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          {code !== KEIN_WERT ? (
                            <button
                              type="button"
                              onClick={() => setzeCodeFilter(code)}
                              title={`Nach Reservierungscode ${code} filtern`}
                              className="inline-flex items-center gap-1 cursor-pointer font-medium text-cd-blue hover:text-cd-blue hover:underline"
                            >
                              {code}
                            </button>
                          ) : (
                            <span className="text-slate-400">{KEIN_WERT}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                          {formatTermin(termin)}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {themaAnzeige(kurs)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                          {kdNrAnzeige(kurs)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {kunde !== KEIN_WERT ? (
                            <button
                              type="button"
                              onClick={() => setzeKundeFilter(kunde)}
                              title={`Nach Kunde ${kunde} filtern`}
                              className="inline-flex items-center gap-1 cursor-pointer font-medium text-slate-700 hover:text-cd-blue hover:underline"
                            >
                              {kunde}
                            </button>
                          ) : (
                            <span className="text-slate-400">{KEIN_WERT}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {trainer !== KEIN_TRAINER ? (
                            <button
                              type="button"
                              onClick={() => setzeTrainerFilter(trainer)}
                              title={`Nach Trainer ${trainer} filtern`}
                              className="inline-flex items-center gap-1 cursor-pointer font-medium text-slate-700 hover:text-cd-blue hover:underline"
                            >
                              {trainer}
                            </button>
                          ) : (
                            <span className="text-slate-400">{trainer}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                          {fristAnzeige(kurs)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          <button
                            type="button"
                            onClick={() => {
                              if (code !== KEIN_WERT) oeffneBearbeiten(code);
                            }}
                            disabled={code === KEIN_WERT}
                            title={
                              code !== KEIN_WERT
                                ? `Reservierung ${code} bearbeiten`
                                : 'Kein Reservierungscode vorhanden'
                            }
                            aria-label={
                              code !== KEIN_WERT
                                ? `Reservierung ${code} bearbeiten`
                                : 'Nicht bearbeitbar'
                            }
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-400 cursor-pointer hover:text-cd-blue hover:bg-blue-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ====== Ansicht: Monatsübersicht (nur Reservierungen) ====== */}
      {!isLoading && !fehler && ansicht === 'monat' && (
        <section>
          {/* Monats-Navigation: ‹ → Monat Jahr → › → Heute */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => monatWechseln(-1)}
              aria-label="Vorheriger Monat"
              title="Vorheriger Monat"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 font-semibold text-slate-800 whitespace-nowrap">
              <CalendarDays className="w-4 h-4 text-cd-blue" />
              {monatsTitel}
            </span>

            <button
              type="button"
              onClick={() => monatWechseln(1)}
              aria-label="Nächster Monat"
              title="Nächster Monat"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={zuHeute}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-cd-blue text-white hover:bg-cd-blue/90 transition"
            >
              Heute
            </button>
          </div>

          {reservierungen.length === 0 ? (
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
              <p className="px-4 py-12 text-center text-sm text-slate-500">
                Aktuell sind keine Reservierungen vorhanden.
              </p>
            </div>
          ) : (
            <div className="monats-scroll">
              <div className="monats-grid" role="grid" aria-label={monatsTitel}>
                {/* Kopfzeile */}
                <div className="monats-kopf monats-kw-kopf" role="columnheader">
                  KW
                </div>
                {WOCHENTAGE.map((tag) => (
                  <div
                    key={tag}
                    className="monats-kopf monats-wochentag"
                    role="columnheader"
                  >
                    {tag}
                  </div>
                ))}

                {/* Wochenzeilen */}
                {raster.map((woche, index) => (
                  <React.Fragment
                    key={`${woche.kw}-${toIsoDate(woche.tage[0].datum)}`}
                  >
                    <div
                      className={`monats-kw ${index % 2 === 0 ? 'monats-kw-gerade' : 'monats-kw-ungerade'}`}
                      role="rowheader"
                      aria-label={`Kalenderwoche ${woche.kw}`}
                    >
                      {woche.kw}
                    </div>
                    {woche.tage.map((tag, index) => {
                      const iso = toIsoDate(tag.datum);
                      const tagesEintraege = eintraegeProTag[iso] ?? [];
                      const sichtbare = tagesEintraege.slice(0, MAX_KURSE_PRO_TAG);
                      const uebrige =
                        tagesEintraege.length - sichtbare.length;
                      const istHeute = iso === heuteIso;

                      const zellenKlassen = [
                        'monats-tag',
                        tag.imMonat ? '' : 'monats-tag-fremd',
                        istHeute ? 'monats-tag-heute' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');

                      return (
                        <div
                          key={iso + '-' + index}
                          role="gridcell"
                          className={zellenKlassen}
                        >
                          {/* Kopf-Container für Datum (+ optionalem Feiertag):
                              Flex ohne Wrap – ein Feiertag würde direkt hinter
                              der Tageszahl beginnen und sein Text bei langen
                              Namen INNERHALB des Badges umbrechen, statt als
                              kompakter Block in eine zweite Zeile zu rutschen.
                              Überhang-Tage erhalten das Monatskürzel,
                              z. B. „31. Okt“ oder „1. Dez“. */}
                          <div className="flex items-start gap-1">
                            <div className="monats-tag-nummer">
                              {tag.imMonat
                                ? tag.datum.getDate()
                                : `${tag.datum.getDate()}.${'\u00A0'}${MONATSKUERZEL[tag.datum.getMonth()]}`}
                            </div>
                          </div>
                          <ul className="monats-kurs-liste">
                            {sichtbare.map((eintrag, i) => (
                              <li
                                key={`${eintrag.termin.date_id}-${iso}-${i}`}
                                title={eintrag.kurs.offer_name ?? ''}
                                className="monats-kurs monats-kurs-reserviert"
                              >
                                <span className="monats-kurs-zeit">
                                  {eintrag.startZeit}
                                </span>
                                <span className="monats-kurs-titel">
                                  {kuerzeTitel(eintrag.kurs.offer_name)}
                                </span>
                                <span className="monats-kurs-trainer">
                                  {trainerKuerzel(eintrag.kurs)}
                                </span>
                              </li>
                            ))}
                            {uebrige > 0 && (
                              <li className="monats-kurs-mehr">
                                +{uebrige} weitere
                              </li>
                            )}
                          </ul>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* Legende: Statusfarbe der Monatsübersicht */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-3 h-3 rounded-full bg-slate-400"
                aria-hidden="true"
              />
              Reservierung
            </span>
          </div>
        </section>
      )}

      <style>{`
        /* ------------------------------------------------------------------
         * Reservierungs-Monatsübersicht: CSS-Grid im Outlook-Stil
         * 1 schmale KW-Spalte links + 7 gleich breite Tages-Spalten (Mo–So).
         * ------------------------------------------------------------------ */
        .monats-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        .monats-grid {
          display: grid;
          grid-template-columns: 3.5rem repeat(7, minmax(0, 1fr));
          grid-auto-rows: auto;
          gap: 1px;
          background-color: #e2e8f0; /* slate-200 = Gitterlinien */
          border: 1px solid #cbd5e1; /* slate-300 */
          border-radius: 0.5rem;
          overflow: hidden;
          min-width: 56rem; /* horizontales Scrollen auf kleinen Screens */
        }

        .monats-kopf {
          background-color: #f1f5f9; /* slate-50 */
          color: #64748b;            /* slate-500 */
          font-size: 0.75rem;
          font-weight: 600;
          text-align: center;
          padding: 0.25rem 0;
          line-height: 1.2;
          border-bottom: 1px solid #cbd5e1;
        }

        .monats-kw-kopf {
          font-size: 0.625rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .monats-kw {
          background-color: #f8fafc;
          color: #64748b;
          font-size: 0.6875rem;
          font-weight: 600;
          text-align: center;
          display: flex;
          align-items: center;
          justify-content: center;
          border-right: 1px solid #cbd5e1;
        }

        .monats-kw-gerade {
          background-color: #f8fafc; /* slate-50 – Zebra-Zeile (gerade) */
        }

        .monats-kw-ungerade {
          background-color: #ffffff; /* white – Zebra-Zeile (ungerade) */
        }

        .monats-tag {
          background-color: #ffffff;
          min-height: 7.5rem;
          padding: 0.25rem 0.375rem;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }

        .monats-tag-fremd {
          background-color: #f8fafc; /* Überhang-Tage abgeschwächt */
          color: #94a3b8;
        }

        .monats-tag-heute {
          background-color: #eff6ff; /* blue-50 */
          box-shadow: inset 0 0 0 2px #3b82f6; /* blue-500 */
        }

        .monats-tag-nummer {
          font-size: 0.75rem;
          font-weight: 600;
          line-height: 1;
          align-self: flex-start;
          padding: 0 0.25rem;
          white-space: nowrap; /* „31. Okt“ bleibt als Einheit – nur das
                                  Feiertags-Badge darf umbrechen */
        }

        .monats-kurs-liste {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }

        .monats-kurs {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.125rem 0.25rem;
          border-radius: 0.25rem;
          background-color: #dbeafe; /* blue-100 */
          border: 1px solid #93c5fd; /* blue-300 */
          font-size: 0.6875rem;
          line-height: 1.1;
          overflow: hidden;
          white-space: nowrap;
        }

        /* Reservierungen: dezentes Grau (slate-100 / slate-700). */
        .monats-kurs-reserviert {
          background-color: #f1f5f9; /* slate-100 */
          border-color: #cbd5e1;     /* slate-300 */
          color: #334155;            /* slate-700 */
        }

        .monats-kurs-reserviert .monats-kurs-titel {
          color: #334155;            /* slate-700 */
          font-weight: 600;
        }

        .monats-kurs-reserviert .monats-kurs-zeit {
          color: #334155;            /* slate-700 */
        }

        .monats-kurs-zeit {
          font-weight: 700;
          color: inherit;
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }

        .monats-kurs-titel {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .monats-kurs-trainer {
          flex-shrink: 0;
          font-weight: 700;
          color: inherit;
        }

        .monats-kurs-mehr {
          font-size: 0.625rem;
          color: #64748b;
          font-weight: 600;
          padding: 0.125rem 0.25rem;
        }
      `}</style>

      {/* Bearbeiten-Dialog (zentrale Komponente): öffnet je Zeile über den
          Reservierungscode der Zeile (Welt B: gruppe_code). Nach
          Speichern/Löschen triggert onSuccess den Re-Fetch der Liste. */}
      <ReservierungsGruppeDialog
        isOpen={bearbeitungsCode !== null}
        gruppeCode={bearbeitungsCode}
        onClose={schliesseBearbeiten}
        onSuccess={nachBearbeitenGespeichert}
      />
    </main>
  );
}
