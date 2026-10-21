'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import Navigation from '../components/Navigation';
import HeaderLogo from '../components/HeaderLogo';
import {
  feiertageFuerJahr as zentraleFeiertageFuerJahr,
  feiertagLabel,
  zeitumstellungHinweiseFuerJahr,
  type Feiertag,
} from '@/lib/feiertage';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Ein einzelner Termin (offer_date) eines Kurses. */
interface KursTermin {
  date_id: string;
  date_start: string | null;
  date_end: string | null;
}

/** Trainer-Kurzprofil innerhalb einer Zuweisung. */
interface TrainerKurz {
  kuerzel: string | null;
}

/** Eine Trainer-Zuweisung (nur die für die Monatsansicht relevanten Felder). */
interface Zuweisung {
  trainer_id: number | null;
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
  /** Effektiver Zuweisungsstatus (erste Zuweisung) – geliefert von /api/termine. */
  zuweisung_status?: string | null;
  /** Aktuelles Trainerkürzel der ersten Zuweisung ('n. v.' wenn keiner). */
  trainer_kuerzel?: string | null;
  /** true, wenn der Kurs eine aktive Trainer-Zuweisung besitzt. */
  hat_trainer?: boolean;
  /** Gebuchte Teilnehmer (Ist-Anzahl) – geliefert von /api/termine. */
  teilnehmer?: number | null;
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

/** Ein Kurs-Eintrag innerhalb einer Tageszelle (inkl. Startzeit an diesem Tag). */
interface TagKurs {
  kurs: Kurs;
  startZeit: string | null;
  /** Startzeit in Minuten seit Mitternacht (Basis der Konfliktprüfung). */
  startMinuten: number;
  /** Endzeit in Minuten seit Mitternacht (null, wenn unbekannt). */
  endMinuten: number | null;
  /** true, wenn der Trainer an diesem Tag eine Doppelbuchung hat. */
  hasConflict?: boolean;
}


// ---------------------------------------------------------------------------
// Konstanten & Formatierung
// ---------------------------------------------------------------------------

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

/** Maximale Anzahl sichtbarer Kurs-Einträge pro Tageszelle. */
const MAX_KURSE_PRO_TAG = 4;

/** Fallback-Kürzel, wenn kein Trainer zugewiesen ist. */
const KEIN_TRAINER = 'n. v.';

const timeFormatter = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// ---------------------------------------------------------------------------
// Datums-Logik
// ---------------------------------------------------------------------------

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
 * Jede Woche trägt die ISO-8601-Kalenderwoche ihres Montags.
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

/** Liefert die früheste Startzeit eines Kurses als „HH:MM“ (null ohne Termin). */
function kursStartZeit(kurs: Kurs): string | null {
  let frueheste: Date | null = null;
  for (const termin of kurs.termine) {
    const start = toDate(termin.date_start);
    if (start && (!frueheste || start.getTime() < frueheste.getTime())) {
      frueheste = start;
    }
  }
  return frueheste ? timeFormatter.format(frueheste) : null;
}

// ---------------------------------------------------------------------------
// Feiertags-Logik (deterministisch, ohne API-Call und ohne Dependency)
// ---------------------------------------------------------------------------

/**
 * Berechnet den Ostersonntag eines Jahres über die Gaußsche Osterformel.
 * Grundlage aller beweglichen Feiertage (Karfreitag, Ostermontag, Christi
 * Himmelfahrt, Pfingstmontag, Fronleichnam, Buß- und Bettag).
 */
function osterSonntag(jahr: number): Date {
  const a = jahr % 19;
  const b = jahr % 4;
  const c = jahr % 7;
  const k = Math.floor(jahr / 100);
  const p = Math.floor((13 + 8 * k) / 25);
  const q = Math.floor(k / 4);
  const m = (15 + k - p - q) % 30;
  const d = (19 * a + m) % 30;
  const n = (4 + k - q) % 7;
  const e = (2 * b + 4 * c + 6 * d + n) % 7;
  const tage = 22 + d + e;
  return tage <= 31
    ? new Date(jahr, 2, tage)      // März
    : new Date(jahr, 3, tage - 31); // April
}

/**
 * Liefert alle deutschen Feiertage eines Jahres als Map ISO-Tag → Feiertag.
 * Nutzt die zentrale Feiertags-Utility (lib/feiertage) für die Standard-
 * Feiertage (bundesweit + regionale mit >= 3 Bundesländern) und ergänzt die
 * beiden zusätzlichen regionalen Feiertage der Monatsübersicht (Mariä
 * Himmelfahrt, Buß- und Bettag), die in der zentralen Liste bewusst nicht
 * enthalten sind (Filter-Kriterium: mindestens drei Bundesländer).
 *
 * Achtung Namensgebung: Die zentrale Utility liefert „1. Mai“ und
 * „3. Oktober“ – die Monatsübersicht übernimmt diese amtlichen
 * Kurzbezeichnungen (vormals „Tag der Arbeit“ / „Tag der Deutschen Einheit“).
 */
function feiertageFuerJahr(jahr: number): Record<string, Feiertag> {
  const feiertage: Record<string, Feiertag> = {};
  for (const f of zentraleFeiertageFuerJahr(jahr)) {
    feiertage[f.datum] = f;
  }

  // Zusätzliche regionale Feiertage der Monatsübersicht (mit Länderkürzeln).
  const add = (monat: number, tag: number, name: string, laender: string[]) => {
    const datum = toIsoDate(new Date(jahr, monat, tag));
    feiertage[datum] = {
      datum,
      name,
      bundesweit: false,
      laender,
      laenderLabel: laender.join(', '),
    };
  };
  add(7, 15, 'Mariä Himmelfahrt', ['BY', 'SL']); // BY, SL

  // Buß- und Bettag: letzter Mittwoch vor dem 23. November (nur SN)
  const bussTag = new Date(jahr, 10, 22);
  while (bussTag.getDay() !== 3) bussTag.setDate(bussTag.getDate() - 1);
  const bussDatum = toIsoDate(bussTag);
  feiertage[bussDatum] = {
    datum: bussDatum,
    name: 'Buß- und Bettag',
    bundesweit: false,
    laender: ['SN'],
    laenderLabel: 'SN',
  };

  return feiertage;
}

/**
 * Liefert die nicht-gesetzlichen Tages-Hinweise eines Jahres als
 * Map ISO-Tag → Anzeigename:
 *  - Fasching: Rosenmontag (48 Tage) und Fastnacht / Faschingsdienstag
 *    (47 Tage) vor Ostersonntag.
 *  - Europäische Zeitumstellung: Beginn der Sommerzeit (MESZ, letzter
 *    Sonntag im März) und Ende der Sommerzeit (Normalzeit / MEZ, letzter
 *    Sonntag im Oktober) – dynamisch berechnet in der zentralen Utility
 *    zeitumstellungHinweiseFuerJahr().
 * WICHTIG: Diese Tage sind KEINE gesetzlichen Feiertage und dürfen die
 * lilane Hintergrundfarbe der Tageszelle NICHT auslösen – sie werden
 * ausschließlich als dezenter grauer Text angezeigt.
 */
function hinweiseFuerJahr(jahr: number): Record<string, string> {
  const ostern = osterSonntag(jahr);
  const hinweise: Record<string, string> = {};
  const addOffset = (offset: number, name: string) => {
    const d = new Date(
      ostern.getFullYear(),
      ostern.getMonth(),
      ostern.getDate() + offset
    );
    hinweise[toIsoDate(d)] = name;
  };
  addOffset(-48, 'Rosenmontag');
  addOffset(-47, 'Fastnacht');

  // Europäische Zeitumstellungen (MEZ ↔ MESZ) ergänzen – rein informativ,
  // analog zu den Faschings-Tagen ohne lilane Tageszellenfarbe.
  Object.assign(hinweise, zeitumstellungHinweiseFuerJahr(jahr));
  return hinweise;
}

// ---------------------------------------------------------------------------
// Anzeige-Logik
// ---------------------------------------------------------------------------

/**
 * Kürzt einen Angebotstitel für die Kalenderanzeige: Alles ab dem ersten
 * Doppelpunkt (inkl. des Doppelpunkts) entfällt; der Rest wird getrimmt.
 * Beispiel: "Excel Grundlagen Modul 4: Tabellenverknüpfungen" → "Excel Grundlagen Modul 4".
 */
function kuerzeTitel(titel: string | null): string {
  return titel ? titel.split(':')[0].trim() : '';
}

/** Liefert das Trainerkürzel eines Kurses (Fallback 'n. v.'). */
function trainerKuerzel(kurs: Kurs): string {
  const kuerzel =
    kurs.trainer_kuerzel?.trim() ??
    kurs.zuweisungen?.[0]?.trainer?.kuerzel?.trim() ??
    '';
  return kuerzel !== '' ? kuerzel : KEIN_TRAINER;
}

/**
 * Liefert die Status-CSS-Klasse eines Kurses für die Monatsansicht.
 * Grundlage ist der Zuweisungsstatus (wie in der Kursplanung); fällt dieser
 * aus, wird der edoobox-Kursstatus (date_status) herangezogen.
 *  - bestätigt / Freigegeben            → grün
 *  - unter Vorbehalt                    → orange
 *  - Reservierung / Reserviert          → grau
 *  - abgesagt                           → rot, durchgestrichen
 *  - ausgeschrieben / keine Zuordnung   → blau (Standard)
 */
function statusKlasse(kurs: Kurs): string {
  const status = (kurs.zuweisung_status ?? kurs.date_status ?? '').toLowerCase();
  if (status === 'abgesagt') return 'monats-kurs-abgesagt';
  if (status === 'bestätigt' || status === 'freigegeben')
    return 'monats-kurs-bestaetigt';
  if (status === 'unter vorbehalt') return 'monats-kurs-vorbehalt';
  if (status === 'reservierung' || status === 'reserviert')
    return 'monats-kurs-reserviert';
  return 'monats-kurs-offen';
}

/**
 * true, wenn die Teilnehmeranzahl an den Kurstitel angehängt werden soll.
 * Nur Kurse, deren Zuweisungsstatus NICHT „ausgeschrieben“ (bzw. der
 * Standardwert für nicht zugewiesene/offene Kurse) ist, tragen das Anhängsel.
 * Abgedeckt werden dabei alle offenen Varianten (ausgeschrieben, offen,
 * angefragt) sowie ein fehlender Status. Zusätzlich muss mindestens ein
 * Teilnehmer gebucht sein (0 TN bzw. null bleibt unsichtbar).
 */
function zeigeTeilnehmer(kurs: Kurs): boolean {
  const status = (kurs.zuweisung_status ?? kurs.date_status ?? '').toLowerCase();
  const offen =
    status === '' ||
    status === 'ausgeschrieben' ||
    status === 'offen' ||
    status === 'angefragt';
  const tn = kurs.teilnehmer;
  return !offen && typeof tn === 'number' && tn > 0;
}

/** true, wenn der Kurs den Status „abgesagt“ trägt. */
function istAbgesagt(kurs: Kurs): boolean {
  return (kurs.zuweisung_status ?? kurs.date_status ?? '').toLowerCase() === 'abgesagt';
}

/**
 * Liefert die CSS-Zusatzklasse des Trainerkürzels innerhalb eines Kurses.
 * Reguläre Kürzel (bestätigt, freigegeben, unter Vorbehalt, abgesagt, offen)
 * tragen keine Zusatzklasse: Sie wirken als einfarbiger Text ohne Badge-
 * Hintergrund und erben ihre Textfarbe über `color: inherit` exakt vom
 * Status-Container (identisch zu Kurstitel & Uhrzeit).
 * Exakt zwei Sonderfälle haben oberste Priorität und bleiben unverändert –
 * ihre rote Hervorhebung darf nie überschrieben werden:
 *  - Terminkonflikt (hasConflict)  → monats-kurs-trainer-konflikt (roter Rand)
 *  - Kurs ohne Trainer („n. v.“)   → monats-kurs-trainer-fehlend (rotes Badge)
 */
function trainerBadgeKlasse(
  hasConflict: boolean | undefined,
  kuerzel: string
): string {
  if (hasConflict) return 'monats-kurs-trainer-konflikt';
  if (kuerzel === KEIN_TRAINER) return 'monats-kurs-trainer-fehlend';
  return '';
}

/**
 * true, wenn der Kurs für die Konfliktprüfung relevant ist.
 * Nur Kurse mit dem Zuweisungsstatus „bestätigt“/„freigegeben“ oder
 * „unter vorbehalt“ können einen Konflikt auslösen. Abgesagte oder
 * ausgeschriebene Kurse (keine Zuordnung) bilden bewusst keinen Konflikt.
 */
function istKonfliktrelevant(kurs: Kurs): boolean {
  const status = (kurs.zuweisung_status ?? kurs.date_status ?? '').toLowerCase();
  return (
    status === 'bestätigt' ||
    status === 'freigegeben' ||
    status === 'unter vorbehalt'
  );
}

/**
 * Prüft, ob zwei Tages-Einträge zeitlich kollidieren.
 * Bei bekannter Endzeit beider Termine: echte Überschneidung
 * (startA < endB && startB < endA). Fehlt eine Endzeit, gilt nur die
 * exakt identische Startzeit als Konflikt.
 */
function ueberschneidet(a: TagKurs, b: TagKurs): boolean {
  if (a.endMinuten === null || b.endMinuten === null) {
    return a.startMinuten === b.startMinuten;
  }
  return a.startMinuten < b.endMinuten && b.startMinuten < a.endMinuten;
}

/**
 * Markiert Doppelbuchungen innerhalb eines Tages: Kurse mit demselben
 * Trainerkürzel (ausgenommen 'n. v.') und zeitlicher Überschneidung erhalten
 * das Flag hasConflict = true – jedoch nur, wenn BEIDE betroffene Kurse einen
 * konfliktrelevanten Zuweisungsstatus besitzen („bestätigt“/„freigegeben“
 * oder „unter vorbehalt“). Abgesagte oder ausgeschriebene Kurse lösen
 * keinen Konflikt aus.
 */
function markiereKonflikte(tagKurse: TagKurs[]): void {
  const gruppen: Record<string, TagKurs[]> = {};
  for (const eintrag of tagKurse) {
    const kuerzel = trainerKuerzel(eintrag.kurs);
    if (kuerzel === KEIN_TRAINER) continue;
    if (!gruppen[kuerzel]) gruppen[kuerzel] = [];
    gruppen[kuerzel].push(eintrag);
  }
  for (const eintraege of Object.values(gruppen)) {
    if (eintraege.length < 2) continue;
    for (let i = 0; i < eintraege.length; i += 1) {
      for (let j = i + 1; j < eintraege.length; j += 1) {
        if (
          ueberschneidet(eintraege[i], eintraege[j]) &&
          istKonfliktrelevant(eintraege[i].kurs) &&
          istKonfliktrelevant(eintraege[j].kurs)
        ) {
          eintraege[i].hasConflict = true;
          eintraege[j].hasConflict = true;
        }
      }
    }
  }
}

/**
 * Formatiert die ausgeblendeten Kurse eines Tages als mehrzeiligen String
 * für die Tooltip-Anzeige. Jede Zeile folgt dem Muster
 * "Uhrzeit - Gekürzter Titel (Trainerkürzel)", getrennt durch \n.
 */
function formatVersteckteKurse(uebrigeKurse: TagKurs[]): string {
  return uebrigeKurse
    .map(
      ({ kurs, startZeit }) =>
        `${startZeit ?? '–:––'} - ${kuerzeTitel(kurs.offer_name)} (${trainerKuerzel(kurs)})`
    )
    .join('\n');
}

// ---------------------------------------------------------------------------
// Komponente
// ---------------------------------------------------------------------------

export default function KalenderPage() {
  const heute = new Date();

  // Angezeigter Monat (0-basiert) – initial der aktuelle Monat.
  const [jahr, setJahr] = useState<number>(heute.getFullYear());
  const [monat, setMonat] = useState<number>(heute.getMonth());

  const [kurse, setKurse] = useState<Kurs[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter: abgesagte Kurse aus der Tagesliste ausblenden.
  const [abgesagteAusblenden, setAbgesagteAusblenden] = useState<boolean>(false);

  // Kurse laden (gleicher Endpunkt wie die Kursplanungs-Übersicht).
  const loadData = useCallback(async (silent = false) => {
    if (silent !== true) setIsLoading(true);
    setError(null);

    try {
      // 'no-store': Niemals eine gecachte HTTP-Antwort verwenden. Eine
      // veraltete Antwort ohne is_deleted-Filter wäre die häufigste Ursache
      // dafür, dass soft-gelöschte (Geister-)Kurse nach einem Sync wieder
      // im Browser auftauchen.
      const res = await fetch('/api/termine', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as Kurs[];
      // Defense-in-Depth gegen Geisterkurse: Es werden nur vollständige Kurse
      // übernommen, die über einen Angebotsnamen oder eine offer_id verfügen
      // und mindestens einen Termin (date_id) besitzen. Dadurch werden
      // soft-gelöschte Einträge, die die API-Filter in Ausnahmefällen
      // passieren, unter keinen Umständen gerendert.
      setKurse(
        data.filter((kurs) => {
          if (kurs === null || !Array.isArray(kurs.termine)) return false;
          // Strategiewechsel: Reservierungen dürfen unter keinen Umständen
          // mehr im Hauptkalender auftauchen (Welt A: public.termin_reservierung,
          // Welt B: public.trainer_reservierung). Sie werden hier zwingend
          // herausgefiltert und leben ausschließlich auf der separaten
          // Reservierungsseite (Listenansicht & Monatsübersicht).
          const status = String(kurs.date_status ?? '').toLowerCase();
          if (status === 'reservierung' || status === 'reserviert') {
            return false;
          }
          const hatIdentitaet =
            kurs.offer_id !== null || kurs.offer_name !== null;
          const hatTerminMitId = kurs.termine.some(
            (t) => t && typeof t.date_id === 'string'
          );
          return hatIdentitaet && hatTerminMitId;
        })
      );
    } catch (err: unknown) {
      console.error('Fehler beim Laden der Monatsübersicht:', err);
      setError(
        'Die Daten konnten nicht geladen werden. Bitte Verbindung zur Datenbank prüfen.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const onSilentReload = () => loadData(true);
    window.addEventListener('kursplan:reload-silent', onSilentReload);
    return () => window.removeEventListener('kursplan:reload-silent', onSilentReload);
  }, [loadData]);

  // Kalender-Raster für den ausgewählten Monat (inkl. Überhang-Tagen).
  const raster = useMemo(() => monatsRaster(jahr, monat), [jahr, monat]);

  // Feiertage für den angezeigten Monat inkl. Überhang-Tagen aus Vor-/Folgejahr.
  const feiertage = useMemo(() => {
    const map: Record<string, Feiertag> = {};
    for (const j of [jahr - 1, jahr, jahr + 1]) {
      Object.assign(map, feiertageFuerJahr(j));
    }
    return map;
  }, [jahr]);

  // Faschings-Hinweise (Rosenmontag, Fastnacht) für den angezeigten Monat
  // inkl. Überhang-Tagen – getrennt von den Feiertagen, daher ohne
  // Hintergrundfarbe der Tageszelle.
  const hinweise = useMemo(() => {
    const map: Record<string, string> = {};
    for (const j of [jahr - 1, jahr, jahr + 1]) {
      Object.assign(map, hinweiseFuerJahr(j));
    }
    return map;
  }, [jahr]);

  // Kurse je ISO-Tag gruppiert, innerhalb des Tages nach Startzeit sortiert
  // und auf Doppelbuchungen (gleicher Trainer, überschneidende Zeit) geprüft.
  const kurseProTag = useMemo(() => {
    const map: Record<string, TagKurs[]> = {};
    for (const kurs of kurse) {
      for (const termin of kurs.termine) {
        const start = toDate(termin.date_start);
        if (!start) continue;
        const iso = toIsoDate(start);
        if (!map[iso]) map[iso] = [];
        const ende = toDate(termin.date_end);
        map[iso].push({
          kurs,
          startZeit: timeFormatter.format(start),
          startMinuten: start.getHours() * 60 + start.getMinutes(),
          endMinuten: ende ? ende.getHours() * 60 + ende.getMinutes() : null,
        });
      }
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        const zeitA = a.startZeit ?? '99:99';
        const zeitB = b.startZeit ?? '99:99';
        return zeitA.localeCompare(zeitB);
      });
      markiereKonflikte(map[key]);
    }
    return map;
  }, [kurse]);

  // Gefilterte und sichtbare Kurs-Menge je Tag. Der „Abgesagte Kurse
  // ausblenden“-Toggle wirkt hier direkt auf die Tagesgruppen: Wird er
  // deaktiviert, erscheinen die abgesagten Kurse sofort wieder (klassischer,
  // rückkehrbarer Checkbox-Zustand – kein Wegwerfen von Daten).
  const sichtbareProTag = useMemo(() => {
    const gefiltert: Record<string, TagKurs[]> = {};
    const sichtbar: Record<string, TagKurs[]> = {};
    for (const key of Object.keys(kurseProTag)) {
      const ohneAbgesagte = abgesagteAusblenden
        ? kurseProTag[key].filter(({ kurs }) => !istAbgesagt(kurs))
        : kurseProTag[key];
      gefiltert[key] = ohneAbgesagte;
      sichtbar[key] = ohneAbgesagte.slice(0, MAX_KURSE_PRO_TAG);
    }
    return { gefiltert, sichtbar };
  }, [kurseProTag, abgesagteAusblenden]);

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
    const jetzt = new Date();
    setJahr(jetzt.getFullYear());
    setMonat(jetzt.getMonth());
  }, []);

  // Unsichtbares natives <input type="month">, das der Monats-Button per
  // Klick öffnet (showPicker) – identisch zur Verfügbarkeitspflege.
  const monatInputRef = useRef<HTMLInputElement | null>(null);

  // Aktueller Wert (YYYY-MM) für das unsichtbare Monats-Input.
  const monatPickerWert = `${jahr}-${String(monat + 1).padStart(2, '0')}`;

  // Monatsauswahl aus dem nativen Picker übernehmen ("YYYY-MM").
  const handleMonatAuswahl = useCallback((wert: string) => {
    if (!/^\d{4}-\d{2}$/.test(wert)) return;
    const [j, m] = wert.split('-').map(Number);
    if (!j || !m || m < 1 || m > 12) return;
    setJahr(j);
    setMonat(m - 1);
  }, []);

  // Manueller Refresh: Daten still neu laden (kein Lade-Spinner, keine
  // Scroll-/Layout-Verschiebung) – analog zur Kursplanung (loadData(true)).
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await loadData(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, loadData]);

  const heuteIso = toIsoDate(heute);
  const monatsTitel = `${MONATSNAMEN[monat]} ${jahr}`;

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-800 sm:p-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-cd-blue" />
            Monatsübersicht
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Alle Kurse im Monatsraster – Uhrzeit, Kurztitel und Trainerkürzel je Tag.
          </p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <Navigation />
          <HeaderLogo />
        </div>
      </header>

      {/* Monats-Navigation: Monats-Auswahl → ‹ → › → Heute → Aktualisieren */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Element 1: Monats-Auswahl (hellblauer Hintergrund, Kalender-Icon,
            „Monat Jahr“, Dropdown-Pfeil) – Optik wie in der Verfügbarkeitspflege. */}
        <button
          type="button"
          onClick={() => {
            const input = monatInputRef.current;
            if (!input) return;
            if (typeof input.showPicker === 'function') {
              input.showPicker();
            } else {
              input.click();
            }
          }}
          title="Monat/Jahr wählen"
          className="inline-flex items-center justify-between gap-1.5 w-48 min-w-[190px] px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 font-semibold text-slate-800 hover:bg-blue-100 transition whitespace-nowrap"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <CalendarDays className="w-4 h-4 text-cd-blue shrink-0" />
            <span className="truncate">{monatsTitel}</span>
          </span>
          <span className="text-slate-500 shrink-0" aria-hidden="true">▾</span>
        </button>
        {/* Unsichtbares natives Monats-Input: wird ausschließlich über den
            Button geöffnet und liefert den gewählten Monat (YYYY-MM). */}
        <input
          ref={monatInputRef}
          type="month"
          value={monatPickerWert}
          onChange={(e) => handleMonatAuswahl(e.target.value)}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />

        {/* Element 2: Vorheriger Monat */}
        <button
          type="button"
          onClick={() => monatWechseln(-1)}
          aria-label="Vorheriger Monat"
          title="Vorheriger Monat"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Element 3: Nächster Monat */}
        <button
          type="button"
          onClick={() => monatWechseln(1)}
          aria-label="Nächster Monat"
          title="Nächster Monat"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        {/* Element 4: Heute (Primär-Button, durchgehend CD-Blau) */}
        <button
          type="button"
          onClick={zuHeute}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-cd-blue text-white hover:bg-cd-blue/90 transition"
        >
          Heute
        </button>

        {/* Element 5: Aktualisieren (Refresh-Icon + Text, weiß mit Rand) */}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Aktualisieren
        </button>

        <label
          className={`inline-flex items-center gap-2 text-sm select-none cursor-pointer ${
            abgesagteAusblenden ? 'text-cd-blue font-medium' : 'text-slate-700'
          }`}
        >
          <input
            type="checkbox"
            checked={abgesagteAusblenden}
            onChange={(e) => setAbgesagteAusblenden(e.target.checked)}
            className="w-4 h-4 rounded border-cd-blue/40 text-cd-blue focus:ring-cd-blue"
          />
          Abgesagte Kurse ausblenden
        </label>
        {isLoading && (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Lade Kurse…
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Kalender-Raster: 1 KW-Spalte + 7 Wochentage (Mo–So) */}
      <div className="monats-scroll">
        <div className="monats-grid" role="grid" aria-label={monatsTitel}>
          {/* Kopfzeile */}
          <div className="monats-kopf monats-kw-kopf" role="columnheader">
            KW
          </div>
          {WOCHENTAGE.map((tag) => (
            <div key={tag} className="monats-kopf monats-wochentag" role="columnheader">
              {tag}
            </div>
          ))}

          {/* Wochenzeilen */}
          {raster.map((woche, index) => (
            <React.Fragment key={`${woche.kw}-${toIsoDate(woche.tage[0].datum)}`}>
              <div
                className={`monats-kw ${index % 2 === 0 ? 'monats-kw-gerade' : 'monats-kw-ungerade'}`}
                role="rowheader"
                aria-label={`Kalenderwoche ${woche.kw}`}
              >
                {woche.kw}
              </div>
              {woche.tage.map((tag, index) => {
                const iso = toIsoDate(tag.datum);
                const feiertag = feiertage[iso];
                const hinweis = hinweise[iso];
                const sichtbare = sichtbareProTag.sichtbar[iso] ?? [];
                const uebrige =
                  (sichtbareProTag.gefiltert[iso] ?? []).length - sichtbare.length;
                const istHeute = iso === heuteIso;

                // Gesetzliche Feiertage färben die komplette Tageszelle seicht
                // lila (purple-50). Die heute-Klasse überschreibt sie bewusst,
                // damit der lokale Tagesfokus (blau + Rahmen) erhalten bleibt.
                const zellenKlassen = [
                  'monats-tag',
                  tag.imMonat ? '' : 'monats-tag-fremd',
                  feiertag ? 'monats-tag-feiertag-zelle' : '',
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
                    <div className="monats-tag-nummer">{tag.datum.getDate()}</div>
                    {feiertag && (
                      <div
                        className="monats-tag-feiertag"
                        title={feiertag.bundesweit
                          ? `${feiertag.name} (bundesweiter Feiertag)`
                          : `${feiertag.name} (${feiertag.laenderLabel})`}
                      >
                        {feiertagLabel(feiertag)}
                      </div>
                    )}
                    {hinweis && (
                      <div
                        className="monats-tag-hinweis"
                        title={`${hinweis} – kein gesetzlicher Feiertag (rein informativ)`}
                      >
                        {hinweis}
                      </div>
                    )}
                    <ul className="monats-kurs-liste">
                      {sichtbare.map((eintrag, index) => {
                        const { kurs, startZeit } = eintrag;
                        const kuerzel = trainerKuerzel(kurs);
                        const anzeigeTeilnehmer = zeigeTeilnehmer(kurs);
                        return (
                          <li
                            key={`${kurs.offer_id ?? kurs.termine[0]?.date_id ?? 'unbekannt'}-${iso}-${startZeit ?? 'ohne-zeit'}-${index}`}
                            title={kurs.offer_name ?? ''}
                            className={`monats-kurs ${statusKlasse(kurs)}`}
                          >
                            <span className="monats-kurs-zeit">
                              {startZeit ?? '–:––'}
                            </span>
                            <span className="monats-kurs-titel">
                              {kuerzeTitel(kurs.offer_name)}
                            </span>
                            {anzeigeTeilnehmer && (
                              <span
                                className="monats-kurs-tn"
                                title={`${kurs.teilnehmer} Teilnehmer`}
                              >
                                ({kurs.teilnehmer} TN)
                              </span>
                            )}
                            <span
                              className={`monats-kurs-trainer ${trainerBadgeKlasse(
                                eintrag.hasConflict,
                                kuerzel
                              )}`}
                              title={eintrag.hasConflict
                                ? 'Doppelbuchung: Trainer ist zur gleichen Zeit anderweitig eingeteilt.'
                                : undefined}
                            >
                              {kuerzel}
                            </span>
                          </li>
                        );
                      })}
                      {uebrige > 0 && (
                        <li
                          className="monats-kurs-mehr"
                          title={formatVersteckteKurse(
                            (sichtbareProTag.gefiltert[iso] ?? []).slice(
                              MAX_KURSE_PRO_TAG
                            )
                          )}
                        >
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

      {/* Legende: Zuweisungsstatus */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-500" aria-hidden="true" />
          Bestätigt
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-amber-500" aria-hidden="true" />
          Unter Vorbehalt
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-blue-500" aria-hidden="true" />
          Ausgeschrieben / Offen
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500" aria-hidden="true" />
          <span className="line-through">Abgesagt</span>
        </span>
      </div>

      {/* Legende: Feiertage */}
      <div className="mt-2 text-xs text-slate-500">
        Regionale Feiertage zeigen die betroffenen Bundesländer in Klammern
        (z. B. „Fronleichnam (BW, BY, HE, NW, RP, SL)“).
      </div>

      <style>{`
        /* ------------------------------------------------------------------
         * Monatsübersicht: CSS-Grid im Outlook-Stil
         * 1 schmale KW-Spalte links + 7 gleich breite Tages-Spalten (Mo–So).
         * ------------------------------------------------------------------ */
        .monats-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        .monats-grid {
          display: grid;
          grid-template-columns: 3.5rem repeat(7, minmax(0, 1fr));
          grid-auto-rows: auto; /* Kopfzeile kompakt; Tageszellen halten eigene min-height */
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
          padding: 0.25rem 0; /* 4px 0 – kompakte Kopfzeile */
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

        /* Gesetzlicher Feiertag: komplette Tageszelle seicht lila (purple-50).
         * Die heute-Klasse weiter unten überschreibt diese Farbe bewusst. */
        .monats-tag-feiertag-zelle {
          background-color: #faf5ff; /* purple-50 */
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
        }

        /* Feiertag als lilafarbenes Badge – farblich passend zur
         * Verfügbarkeitspflege (purple-100 / purple-800 / purple-200). */
        .monats-tag-feiertag {
          font-size: 0.5625rem;
          font-weight: 600;
          color: #6b21a8;            /* purple-800 */
          background-color: #f3e8ff; /* purple-100 */
          border: 1px solid #e9d5ff; /* purple-200 */
          border-radius: 0.25rem;
          padding: 0.125rem 0.25rem;
          line-height: 1.15;
          white-space: normal;       /* Name + Länderkürzel brechen bei Bedarf um */
          overflow-wrap: break-word; /* lange Kürzelketten sauber umbrechen */
          align-self: flex-start;
        }

        /* Nicht-gesetzliche Hinweise (Fasching: Rosenmontag, Fastnacht sowie
         * Zeitumstellung MEZ ↔ MESZ): rein informativ in Grau – lösen KEINE
         * lilane Tageszellenfarbe aus (kein gesetzlicher Feiertag). */
        .monats-tag-hinweis {
          font-size: 0.5625rem;
          font-weight: 500;
          color: #94a3b8; /* slate-400 */
          background-color: transparent;
          padding: 0 0.25rem;
          line-height: 1.15;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          align-self: flex-start;
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

        .monats-kurs-abgesagt {
          background-color: #fee2e2; /* red-100 */
          border-color: #fca5a5;     /* red-300 */
          color: #991b1b;            /* red-800 */
          text-decoration: line-through;
          opacity: 0.75;
        }

        .monats-kurs-bestaetigt {
          background-color: #ecfdf5; /* emerald-50 */
          border-color: #6ee7b7;     /* emerald-300 */
          color: #047857;            /* emerald-700 – Statusfarbe wird an Textelemente vererbt */
        }

        .monats-kurs-bestaetigt .monats-kurs-titel {
          color: #047857;            /* emerald-700 */
          font-weight: 600;
        }

        .monats-kurs-bestaetigt .monats-kurs-zeit {
          color: #047857;            /* emerald-700 – wie Kurstitel */
        }

        .monats-kurs-vorbehalt {
          background-color: #fffbeb; /* amber-50 */
          border-color: #fcd34d;     /* amber-300 */
          color: #b45309;            /* amber-700 – Statusfarbe wird an Textelemente vererbt */
        }

        .monats-kurs-vorbehalt .monats-kurs-titel {
          color: #b45309;            /* amber-700 */
          font-weight: 600;
        }

        .monats-kurs-vorbehalt .monats-kurs-zeit {
          color: #b45309;            /* amber-700 – wie Kurstitel */
        }

        /* Reservierung: dezentes Grau (slate-100 / slate-700) – hebt sich
         * klar von Grün, Orange, Rot und Blau ab. Trainerkürzel und Uhrzeit
         * erben die Farbe über 'color: inherit' (bzw. die expliziten
         * Titel-/Zeit-Regeln) exakt vom Status-Container. */
        .monats-kurs-reserviert {
          background-color: #f1f5f9; /* slate-100 */
          border-color: #cbd5e1;     /* slate-300 */
          color: #334155;            /* slate-700 – Statusfarbe wird an Textelemente vererbt */
        }

        .monats-kurs-reserviert .monats-kurs-titel {
          color: #334155;            /* slate-700 */
          font-weight: 600;
        }

        .monats-kurs-reserviert .monats-kurs-zeit {
          color: #334155;            /* slate-700 – wie Kurstitel */
        }

        .monats-kurs-offen {
          color: #1d4ed8;            /* blue-700 – Statusfarbe wird an Textelemente vererbt */
        }

        .monats-kurs-offen .monats-kurs-titel {
          color: #1d4ed8;            /* blue-700 – Ausgeschrieben / keine Zuordnung */
        }

        .monats-kurs-offen .monats-kurs-zeit {
          color: #1d4ed8;            /* blue-700 – wie Kurstitel */
        }

        .monats-kurs-zeit {
          font-weight: 700;
          color: inherit;            /* erbt die Statusfarbe des Kurs-Containers */
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }

        .monats-kurs-titel {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Teilnehmeranzahl: dezentes Anhängsel direkt hinter dem Kurstitel.
         * Erbt die Statusfarbe des Kurs-Containers (color: inherit) und wirkt
         * durch Transparenz bewusst untergeordnet; reduziert sich nie auf eine
         * Ellipse und bleibt daher immer vollständig sichtbar. */
        .monats-kurs-tn {
          flex-shrink: 0;
          color: inherit;
          opacity: 0.7;
          margin-left: 0.125rem;
        }

        /* Reguläres Trainerkürzel: einfarbiger Text ohne Badge – kein
         * Hintergrund, kein Rahmen. Die Textfarbe wird per 'color: inherit'
         * exakt vom Status-Container geerbt (identisch zu Kurstitel und
         * Uhrzeit). Die roten Sonderfälle (Konflikt / n. v.) weiter unten
         * werden durch ihre expliziten Farbwerte davon nie überschrieben. */
        .monats-kurs-trainer {
          flex-shrink: 0;
          font-weight: 700;
          color: inherit;            /* erbt die Statusfarbe des Kurs-Containers */
          background-color: transparent;
          border: none;
        }

        /* Fehlende Trainerzuordnung: rotes Badge als Alarm */
        .monats-kurs-trainer-fehlend {
          color: #991b1b;            /* red-800 */
          background-color: #fecaca; /* red-200 */
        }

        /* Doppelbuchung: rotes Badge ohne Rahmen – roter Hintergrund und rote
         * Schrift bleiben als deutliche Alarmierung vollständig erhalten. */
        .monats-kurs-trainer-konflikt {
          color: #991b1b;            /* red-800 */
          background-color: #fecaca; /* red-200 */
        }


        .monats-kurs-mehr {
          font-size: 0.625rem;
          color: #64748b;
          font-weight: 600;
          padding: 0.125rem 0.25rem;
        }
      `}</style>
    </main>
  );
}