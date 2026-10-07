'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CalendarDays,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Users,
  Search,
  FilterX,
  X,
  ChevronDown,
} from 'lucide-react';
import Navigation from './components/Navigation';
import HeaderLogo from './components/HeaderLogo';
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
}

/** Pro Kurs angezeigtes Auto-Save-Feedback. */
interface Feedback {
  type: 'success' | 'error';
  text: string;
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
    selectClassName: 'bg-rose-50 text-rose-800 border-rose-300 focus:ring-rose-500',
    dotClassName: 'bg-rose-500',
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
    badgeClasses: 'bg-rose-50 text-rose-700 border-rose-200 line-through opacity-75',
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

/** Ein einzelner Hinweis-Badge eines Kurses. */
interface KursHinweis {
  text: string;
  className: string;
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
      className: 'bg-rose-50 text-rose-700 border-rose-200',
    });
  }

  if (optionen.last_minute) {
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
        className: 'bg-rose-50 text-rose-700 border-rose-200',
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
 */
function trainerNichtVerfuegbarHinweis(kurs: Kurs): KursHinweis | null {
  if (kurs.trainer_verfuegbar !== false) return null;
  if (kurs.zuweisung_status === 'abgesagt') return null;
  if (kurs.offer_status === '5') return null;
  if (kurs.offer_status === '3' && (kurs.teilnehmer ?? 0) === 0) return null;
  return {
    text: 'Trainer nicht verfügbar',
    className:
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-600 text-yellow-300 border border-red-700 shadow-sm whitespace-nowrap',
  };
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
              className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-100 transition"
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

export default function Home() {
  const [kurse, setKurse] = useState<Kurs[]>([]);
  const [trainer, setTrainer] = useState<Trainer[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
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
  const loadData = useCallback(async () => {
    setIsLoading(true);
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
      // sobald das DOM die Tabelle gerendert hat.
      if (kurseData.length > 0) {
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
    selectedStatusFilter,
    selectedJahr,
    selectedMonat,
    selectedKw,
    selectedTrainerFilter,
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
    setSearchTerm('');
    setSearchKursnr('');
  }, []);

  // Status-Filter-Chip umschalten (Mehrfachauswahl).
  const toggleStatusFilter = useCallback((value: string) => {
    setSelectedStatusFilter((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  }, []);

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

  // Dynamische Ausblendung: Die Hinweis-Spalte wird nur gerendert, wenn
  // mindestens ein gefilterter Kurs einen Schließungs-, Last-Minute- oder
  // Trainer-nicht-verfügbar-Hinweis auslöst.
  const zeigeHinweisSpalte = gefilterteKurse.some(
    (kurs) =>
      schliessungHinweis(kurs, heuteIso) !== null ||
      lastMinuteHinweis(kurs, diffTageBisStart(kurs, heuteIso)) !== null ||
      trainerNichtVerfuegbarHinweis(kurs) !== null ||
      (konflikteProKurs[kursKey(kurs)] ?? []).some(
        (konflikt) => konflikt.echt
      )
  );

  const naechsterKurstagIso = gefilterteKurse.reduce<string | null>(
    (fruehester, kurs) => {
      if (istKursAusgenommen(kurs)) return fruehester;
      const start = kursStartDate(kurs);
      if (!start) return fruehester;
      const iso = toIsoDate(start);
      if (iso < heuteIso) return fruehester;
      return fruehester === null || iso < fruehester ? iso : fruehester;
    },
    null
  );

  // Index des allerersten Kurses am ersten anstehenden Kurstag.
  const indexNaechsterKurstag =
    naechsterKurstagIso === null
      ? -1
      : gefilterteKurse.findIndex((kurs) => {
          if (istKursAusgenommen(kurs)) return false;
          const start = kursStartDate(kurs);
          return start !== null && toIsoDate(start) === naechsterKurstagIso;
        });

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-800 sm:p-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-blue-600" />
            Kursplanung
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Traineranzeige wird aus edoobox übernommen; der Status wird bei
            Änderung automatisch gespeichert.
          </p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <Navigation />
          <HeaderLogo />
        </div>
      </header>

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
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
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
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="z. B. Yoga, Rückenschule…"
                  className="w-full pl-9 pr-8 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {searchTerm !== '' && (
                  <FilterClearButton
                    onClick={() => setSearchTerm('')}
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
                  onChange={(e) => setSearchKursnr(e.target.value)}
                  placeholder="z. B. xls-gl-m1…"
                  className="w-full pl-9 pr-8 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {searchKursnr !== '' && (
                  <FilterClearButton
                    onClick={() => setSearchKursnr('')}
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
                onChange={(e) => setSelectedTrainerFilter(e.target.value)}
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
                  onChange={(e) => setSelectedTag(e.target.value)}
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
                    onClick={() => setSelectedTag('ALL')}
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
                  onChange={(e) => setSelectedJahr(e.target.value)}
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
                    onClick={() => setSelectedJahr('ALL')}
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
                  onChange={(e) => setSelectedMonat(e.target.value)}
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
                    onClick={() => setSelectedMonat('ALL')}
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
                  onChange={(e) => setSelectedKw(e.target.value)}
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
                    onClick={() => setSelectedKw('ALL')}
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
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition whitespace-nowrap"
              >
                <CalendarDays className="w-3.5 h-3.5" />
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
                Zeige {gefilterteKurse.length} von {kurse.length} Kursen
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
        <div className="p-4 rounded-lg border border-rose-300 bg-rose-50 text-rose-800 text-sm flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition"
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
        <div className="overflow-auto max-h-[70vh] rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm min-w-[1280px]">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
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
                {zeigeHinweisSpalte && (
                  <th className="sticky top-0 z-10 bg-slate-50 px-3 py-3 font-semibold whitespace-nowrap text-center">
                    Hinweis
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {gefilterteKurse.map((kurs, index) => {
                const zuweisung = kurs.zuweisungen[0] ?? null;
                const hatTrainer = zuweisung !== null && zuweisung.trainer_id !== null;
                const effektivStatus: ZuweisungStatus =
                  hatTrainer && isZuweisungStatus(zuweisung.status)
                    ? zuweisung.status
                    : 'keine Zuordnung';
                const key = kursKey(kurs);
                const startDatum = kursStartDate(kurs);
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
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : quote < 0.7
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                const teilnehmerText = hatLimit
                  ? `${kurs.teilnehmer}/${maxPlaetze}`
                  : `${kurs.teilnehmer}/-`;
                const zeit = kursZeitraum(kurs);
                const optionen = kurs.optionen ?? LEERE_OPTIONEN;

                // Automatisierte Schließungs-, Last-Minute- und
                // Trainer-Verfügbarkeits-Prüfung (ersetzt die bisherige
                // Hinweis-Berechnung in dieser Spalte vollständig).
                const diffTage = diffTageBisStart(kurs, heuteIso);
                const hinweisSchliessung = schliessungHinweis(kurs, heuteIso);
                const hinweisLastMinute = lastMinuteHinweis(kurs, diffTage);
                const hinweisTrainer = trainerNichtVerfuegbarHinweis(kurs);

                // Honorar: manueller Wert hat Vorrang, sonst Modell-A-Vorschlag.
                const autoHonorar = berechneKursHonorar(kurs, zuweisung, trainerMap);
                const manualHonorar = zuweisung?.honorar_manuell ?? null;
                const istHonorarManuell = manualHonorar !== null;
                const effektivesHonorar = istHonorarManuell
                  ? manualHonorar
                  : autoHonorar;
                const deckungsbeitrag =
                  effektivesHonorar !== null
                    ? kurs.einnahmen - effektivesHonorar
                    : null;
                const marge =
                  kurs.einnahmen > 0 && deckungsbeitrag !== null
                    ? (deckungsbeitrag / kurs.einnahmen) * 100
                    : null;

                return (
                  <tr
                    key={key}
                    id={istHeuteZeile ? 'row-today' : undefined}
                    data-date={startDatum ? toIsoDate(startDatum) : undefined}
                    className={`border-b border-slate-100 last:border-b-0 align-top transition-colors ${istHeuteZeile ? 'scroll-mt-32 ' : ''}${
                      istNaechsterKurstag
                        ? 'border-l-4 border-l-rose-400 dark:border-l-rose-700 bg-red-100/60 dark:bg-red-950/35 hover:bg-red-100/80 dark:hover:bg-red-950/50'
                        : istFolgetermin
                          ? 'border-l-4 border-l-red-800 dark:border-l-red-600 bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-100/50 dark:hover:bg-rose-950/35'
                          : index % 2 === 0
                            ? 'bg-white hover:bg-slate-100'
                            : 'bg-slate-100/75 hover:bg-slate-100'
                    }`}
                  >
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
                    </td>

                    {/* Kurs */}
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium text-slate-800">
                        {kurs.offer_name ?? '–'}
                      </div>
                      {kurs.kursnr?.trim() && (
                        <div className="text-xs font-mono text-gray-500 mt-0.5">
                          #{kurs.kursnr.trim()}
                        </div>
                      )}
                      {kurs.tags && kurs.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {kurs.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
                            >
                              {tag}
                            </span>
                          ))}
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
                      honorar={effektivesHonorar}
                      manuell={istHonorarManuell}
                      disabled={!hatTrainer}
                      onSave={(wert) => handleHonorarChange(kurs, wert)}
                    />

                    {/* Deckungsbeitrag */}
                    <td
                      className={`px-3 py-3 text-right whitespace-nowrap tabular-nums font-medium align-top ${
                        deckungsbeitrag !== null && deckungsbeitrag < 0
                          ? 'text-rose-600'
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
                            ? 'text-rose-600 font-medium'
                            : 'text-emerald-700'
                      }`}
                    >
                      {marge === null
                        ? '–'
                        : `${marge.toFixed(1).replace('.', ',')} %`}
                    </td>

                    {/* Trainer (read-only: Anzeige des edoobox-Kürzels) */}
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-center gap-1.5">
                        {hatTrainer ? (
                          <span
                            title="Trainer aus edoobox (schreibgeschützt)"
                            className="inline-flex px-2 py-1 rounded-md text-xs font-semibold bg-sky-50 text-sky-800 border border-sky-200"
                          >
                            {zuweisung?.trainer?.kuerzel?.trim() ||
                              `Trainer #${zuweisung?.trainer_id}`}
                          </span>
                        ) : (
                          <span className="inline-flex border border-red-700 shadow-sm rounded px-2 py-0.5 whitespace-nowrap bg-red-600 text-yellow-300 font-bold text-xs">
                            Nicht zugewiesen
                          </span>
                        )}

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
                              : 'bg-rose-100 text-rose-800 border-rose-300'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              feedbackEntry.type === 'success'
                                ? 'bg-emerald-500'
                                : 'bg-rose-500'
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
                      </td>
                    ))}

                    {/* Hinweis-Spalte: automatisierte Schließungs-, Last-Minute-
                        und Trainer-Verfügbarkeits-Prüfung. Ohne zutreffenden
                        Hinweis bleibt die Zelle komplett leer. */}
                    {zeigeHinweisSpalte && (
                      <td className="px-3 py-3 align-top text-center">
                        {(hinweisSchliessung ||
                          hinweisLastMinute ||
                          hinweisTrainer ||
                          hatEchtenKonflikt) && (
                          <div className="flex flex-wrap gap-1 items-center justify-center">
                            {hinweisSchliessung && (
                              <span className={hinweisSchliessung.className}>
                                {hinweisSchliessung.text}
                              </span>
                            )}
                            {hinweisLastMinute && (
                              <span className={hinweisLastMinute.className}>
                                {hinweisLastMinute.text}
                              </span>
                            )}
                            {hinweisTrainer && (
                              <span className={hinweisTrainer.className}>
                                {hinweisTrainer.text}
                              </span>
                            )}
                            {hatEchtenKonflikt && (
                              <span className="bg-red-600 text-yellow-300 font-semibold px-2 py-0.5 rounded text-xs">
                                Terminkonflikt
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
