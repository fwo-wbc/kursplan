'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CalendarDays,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Check,
  TriangleAlert,
  Users,
  Search,
  FilterX,
  X,
  ChevronDown,
  User,
  FileText,
  Wand2,
} from 'lucide-react';
import AppHeader from './components/AppHeader';
import { berechneHonorar } from '@/lib/honorar';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Zulässige Statuswerte einer Trainer-Zuweisung (einheitliches Statusmodell). */
type ZuweisungStatus =
  | 'keine Zuordnung'
  | 'ausgeschrieben'
  | 'unter Vorbehalt'
  | 'bestätigt'
  | 'abgesagt';

/** Trainer-Stammdaten aus GET /api/trainer. */
interface Trainer {
  id: number;
  vorname: string;
  nachname: string;
  kuerzel: string | null;
  is_active: boolean;
  edoobox_admin_id: string | null;
  tagessatz: number;
  halbtagessatz: number;
  stundensatz: number;
  reduzierter_satz: number;
  honorar_90min: number;
}

/** Trainer-Kurzprofil innerhalb einer Zuweisung. */
interface TrainerKurz {
  kuerzel: string | null;
}

/** Eine Trainer-Zuweisung. */
interface Zuweisung {
  id: number | null;
  trainer_id: number | null;
  status: ZuweisungStatus | null;
  notiz: string | null;
  honorar_manuell: number | null;
  trainer: TrainerKurz | null;
  quelle?: 'edoobox' | 'lokal';
}

/** Ein einzelner Termin (offer_date) eines Kurses. */
interface KursTermin {
  date_id: string;
  date_start: string | null;
  date_end: string | null;
}

/**
 * Ein Kurs/Angebot aus GET /api/termine. Mehrtägige Kurse besitzen mehrere
 * termine; Trainerzuweisung und Zuweisungsstatus gelten einheitlich für den
 * gesamten Kurs.
 */
/** Persistente Options-Haken eines Kurses (aggregiert über alle Termine). */
interface KursOptionen {
  einladungslink: boolean;
  last_minute: boolean;
  abgerechnet: boolean;
}

interface Kurs {
  offer_id: string | null;
  termine: KursTermin[];
  date_status: string | null;
  offer_name: string | null;
  offer_type: string | null;
  kursnr: string | null;
  teilnehmer: number;
  max_plaetze: number | null;
  einnahmen: number;
  tags: string[];
  zuweisungen: Zuweisung[];
  /** Roher edoobox-Angebotsstatus (o.status) für Status-Ableitungen. */
  offer_status?: string | null;
  /** Effektiver Zuweisungsstatus des Kurses (erste Zuweisung). */
  zuweisung_status?: ZuweisungStatus | null;
  /** Verfügbarkeit je aktivem Trainer (trainer_id -> ist_verfuegbar). */
  trainer_verfuegbarkeit?: Record<string, boolean>;
  /**
   * Verfügbarkeit des zugewiesenen Trainers für alle Kurstage:
   * null = kein Trainer zugewiesen (oder Status 'keine Zuordnung'),
   * true = zugewiesener Trainer ist für alle Kurstage als 'frei' eingetragen,
   * false = zugewiesener Trainer ist nicht (vollständig) verfügbar.
   */
  trainer_verfuegbar?: boolean | null;
  /** Persistente Options-Haken (Einladungslink, Last Minute, abgerechnet). */
  optionen?: KursOptionen;
  /** Aktuelles Trainerkürzel der ersten Zuweisung ('n. v.' wenn keiner). */
  trainer_kuerzel?: string | null;
  /** true, wenn der Kurs eine aktive Trainer-Zuweisung besitzt. */
  hat_trainer?: boolean;
}

/** Ein Anzeige-Eintrag der flachen Terminliste: ein Kurs-Einzeltermin. */
interface FlacherTermin {
  /** Der zugehörige Kurs (Zuweisung, Status, Optionen gelten kursweit). */
  kurs: Kurs;
  /** Der konkrete Einzeltermin, der in dieser Zeile angezeigt wird. */
  termin: KursTermin;
  /** 0-basierter Index des Termins im Termin-Array des Kurses. */
  terminIndex: number;
  /** Gesamtzahl der Termine des Kurses (für „Tag X von N“). */
  terminAnzahl: number;
}

/** Pro Kurs angezeigtes Auto-Save-Feedback. */
interface Feedback {
  type: 'success' | 'error';
  text: string;
}

// ---------------------------------------------------------------------------
// Bereinigung doppelter Trainer-Zuweisungen (POST /api/cleanup-assignments)
// ---------------------------------------------------------------------------

/** Ein Trainer samt Zuweisungsstatus in der Bereinigungs-Antwort. */
interface CleanupTrainer {
  trainer_id: number;
  name: string;
  kuerzel: string | null;
  status: string | null;
}

/** Ein automatisch aufgelöster Termin (Dublette mit genau einer Bestätigung). */
interface CleanupBereinigt {
  date_id: string;
  offer_id: string | null;
  kursnr: string | null;
  titel: string | null;
  datum: string | null;
  start_uhr: number | null;
  behalten: CleanupTrainer;
  entfernt: CleanupTrainer[];
}

/** Eine uneindeutige Dublette zur manuellen Korrektur (kein Löschvorgang). */
interface CleanupKonflikt {
  date_id: string;
  offer_id: string | null;
  kursnr: string | null;
  titel: string | null;
  datum: string | null;
  start_uhr: number | null;
  trainer: CleanupTrainer[];
}

/** Vollständige Antwort von POST /api/cleanup-assignments. */
interface CleanupErgebnis {
  ok: boolean;
  bereinigt: CleanupBereinigt[];
  konflikte: CleanupKonflikt[];
  zusammenfassung: {
    dubletten: number;
    bereinigt: number;
    konflikte: number;
    geloeschte_zuweisungen: number;
  };
}

/** Formatiert eine Startzeit (Dezimalstunden) als HH:MM. */
function cleanupStartzeitText(startUhr: number | null): string {
  if (startUhr === null || !Number.isFinite(startUhr)) return '–';
  const stunden = Math.floor(startUhr);
  const minuten = Math.round((startUhr - stunden) * 60);
  return `${String(stunden).padStart(2, '0')}:${String(minuten).padStart(2, '0')}`;
}

/** Tailwind-Klassen für den farbigen Status-Badge eines Trainers. */
function cleanupStatusBadgeClass(status: string | null): string {
  switch (status) {
    case 'bestätigt':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'ausgeschrieben':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'unter Vorbehalt':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'abgesagt':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'keine Zuordnung':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

/** Beschreibung einer Trainer-Doppelbelegung eines Kurses. */
interface KursKonflikt {
  /** Kurs-Schlüssel des kollidierenden Kurses. */
  kursKey: string;
  /** Vorformulierter Tooltip-Text der Kollision. */
  text: string;
  /**
   * Echter Terminkonflikt: mindestens zwei der überlappenden Termine
   * besitzen den Status „Bestätigt" (Doppel-Bestätigung desselben Trainers).
   */
  echt: boolean;
}

// ---------------------------------------------------------------------------
// Konstanten & Formatierung
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: { value: ZuweisungStatus; label: string }[] = [
  { value: 'keine Zuordnung', label: 'Keine Zuordnung' },
  { value: 'ausgeschrieben', label: 'Ausgeschrieben' },
  { value: 'unter Vorbehalt', label: 'Unter Vorbehalt' },
  { value: 'bestätigt', label: 'Bestätigt' },
  { value: 'abgesagt', label: 'Abgesagt' },
];

/** Fallback, falls die API noch keine Optionen liefert (robustes Rendering). */
const LEERE_OPTIONEN: KursOptionen = {
  einladungslink: false,
  last_minute: false,
  abgerechnet: false,
};

/** Definitionen der drei schaltbaren Options-Haken (Spaltenreihenfolge). */
const OPTIONEN_DEFINITIONEN: {
  key: keyof KursOptionen;
  label: string;
  title: string;
}[] = [
  {
    key: 'einladungslink',
    label: 'Kurs-Link',
    title: 'Einladungslink gesendet',
  },
  {
    key: 'abgerechnet',
    label: 'Fakt',
    title: 'Kurs wurde abgerechnet',
  },
];

/** Farb-Schema je Zuweisungs-Status für das Auswahlfeld und den Status-Punkt. */
const ZUWEISUNG_STATUS_CONFIG: Record<
  ZuweisungStatus,
  { selectClassName: string; dotClassName: string }
> = {
  'keine Zuordnung': {
    selectClassName: 'bg-red-600 text-yellow-300 border-red-700 focus:ring-red-500',
    dotClassName: 'bg-red-600',
  },
  ausgeschrieben: {
    selectClassName: 'bg-blue-50 text-blue-800 border-blue-300 focus:ring-blue-500',
    dotClassName: 'bg-blue-500',
  },
  'unter Vorbehalt': {
    selectClassName: 'bg-amber-50 text-amber-800 border-amber-300 focus:ring-amber-500',
    dotClassName: 'bg-amber-500',
  },
  bestätigt: {
    selectClassName: 'bg-emerald-50 text-emerald-800 border-emerald-300 focus:ring-emerald-500',
    dotClassName: 'bg-emerald-500',
  },
  abgesagt: {
    selectClassName: 'bg-red-50 text-red-800 border-red-300 focus:ring-red-500',
    dotClassName: 'bg-red-500',
  },
};

const STATUS_CONFIG: Record<string, { label: string; badgeClasses: string }> = {
  'Veröffentlicht': {
    label: 'Veröffentlicht',
    badgeClasses: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  'Garantierte Durchführung': {
    label: 'Garantierte Durchführung',
    badgeClasses: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  'Freigegeben': {
    label: 'Freigegeben',
    badgeClasses: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  'Geschlossen': {
    label: 'Geschlossen',
    badgeClasses: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  'Geschlossen (mit TN)': {
    label: 'Geschlossen (mit TN)',
    badgeClasses: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  'Geschlossen (ohne TN)': {
    label: 'Geschlossen (ohne TN)',
    badgeClasses: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  'Abgesagt': {
    label: 'Abgesagt',
    badgeClasses: 'bg-red-50 text-red-700 border-red-200 line-through opacity-75',
  },
  'Unbekannt': {
    label: 'Unbekannt',
    badgeClasses: 'bg-slate-100 text-slate-600 border-slate-200',
  },
};

/** Reihenfolge der Statuswerte im Kursstatus-Filter. */
const STATUS_FILTER_REIHENFOLGE = [
  'Veröffentlicht',
  'Garantierte Durchführung',
  'Freigegeben',
  'Geschlossen (mit TN)',
  'Geschlossen (ohne TN)',
  'Abgesagt',
];

/** Status-Optionen für den Kursstatus-Filter, abgeleitet aus STATUS_CONFIG. */
const STATUS_FILTER_OPTIONS = STATUS_FILTER_REIHENFOLGE
  .filter((value) => STATUS_CONFIG[value])
  .map((value) => ({ value, label: STATUS_CONFIG[value].label }));

/** Vorausgewählte Statuswerte (Standard-Filterauswahl). */
const DEFAULT_STATUS_FILTERS = [
  'Veröffentlicht',
  'Garantierte Durchführung',
  'Freigegeben',
  'Geschlossen (mit TN)',
];

/** Zeitfilter-Optionen für das Jahr (Anforderung: Alle, 2025–2027). */
const JAHR_OPTIONS = ['2025', '2026', '2027'];

/** Zeitfilter-Optionen für den Monat. */
const MONAT_OPTIONS = [
  { value: '1', label: 'Januar' },
  { value: '2', label: 'Februar' },
  { value: '3', label: 'März' },
  { value: '4', label: 'April' },
  { value: '5', label: 'Mai' },
  { value: '6', label: 'Juni' },
  { value: '7', label: 'Juli' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'Oktober' },
  { value: '11', label: 'November' },
  { value: '12', label: 'Dezember' },
];

/** Zeitfilter-Optionen für die Kalenderwoche (KW 1–53). */
const KW_OPTIONS = Array.from({ length: 53 }, (_, index) => String(index + 1));

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const weekdayShortFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
});

const dateShortFormatter = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
});

const dateRangeFormatter = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Währungsformatierung für die Kennzahlenspalte „Einnahmen“. */
const euroFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Währungsformatierung für Honorarbeträge (mit Cent-Angabe). */
const honorarFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATUM_FALLBACK = 'Datum unbekannt';

function isZuweisungStatus(value: unknown): value is ZuweisungStatus {
  return (
    value === 'keine Zuordnung' ||
    value === 'ausgeschrieben' ||
    value === 'unter Vorbehalt' ||
    value === 'bestätigt' ||
    value === 'abgesagt'
  );
}

/** Erzeugt eine unabhängige Kopie einer Zuweisung für optimistische Rollbacks. */
function cloneZuweisung(z: Zuweisung | null): Zuweisung | null {
  if (!z) return null;
  return {
    ...z,
    trainer: z.trainer ? { ...z.trainer } : null,
  };
}

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

/** Liefert einen stabilen Schlüssel für einen Kurs. */
function kursKey(kurs: Kurs): string {
  return kurs.offer_id ?? kurs.termine[0]?.date_id ?? 'unbekannt';
}

/** Liefert den frühesten Termin-Start eines Kurses. */
function kursStartDate(kurs: Kurs): Date | null {
  let earliest: Date | null = null;
  for (const termin of kurs.termine) {
    const datum = toDate(termin.date_start);
    if (datum && (!earliest || datum.getTime() < earliest.getTime())) {
      earliest = datum;
    }
  }
  return earliest;
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

/** Formatiert Einnahmen als Währungsbetrag, z. B. „1.250 €“. */
function formatEinnahmen(wert: number): string {
  return euroFormatter.format(Number.isFinite(wert) ? wert : 0);
}

/** Beschreibt die Anzeige der Spalte „Datum & Zeit“ eines Kurses. */
interface KursZeitraumAnzeige {
  haupt: string;
  detail: string | null;
}

/**
 * Formatiert einen Einzeltermin und trennt Datum und Uhrzeit:
 * Die Uhrzeit wird ohne Komma separat als zweite Zeile gerendert.
 */
function formatZeitraum(
  dateStart: string | null,
  dateEnd: string | null
): KursZeitraumAnzeige {
  const start = toDate(dateStart);
  const end = toDate(dateEnd);

  if (!start && !end) return { haupt: DATUM_FALLBACK, detail: null };

  const basis = start ?? end;
  const datumTeil = basis ? dateFormatter.format(basis) : DATUM_FALLBACK;
  const startZeit = start ? timeFormatter.format(start) : null;
  const endZeit = end ? timeFormatter.format(end) : null;

  let detail: string | null = null;
  if (startZeit && endZeit) {
    detail = `${startZeit} – ${endZeit} Uhr`;
  } else if (startZeit) {
    detail = `${startZeit} Uhr`;
  } else if (endZeit) {
    detail = `${endZeit} Uhr`;
  }

  return { haupt: datumTeil, detail };
}

/** Formatiert eine Datumsspanne zweier Stichtage, z. B. „15.09. – 17.09.2026“. */
function formatDatumSpanne(a: Date | null, b: Date | null): string {
  if (!a && !b) return DATUM_FALLBACK;
  const first = a ?? (b as Date);
  const last = b ?? (a as Date);

  if (a && b && a.getFullYear() === b.getFullYear()) {
    return `${dateShortFormatter.format(first)} – ${dateRangeFormatter.format(last)}`;
  }
  return `${dateRangeFormatter.format(first)} – ${dateRangeFormatter.format(last)}`;
}

/**
 * Erzeugt eine kompakte, mehrzeilige Anzeige für (mehrtägige) Kurse:
 *   „Mo., Di. · 15.09. – 17.09.2026“ mit Zeitangabe „09:00 – 12:30 Uhr“.
 */
function kursZeitraum(kurs: Kurs): KursZeitraumAnzeige {
  const termine = [...kurs.termine].sort((a, b) => {
    const zeitA = toDate(a.date_start)?.getTime() ?? 0;
    const zeitB = toDate(b.date_start)?.getTime() ?? 0;
    return zeitA - zeitB;
  });

  if (termine.length === 0) {
    return { haupt: DATUM_FALLBACK, detail: null };
  }

  if (termine.length === 1) {
    return formatZeitraum(termine[0].date_start, termine[0].date_end);
  }

  const wochentage: string[] = [];
  const startZeiten: string[] = [];
  const endZeiten: string[] = [];
  let firstStart: Date | null = null;
  let lastStart: Date | null = null;
  let minStartZeit: Date | null = null;
  let maxEndZeit: Date | null = null;

  for (const termin of termine) {
    const start = toDate(termin.date_start);
    const end = toDate(termin.date_end);

    if (start) {
      const wd = weekdayShortFormatter.format(start);
      if (wochentage[wochentage.length - 1] !== wd) wochentage.push(wd);

      if (!firstStart) firstStart = start;
      lastStart = start;

      if (!minStartZeit || start.getTime() < minStartZeit.getTime()) {
        minStartZeit = start;
      }
      if (end && (!maxEndZeit || end.getTime() > maxEndZeit.getTime())) {
        maxEndZeit = end;
      }

      startZeiten.push(timeFormatter.format(start));
      if (end) endZeiten.push(timeFormatter.format(end));
    }
  }

  const wochentageText = wochentage.join(', ');
  const datumTeil = formatDatumSpanne(firstStart, lastStart);

  // Zeitdarstellung: konsistente Zeiten => eine Spanne, sonst das Gesamtfenster.
  const zeitenKonsistent =
    startZeiten.length > 0 &&
    endZeiten.length > 0 &&
    startZeiten.every((zeit) => zeit === startZeiten[0]) &&
    endZeiten.every((zeit) => zeit === endZeiten[0]);

  let zeitText: string | null = null;
  if (zeitenKonsistent) {
    zeitText = `${startZeiten[0]} – ${endZeiten[0]} Uhr`;
  } else if (minStartZeit) {
    const start = timeFormatter.format(minStartZeit);
    const end = maxEndZeit ? timeFormatter.format(maxEndZeit) : null;
    zeitText = end ? `${start} – ${end} Uhr` : `${start} Uhr`;
  }

  const haupt = wochentageText ? `${wochentageText} · ${datumTeil}` : datumTeil;

  return { haupt, detail: zeitText };
}

/** Prüft, ob zwei Daten auf denselben Kalendertag fallen. */
function gleicherKalendertag(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Prüft, ob sich zwei Termin-Zeitfenster überschneiden.
 * Fehlen Zeitangaben, wird konservativ auf denselben Kalendertag geprüft.
 */
function ueberschneidenSich(
  aStart: string | null,
  aEnd: string | null,
  bStart: string | null,
  bEnd: string | null
): boolean {
  const as = toDate(aStart);
  const ae = toDate(aEnd);
  const bs = toDate(bStart);
  const be = toDate(bEnd);

  if (!as || !ae || !bs || !be) {
    return gleicherKalendertag(as ?? ae ?? null, bs ?? be ?? null);
  }

  return as.getTime() < be.getTime() && bs.getTime() < ae.getTime();
}

/**
 * Bestimmt, ob ein Kurs für Trainer-Konfliktprüfungen relevant ist.
 * Abgesagte Kurse (Status „5“) sowie geschlossene Kurse (Status „3“) ohne
 * Teilnehmer lösen keine Konflikte aus (Vermeidung von Phantom-Konflikten).
 */
function istKonfliktRelevant(kurs: Kurs): boolean {
  const status = kurs.date_status;
  if (status === 'Abgesagt') return false;
  if (status === 'Geschlossen' && kurs.teilnehmer === 0) return false;
  return true;
}

/**
 * Prüft, ob ein Kurs von der Zeilen-Hervorhebung ausgenommen ist.
 * Ausgenommen sind abgesagte Kurse sowie geschlossene Kurse ohne Teilnehmer.
 * Ausgenommene Kurse erhalten grundsätzlich das Standard-Styling (Fall 3).
 */
function istKursAusgenommen(kurs: Kurs): boolean {
  const status = kurs.date_status;
  if (status === 'Abgesagt') return true;
  if (status === 'Geschlossen' && kurs.teilnehmer === 0) return true;
  return false;
}

/** Erzeugt den Tooltip-Text einer Trainer-Kollision mit einem anderen Kurs. */
function konfliktText(kurs: Kurs): string {
  const kursnr = kurs.kursnr?.trim();
  return kursnr
    ? `Bereits eingeteilt in Kursnr. ${kursnr}`
    : 'Bereits eingeteilt in einem Paralleltermin (Kursnr. unbekannt)';
}

/** true, wenn der Zuweisungsstatus einer Bestätigung entspricht. */
function istBestaetigtStatus(
  status: string | null | undefined
): boolean {
  return status === 'bestätigt' || status === 'bestaetigt';
}

/** Erzeugt den Anzeigetext eines Trainers – ausschließlich das Kürzel. */
function trainerAnzeige(t: { kuerzel: string | null }): string {
  return t.kuerzel?.trim() ?? '';
}

/** Kürzt einen Angebotstitel für die Anzeige: Alles ab dem ersten Doppelpunkt
 *  (inkl. des Doppelpunkts) entfällt; der Rest wird getrimmt.
 *  Beispiel: "Excel Grundlagen Modul 4: Tabellenverknüpfungen" → "Excel Grundlagen Modul 4". */
function kuerzeAngebotstitel(titel: string | null): string {
  return titel ? titel.split(':')[0].trim() : '';
}

/**
 * Beschriftung einer Trainer-<option> im Format „[Kürzel] – [Vorname/Name]“,
 * z. B. „FW – Frank“. Fehlt der Name, wird nur das Kürzel angezeigt.
 */
function trainerLabel(t: Trainer): string {
  const kuerzel = t.kuerzel?.trim() ?? '';
  const name = [t.vorname, t.nachname]
    .map((teil) => (typeof teil === 'string' ? teil.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
  return kuerzel ? (name ? `${kuerzel} – ${name}` : kuerzel) : name;
}

/** Ein einzelner Hinweis-Badge eines Kurses. */
interface KursHinweis {
  text: string;
  className: string;
}

/**
 * Firmenkurse / Coachings erkennen: Die Kursnummer beginnt mit einer Ziffer
 * (z. B. "2250...", Regex /^\d/). Für diese Kurse wird das „Last Minute"-Badge
 * nicht angezeigt.
 */
function istFirmenkurs(kurs: Kurs): boolean {
  const erweitert = kurs as Kurs & {
    kursnummer?: string | null;
    nummer?: string | null;
    offer_number?: string | null;
  };
  const nummer =
    kurs.kursnr?.trim() ||
    erweitert.kursnummer?.trim() ||
    erweitert.nummer?.trim() ||
    erweitert.offer_number?.trim() ||
    '';
  return /^\d/.test(nummer);
}

/**
 * Dynamische Hinweis-Regeln je Kurs. Reihenfolge = Anzeigereihenfolge:
 * 1. Kurs abgesagt, 2. Last Minute, 3. Einladungslink, 4. Abgerechnet,
 * 5. Belegung (Ausgebucht / nur noch wenige Plätze), 6. fehlender Trainer.
 */
function kursHinweise(kurs: Kurs): KursHinweis[] {
  const hinweise: KursHinweis[] = [];
  const optionen = kurs.optionen ?? LEERE_OPTIONEN;

  if (kurs.date_status === 'Abgesagt') {
    hinweise.push({
      text: 'Abgesagt',
      className: 'bg-red-50 text-red-700 border-red-200',
    });
  }

  // Last-Minute-Badge nur rendern, wenn NICHT Firmenkurs/Coaching
  // (Kursnummer beginnt nicht mit einer Ziffer).
  if (optionen.last_minute && !istFirmenkurs(kurs)) {
    hinweise.push({
      text: 'Last Minute',
      className: 'bg-violet-50 text-violet-700 border-violet-200',
    });
  }

  if (optionen.einladungslink) {
    hinweise.push({
      text: 'Einladungslink',
      className: 'bg-sky-50 text-sky-700 border-sky-200',
    });
  }

  if (optionen.abgerechnet) {
    hinweise.push({
      text: 'Abgerechnet',
      className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    });
  }

  const maxPlaetze = kurs.max_plaetze ?? null;
  if (maxPlaetze !== null && maxPlaetze > 0) {
    const frei = maxPlaetze - kurs.teilnehmer;
    if (frei <= 0) {
      hinweise.push({
        text: 'Ausgebucht',
        className: 'bg-red-50 text-red-700 border-red-200',
      });
    } else if (frei <= 2) {
      hinweise.push({
        text: `Nur ${frei} Platz${frei === 1 ? '' : 'e'} frei`,
        className: 'bg-amber-50 text-amber-700 border-amber-200',
      });
    }
  }

  const hatTrainer = (kurs.zuweisungen[0]?.trainer_id ?? null) !== null;
  if (!hatTrainer && kurs.date_status !== 'Abgesagt') {
    hinweise.push({
      text: 'Kein Trainer',
      className: 'bg-amber-50 text-amber-700 border-amber-200',
    });
  }

  return hinweise;
}

/** Statuswerte, für die die automatisierte Schließungsprüfung greift. */
const SCHLIESSUNG_STATUSWERTE = [
  'Veröffentlicht',
  'Garantierte Durchführung',
  'Freigegeben',
];

/**
 * Automatisierte Schließungsprüfung: Kurse mit aktivem Status, 0 Teilnehmern
 * und Start innerhalb der nächsten 21 Tage erhalten den Hinweis
 * „Schließung prüfen“ (0–14 Tage = Signal-Rot, 15–21 Tage = Rosarot).
 * Alle übrigen Kurse liefern null (leere Zelle).
 */
function schliessungHinweis(kurs: Kurs, heuteIso: string): KursHinweis | null {
  if (!SCHLIESSUNG_STATUSWERTE.includes(kurs.date_status ?? '')) return null;
  if (kurs.teilnehmer !== 0) return null;

  const start = kursStartDate(kurs);
  if (!start) return null;
  const kursIso = toIsoDate(start);

  const diffTage = Math.round(
    (new Date(kursIso).getTime() - new Date(heuteIso).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  if (diffTage >= 0 && diffTage <= 14) {
    return {
      text: 'Schließung prüfen',
      className:
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-600 text-yellow-300 border border-red-700 shadow-sm whitespace-nowrap',
    };
  }

  if (diffTage > 14 && diffTage <= 21) {
    return {
      text: 'Schließung prüfen',
      className:
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-pink-200 text-pink-950 border border-pink-300 shadow-sm whitespace-nowrap',
    };
  }

  return null;
}

/**
 * Hinweis „TN-Liste vorhanden?“: Nur für Firmenkurse (Kursnummer beginnt mit
 * der Ziffer "2") mit genau 1 eingebuchtem Teilnehmer. Coachings ("9...")
 * und offene Kurse (Buchstaben) erhalten diesen Hinweis in keinem Fall.
 */
function tnListeHinweis(kurs: Kurs): KursHinweis | null {
  const erweitert = kurs as Kurs & {
    kursnummer?: string | null;
    nummer?: string | null;
    offer_number?: string | null;
    teilnehmer_anzahl?: number | null;
    buchungen?: number | null;
    participants?: number | null;
  };
  const nummer =
    kurs.kursnr?.trim() ||
    erweitert.kursnummer?.trim() ||
    erweitert.nummer?.trim() ||
    erweitert.offer_number?.trim() ||
    '';
  const istFirmenkurs = /^2/.test(nummer);
  const teilnehmer = Number(
    erweitert.teilnehmer_anzahl ??
      kurs.teilnehmer ??
      erweitert.buchungen ??
      erweitert.participants ??
      0
  );
  if (!istFirmenkurs || teilnehmer !== 1) return null;
  return {
    text: 'TN-Liste vorhanden?',
    className: 'bg-amber-100 text-amber-800 border-amber-300',
  };
}

/** Differenz in Tagen zwischen heute und dem frühesten Kursstart (ISO-Tage). */
function diffTageBisStart(kurs: Kurs, heuteIso: string): number {
  const start = kursStartDate(kurs);
  if (!start) return Number.NaN;
  const kursIso = toIsoDate(start);
  return Math.round(
    (new Date(kursIso).getTime() - new Date(heuteIso).getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

/**
 * Automatisierte Last-Minute-Erkennung: Kurse mit Start innerhalb der
 * nächsten 14 Tage, aktivem Status (Veröffentlicht / Garantierte
 * Durchführung), Einnahmen ab 100 € und ohne Last-Minute-Tag erhalten
 * das grüne „Last Minute"-Badge. Alle übrigen Kurse liefern null.
 */
function lastMinuteHinweis(kurs: Kurs, diffTage: number): KursHinweis | null {
  // Firmenkurse / Coachings (Kursnummer beginnt mit einer Ziffer) erhalten
  // grundsätzlich kein „Last Minute"-Badge.
  if (istFirmenkurs(kurs)) return null;
  if (!(diffTage >= 0 && diffTage <= 14)) return null;
  if (
    !['Veröffentlicht', 'Garantierte Durchführung'].includes(
      kurs.date_status ?? ''
    )
  ) {
    return null;
  }
  if ((kurs.einnahmen || 0) < 100) return null;
  if ((kurs.teilnehmer || 0) < 0) return null;

  // Tag-Prüfung: „LastMinute" bzw. „Last Minute" schließt das Badge aus.
  const hatLastMinuteTag = (kurs.tags ?? []).some((tag) => {
    const bereinigt = tag.trim().toLowerCase();
    return bereinigt === 'lastminute' || bereinigt === 'last minute';
  });
  if (hatLastMinuteTag) return null;

  return {
    text: 'Last Minute',
    className:
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-600 text-white border border-emerald-700 shadow-sm whitespace-nowrap',
  };
}

/**
 * Hinweis „Trainer nicht verfügbar": Greift, wenn ein Trainer zugewiesen ist
 * und dieser nicht für alle Kurstage als 'frei' eingetragen ist
 * (trainer_verfuegbar === false). Ohne Zuweisung bzw. bei Status
 * 'keine Zuordnung' bleibt der Wert null und es erscheint kein Hinweis.
 * Abgesagte Kurse (Zuweisungsstatus 'abgesagt', edoobox-Status '5') sowie
 * geschlossene Kurse (Status '3') ohne Teilnehmer zeigen keinen Hinweis.
 * Datumsabgleich: Vergangene Termine (Start vor dem heutigen Tag, Tagesbeginn
 * 00:00 ohne Uhrzeit-Fokus) rendern das Badge ebenfalls nicht mehr; es ist
 * ausschließlich für aktuelle und zukünftige Kurse relevant.
 */
function trainerNichtVerfuegbarHinweis(
  kurs: Kurs,
  heuteIso: string
): KursHinweis | null {
  if (kurs.trainer_verfuegbar !== false) return null;
  if (kurs.zuweisung_status === 'abgesagt') return null;
  if (kurs.offer_status === '5') return null;
  if (kurs.offer_status === '3' && (kurs.teilnehmer ?? 0) === 0) return null;

  // Datumsabgleich (Tagesbeginn, ohne Uhrzeit-Fokus): Das Badge erscheint nur
  // dann, wenn das Kursdatum größer oder gleich dem heutigen Datum ist.
  const start = kursStartDate(kurs);
  if (!start) return null;
  if (toIsoDate(start) < heuteIso) return null;

  return {
    text: 'Trainer nicht verfügbar',
    className:
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-600 text-yellow-300 border border-red-700 shadow-sm whitespace-nowrap',
  };
}

/** Eindeutige Schlüssel der klickbaren Hinweis-Badges in der Kurstitel-Spalte. */
type BadgeFilterKey = 'schliessung' | 'lastminute' | 'trainer' | 'tnliste' | 'konflikt';

/** Prüft, ob ein Kurs einen echten Terminkonflikt hat (beide überlappenden
 *  Kurse mit bestätigter Zuweisung). Repliziert die Kernlogik von
 *  konflikteProKurs für den Badge-Filter „Terminkonflikt". */
function kursHatEchtenKonflikt(kurs: Kurs, alleKurse: Kurs[]): boolean {
  if (!istKonfliktRelevant(kurs)) return false;
  const trainerId = kurs.zuweisungen[0]?.trainer_id ?? null;
  if (trainerId === null) return false;
  if (!istBestaetigtStatus(kurs.zuweisungen[0]?.status ?? null)) return false;

  return alleKurse.some((anderer) => {
    if (anderer === kurs) return false;
    if (!istKonfliktRelevant(anderer)) return false;
    if ((anderer.zuweisungen[0]?.trainer_id ?? null) !== trainerId) return false;
    if (!istBestaetigtStatus(anderer.zuweisungen[0]?.status ?? null)) return false;

    for (const ta of kurs.termine) {
      for (const tb of anderer.termine) {
        if (
          ueberschneidenSich(
            ta.date_start,
            ta.date_end,
            tb.date_start,
            tb.date_end
          )
        ) {
          return true;
        }
      }
    }
    return false;
  });
}

/** Prüft, ob ein Kurs das angegebene Hinweis-Badge trägt (Badge-Filter). */
function kursHatBadge(
  kurs: Kurs,
  badge: BadgeFilterKey,
  heuteIso: string,
  alleKurse: Kurs[]
): boolean {
  switch (badge) {
    case 'schliessung':
      return schliessungHinweis(kurs, heuteIso) !== null;
    case 'lastminute':
      return lastMinuteHinweis(kurs, diffTageBisStart(kurs, heuteIso)) !== null;
    case 'trainer':
      return trainerNichtVerfuegbarHinweis(kurs, heuteIso) !== null;
    case 'tnliste':
      return tnListeHinweis(kurs) !== null;
    case 'konflikt':
      return kursHatEchtenKonflikt(kurs, alleKurse);
    default:
      return false;
  }
}

/**
 * Berechnet das automatische Honorar eines Kurses nach Modell A anhand der
 * Vergütungssätze des zugewiesenen Trainers. Liefert null, wenn kein Trainer
 * zugewiesen oder dessen Sätze nicht ermittelbar sind.
 */
function berechneKursHonorar(
  kurs: Kurs,
  zuweisung: Zuweisung | null,
  trainerMap: Map<number, Trainer>
): number | null {
  const trainerId = zuweisung?.trainer_id ?? null;
  if (trainerId === null) return null;

  const trainer = trainerMap.get(trainerId);
  if (!trainer) return null;

  return berechneHonorar(kurs, trainer);
}

/** Kleiner Clear-Button zur Rücksetzung eines einzelnen Filterfelds. */
function FilterClearButton({
  onClick,
  label,
  position = 'right-2',
}: {
  onClick: () => void;
  label: string;
  position?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`absolute top-1/2 -translate-y-1/2 ${position} inline-flex items-center justify-center w-5 h-5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition`}
    >
      <X className="w-3.5 h-3.5" />
    </button>
  );
}

/** Dropdown-Pfeil für native Selects mit `appearance-none`. */
function SelectChevron() {
  return (
    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
  );
}

/** Spalte für das Dozentenhonorar mit Inline-Edit und Reset-Option. */
function HonorarZelle({
  honorar,
  manuell,
  disabled,
  onSave,
}: {
  honorar: number | null;
  manuell: boolean;
  disabled: boolean;
  onSave: (wert: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    if (disabled) return;
    setInput(honorar !== null ? String(honorar).replace('.', ',') : '');
    setEditing(true);
  };

  const commit = async () => {
    const normalized = input.trim().replace(',', '.');
    if (normalized === '') {
      setEditing(false);
      return;
    }
    const n = Number(normalized);
    if (!Number.isFinite(n) || n < 0) return;

    setSaving(true);
    try {
      await onSave(Math.round(n * 100) / 100);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (disabled || !manuell) return;
    setSaving(true);
    try {
      await onSave(null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing || saving) {
    return (
      <td className="px-3 py-3 text-right whitespace-nowrap align-top">
        <div className="inline-flex items-center justify-end gap-1 translate-x-[20px]">
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          ) : (
            <input
              type="number"
              min="0"
              step="0.01"
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="w-24 text-right text-sm border border-blue-400 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>
      </td>
    );
  }

  return (
    <td className="px-3 py-3 text-right whitespace-nowrap align-top">
      {disabled ? (
        <span className="text-slate-400">–</span>
      ) : (
        <div className="relative inline-flex items-start justify-end gap-1.5 pr-8 translate-x-[20px]">
          {manuell && (
            <span
              aria-hidden="true"
              className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0"
            />
          )}
          <button
            type="button"
            onClick={startEdit}
            title={
              manuell
                ? 'Manuell angepasst – klicken zum Bearbeiten'
                : 'Klicken zum Anpassen'
            }
            className={`text-sm tabular-nums focus:outline-none hover:bg-slate-200 rounded px-1.5 -mx-1.5 ${
              manuell ? 'text-violet-700 font-medium' : 'text-slate-800'
            }`}
          >
            {honorar !== null ? honorarFormatter.format(honorar) : '–'}
          </button>
          {manuell && (
            <button
              type="button"
              onClick={reset}
              title="Manuellen Wert zurücksetzen"
              aria-label="Manuellen Wert zurücksetzen"
              className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-100 transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Komponente
// ---------------------------------------------------------------------------

type SyncStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * Sync-Button der Kursmanagement-Seite. Saß früher ganz rechts in der
 * Hauptnavigation (Navigation.tsx) und verschob beim Laden („Synchronisiere...“)
 * die komplette obere Navigation. Er sitzt jetzt in der unteren Aktionszeile
 * links neben „Zuweisungen bereinigen“. Hört weiterhin auf das Trigger-Event
 * (kursplan:trigger-sync), das die Seite nach dem Speichern einer Zuweisung
 * auslöst.
 */
function SyncButton() {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [resetTimer, setResetTimer] = useState<ReturnType<typeof setTimeout> | null>(
    null
  );

  const handleSync = useCallback(async () => {
    if (status === 'loading') return;

    setStatus('loading');
    try {
      const response = await fetch('/api/sync/p90', {
        method: 'POST',
        // Festes Timeout, damit der Button bei hängendem n8n-Webhook nicht ewig lädt.
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        throw new Error(`Sync fehlgeschlagen (Status ${response.status})`);
      }
      setStatus('success');
      // Die Hauptseite (page.tsx) lädt ihre Kursdaten clientseitig in den
      // lokalen React-State (loadData -> fetch /api/termine). router.refresh()
      // aktualisiert nur Server-Component-Payloads, nicht diesen Client-State.
      // Deshalb garantierter Voll-Reload nach kurzer Verzögerung, damit der
      // Nutzer kurz das grüne Erfolgs-Icon sieht.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('kursplan:reload-silent'));
      }, 600);
    } catch {
      // Fehler oder Timeout: Ladezustand zuverlässig beenden.
      setStatus('error');
    }

    // Nach kurzem Feedback zurück in den Ruhezustand.
    if (resetTimer) clearTimeout(resetTimer);
    setResetTimer(
      setTimeout(() => {
        setStatus('idle');
        setResetTimer(null);
      }, 2500)
    );
  }, [status, resetTimer]);

  // Auf den Hintergrund-Sync-Auslöser aus page.tsx reagieren
  // (kursplan:trigger-sync) und den bestehenden Sync automatisch starten.
  useEffect(() => {
    const onTriggerSync = () => {
      void handleSync();
    };
    window.addEventListener('kursplan:trigger-sync', onTriggerSync);
    return () => window.removeEventListener('kursplan:trigger-sync', onTriggerSync);
  }, [handleSync]);

  const isLoading = status === 'loading';
  const Icon =
    status === 'success' ? Check : status === 'error' ? TriangleAlert : RefreshCw;
  const label =
    status === 'loading'
      ? 'Synchronisiere...'
      : status === 'success'
        ? 'Synchronisiert'
        : status === 'error'
          ? 'Fehler beim Sync'
          : 'Sync';

  return (
    <button
      type="button"
      onClick={handleSync}
      disabled={isLoading}
      aria-label="edoobox synchronisieren"
      title="edoobox synchronisieren"
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
        status === 'success'
          ? 'border-green-300 bg-green-50 text-green-700'
          : status === 'loading' || status === 'error'
            ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'
            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
      } disabled:opacity-60 disabled:cursor-not-allowed`}
    >
      <Icon
        className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''} ${
          status === 'success'
            ? 'text-green-600'
            : status === 'loading' || status === 'error'
              ? 'text-white'
              : 'text-slate-500'
        }`}
      />
      {label}
    </button>
  );
}

export default function Home() {
  const [kurse, setKurse] = useState<Kurs[]>([]);
  const [trainer, setTrainer] = useState<Trainer[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  // Kurs-Schlüssel, für die gerade eine Trainer-Umzuweisung (P98) läuft.
  const [savingTrainerKeys, setSavingTrainerKeys] = useState<Set<string>>(
    new Set()
  );
  const [selectedTrainerFilter, setSelectedTrainerFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string[]>(
    DEFAULT_STATUS_FILTERS
  );
  const [selectedJahr, setSelectedJahr] = useState<string>('ALL');
  const [selectedMonat, setSelectedMonat] = useState<string>('ALL');
  const [selectedKw, setSelectedKw] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searchKursnr, setSearchKursnr] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [selectedBadge, setSelectedBadge] = useState<string>('ALL');
  const [selectedTitel, setSelectedTitel] = useState<string>('ALL');

  // Mehrfachbearbeitung (L-10): date_id-Gruppe der aktuell markierten Termine
  // sowie die Werte der Bulk-Aktionsleiste (Trainer-Kürzel, Zuweisungs-Status).
  const [selectedTermine, setSelectedTermine] = useState<string[]>([]);
  const [bulkTrainerKuerzel, setBulkTrainerKuerzel] = useState<string>('');
  const [bulkStatus, setBulkStatus] = useState<string>('');
  // Ladezustand des Bulk-Speicherns – deaktiviert den Button gegen Doppel-Klicks.
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Bereinigung doppelter Trainer-Zuweisungen (Button im Header + Report-Modal).
  const [cleanupOffen, setCleanupOffen] = useState<boolean>(false);
  const [cleanupLaeuft, setCleanupLaeuft] = useState<boolean>(false);
  const [cleanupFehler, setCleanupFehler] = useState<string | null>(null);
  const [cleanupErgebnis, setCleanupErgebnis] = useState<CleanupErgebnis | null>(null);

  // Scrollt zur Zeile des nächsten anstehenden Termins (heute oder später).
  // Container-sicher: findet den tatsächlich scrollenden Parent-Container
  // (overflow-y-auto) und berechnet die Zielposition relativ zu dessen scrollTop.
  const scrollToToday = useCallback((smooth = true) => {
    const el =
      document.getElementById('row-today') ||
      document.querySelector('[data-date]');
    if (!el) return;

    // 1. Den tatsächlich scrollenden Parent-Container finden:
    let scrollContainer: HTMLElement | null = el.parentElement;
    while (scrollContainer && scrollContainer !== document.body) {
      const style = window.getComputedStyle(scrollContainer);
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        scrollContainer.scrollHeight > scrollContainer.clientHeight
      ) {
        break;
      }
      scrollContainer = scrollContainer.parentElement;
    }

    const headerOffset = 140; // Genug Puffer für Header, Navigation & Toolbar

    if (scrollContainer && scrollContainer !== document.body) {
      // Der gefundene Container scrollt:
      // Im Container nur den Tabellenkopf (thead) berücksichtigen:
      const thead = scrollContainer.querySelector('thead');
      const theadOffset = thead ? thead.offsetHeight : 0;
      const elRect = el.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const targetTop =
        scrollContainer.scrollTop +
        (elRect.top - containerRect.top) -
        theadOffset;
      scrollContainer.scrollTo({
        top: Math.max(0, targetTop),
        behavior: smooth ? 'smooth' : 'auto',
      });
    } else {
      // Fallback: Das gesamte Fenster scrollt:
      const elPos = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: Math.max(0, elPos - headerOffset),
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  // Kurse und Trainer-Stammdaten parallel laden.
  const loadData = useCallback(async (silent = false) => {
    if (silent !== true) setIsLoading(true);
    setError(null);

    try {
      const [termineRes, trainerRes] = await Promise.all([
        fetch('/api/termine'),
        fetch('/api/trainer'),
      ]);

      if (!termineRes.ok || !trainerRes.ok) {
        throw new Error('Ein Endpunkt antwortete mit einem Fehler.');
      }

      const kurseData = (await termineRes.json()) as Kurs[];
      const trainerData = (await trainerRes.json()) as Trainer[];

      setKurse(kurseData);
      setTrainer(trainerData);

      // Nach erfolgreichem Laden einmalig zur aktuellen Zeile springen,
      // sobald das DOM die Tabelle gerendert hat. Beim stillen Reload
      // (nach P90-Sync, silent = true) wird NICHT gescrollt, damit die
      // aktuelle Seitenposition erhalten bleibt.
      if (!silent && kurseData.length > 0) {
        setTimeout(() => scrollToToday(false), 80);
      }
    } catch (err: unknown) {
      console.error('Fehler beim Laden der Übersicht:', err);
      setError(
        'Die Daten konnten nicht geladen werden. Bitte Verbindung zur Datenbank prüfen.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [scrollToToday]);

  useEffect(() => {
    loadData();
    const onSilentReload = () => loadData(true);
    window.addEventListener('kursplan:reload-silent', onSilentReload);
    return () => window.removeEventListener('kursplan:reload-silent', onSilentReload);
  }, [loadData]);

  // Alle in den geladenen Kursen vorkommenden Tags, alphabetisch sortiert.
  const tagOptionen = useMemo(() => {
    const tagSet = new Set<string>();
    for (const kurs of kurse) {
      for (const tag of kurs.tags ?? []) {
        const bereinigt = tag.trim();
        if (bereinigt) tagSet.add(bereinigt);
      }
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'de'));
  }, [kurse]);

  // Trainer-Sätze für die automatische Honorarberechnung je ID nachschlagbar.
  const trainerMap = useMemo(() => {
    const map = new Map<number, Trainer>();
    for (const t of trainer) map.set(t.id, t);
    return map;
  }, [trainer]);

  // Aktive Trainer mit gültigem Kürzel – Grundlage für die <option>-Liste
  // der interaktiven Trainer-Auswahl in jeder Kurszeile.
  const aktiveTrainer = useMemo(
    () =>
      trainer.filter(
        (t) => t.is_active && (t.kuerzel?.trim() ?? '') !== ''
      ),
    [trainer]
  );

  // Gefilterte Kursliste basierend auf den aktiven Filtern.
  const gefilterteKurse = useMemo(() => {
    const such = searchTerm.trim().toLowerCase();
    const suchKursnr = searchKursnr.trim().toLowerCase();

    return kurse.filter((kurs) => {
      // Kursname case-insensitive filtern.
      if (such && !(kurs.offer_name ?? '').toLowerCase().includes(such)) {
        return false;
      }

      // Kursnummer case-insensitive filtern.
      if (suchKursnr && !(kurs.kursnr ?? '').toLowerCase().includes(suchKursnr)) {
        return false;
      }

      // Kursstatus filtern (Mehrfachauswahl). Ohne aktive Auswahl wird der
      // Statusfilter nicht angewendet. Der Status „Geschlossen" wird über
      // zwei explizite Filter gesteuert: „Geschlossen (mit TN)" (teilnehmer
      // >= 1) und „Geschlossen (ohne TN)" (teilnehmer === 0). Alle übrigen
      // Statuswerte werden weiterhin 1:1 abgeglichen.
      if (selectedStatusFilter.length > 0) {
        const status = kurs.date_status ?? '';
        const passtDirekt = selectedStatusFilter.includes(status);
        const passtGeschlossenMitTn =
          status === 'Geschlossen' &&
          selectedStatusFilter.includes('Geschlossen (mit TN)') &&
          kurs.teilnehmer >= 1;
        const passtGeschlossenOhneTn =
          status === 'Geschlossen' &&
          selectedStatusFilter.includes('Geschlossen (ohne TN)') &&
          kurs.teilnehmer === 0;

        if (!passtDirekt && !passtGeschlossenMitTn && !passtGeschlossenOhneTn) {
          return false;
        }
      }

      // Zeitfilter clientseitig über den frühesten Termin-Start des Kurses.
      const kursDatum = kursStartDate(kurs);
      if (kursDatum) {
        if (selectedJahr !== 'ALL' && kursDatum.getFullYear() !== Number(selectedJahr)) {
          return false;
        }
        if (selectedMonat !== 'ALL' && kursDatum.getMonth() + 1 !== Number(selectedMonat)) {
          return false;
        }
        if (selectedKw !== 'ALL' && getIsoWeek(kursDatum) !== Number(selectedKw)) {
          return false;
        }
      } else if (selectedJahr !== 'ALL' || selectedMonat !== 'ALL' || selectedKw !== 'ALL') {
        // Ohne gültiges Start-Datum kann ein Kurs keinen Zeitfilter erfüllen.
        return false;
      }

      // Tag filtern (Option „ALL“ = kein Tag-Filter aktiv).
      if (selectedTag !== 'ALL') {
        const kursTags = kurs.tags ?? [];
        if (!kursTags.some((tag) => tag.trim() === selectedTag)) {
          return false;
        }
      }

      // Badge filtern (Option „ALL“ = kein Badge-Filter aktiv). Die Prüfung
      // nutzt dieselben Hinweis-Regeln wie die Badge-Anzeige in der
      // Kurstitel-Spalte, damit Filter und Anzeige immer übereinstimmen.
      if (selectedBadge !== 'ALL') {
        const heute = toIsoDate(new Date());
        if (!kursHatBadge(kurs, selectedBadge as BadgeFilterKey, heute, kurse)) {
          return false;
        }
      }

      // Kurstitel filtern (Option „ALL“ = kein Titel-Filter aktiv). Exakter
      // Vergleich auf den vollständigen Angebotstitel.
      if (selectedTitel !== 'ALL' && kurs.offer_name !== selectedTitel) {
        return false;
      }

      // Trainer filtern.
      if (selectedTrainerFilter !== 'ALL') {
        const hatTrainer = kurs.zuweisungen[0]?.trainer_id ?? null;

        if (selectedTrainerFilter === 'UNASSIGNED') {
          if (hatTrainer !== null) return false;
        } else if (hatTrainer !== Number(selectedTrainerFilter)) {
          return false;
        }
      }

      return true;
    });
  }, [
    kurse,
    searchTerm,
    searchKursnr,
    selectedTag,
    selectedBadge,
    selectedTitel,
    selectedStatusFilter,
    selectedJahr,
    selectedMonat,
    selectedKw,
    selectedTrainerFilter,
  ]);

  // Flache Terminliste: Jeder Einzeltermin eines Kurses wird zu einem eigenen
  // Anzeige-Eintrag (mehrtägige Kurse erscheinen an jedem Kurstag). Die Liste
  // wird strikt chronologisch nach Datum und Startzeit sortiert.
  const flacheTermine = useMemo(() => {
    const eintraege: FlacherTermin[] = [];

    for (const kurs of gefilterteKurse) {
      const termine = [...kurs.termine].sort((a, b) => {
        const zeitA = toDate(a.date_start)?.getTime() ?? 0;
        const zeitB = toDate(b.date_start)?.getTime() ?? 0;
        return zeitA - zeitB;
      });

      if (termine.length === 0) {
        // Fallback: Kurs ohne Termine trotzdem anzeigen (ein Eintrag).
        eintraege.push({
          kurs,
          termin: {
            date_id: kursKey(kurs),
            date_start: null,
            date_end: null,
          },
          terminIndex: 0,
          terminAnzahl: 1,
        });
        continue;
      }

      termine.forEach((termin, index) => {
        eintraege.push({
          kurs,
          termin,
          terminIndex: index,
          terminAnzahl: termine.length,
        });
      });
    }

    // Chronologisch nach Datum + Startzeit sortieren (stabil).
    eintraege.sort((a, b) => {
      const zeitA =
        toDate(a.termin.date_start)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const zeitB =
        toDate(b.termin.date_start)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return zeitA - zeitB;
    });

    return eintraege;
  }, [gefilterteKurse]);

  // -------------------------------------------------------------------------
  // Mehrfachbearbeitung (L-10): Auswahl-Logik über die sichtbaren Termine.
  // -------------------------------------------------------------------------

  // IDs aller aktuell SICHTBAREN (gefilterten) Einzeltermine – Grundlage für
  // die „Alle auswählen"-Checkbox im Tabellenkopf.
  const visibleTerminIds = useMemo(
    () => flacheTermine.map((eintrag) => eintrag.termin.date_id),
    [flacheTermine]
  );

  const alleSichtbarenSelektiert =
    visibleTerminIds.length > 0 &&
    visibleTerminIds.every((id) => selectedTermine.includes(id));

  const einigeSichtbareSelektiert =
    visibleTerminIds.some((id) => selectedTermine.includes(id)) &&
    !alleSichtbarenSelektiert;

  // „Alle auswählen" bzw. „Auswahl aufheben" – wirkt ausschließlich auf die
  // aktuell sichtbaren (gefilterten) Termine; Markierungen auf ausgeblendeten
  // Zeilen bleiben unangetastet.
  const toggleAlleSichtbaren = useCallback(() => {
    setSelectedTermine((prev) => {
      const next = new Set(prev);
      if (alleSichtbarenSelektiert) {
        for (const id of visibleTerminIds) next.delete(id);
      } else {
        for (const id of visibleTerminIds) next.add(id);
      }
      return Array.from(next);
    });
  }, [alleSichtbarenSelektiert, visibleTerminIds]);

  // Einzelnen Termin markieren bzw. die Markierung aufheben (date_id).
  const toggleTermin = useCallback((id: string) => {
    setSelectedTermine((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  // Indeterminate-Zustand der Kopf-Checkbox rendern („ein Teil ausgewählt").
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = einigeSichtbareSelektiert;
    }
  }, [einigeSichtbareSelektiert]);

  // „Für alle übernehmen" (L-10): speichert die Bulk-Änderungen über
  // PATCH /api/zuweisung/bulk. Es werden nur die Felder gesendet, die der
  // Nutzer tatsächlich in den Bulk-Dropdowns gewählt hat.
  const handleBulkUebernehmen = useCallback(async () => {
    if (isSubmitting) return;

    const gewaehlterTrainer = aktiveTrainer.find(
      (t) => (t.kuerzel ?? '').trim() === bulkTrainerKuerzel
    );

    // Weder Trainer noch Status gewählt: keine sinnvolle Änderung möglich.
    if (bulkTrainerKuerzel === '' && bulkStatus === '') {
      setError('Bitte mindestens einen Trainer oder einen Status auswählen.');
      return;
    }

    // Payload aufbauen – nur die vom Nutzer geänderten Felder übernehmen.
    const payload: Record<string, unknown> = { date_ids: selectedTermine };
    if (bulkTrainerKuerzel !== '') {
      if (gewaehlterTrainer) {
        payload.trainer_id = gewaehlterTrainer.id;
        payload.trainer_kuerzel = gewaehlterTrainer.kuerzel;
      } else {
        // 'n. v.' = Aufhebung der Trainer-Zuweisung (Status 'keine Zuordnung').
        payload.trainer_kuerzel = 'n. v.';
      }
    }
    if (bulkStatus !== '') {
      payload.status = bulkStatus;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/zuweisung/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          data?.error ?? `Serverfehler beim Bulk-Update (Status ${res.status}).`
        );
      }

      // Erfolg: ZUERST den lokalen Kurs-State optimistisch aktualisieren.
      // Der Webhook/n8n-Sync zu edoobox benötigt im Hintergrund einige
      // Sekunden; ein sofortiges loadData würde noch die alten Werte liefern.
      // Das Zustandsbild unten entspricht exakt dem Ergebnis der Bulk-Route
      // (public.trainer_zuweisung), wie es nach dem Sync in /api/termine
      // ankommt: Ein Kurs gilt als betroffen, wenn eine seiner date_ids im
      // Auswahl-Array markiert war; die geänderten Felder werden kursweit
      // gesetzt (Zuweisung, Status und Trainer gelten einheitlich für den
      // gesamten Kurs).
      setKurse((prevKurse) =>
        prevKurse.map((kurs) => {
          const betroffen = (kurs.termine ?? []).some((termin) =>
            selectedTermine.includes(termin.date_id)
          );
          if (!betroffen) return kurs;

          // Strikte Immutability: Jedes verschachtelte Array/Objekt, das in
          // diesem Update berührt wird, wird per Spread-Operator kopiert.
          // Nur so erhält React eine neue Referenz und rendert zwingend neu.
          const termineKopie = [...(kurs.termine ?? [])];
          const bisherige = kurs.zuweisungen[0] ?? null;
          // 'n. v.' (kein passender aktiver Trainer im Dropdown) = Aufhebung
          // der Zuweisung – serverseitig wird Status 'keine Zuordnung' gesetzt.
          const istAufhebung = bulkTrainerKuerzel.trim() !== '' && !gewaehlterTrainer;

          // Effektiven Zuweisungsstatus bestimmen – konsistent zur Bulk-Route:
          // ein explizit gewählter Status gewinnt, sonst setzt die Aufhebung
          // 'keine Zuordnung'; ein Trainerwechsel ohne Status erzeugt eine
          // neue Zuweisungs-Zeile mit 'ausgeschrieben' (bzw. behält den
          // Status, wenn derselbe Trainer erneut bestätigt wird).
          let neuerStatus: ZuweisungStatus | null = bisherige?.status ?? null;
          if (bulkStatus !== '') {
            neuerStatus = bulkStatus as ZuweisungStatus;
          } else if (istAufhebung) {
            neuerStatus = 'keine Zuordnung';
          } else if (gewaehlterTrainer) {
            neuerStatus =
              bisherige?.trainer_id === gewaehlterTrainer.id
                ? (bisherige?.status ?? 'ausgeschrieben')
                : 'ausgeschrieben';
          }

          // Echte Aufhebung: Der Kurs gilt als bewusst ohne Trainer geführt
          // (keine aktive Zuweisungs-Zeile im Grid), bis er erneut zugewiesen
          // wird – exakt das Verhalten der 'n. v.'-Sperre in GET /api/termine.
          if (istAufhebung && neuerStatus === 'keine Zuordnung') {
            return {
              ...kurs,
              termine: termineKopie,
              zuweisungen: [],
              zuweisung_status: 'keine Zuordnung',
              trainer_kuerzel: 'n. v.',
              hat_trainer: false,
            };
          }

          let neueZuweisung: Zuweisung;
          if (gewaehlterTrainer) {
            // Trainerwechsel: neue erste Zuweisung des Kurses.
            neueZuweisung = {
              ...(bisherige ?? {
                id: null,
                trainer_id: null,
                status: null,
                notiz: null,
                honorar_manuell: null,
                trainer: null,
              }),
              trainer_id: gewaehlterTrainer.id,
              status: neuerStatus,
              trainer: { kuerzel: gewaehlterTrainer.kuerzel },
              quelle: 'lokal',
            };
          } else if (bisherige) {
            // Nur Status-Änderung (inkl. Aufhebung mit explizitem Status):
            // der bisherige Trainer bleibt unangetastet.
            neueZuweisung = {
              ...bisherige,
              status: neuerStatus,
              quelle: 'lokal',
            };
          } else {
            // Weder Trainer noch bestehende Zuweisung: nichts zu ändern.
            return kurs;
          }

          return {
            ...kurs,
            termine: termineKopie,
            zuweisungen: [neueZuweisung],
            zuweisung_status: neuerStatus,
            trainer_kuerzel: neueZuweisung.trainer?.kuerzel?.trim() || 'n. v.',
            hat_trainer: neueZuweisung.trainer_id !== null,
          };
        })
      );

      // Danach Auswahl und Dropdowns zurücksetzen. Ein erneuter Server-Abruf
      // (loadData) ist bewusst nicht nötig: Das Optimistic Update oben hat den
      // lokalen Kurs-State bereits vollständig und korrekt aktualisiert, ein
      // sofortiger Refresh würde nur die noch alten edoobox-Sync-Werte liefern.
      setSelectedTermine([]);
      setBulkTrainerKuerzel('');
      setBulkStatus('');
    } catch (err: unknown) {
      console.error('[L-10] Bulk-Update fehlgeschlagen:', err);
      setError(
        err instanceof Error ? err.message : 'Das Bulk-Update ist fehlgeschlagen.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    selectedTermine,
    bulkTrainerKuerzel,
    bulkStatus,
    aktiveTrainer,
  ]);

  // Konflikt-Erkennung: gleicher Trainer an sich überschneidenden Terminen
  // (mehrtägige Kurse werden über ihre Einzeltermine geprüft).
  const konflikteProKurs = useMemo(() => {
    const karte: Record<string, KursKonflikt[]> = {};

    for (let i = 0; i < kurse.length; i += 1) {
      for (let j = i + 1; j < kurse.length; j += 1) {
        const a = kurse[i];
        const b = kurse[j];

        // Abgesagte bzw. geschlossene Kurse ohne Teilnehmer ignorieren.
        if (!istKonfliktRelevant(a) || !istKonfliktRelevant(b)) {
          continue;
        }

        const trainerIdA = a.zuweisungen[0]?.trainer_id ?? null;
        const trainerIdB = b.zuweisungen[0]?.trainer_id ?? null;

        if (
          trainerIdA === null ||
          trainerIdB === null ||
          trainerIdA !== trainerIdB
        ) {
          continue;
        }

        let overlapping = false;
        for (const ta of a.termine) {
          for (const tb of b.termine) {
            if (
              ueberschneidenSich(
                ta.date_start,
                ta.date_end,
                tb.date_start,
                tb.date_end
              )
            ) {
              overlapping = true;
              break;
            }
          }
          if (overlapping) break;
        }

        if (!overlapping) continue;

        const keyA = kursKey(a);
        const keyB = kursKey(b);

        // Echter Terminkonflikt: beide überlappenden Kurse sind bestätigt
        // (mindestens zwei überschneidende Termine mit Status „Bestätigt").
        const echt =
          istBestaetigtStatus(a.zuweisungen[0]?.status ?? null) &&
          istBestaetigtStatus(b.zuweisungen[0]?.status ?? null);

        if (!karte[keyA]) karte[keyA] = [];
        karte[keyA].push({ kursKey: keyB, text: konfliktText(b), echt });

        if (!karte[keyB]) karte[keyB] = [];
        karte[keyB].push({ kursKey: keyA, text: konfliktText(a), echt });
      }
    }

    return karte;
  }, [kurse]);

  const hatAktiveFilter =
    selectedTrainerFilter !== 'ALL' ||
    selectedJahr !== 'ALL' ||
    selectedMonat !== 'ALL' ||
    selectedKw !== 'ALL' ||
    selectedTag !== 'ALL' ||
    selectedBadge !== 'ALL' ||
    selectedTitel !== 'ALL' ||
    selectedStatusFilter.length !== STATUS_FILTER_OPTIONS.length ||
    searchTerm.trim() !== '' ||
    searchKursnr.trim() !== '';

  const resetFilters = useCallback(() => {
    setSelectedTrainerFilter('ALL');
    setSelectedStatusFilter([...DEFAULT_STATUS_FILTERS]);
    setSelectedJahr('ALL');
    setSelectedMonat('ALL');
    setSelectedKw('ALL');
    setSelectedTag('ALL');
    setSelectedBadge('ALL');
    setSelectedTitel('ALL');
    setSearchTerm('');
    setSearchKursnr('');
  }, []);

  // Status-Filter-Chip umschalten (Mehrfachauswahl).
  const toggleStatusFilter = useCallback((value: string) => {
    setSelectedStatusFilter((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  }, []);

  // Zentrale Filter-Handler: Jede Filteränderung setzt den jeweiligen State.
  // Das automatische Springen zum aktuellen Tag übernimmt das useEffect
  // "filterScrollEffect" weiter unten (nach dem Re-Render).
  const handleTrainerFilterChange = useCallback((value: string) => {
    setSelectedTrainerFilter(value);
  }, []);

  const handleTagFilterChange = useCallback((value: string) => {
    setSelectedTag(value);
    // Exklusive Filter-Logik: Ein Tag-Filter setzt Badge- und Titel-Filter
    // zurück, damit nie mehr als einer der drei Filter aktiv ist.
    setSelectedBadge('ALL');
    setSelectedTitel('ALL');
  }, []);

  const handleBadgeFilterChange = useCallback((value: string) => {
    setSelectedBadge(value);
    // Exklusive Filter-Logik: Ein Badge-Filter setzt Tag- und Titel-Filter
    // zurück, damit nie mehr als einer der drei Filter aktiv ist.
    setSelectedTag('ALL');
    setSelectedTitel('ALL');
  }, []);

  const handleTitelFilterChange = useCallback((value: string) => {
    setSelectedTitel(value);
    // Exklusive Filter-Logik: Ein Titel-Filter setzt Tag- und Badge-Filter
    // zurück, damit nie mehr als einer der drei Filter aktiv ist.
    setSelectedTag('ALL');
    setSelectedBadge('ALL');
  }, []);

  const handleJahrFilterChange = useCallback((value: string) => {
    setSelectedJahr(value);
  }, []);

  const handleMonatFilterChange = useCallback((value: string) => {
    setSelectedMonat(value);
  }, []);

  const handleKwFilterChange = useCallback((value: string) => {
    setSelectedKw(value);
  }, []);

  const handleSearchTermChange = useCallback((value: string) => {
    setSearchTerm(value);
  }, []);

  const handleSearchKursnrChange = useCallback((value: string) => {
    setSearchKursnr(value);
  }, []);

  // Sobald ein Filter angewendet bzw. aktiviert wird, springt die Ansicht
  // automatisch zum aktuellen Tag (heute), damit die Anzeige immer mit dem
  // aktuellen Datum beginnt. Der erste Render (initiales Laden) wird über
  // filterScrollInitial übersprungen – das initiale Scrollen übernimmt
  // loadData().
  const filterScrollInitial = useRef(true);
  useEffect(() => {
    if (filterScrollInitial.current) {
      filterScrollInitial.current = false;
      return;
    }
    // Nach dem Re-Render scrollen, sobald das DOM die gefilterte Tabelle
    // gerendert hat (requestAnimationFrame garantiert berechnetes Layout).
    requestAnimationFrame(() => scrollToToday(false));
  }, [
    selectedTrainerFilter,
    selectedStatusFilter,
    selectedJahr,
    selectedMonat,
    selectedKw,
    searchTerm,
    searchKursnr,
    selectedTag,
    selectedBadge,
    selectedTitel,
    scrollToToday,
  ]);

  // Lokalen Zustand eines Kurses aktualisieren (optimistisches Update).
  const patchKurs = useCallback(
    (key: string, updater: (kurs: Kurs) => Kurs) => {
      setKurse((prev) =>
        prev.map((kurs) => (kursKey(kurs) === key ? updater(kurs) : kurs))
      );
    },
    []
  );

  const setZuweisung = useCallback(
    (key: string, zuweisung: Zuweisung | null) => {
      patchKurs(key, (kurs) => ({
        ...kurs,
        zuweisungen: zuweisung ? [zuweisung] : [],
      }));
    },
    [patchKurs]
  );

  const showFeedback = useCallback(
    (key: string, type: Feedback['type'], text: string) => {
      setFeedback((prev) => ({ ...prev, [key]: { type, text } }));
      setTimeout(() => {
        setFeedback((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 4000);
    },
    []
  );

  // Zuweisungs-Status geändert -> POST zur Aktualisierung aller Termine
  // des Kurses (date_ids werden im Hintergrund einheitlich aktualisiert).
  const handleStatusChange = useCallback(
    async (kurs: Kurs, newStatus: ZuweisungStatus) => {
      const prevZuweisung = cloneZuweisung(kurs.zuweisungen[0] ?? null);

      if (!prevZuweisung || prevZuweisung.trainer_id === null) {
        return;
      }

      const dateIds = kurs.termine
        .map((termin) => termin.date_id)
        .filter((id) => id.trim() !== '');

      if (dateIds.length === 0) {
        return;
      }

      const key = kursKey(kurs);
      const optimistic: Zuweisung = {
        ...prevZuweisung,
        status: newStatus,
        quelle: 'lokal',
      };
      setZuweisung(key, optimistic);

      try {
        const res = await fetch('/api/zuweisung', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date_ids: dateIds,
            trainer_id: prevZuweisung.trainer_id,
            status: newStatus,
          }),
        });

        if (!res.ok) {
          throw new Error('Speichern fehlgeschlagen');
        }

        showFeedback(key, 'success', 'Status gespeichert');
      } catch (err: unknown) {
        console.error('Fehler beim Speichern des Status:', err);
        setZuweisung(key, prevZuweisung);
        showFeedback(key, 'error', 'Speichern fehlgeschlagen – bitte erneut versuchen');
      }
    },
    [setZuweisung, showFeedback]
  );

  // Manuelles Dozentenhonorar setzen bzw. zurücksetzen (null = automatischer
  // Vorschlag). Die Änderung gilt einheitlich für alle Termine des Kurses.
  const handleHonorarChange = useCallback(
    async (kurs: Kurs, honorarManuell: number | null) => {
      const prevZuweisung = cloneZuweisung(kurs.zuweisungen[0] ?? null);

      if (!prevZuweisung || prevZuweisung.trainer_id === null) {
        return;
      }

      const dateIds = kurs.termine
        .map((termin) => termin.date_id)
        .filter((id) => id.trim() !== '');

      if (dateIds.length === 0) {
        return;
      }

      const key = kursKey(kurs);
      const optimistic: Zuweisung = {
        ...prevZuweisung,
        status: prevZuweisung.status ?? 'ausgeschrieben',
        honorar_manuell: honorarManuell,
        quelle: 'lokal',
      };
      setZuweisung(key, optimistic);

      try {
        const res = await fetch('/api/zuweisung', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date_ids: dateIds,
            trainer_id: prevZuweisung.trainer_id,
            status: prevZuweisung.status ?? 'ausgeschrieben',
            notiz: prevZuweisung.notiz,
            honorar_manuell: honorarManuell,
          }),
        });

        if (!res.ok) {
          throw new Error('Speichern fehlgeschlagen');
        }

        showFeedback(
          key,
          'success',
          honorarManuell === null
            ? 'Honorar zurückgesetzt'
            : 'Honorar gespeichert'
        );
      } catch (err: unknown) {
        console.error('Fehler beim Speichern des Honorars:', err);
        setZuweisung(key, prevZuweisung);
        showFeedback(
          key,
          'error',
          'Speichern fehlgeschlagen – bitte erneut versuchen'
        );
      }
    },
    [setZuweisung, showFeedback]
  );

  // Options-Haken (Einladungslink, Last Minute, abgerechnet) persistent
  // speichern. Die Änderung gilt einheitlich für alle Termine des Kurses.
  const handleOptionChange = useCallback(
    async (kurs: Kurs, key: keyof KursOptionen, wert: boolean) => {
      const dateIds = kurs.termine
        .map((termin) => termin.date_id)
        .filter((id) => id.trim() !== '');

      if (dateIds.length === 0) return;

      const keyKurs = kursKey(kurs);
      const vorher = (kurs.optionen ?? LEERE_OPTIONEN)[key];

      // Optimistisches Update.
      patchKurs(keyKurs, (k) => ({
        ...k,
        optionen: { ...(k.optionen ?? LEERE_OPTIONEN), [key]: wert },
      }));

      try {
        const res = await fetch('/api/termine/optionen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date_ids: dateIds, [key]: wert }),
        });

        if (!res.ok) {
          throw new Error('Speichern fehlgeschlagen');
        }

        showFeedback(keyKurs, 'success', 'Option gespeichert');
      } catch (err: unknown) {
        console.error('Fehler beim Speichern der Option:', err);
        patchKurs(keyKurs, (k) => ({
          ...k,
          optionen: { ...(k.optionen ?? LEERE_OPTIONEN), [key]: vorher },
        }));
        showFeedback(
          keyKurs,
          'error',
          'Speichern fehlgeschlagen – bitte erneut versuchen'
        );
      }
    },
    [patchKurs, showFeedback]
  );

  // Interaktive Trainer-Umzuweisung (P98): Nach Sicherheitsabfrage wird die
  // Änderung über /api/trainer-zuweisung an den n8n-Workflow weitergeleitet.
  // Bei Erfolg werden Kürzel (und ggf. der neue Titel) lokal übernommen,
  // bei Abbruch bzw. Fehler bleibt die Zeile unverändert.
  const handleTrainerChange = useCallback(
    async (kurs: Kurs, neuesKuerzel: string, terminDateId?: string) => {
      const key = kursKey(kurs);
      const aktuelleZuweisung = kurs.zuweisungen[0] ?? null;
      const altesKuerzel = aktuelleZuweisung?.trainer?.kuerzel?.trim() ?? '';

      // Nur tatsächliche Wechsel auslösen; gleiche Auswahl ignoriert.
      // Ein Wechsel auf 'n. v.' hebt die Zuweisung auf und ist nur relevant,
      // wenn bisher kein 'n. v.' zugewiesen war.
      if (altesKuerzel === neuesKuerzel) return;

      // Sicherheitsabfrage: Das Aufheben der Zuweisung ('n. v.') erhält einen
      // eigenen Wortlaut; reguläre Trainerwechsel behalten die bisherige
      // Abfrage.
      if (neuesKuerzel === 'n. v.') {
        const ok = window.confirm(
          `Möchtest du die Trainerzuweisung für das Kursangebot "${kurs.offer_name || ''}" wirklich aufheben? Das Trainerkürzel wird dabei aus den Titeln in edoobox entfernt.`
        );
        if (!ok) return; // Controlled Select bleibt beim alten Kürzel.
      } else {
        const ok = window.confirm(
          `Möchtest du den Trainer für das Kursangebot "${kurs.offer_name || ''}" wirklich auf ${neuesKuerzel} ändern? Der Titel in edoobox wird dabei ebenfalls angepasst.`
        );
        if (!ok) return; // Controlled Select bleibt beim alten Kürzel.
      }

      const offerId = kurs.offer_id?.trim() ?? '';
      if (offerId === '') {
        showFeedback(
          key,
          'error',
          'Fehler bei der Trainerzuweisung: offer_id fehlt.'
        );
        return;
      }

      // Alle Einzeltermine des Kurses sammeln: Die Trainerzuweisung gilt laut
      // Backend einheitlich für den gesamten Kurs, das Persistieren erfolgt
      // aber zwingend date_id-basiert (nie über die offer_id). Die date_id der
      // aktuell bearbeiteten Zeile wird dabei garantiert mit übergeben.
      const dateIds = kurs.termine
        .map((termin) => termin.date_id)
        .filter((id) => id.trim() !== '');
      const konkretId = terminDateId?.trim();
      if (konkretId && !dateIds.includes(konkretId)) {
        dateIds.push(konkretId);
      }
      if (dateIds.length === 0) {
        showFeedback(
          key,
          'error',
          'Fehler bei der Trainerzuweisung: keine gültige date_id vorhanden.'
        );
        return;
      }

      // Kürzel in die eindeutige Trainer-ID auflösen (für den lokalen Upsert).
      const istAufhebung = neuesKuerzel === 'n. v.';
      let trainerId: number | null = null;
      if (!istAufhebung) {
        const trainer = aktiveTrainer.find(
          (t) => (t.kuerzel?.trim() ?? '') === neuesKuerzel
        );
        if (!trainer) {
          showFeedback(
            key,
            'error',
            `Fehler bei der Trainerzuweisung: unbekanntes Kürzel "${neuesKuerzel}".`
          );
          return;
        }
        trainerId = trainer.id;
      }

      // Für die Aufhebung ('n. v.') dient die Zeile des zuletzt zugewiesenen
      // Trainers als Träger des Status 'keine Zuordnung' (trainer_id ist in
      // public.trainer_zuweisung NOT NULL und per FK an public.trainer(id)
      // gebunden). Ohne bisherige Zuweisung gibt es nichts aufzuheben.
      const bisherigeTrainerId = aktuelleZuweisung?.trainer_id ?? null;
      if (istAufhebung && bisherigeTrainerId === null) {
        showFeedback(
          key,
          'error',
          'Fehler bei der Trainerzuweisung: keine aktive Zuweisung zum Aufheben vorhanden.'
        );
        return;
      }

      // Status, der persistent geschrieben wird: Bei 'n. v.' lautet er
      // 'keine Zuordnung'; bei einem Trainerwechsel wird ein bestehender
      // Status übernommen (eine evtl. noch vorhandene 'keine Zuordnung'-
      // Sperr-Zeile darf dabei nicht weitergereicht werden -> 'ausgeschrieben').
      const neuerZuweisungStatus = istAufhebung
        ? 'keine Zuordnung'
        : aktuelleZuweisung?.status &&
            aktuelleZuweisung.status !== 'keine Zuordnung'
          ? aktuelleZuweisung.status
          : 'ausgeschrieben';

      // Lokale Persistenz-Hilfe: Upsert über die eindeutigen date_ids
      // (nie über die offer_id). Bei 'n. v.' wird die trainer_id des
      // bisherigen Trainers mit Status 'keine Zuordnung' übergeben.
      const persistiereLokal = async (
        trainerIdInt: number | null,
        statusWert: string
      ) => {
        const resp = await fetch('/api/zuweisung', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date_ids: dateIds,
            trainer_id: trainerIdInt,
            status: statusWert,
            notiz: aktuelleZuweisung?.notiz ?? null,
          }),
        });
        const respData = (await resp.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!resp.ok) {
          throw new Error(respData.error ?? `HTTP ${resp.status}`);
        }
      };

      // Auswahl für die Dauer des Vorgangs sperren (disabled + Ladezustand).
      setSavingTrainerKeys((prev) => new Set(prev).add(key));

      try {
        // 1) Lokale Persistenz (public.trainer_zuweisung): date_id-basiert.
        //    Bei 'n. v.' (Status 'keine Zuordnung') bleibt die Zeile des
        //    bisherigen Trainers erhalten; der nachfolgende Sync blendet den
        //    edoobox-Leiter des Kurses aus.
        await persistiereLokal(
          istAufhebung ? bisherigeTrainerId : trainerId,
          neuerZuweisungStatus
        );

        // 2) edoobox-Rückkanal (P98): Titel & Termin-Trainer in edoobox
        //    anpassen. Die date_ids werden mit übertragen, damit der Workflow
        //    bei mehrtägigen Kursen alle Einzeltermine vereinheitlichen kann.
        const res = await fetch('/api/trainer-zuweisung', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offer_id: offerId,
            date_ids: dateIds,
            neuer_trainer_kuerzel: neuesKuerzel,
            altes_trainer_kuerzel: altesKuerzel,
          }),
        });

        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          trainer_kuerzel?: string | null;
        };

        if (!res.ok) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        // 3) Bei Aufhebung die lokale 'n. v.'-Sperre NACH P98 erneut setzen:
        //    P98 löscht bei 'n. v.' in seinem lokalen DB-Update die Zuweisung
        //    je date_id. Ohne Nachziehen würde der folgende Sync den zuvor
        //    noch gespiegelten edoobox-Leiter wieder sichtbar machen.
        if (istAufhebung) {
          await persistiereLokal(bisherigeTrainerId, 'keine Zuordnung');
        }

        // Nach erfolgreichem Speichern den Hintergrund-Sync anstoßen (der
        // Sync-Button in der unteren Aktionszeile hört auf
        // 'kursplan:trigger-sync' und startet den Sync).
        window.dispatchEvent(new CustomEvent('kursplan:trigger-sync'));

        // Zeile lokal aktualisieren: das Kürzel wird direkt auf die getroffene
        // Auswahl gesetzt (bei Aufhebung 'n. v.'). Der Angebotstitel
        // (offer_name) bleibt unverändert.
        patchKurs(key, (k) => {
          const bisherige = k.zuweisungen[0] ?? null;
          const neueZuweisung: Zuweisung = {
            ...(bisherige ?? {
              id: null,
              trainer_id: null,
              status: null,
              notiz: null,
              honorar_manuell: null,
              trainer: null,
            }),
            // Sofortige lokale Aktualisierung des Zuweisungs-Status:
            // 'n. v.' hebt die Zuweisung auf (Status null), jede Trainer-
            // Zuweisung setzt 'ausgeschrieben', sofern kein Status stand.
            status:
              istAufhebung
                ? null
                : (bisherige?.status ?? 'ausgeschrieben'),
            trainer: {
              kuerzel: neuesKuerzel,
            },
            quelle: 'lokal',
          };
          return {
            ...k,
            zuweisungen: [neueZuweisung],
            trainer_kuerzel: neuesKuerzel,
            hat_trainer: !istAufhebung,
          };
        });

        showFeedback(
          key,
          'success',
          istAufhebung ? 'Zuweisung aufgehoben' : 'Trainer zugewiesen'
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Fehler bei der Trainerzuweisung:', err);
        showFeedback(key, 'error', `Fehler bei der Trainerzuweisung: ${msg}`);
      } finally {
        setSavingTrainerKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [patchKurs, showFeedback, aktiveTrainer]
  );

  function dateStatusInfo(
    status: string | null
  ): { label: string; className: string } {
    if (status && STATUS_CONFIG[status]) {
      return {
        label: STATUS_CONFIG[status].label,
        className: STATUS_CONFIG[status].badgeClasses,
      };
    }
    return {
      label: STATUS_CONFIG['Unbekannt'].label,
      className: STATUS_CONFIG['Unbekannt'].badgeClasses,
    };
  }

  // Heutiges Datum als ISO-Tag (Basis für Schließungsprüfung und Hervorhebung).
  const heuteIso = toIsoDate(new Date());
  const in5Tagen = new Date();
  in5Tagen.setDate(in5Tagen.getDate() + 5);
  const in5TagenIso = toIsoDate(in5Tagen);

  const naechsterKurstagIso = flacheTermine.reduce<string | null>(
    (fruehester, eintrag) => {
      if (istKursAusgenommen(eintrag.kurs)) return fruehester;
      const start = toDate(eintrag.termin.date_start);
      if (!start) return fruehester;
      const iso = toIsoDate(start);
      if (iso < heuteIso) return fruehester;
      return fruehester === null || iso < fruehester ? iso : fruehester;
    },
    null
  );

  // Index des allerersten Eintrags am ersten anstehenden Kurstag.
  const indexNaechsterKurstag =
    naechsterKurstagIso === null
      ? -1
      : flacheTermine.findIndex((eintrag) => {
          if (istKursAusgenommen(eintrag.kurs)) return false;
          const start = toDate(eintrag.termin.date_start);
          return start !== null && toIsoDate(start) === naechsterKurstagIso;
        });

  /** Führt die Bereinigung doppelter Trainer-Zuweisungen über die API aus. */
  const cleanupAusfuehren = useCallback(async () => {
    setCleanupLaeuft(true);
    setCleanupFehler(null);
    setCleanupErgebnis(null);
    try {
      const res = await fetch('/api/cleanup-assignments', { method: 'POST' });
      const data = (await res.json()) as CleanupErgebnis | { error?: string };
      if (!res.ok) {
        setCleanupFehler(
          (data as { error?: string }).error ??
            `Server antwortete mit Status ${res.status}.`
        );
        return;
      }
      setCleanupErgebnis(data as CleanupErgebnis);
      // Nach erfolgreicher Bereinigung die Kursliste still neu laden, damit
      // entfernte Zuweisungen sofort aus der Tabelle verschwinden.
      void loadData(true);
    } catch (err) {
      setCleanupFehler(
        err instanceof Error
          ? err.message
          : 'Netzwerkfehler beim Aufruf der Bereinigung.'
      );
    } finally {
      setCleanupLaeuft(false);
    }
  }, [loadData]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-800 sm:p-6">
      <AppHeader />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Traineranzeige wird aus edoobox übernommen; der Status wird bei
          Änderung automatisch gespeichert.
        </p>
        {/* Sync-Button + Bereinigen als gemeinsame, rechtsbündige
            Aktionsgruppe in der unteren Zeile. */}
        <div className="flex items-center gap-4 ml-auto">
          <SyncButton />
          {/* Doppelte Trainer-Zuweisungen erkennen und bereinigen – bewusst an
              letzter Position, da die Funktion nur selten genutzt wird. */}
          <button
            type="button"
            onClick={() => {
              setCleanupErgebnis(null);
              setCleanupFehler(null);
              setCleanupOffen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-100 transition shrink-0"
            title="Doppelte Trainer-Zuweisungen erkennen und bereinigen"
          >
            <Wand2 className="w-4 h-4 text-cd-blue" />
            Zuweisungen bereinigen
          </button>
        </div>
      </div>

      {!isLoading && !error && kurse.length > 0 && (
        <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white border-b border-slate-200 shadow-sm mb-4 flex flex-col gap-3">
          {/* Kursstatus: klickbare Filter-Chips (Mehrfachauswahl) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Kursstatus:</span>
            {STATUS_FILTER_OPTIONS.map((option) => {
              const active = selectedStatusFilter.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleStatusFilter(option.value)}
                  aria-pressed={active}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition ${
                    active
                      ? 'bg-cd-blue text-white border-cd-blue'
                      : 'bg-white text-cd-blue border-cd-blue/40 hover:bg-cd-blue/10'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            {/* Suchfeld */}
            <div className="flex-1">
              <label htmlFor="kurs-suche" className="block text-xs font-semibold text-slate-500 mb-1">
                Kursname suchen
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="kurs-suche"
                  type="text"
                  value={searchTerm}
                  onChange={(e) => handleSearchTermChange(e.target.value)}
                  placeholder="z. B. Excel Grundlagen"
                  className="w-full pl-9 pr-8 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {searchTerm !== '' && (
                  <FilterClearButton
                    onClick={() => handleSearchTermChange('')}
                    label="Suchfeld zurücksetzen"
                  />
                )}
              </div>
            </div>

            {/* Kursnummer-Filter */}
            <div className="w-full lg:w-48">
              <label htmlFor="kursnr-suche" className="block text-xs font-semibold text-slate-500 mb-1">
                Kursnr. suchen
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="kursnr-suche"
                  type="text"
                  value={searchKursnr}
                  onChange={(e) => handleSearchKursnrChange(e.target.value)}
                  placeholder="z. B. xls-gl-m1…"
                  className="w-full pl-9 pr-8 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {searchKursnr !== '' && (
                  <FilterClearButton
                    onClick={() => handleSearchKursnrChange('')}
                    label="Kursnr.-Suchfeld zurücksetzen"
                  />
                )}
              </div>
            </div>

            {/* Trainer-Filter */}
            <div className="w-full lg:w-64">
              <label htmlFor="trainer-filter" className="block text-xs font-semibold text-slate-500 mb-1">
                Trainer filtern
              </label>
              <select
                id="trainer-filter"
                value={selectedTrainerFilter}
                onChange={(e) => handleTrainerFilterChange(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">Alle Trainer</option>
                <option value="UNASSIGNED">Nur ohne Zuweisung</option>
                {trainer
                  .filter((t) => t.is_active)
                  .map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {trainerAnzeige(t)}
                    </option>
                  ))}
              </select>
            </div>

            {/* Tag-Filter */}
            <div className="w-full lg:w-40">
              <label htmlFor="tag-filter" className="block text-xs font-semibold text-slate-500 mb-1">
                Tag
              </label>
              <div className="relative">
                <select
                  id="tag-filter"
                  value={selectedTag}
                  onChange={(e) => handleTagFilterChange(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-2 py-2 pr-14 bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">Alle Tags</option>
                  {tagOptionen.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
                <SelectChevron />
                {selectedTag !== 'ALL' && (
                  <FilterClearButton
                    onClick={() => handleTagFilterChange('ALL')}
                    label="Tag-Filter zurücksetzen"
                    position="right-7"
                  />
                )}
              </div>
            </div>

            {/* Zeitfilter: Jahr */}
            <div className="w-full lg:w-28">
              <label htmlFor="jahr-filter" className="block text-xs font-semibold text-slate-500 mb-1">
                Jahr
              </label>
              <div className="relative">
                <select
                  id="jahr-filter"
                  value={selectedJahr}
                  onChange={(e) => handleJahrFilterChange(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-2 py-2 pr-14 bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">Alle</option>
                  {JAHR_OPTIONS.map((jahr) => (
                    <option key={jahr} value={jahr}>
                      {jahr}
                    </option>
                  ))}
                </select>
                <SelectChevron />
                {selectedJahr !== 'ALL' && (
                  <FilterClearButton
                    onClick={() => handleJahrFilterChange('ALL')}
                    label="Jahr-Filter zurücksetzen"
                    position="right-7"
                  />
                )}
              </div>
            </div>

            {/* Zeitfilter: Monat */}
            <div className="w-full lg:w-36">
              <label htmlFor="monat-filter" className="block text-xs font-semibold text-slate-500 mb-1">
                Monat
              </label>
              <div className="relative">
                <select
                  id="monat-filter"
                  value={selectedMonat}
                  onChange={(e) => handleMonatFilterChange(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-2 py-2 pr-14 bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">Alle</option>
                  {MONAT_OPTIONS.map((monat) => (
                    <option key={monat.value} value={monat.value}>
                      {monat.label}
                    </option>
                  ))}
                </select>
                <SelectChevron />
                {selectedMonat !== 'ALL' && (
                  <FilterClearButton
                    onClick={() => handleMonatFilterChange('ALL')}
                    label="Monat-Filter zurücksetzen"
                    position="right-7"
                  />
                )}
              </div>
            </div>

            {/* Zeitfilter: Kalenderwoche */}
            <div className="w-full lg:w-28">
              <label htmlFor="kw-filter" className="block text-xs font-semibold text-slate-500 mb-1">
                Kalenderwoche
              </label>
              <div className="relative">
                <select
                  id="kw-filter"
                  value={selectedKw}
                  onChange={(e) => handleKwFilterChange(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-2 py-2 pr-14 bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">Alle</option>
                  {KW_OPTIONS.map((kw) => (
                    <option key={kw} value={kw}>
                      KW {kw}
                    </option>
                  ))}
                </select>
                <SelectChevron />
                {selectedKw !== 'ALL' && (
                  <FilterClearButton
                    onClick={() => handleKwFilterChange('ALL')}
                    label="Kalenderwochen-Filter zurücksetzen"
                    position="right-7"
                  />
                )}
              </div>
            </div>

            {/* Heute-Sprung, Zurücksetzen & Trefferanzeige */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => scrollToToday(true)}
                title="Zum nächsten anstehenden Termin springen"
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-cd-blue hover:bg-cd-blue/90 text-white text-xs font-semibold rounded-lg transition whitespace-nowrap"
              >
                <CalendarDays className="w-3.5 h-3.5 text-white" />
                Heute
              </button>
              {hatAktiveFilter && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition whitespace-nowrap"
                >
                  <FilterX className="w-3.5 h-3.5" />
                  Filter zurücksetzen
                </button>
              )}
              <span className="text-xs text-slate-500 whitespace-nowrap">
                Zeige {flacheTermine.length} von {kurse.reduce(
                  (n, k) => n + Math.max(1, k.termine.length),
                  0
                )} Terminen
              </span>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Lade Kurse und Trainer...</span>
        </div>
      ) : error ? (
        <div className="p-4 rounded-lg border border-red-300 bg-red-50 text-red-800 text-sm flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => loadData()}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Erneut versuchen
          </button>
        </div>
      ) : kurse.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <Users className="w-5 h-5" />
          <span className="text-sm">Keine anstehenden Kurse vorhanden.</span>
        </div>
      ) : gefilterteKurse.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <Search className="w-5 h-5" />
          <span className="text-sm">Keine Kurse entsprechen den aktiven Filtern.</span>
        </div>
      ) : (
        <>
          {/* Bulk-Aktionsleiste (L-10): sichtbar nur bei mindestens einer Auswahl */}
          {selectedTermine.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-cd-blue/30 bg-cd-blue/5 px-4 py-2.5 shadow-sm">
              <span className="text-sm font-bold text-slate-800 whitespace-nowrap">
                {selectedTermine.length} Termine ausgewählt
              </span>

              <div className="ml-auto flex flex-wrap items-center gap-3">
                {/* Trainer zuweisen: alle aktiven Trainer inkl. „n. v." */}
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  Trainer zuweisen
                  <div className="relative">
                    <select
                      value={bulkTrainerKuerzel}
                      onChange={(e) => setBulkTrainerKuerzel(e.target.value)}
                      title="Trainer für alle ausgewählten Termine festlegen"
                      className="text-xs border border-slate-300 rounded-md pl-2 pr-6 py-1.5 bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">– nicht ändern –</option>
                      <option value="n. v.">n. v.</option>
                      {aktiveTrainer.map((t) => (
                        <option key={t.id} value={(t.kuerzel ?? '').trim()}>
                          {trainerLabel(t)}
                        </option>
                      ))}
                    </select>
                    <SelectChevron />
                  </div>
                </label>

                {/* Status ändern: Standard-Zuweisungs-Statuswerte */}
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  Status ändern
                  <div className="relative">
                    <select
                      value={bulkStatus}
                      onChange={(e) => setBulkStatus(e.target.value)}
                      title="Zuweisungs-Status für alle ausgewählten Termine festlegen"
                      className="text-xs border border-slate-300 rounded-md pl-2 pr-6 py-1.5 bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">– nicht ändern –</option>
                      <option value="bestätigt">Bestätigt</option>
                      <option value="unter Vorbehalt">Unter Vorbehalt</option>
                      <option value="abgesagt">Abgesagt</option>
                    </select>
                    <SelectChevron />
                  </div>
                </label>

                {/* Primäre Bulk-Aktion (CD-Blau #285DAA) – speichert via PATCH /api/zuweisung/bulk */}
                <button
                  type="button"
                  onClick={handleBulkUebernehmen}
                  disabled={isSubmitting}
                  title={
                    isSubmitting
                      ? 'Speichern läuft …'
                      : 'Änderungen für alle ausgewählten Termine speichern'
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-white text-xs font-semibold rounded-lg transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ backgroundColor: '#285DAA' }}
                >
                  {isSubmitting ? 'Speichern …' : 'Für alle übernehmen'}
                </button>
              </div>
            </div>
          )}

          <div className="overflow-auto max-h-[70vh] rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm min-w-[1280px]">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                {/* Mehrfachbearbeitung (L-10): „Alle sichtbaren Termine auswählen" */}
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap text-center w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={alleSichtbarenSelektiert}
                    onChange={toggleAlleSichtbaren}
                    disabled={flacheTermine.length === 0}
                    aria-label={
                      alleSichtbarenSelektiert
                        ? 'Auswahl aller sichtbaren Termine aufheben'
                        : 'Alle sichtbaren Termine auswählen'
                    }
                    title={
                      alleSichtbarenSelektiert
                        ? 'Alle sichtbaren Termine abwählen'
                        : 'Alle sichtbaren Termine auswählen'
                    }
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap text-center w-14">KW</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap">Datum & Zeit</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap">Kurs</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap">Status</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap text-center">TN</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap text-right">Einnahmen</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap text-right">Honorar</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap text-right">Marge</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap text-right">Marge %</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap w-28">Trainer</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap">Zuweisungs-Status</th>
                {OPTIONEN_DEFINITIONEN.map((def) => (
                  <th
                    key={def.key}
                    title={def.title}
                    className="sticky top-0 z-10 bg-slate-50 px-2 py-3 font-semibold whitespace-nowrap text-center"
                  >
                    {def.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flacheTermine.map((eintrag, index) => {
                const kurs = eintrag.kurs;
                const termin = eintrag.termin;
                const zuweisung = kurs.zuweisungen[0] ?? null;
                const hatTrainer = zuweisung !== null && zuweisung.trainer_id !== null;
                const effektivStatus: ZuweisungStatus =
                  hatTrainer && isZuweisungStatus(zuweisung.status)
                    ? zuweisung.status
                    : 'keine Zuordnung';
                // Kursbezogener Schlüssel (Feedback, Ladezustand, Konflikte)
                // und eindeutiger Zeilenschlüssel je Einzeltermin.
                const key = kursKey(kurs);
                const rowKey = `${key}#${termin.date_id}`;
                const startDatum = toDate(termin.date_start);
                const kursIso = startDatum ? toIsoDate(startDatum) : null;
                const istAusgenommen = istKursAusgenommen(kurs);
                const istNaechsterKurstag =
                  !istAusgenommen &&
                  naechsterKurstagIso !== null &&
                  kursIso === naechsterKurstagIso;
                const istHeuteZeile = index === indexNaechsterKurstag;
                const istFolgetermin =
                  !istAusgenommen &&
                  naechsterKurstagIso !== null &&
                  kursIso !== null &&
                  kursIso > naechsterKurstagIso &&
                  kursIso <= in5TagenIso;
                const konflikte = konflikteProKurs[key] ?? [];
                const hatEchtenKonflikt = konflikte.some(
                  (konflikt) => konflikt.echt
                );
                const konfliktTitle =
                  konflikte.length > 0
                    ? konflikte.map((konflikt) => konflikt.text).join('\n')
                    : undefined;
                const feedbackEntry = feedback[key];
                const statusInfo = dateStatusInfo(kurs.date_status);
                const maxPlaetze = kurs.max_plaetze ?? null;
                const hatLimit = maxPlaetze !== null && maxPlaetze > 0;
                const quote = hatLimit ? kurs.teilnehmer / (maxPlaetze ?? 1) : 0;
                const belegungBadgeClass = !hatLimit
                  ? 'bg-slate-50 text-slate-600 border-slate-200'
                  : quote < 0.25
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : quote < 0.7
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                const teilnehmerText = hatLimit
                  ? `${kurs.teilnehmer}/${maxPlaetze}`
                  : `${kurs.teilnehmer}/-`;
                const zeit = formatZeitraum(termin.date_start, termin.date_end);
                const optionen = kurs.optionen ?? LEERE_OPTIONEN;

                // Mehrfachbearbeitung (L-10): Ist dieser Einzeltermin markiert?
                const istSelektiert = selectedTermine.includes(termin.date_id);

                // Interaktive Trainer-Auswahl: laufende Umzuweisung (P98) für
                // den Ladezustand in dieser Zeile. Das aktuelle Kürzel kommt
                // einheitlich aus kurs.trainer_kuerzel (keine hatTrainer-
                // Verzweigung mehr).
                const istTrainerSaving = savingTrainerKeys.has(key);

                // Automatisierte Schließungs-, Last-Minute- und
                // Trainer-Verfügbarkeits-Prüfung (ersetzt die bisherige
                // Hinweis-Berechnung in dieser Spalte vollständig).
                const diffTage = diffTageBisStart(kurs, heuteIso);
                const hinweisSchliessung = schliessungHinweis(kurs, heuteIso);
                const hinweisLastMinute = lastMinuteHinweis(kurs, diffTage);
                const hinweisTrainer = trainerNichtVerfuegbarHinweis(
                  kurs,
                  heuteIso
                );
                const hinweisTnListe = tnListeHinweis(kurs);

                // Klickbare Hinweis-Badges: Schlüssel + Hinweis-Paar für die
                // Badge-Filterung (exklusive Filter-Logik wie bei den Tags).
                const badgeEintraege: {
                  key: BadgeFilterKey;
                  hinweis: KursHinweis | null;
                }[] = [
                  { key: 'schliessung', hinweis: hinweisSchliessung },
                  { key: 'lastminute', hinweis: hinweisLastMinute },
                  { key: 'trainer', hinweis: hinweisTrainer },
                  { key: 'tnliste', hinweis: hinweisTnListe },
                ];
                const badgeAktiv = (key: BadgeFilterKey) =>
                  selectedBadge === key;

                // Honorar: manueller Wert hat Vorrang, sonst Modell-A-Vorschlag.
                const autoHonorar = berechneKursHonorar(kurs, zuweisung, trainerMap);
                const manualHonorar = zuweisung?.honorar_manuell ?? null;
                const istHonorarManuell = manualHonorar !== null;
                const effektivesHonorar = istHonorarManuell
                  ? manualHonorar
                  : autoHonorar;
                const hatUmsatz = (kurs.einnahmen ?? 0) > 0;
                const deckungsbeitrag =
                  effektivesHonorar !== null && hatUmsatz
                    ? kurs.einnahmen - effektivesHonorar
                    : null;
                const marge =
                  hatUmsatz && deckungsbeitrag !== null
                    ? (deckungsbeitrag / kurs.einnahmen) * 100
                    : null;

                return (
                  <tr
                    key={rowKey}
                    id={istHeuteZeile ? 'row-today' : undefined}
                    data-date={startDatum ? toIsoDate(startDatum) : undefined}
                    className={`border-b border-slate-100 last:border-b-0 align-top transition-colors ${istHeuteZeile ? 'scroll-mt-32 ' : ''}${
                      istNaechsterKurstag
                        ? 'border-l-4 border-l-amber-500 bg-amber-100 hover:bg-amber-200'
                        : istFolgetermin
                          ? 'border-l-4 border-l-amber-200 bg-amber-50 hover:bg-amber-100'
                          : index % 2 === 0
                            ? 'bg-white hover:bg-slate-100'
                            : 'bg-slate-100/75 hover:bg-slate-100'
                    }`}
                  >
                    {/* Mehrfachbearbeitung (L-10): Termin-Auswahl (date_id) */}
                    <td className="px-2 py-3 text-center whitespace-nowrap align-top">
                      <input
                        type="checkbox"
                        checked={istSelektiert}
                        onChange={() => toggleTermin(termin.date_id)}
                        aria-label={`Termin ${termin.date_id} auswählen`}
                        title={istSelektiert ? 'Auswahl aufheben' : 'Termin auswählen'}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* Kalenderwoche (ISO-8601, ermittelt über den Kursstart) */}
                    <td className="px-2 py-3 text-center whitespace-nowrap align-top">
                      <span className="inline-flex items-center justify-center min-w-[2rem] text-sm tabular-nums text-slate-600">
                        {startDatum ? getIsoWeek(startDatum) : '–'}
                      </span>
                    </td>

                    {/* Datum & Zeit */}
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium text-slate-800 whitespace-nowrap">
                        {zeit.haupt}
                      </div>
                      {zeit.detail && (
                        <div className="text-xs text-slate-500 whitespace-nowrap mt-0.5">
                          {zeit.detail}
                        </div>
                      )}
                      {eintrag.terminAnzahl > 1 && (
                        <div className="mt-0.5">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 whitespace-nowrap">
                            Tag {eintrag.terminIndex + 1} von {eintrag.terminAnzahl}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Kurs */}
                    <td className="px-3 py-3 align-top">
                      <button
                        type="button"
                        onClick={() =>
                          // Exklusiver Filter: Setzt den Kurstitel als aktiven
                          // Filter. Ein erneuter Klick auf denselben Titel
                          // (bereits aktiv) setzt den Filter zurück.
                          handleTitelFilterChange(
                            selectedTitel === kurs.offer_name
                              ? 'ALL'
                              : (kurs.offer_name ?? '')
                          )
                        }
                        title={`Nach Kurstitel „${kurs.offer_name}" filtern${
                          selectedTitel === kurs.offer_name
                            ? ' (Filter zurücksetzen)'
                            : ''
                        }`}
                        aria-pressed={selectedTitel === kurs.offer_name}
                        className={`text-left font-medium transition ${
                          selectedTitel === kurs.offer_name
                            ? 'text-cd-blue underline decoration-cd-blue decoration-2 underline-offset-2'
                            : 'text-slate-800 hover:text-cd-blue hover:underline hover:decoration-cd-blue/50'
                        }`}
                      >
                        {kuerzeAngebotstitel(kurs.offer_name) || '–'}
                      </button>
                      {kurs.kursnr?.trim() && (
                        <div className="text-xs font-mono text-gray-500 mt-0.5">
                          {kurs.kursnr.trim()}
                        </div>
                      )}
                      {kurs.tags && kurs.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {kurs.tags.map((tag) => {
                            const istAktiv = selectedTag === tag;
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() =>
                                  // Exklusiver Filter: Setzt den Tag als aktiven
                                  // Filter. Ein erneuter Klick auf denselben Tag
                                  // (bereits aktiv) setzt den Filter zurück.
                                  // Da selectedTag ein Einzelwert ist, ersetzt
                                  // jeder neue Klick zwangsläufig den vorherigen
                                  // Filter – es ist nie mehr als einer aktiv.
                                  handleTagFilterChange(istAktiv ? 'ALL' : tag)
                                }
                                title={`Nach Tag „${tag}" filtern${
                                  istAktiv ? ' (Filter zurücksetzen)' : ''
                                }`}
                                aria-pressed={istAktiv}
                                className={`text-[11px] px-1.5 py-0.5 rounded font-medium border cursor-pointer transition ${
                                  istAktiv
                                    ? 'bg-cd-blue text-white border-cd-blue shadow-sm ring-2 ring-cd-blue/30'
                                    : 'bg-cd-blue/10 text-cd-blue border-cd-blue/30 hover:bg-cd-blue/20'
                                }`}
                              >
                                {tag}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {(hinweisSchliessung ||
                        hinweisLastMinute ||
                        hinweisTrainer ||
                        hinweisTnListe ||
                        hatEchtenKonflikt) && (
                        <div className="mt-1 flex flex-wrap gap-1 items-center">
                          {badgeEintraege.map(({ key, hinweis }) =>
                            hinweis ? (
                              <button
                                key={key}
                                type="button"
                                onClick={() =>
                                  // Exklusiver Filter: Setzt das Badge als
                                  // aktiven Filter. Ein erneuter Klick auf
                                  // dasselbe Badge (bereits aktiv) setzt den
                                  // Filter zurück.
                                  handleBadgeFilterChange(
                                    badgeAktiv(key) ? 'ALL' : key
                                  )
                                }
                                title={`Nach Badge „${hinweis.text}" filtern${
                                  badgeAktiv(key) ? ' (Filter zurücksetzen)' : ''
                                }`}
                                aria-pressed={badgeAktiv(key)}
                                className={`${hinweis.className} cursor-pointer transition ${
                                  badgeAktiv(key)
                                    ? 'ring-2 ring-cd-blue'
                                    : 'hover:ring-2 hover:ring-cd-blue/40'
                                }`}
                              >
                                {hinweis.text}
                              </button>
                            ) : null
                          )}
                          {hatEchtenKonflikt && (
                            <button
                              type="button"
                              onClick={() =>
                                handleBadgeFilterChange(
                                  badgeAktiv('konflikt') ? 'ALL' : 'konflikt'
                                )
                              }
                              title={`Nach Badge „Terminkonflikt" filtern${
                                badgeAktiv('konflikt')
                                  ? ' (Filter zurücksetzen)'
                                  : ''
                              }`}
                              aria-pressed={badgeAktiv('konflikt')}
                              className={`bg-red-600 text-yellow-300 font-semibold px-2 py-0.5 rounded text-xs cursor-pointer transition ${
                                badgeAktiv('konflikt')
                                  ? 'ring-2 ring-cd-blue'
                                  : 'hover:ring-2 hover:ring-cd-blue/40'
                              }`}
                            >
                              Terminkonflikt
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Kursstatus */}
                    <td className="px-3 py-3 whitespace-nowrap align-top">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${statusInfo.className}`}
                      >
                        {statusInfo.label}
                      </span>
                    </td>

                    {/* Teilnehmer */}
                    <td className="px-3 py-3 text-center whitespace-nowrap align-top">
                      <span
                        className={`inline-flex items-center justify-center min-w-[3.25rem] px-2 py-1 rounded-full text-xs font-semibold border ${belegungBadgeClass}`}
                      >
                        {teilnehmerText}
                      </span>
                    </td>

                    {/* Einnahmen */}
                    <td className="px-3 py-3 text-right whitespace-nowrap font-medium text-slate-800 tabular-nums align-top">
                      {formatEinnahmen(kurs.einnahmen)}
                    </td>

                    {/* Dozentenhonorar (Inline-Edit & Reset) */}
                    <HonorarZelle
                      honorar={hatUmsatz ? effektivesHonorar : null}
                      manuell={istHonorarManuell && hatUmsatz}
                      disabled={!hatTrainer}
                      onSave={(wert) => handleHonorarChange(kurs, wert)}
                    />

                    {/* Deckungsbeitrag */}
                    <td
                      className={`px-3 py-3 text-right whitespace-nowrap tabular-nums font-medium align-top ${
                        deckungsbeitrag !== null && deckungsbeitrag < 0
                          ? 'text-red-600'
                          : 'text-slate-600'
                      }`}
                    >
                      {deckungsbeitrag !== null
                        ? euroFormatter.format(deckungsbeitrag)
                        : '–'}
                    </td>

                    {/* Marge */}
                    <td
                      className={`px-3 py-3 text-right whitespace-nowrap tabular-nums align-top ${
                        marge === null
                          ? 'text-slate-400'
                          : marge < 0
                            ? 'text-red-600 font-medium'
                            : 'text-emerald-700'
                      }`}
                    >
                      {marge === null
                        ? '–'
                        : `${marge.toFixed(1).replace('.', ',')} %`}
                    </td>

                    {/* Trainer (interaktive Auswahl mit Sicherheitsabfrage) */}
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <select
                            value={kurs.trainer_kuerzel || 'n. v.'}
                            disabled={istTrainerSaving}
                            onChange={(e) =>
                              handleTrainerChange(
                                kurs,
                                e.target.value,
                                termin.date_id
                              )
                            }
                            title="Trainer zuweisen – edoobox & Kurstitel werden angepasst"
                            aria-label={`Trainer für Kurs ${kurs.offer_name ?? ''}`}
                            className={`text-xs border rounded-md px-2 py-1 pr-6 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                              istTrainerSaving
                                ? 'opacity-60 cursor-wait'
                                : 'border-slate-300 cursor-pointer'
                            }`}
                          >
                            <option value="n. v.">n. v.</option>
                            {aktiveTrainer.map((t) => (
                              <option
                                key={t.id}
                                value={(t.kuerzel ?? '').trim()}
                              >
                                {t.kuerzel}
                              </option>
                            ))}
                          </select>
                          {istTrainerSaving && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 shrink-0" />
                          )}
                        </span>

                        {konflikte.length > 0 && (
                          <span
                            title={konfliktTitle}
                            aria-label={konfliktTitle ?? 'Konflikt: Trainer-Doppelbelegung'}
                            className={`inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-full cursor-help ring-1 ${
                              hatEchtenKonflikt
                                ? 'bg-red-100 text-red-600 ring-red-300'
                                : 'bg-amber-100 text-amber-700 ring-amber-300'
                            }`}
                          >
                            <AlertTriangle
                              className={`w-3.5 h-3.5 ${
                                hatEchtenKonflikt ? 'text-red-600' : ''
                              }`}
                            />
                          </span>
                        )}
                      </div>

                      {feedbackEntry && (
                        <div
                          role="status"
                          className={`mt-1 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold border ${
                            feedbackEntry.type === 'success'
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              : 'bg-red-100 text-red-800 border-red-300'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              feedbackEntry.type === 'success'
                                ? 'bg-emerald-500'
                                : 'bg-red-500'
                            }`}
                          />
                          {feedbackEntry.text}
                        </div>
                      )}
                    </td>

                    {/* Zuweisungs-Status */}
                    <td className="px-3 py-3 whitespace-nowrap align-top">
                      {(() => {
                        const statusSchema = ZUWEISUNG_STATUS_CONFIG[effektivStatus];
                        const dotClassName = hatTrainer
                          ? statusSchema.dotClassName
                          : 'bg-red-600';

                        return (
                          <div className="flex items-center gap-2">
                            {/* Farbiger Status-Punkt */}
                            <span
                              aria-hidden="true"
                              className={`w-2 h-2 rounded-full shrink-0 ${dotClassName}`}
                            />

                            <select
                              value={effektivStatus}
                              disabled={!hatTrainer}
                              onChange={(e) => {
                                if (isZuweisungStatus(e.target.value)) {
                                  handleStatusChange(kurs, e.target.value);
                                }
                              }}
                              className={`w-full min-w-[145px] text-sm border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 ${statusSchema.selectClassName} ${
                                hatTrainer ? '' : 'cursor-not-allowed'
                              }`}
                            >
                              {STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })()}
                    </td>

                    {/* Options-Haken: Einladungslink, Last Minute, Abgerechnet */}
                    {OPTIONEN_DEFINITIONEN.map((def) => (
                      <td key={def.key} className="px-2 py-3 text-center align-top">
                        <div className="inline-flex items-center justify-center gap-1">
                          {def.key === 'einladungslink' && (
                            <span
                              title="Dozent informiert & beauftragt"
                              aria-label="Dozent informiert & beauftragt"
                              className="inline-flex"
                            >
                              <User className="w-3.5 h-3.5 text-slate-400" />
                            </span>
                          )}
                          {def.key === 'abgerechnet' && (
                            <span
                              title="Kurslink & Unterlagen bereitgestellt"
                              aria-label="Kurslink & Unterlagen bereitgestellt"
                              className="inline-flex"
                            >
                              <FileText className="w-3.5 h-3.5 text-slate-400" />
                            </span>
                          )}
                          <input
                            type="checkbox"
                            checked={optionen[def.key]}
                            onChange={(e) =>
                              handleOptionChange(kurs, def.key, e.target.checked)
                            }
                            title={def.title}
                            aria-label={def.label}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                        </div>
                      </td>
                    ))}

                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Modal: Bereinigung doppelter Trainer-Zuweisungen */}
      {cleanupOffen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cleanup-modal-titel"
          onClick={() => setCleanupOffen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Kopf */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2
                id="cleanup-modal-titel"
                className="text-lg font-bold text-slate-800 flex items-center gap-2"
              >
                <Wand2 className="w-5 h-5 text-cd-blue" />
                Zuweisungen bereinigen
              </h2>
              <button
                type="button"
                onClick={() => setCleanupOffen(false)}
                aria-label="Schließen"
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4">
              {/* Fehleranzeige */}
              {cleanupFehler && (
                <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Bereinigung fehlgeschlagen</p>
                    <p className="mt-0.5 text-xs">{cleanupFehler}</p>
                  </div>
                </div>
              )}

              {/* Startansicht: Erklärung + Auslöse-Button */}
              {!cleanupErgebnis && !cleanupFehler && (
                <div className="text-sm text-slate-600">
                  <p>
                    Ermittelt alle Kurs-Termine mit mehr als einer Trainer-Zuweisung.
                    Eindeutige Fälle (exakt ein Trainer mit Status „Bestätigt“) werden
                    automatisch bereinigt; uneindeutige Fälle landen im Report zur
                    manuellen Korrektur.
                  </p>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void cleanupAusfuehren()}
                      disabled={cleanupLaeuft}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold rounded-lg transition"
                    >
                      {cleanupLaeuft ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Wand2 className="w-4 h-4" />
                      )}
                      {cleanupLaeuft ? 'Bereinigung läuft…' : 'Bereinigung jetzt ausführen'}
                    </button>
                  </div>
                </div>
              )}

              {/* Ergebnisdarstellung */}
              {cleanupErgebnis && (
                <>
                  {/* Zusammenfassung */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                      <p className="text-xs font-semibold text-slate-500">Dubletten</p>
                      <p className="text-xl font-bold text-slate-800">
                        {cleanupErgebnis.zusammenfassung.dubletten}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                      <p className="text-xs font-semibold text-emerald-600">Bereinigt</p>
                      <p className="text-xl font-bold text-emerald-700">
                        {cleanupErgebnis.zusammenfassung.bereinigt}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                      <p className="text-xs font-semibold text-red-600">Konflikte</p>
                      <p className="text-xl font-bold text-red-700">
                        {cleanupErgebnis.zusammenfassung.konflikte}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                      <p className="text-xs font-semibold text-slate-500">Gelöscht</p>
                      <p className="text-xl font-bold text-slate-800">
                        {cleanupErgebnis.zusammenfassung.geloeschte_zuweisungen}
                      </p>
                    </div>
                  </div>

                  {/* Kein Handlungsbedarf */}
                  {cleanupErgebnis.bereinigt.length === 0 &&
                    cleanupErgebnis.konflikte.length === 0 && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm">
                        <span className="mt-0.5">✓</span>
                        <p>
                          Keine doppelten Trainer-Zuweisungen gefunden. Die Zuweisungen
                          sind konsistent.
                        </p>
                      </div>
                    )}

                  {/* Automatisch bereinigte Fälle */}
                  {cleanupErgebnis.bereinigt.length > 0 && (
                    <div className="mb-5">
                      <h3 className="text-sm font-bold text-slate-700 mb-2">
                        Automatisch bereinigt ({cleanupErgebnis.bereinigt.length})
                      </h3>
                      <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-left text-slate-500">
                              <th className="px-3 py-2 font-semibold">Kursnr.</th>
                              <th className="px-3 py-2 font-semibold">Titel</th>
                              <th className="px-3 py-2 font-semibold">Datum</th>
                              <th className="px-3 py-2 font-semibold">Start</th>
                              <th className="px-3 py-2 font-semibold">Behalten</th>
                              <th className="px-3 py-2 font-semibold">Entfernt</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cleanupErgebnis.bereinigt.map((fall) => (
                              <tr
                                key={fall.date_id}
                                className="border-t border-slate-100"
                              >
                                <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                                  {fall.kursnr ?? '–'}
                                </td>
                                <td className="px-3 py-2 text-slate-700">
                                  {fall.titel ?? '–'}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                                  {fall.datum ?? '–'}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                                  {cleanupStartzeitText(fall.start_uhr)}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1">
                                    <span className="font-medium text-emerald-700">
                                      {fall.behalten.name}
                                    </span>
                                    {fall.behalten.kuerzel && (
                                      <span className="text-slate-400">
                                        ({fall.behalten.kuerzel})
                                      </span>
                                    )}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-slate-500">
                                  {fall.entfernt
                                    .map((t) => `${t.name}${t.kuerzel ? ` (${t.kuerzel})` : ''}`)
                                    .join(', ') || '–'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Ungelöste Konflikte zur manuellen Korrektur */}
                  {cleanupErgebnis.konflikte.length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        Ungelöste Konflikte – bitte manuell korrigieren (
                        {cleanupErgebnis.konflikte.length})
                      </h3>
                      <p className="text-xs text-slate-500 mb-2">
                        Keine oder mehrere Zuweisungen haben den Status „Bestätigt“.
                        Es wurde nichts gelöscht. Bitte den Status in der Kursplanung
                        korrigieren und die Bereinigung erneut ausführen.
                      </p>
                      <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-left text-slate-500">
                              <th className="px-3 py-2 font-semibold">Kursnr.</th>
                              <th className="px-3 py-2 font-semibold">Titel</th>
                              <th className="px-3 py-2 font-semibold">Datum</th>
                              <th className="px-3 py-2 font-semibold">Start</th>
                              <th className="px-3 py-2 font-semibold">Trainer & Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cleanupErgebnis.konflikte.map((fall) => (
                              <tr
                                key={fall.date_id}
                                className="border-t border-slate-100"
                              >
                                <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                                  {fall.kursnr ?? '–'}
                                </td>
                                <td className="px-3 py-2 text-slate-700">
                                  {fall.titel ?? '–'}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                                  {fall.datum ?? '–'}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                                  {cleanupStartzeitText(fall.start_uhr)}
                                </td>
                                <td className="px-3 py-2">
                                  <ul className="space-y-1">
                                    {fall.trainer.map((t) => (
                                      <li
                                        key={t.trainer_id}
                                        className="flex items-center gap-2"
                                      >
                                        <span className="text-slate-700">
                                          {t.name}
                                          {t.kuerzel ? ` (${t.kuerzel})` : ''}
                                        </span>
                                        <span
                                          className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${cleanupStatusBadgeClass(t.status)}`}
                                        >
                                          {t.status ?? 'ohne Status'}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Fuß */}
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setCleanupOffen(false)}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50 transition"
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
