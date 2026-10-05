'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Loader2,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  BookMarked,
} from 'lucide-react';
import { feiertageFuerZeitraum, feiertagLabel, type Feiertag } from '@/lib/feiertage';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Trainer-Kürzel-Stammdaten aus GET /api/trainer (für die Dozenten-Auswahl). */
interface Trainer {
  id: number;
  vorname: string;
  nachname: string;
  kuerzel: string | null;
}

/** Eine Verfügbarkeitszeile aus GET /api/verfuegbarkeit. */
interface VerfuegbarkeitRow {
  datum: string;
  slot_code: string;
  status: string;
}

/** Ein bereits eingeteilter Kurstermin (Kurs-Slot in der Wochenansicht). */
interface KursRow {
  datum: string;
  date_id: string | null;
  kursname: string | null;
  zuweisung_status: string | null;
  start_time: string | null;
  end_time: string | null;
}

/** Eine unverbindliche Trainer-Reservierung (Firmenanfrage). */
interface ReservierungRow {
  id: number;
  trainer_id: number;
  datum: string;
  start_time: string;
  end_time: string;
  kunde: string;
  bemerkung: string | null;
}

/** Aggregierter VM/NM-Zustand eines Tages. */
interface DayState {
  vm: boolean;
  nm: boolean;
}

/** Ein Eintrag für den Batch-Endpunkt POST /api/trainer/verfuegbarkeit/batch. */
interface BatchEintrag {
  datum: string;
  vm: boolean;
  nm: boolean;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Wochen, die beim ersten Aufruf geladen werden: 2 in der Vergangenheit,
 *  8 in der Zukunft (Puffer rund um die aktuelle Kalenderwoche). */
const WOCHEN_INITIAL = 10;

/** Wochen, die pro Scroll-Schritt nachgeladen (bzw. vorangestellt) werden. */
const WOCHEN_NACHLADEN = 4;

/** Wochen, die beim „Springen zu“ vor der Zielwoche liegen. */
const WOCHEN_VOR_ZIEL = 2;

// Slot-Auflösung gemäß S-01 (identisch zur Backend-Route).
const VM_SLOTS = ['HT', 'K1', 'K2'];
const NM_SLOTS = ['K3', 'K4'];

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// ---------------------------------------------------------------------------
// Datums-Hilfen (rein lokal, ohne UTC-Offset-Fallen)
// ---------------------------------------------------------------------------

/** Formatiert ein Date lokal als YYYY-MM-DD. */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${t}`;
}

/** Parst ein ISO-Datum YYYY-MM-DD lokal (kein UTC-Versatz). */
function parseDateStr(s: string): Date {
  const [y, m, t] = s.split('-').map(Number);
  return new Date(y, m - 1, t);
}

/** Formatiert ein Date als DD.MM. (z. B. "05.10."). */
function formatDDMM(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(
    d.getMonth() + 1
  ).padStart(2, '0')}.`;
}

/** Formatiert ein Date als DD.MM.YYYY (z. B. "09.10.2026"). */
function formatDDMMYYYY(d: Date): string {
  return `${formatDDMM(d)}${d.getFullYear()}`;
}

/** ISO-Wochentag: Mo=0 … So=6. */
function isoWochentag(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Formatiert den Tageskopf einer Kachel: "MO. 14.12.2026". */
function formatTageskopf(d: Date): string {
  return `${WOCHENTAGE[isoWochentag(d)].toUpperCase()}. ${formatDDMMYYYY(d)}`;
}

/**
 * Kalenderwoche (ISO 8601) eines Datums – exakte Donnerstags-Regel.
 * Korrigiert die frühere Näherung, die z. B. den 28.09.2026 fälschlich als
 * KW 39 auswies (korrekt nach ISO 8601: KW 40).
 */
function kalenderwoche(d: Date): number {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

/** Liefert einen lesbaren Zuweisungsstatus. */
function statusLabel(status: string | null): string {
  if (!status) return '';
  switch (status.toLowerCase()) {
    case 'ausgeschrieben':
      return 'ausgeschrieben';
    case 'unter vorbehalt':
      return 'unter Vorbehalt';
    case 'bestaetigt':
    case 'bestätigt':
      return 'bestätigt';
    case 'abgesagt':
      return 'abgesagt';
    case 'offen':
      return 'ausgeschrieben';
    case 'angefragt':
      return 'ausgeschrieben';
    default:
      return status;
  }
}

/** true, wenn der Zuweisungsstatus einen aktiven (nicht abgesagten) Kurs bedeutet. */
function istAktiverStatus(status: string | null): boolean {
  const s = statusLabel(status).toLowerCase();
  return s === 'ausgeschrieben' || s === 'unter vorbehalt' || s === 'bestätigt';
}

/** Status-Farbklassen für Kurs-Slot-Buttons in der Wochenansicht. */
function statusSlotClasses(status: string | null): string {
  switch (statusLabel(status).toLowerCase()) {
    case 'ausgeschrieben':
      return 'bg-blue-50 text-blue-700 border border-blue-300 hover:bg-blue-100';
    case 'unter vorbehalt':
      return 'bg-amber-500 text-white font-medium border border-amber-600 hover:bg-amber-600';
    case 'bestätigt':
      return 'bg-emerald-600 text-white font-medium border border-emerald-700 hover:bg-emerald-700';
    case 'abgesagt':
      return 'bg-rose-50 text-rose-700 border border-rose-300 line-through opacity-80 hover:bg-rose-100';
    default:
      return 'bg-slate-200 border-slate-300 text-slate-600';
  }
}

/** Formatiert eine HH:MM-Uhrzeit kompakt: "09:00" → "9", "09:30" → "9:30" (Fallback "–"). */
function formatUhrzeit(zeit: string | null): string {
  if (!zeit || !/^\d{2}:\d{2}$/.test(zeit)) return '–';
  const [std, min] = zeit.split(':');
  const stunde = String(Number(std));
  return min === '00' ? stunde : `${stunde}:${min}`;
}

/** Rangfolge für den primären Kurs: bestätigt > unter Vorbehalt > ausgeschrieben > abgesagt. */
function statusRang(status: string | null): number {
  switch (statusLabel(status).toLowerCase()) {
    case 'bestätigt':
      return 0;
    case 'unter vorbehalt':
      return 1;
    case 'ausgeschrieben':
      return 2;
    case 'abgesagt':
      return 3;
    default:
      return 4;
  }
}

/** Kompakte Status-Badge-Farbklassen für das Parallele-Termine-Popover. */
function statusBadgeClasses(status: string | null): string {
  switch (statusLabel(status).toLowerCase()) {
    case 'ausgeschrieben':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'unter vorbehalt':
      return 'bg-amber-500 text-white font-medium border-amber-600';
    case 'bestätigt':
      return 'bg-emerald-600 text-white font-medium border-emerald-700';
    case 'abgesagt':
      return 'bg-rose-50 text-rose-700 border-rose-200 line-through';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

/** Prüft, ob zwei Zeitfenster (HH:MM) sich zeitlich überschneiden. */
function ueberschneidet(
  startA: string,
  endeA: string,
  startB: string,
  endeB: string
): boolean {
  return startA < endeB && endeA > startB;
}

/** true, wenn mindestens eine Reservierung das Zeitfenster (HH:MM) belegt. */
function slotBelegt(
  reservierungen: ReservierungRow[],
  start: string,
  ende: string
): boolean {
  return reservierungen.some((r) =>
    ueberschneidet(r.start_time, r.end_time, start, ende)
  );
}

/**
 * true, wenn mindestens ein AKTIVER Kurs (nicht abgesagt) das Zeitfenster
 * (HH:MM) belegt. Grundlage für die VM/NM-Rücknahme-Sperre: Ein Slot, in dem
 * bereits Kurse zugewiesen sind, darf nicht mehr als „nicht verfügbar“
 * markiert werden.
 */
function slotBelegtDurchKurse(
  kurse: KursRow[],
  start: string,
  ende: string
): boolean {
  return kurse.some(
    (k) =>
      istAktiverStatus(k.zuweisung_status) &&
      ueberschneidet(
        k.start_time ?? '00:00',
        k.end_time ?? '23:59',
        start,
        ende
      )
  );
}

/**
 * true, wenn die App über die Admin-Domäne webinarcenter.de (oder lokal zur
 * Entwicklung) aufgerufen wird. Reservierungen sind exklusiv für diesen
 * Personenkreis freigegeben.
 */
function istAdminUmgebung(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('webinarcenter.de');
}

// ---------------------------------------------------------------------------
// Komponente
// ---------------------------------------------------------------------------

function VerfuegbarkeitContent() {
  // URL-Persistenz des Dozentenfilters (?trainer_id=…).
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlTrainerId = searchParams.get('trainer_id') ?? '';

  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [selectedTrainerId, setSelectedTrainerId] = useState<string>(urlTrainerId);

  // Wochenanker (Montag der ersten geladenen Woche) für die Wochenliste.
  // Initial: 4 Wochen vor der aktuellen Woche, damit die aktuelle Woche
  // innerhalb des initialen Fensters (WOCHEN_INITIAL) liegt.
  const [wochenAnker, setWochenAnker] = useState<Date>(() => {
    const jetzt = new Date();
    const montag = new Date(
      jetzt.getFullYear(),
      jetzt.getMonth(),
      jetzt.getDate() - isoWochentag(jetzt)
    );
    return new Date(
      montag.getFullYear(),
      montag.getMonth(),
      montag.getDate() - 7 * WOCHEN_VOR_ZIEL
    );
  });

  // Anzahl der aktuell geladenen Wochen (wächst durch Infinite Scrolling).
  const [wochenAnzahl, setWochenAnzahl] = useState<number>(WOCHEN_INITIAL);

  // Modal „Verfügbare Zeiträume erfassen“ (Von / Bis).
  const [modalOffen, setModalOffen] = useState<boolean>(false);
  const [modalVon, setModalVon] = useState<string>(() => toDateStr(new Date()));
  const [modalBis, setModalBis] = useState<string>(() => toDateStr(new Date()));
  const [modalHinweis, setModalHinweis] = useState<string>('');
  const [modalInfo, setModalInfo] = useState<string>('');

  // Modal „Reservierung anlegen“ (unverbindliche Firmenanfrage).
  const [resModalOffen, setResModalOffen] = useState<boolean>(false);
  const [resDatum, setResDatum] = useState<string>(() => toDateStr(new Date()));
  const [resStart, setResStart] = useState<string>('09:00');
  const [resEnde, setResEnde] = useState<string>('13:00');
  const [resKunde, setResKunde] = useState<string>('');
  const [resBemerkung, setResBemerkung] = useState<string>('');
  const [resFehler, setResFehler] = useState<string>('');
  const [resSpeichert, setResSpeichert] = useState<boolean>(false);

  // Popover für parallele Kurstermine (Mehrfachbelegung im selben Slot).
  const [offenesPopover, setOffenesPopover] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Datumsfilter zum gezielten Springen in der Wochenliste.
  const [sprungDatum, setSprungDatum] = useState<string>('');
  // Ziel-Wochen-ID (woche-YYYY-MM-DD) für den einheitlichen Sprung-Scroll.
  const [scrollZielWocheId, setScrollZielWocheId] = useState<string>('');

  // Wochenenden in der Wochenliste anzeigen (Standard: ausgeblendet).
  const [wochenendenAnzeigen, setWochenendenAnzeigen] = useState<boolean>(false);

  const [avail, setAvail] = useState<Record<string, DayState>>({});
  const [kurse, setKurse] = useState<Record<string, KursRow[]>>({});
  const [reservierungen, setReservierungen] = useState<
    Record<string, ReservierungRow[]>
  >({});

  const [isTrainerLoading, setIsTrainerLoading] = useState<boolean>(true);
  const [isGridLoading, setIsGridLoading] = useState<boolean>(false);
  const [isAppending, setIsAppending] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // Referenz auf den aktuellen Verfügbarkeitszustand, damit schnelle Klicks
  // nie auf einem veralteten Closure-Zustand operieren.
  const availRef = useRef<Record<string, DayState>>(avail);
  availRef.current = avail;

  // Scroll-Container und Sentinels für das bidirektionale Infinite Scrolling.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);

  // Einmal-Flag: initiales Scrollen zur aktuellen Woche. Wird erst NACH
  // erfolgreicher Ausrichtung auf true gesetzt – bis dahin bleibt der obere
  // Sentinel (Vergangenheit) inaktiv, damit kein Nachladen nach oben den
  // sichtbaren Bereich verschiebt, bevor überhaupt gescrollt wurde.
  const isInitialScrolled = useRef(false);

  // Schutz gegen parallele Nachlade-Vorgänge.
  const isLoadingRef = useRef(false);

  // Ladeauftrag, der nach dem Rendern der neuen Wochen abgearbeitet wird
  // (inkl. Scroll-Positions-Korrektur beim Voranstellen).
  const ladeAuftragRef = useRef<{
    merge: boolean;
    scrollKorrektur?: number;
  } | null>(null);

  // Trainer, für den die aktuell geladenen Daten gelten.
  const geladenerTrainerRef = useRef<string>('');

  // Heutiges Datum (für die Hervorhebung der aktuellen Woche).
  const heuteStr = toDateStr(new Date());

  // Reservierungen sind exklusiv für die Admin-Domäne webinarcenter.de.
  // istAdmin hängt von window.location ab und darf erst NACH dem Mounting
  // ausgewertet werden – sonst rendert der Server ohne Admin-Buttons, der
  // Client beim ersten Hydration-Durchlauf aber mit (Hydration-Mismatch).
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  const istAdmin = isMounted && istAdminUmgebung();

  // -------------------------------------------------------------------------
  // Dozenten laden (inkl. URL-Persistenz)
  // -------------------------------------------------------------------------
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/trainer');
        if (!res.ok) {
          throw new Error('Trainer konnten nicht geladen werden.');
        }
        const liste = (await res.json()) as Trainer[];
        if (!active) return;
        setTrainers(liste);
        if (liste.length > 0) {
          const urlId = searchParams.get('trainer_id');
          const existiert = urlId && liste.some((t) => String(t.id) === urlId);
          if (existiert) {
            setSelectedTrainerId(urlId);
          } else if (selectedTrainerId === '') {
            const erste = String(liste[0].id);
            setSelectedTrainerId(erste);
            const params = new URLSearchParams(searchParams.toString());
            params.set('trainer_id', erste);
            router.replace(`?${params.toString()}`, { scroll: false });
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
  // Zeitraum der geladenen Wochenliste
  // -------------------------------------------------------------------------
  const zeitraum = useMemo(
    () => ({
      von: wochenAnker,
      bis: new Date(
        wochenAnker.getFullYear(),
        wochenAnker.getMonth(),
        wochenAnker.getDate() + 7 * wochenAnzahl - 1
      ),
    }),
    [wochenAnker, wochenAnzahl]
  );

  // Feiertage im aktuell sichtbaren Zeitraum (für die Kachel-Kennzeichnung).
  const feiertageImZeitraum = useMemo(() => {
    const map = new Map<string, Feiertag>();
    for (const f of feiertageFuerZeitraum(
      toDateStr(zeitraum.von),
      toDateStr(zeitraum.bis)
    )) {
      map.set(f.datum, f);
    }
    return map;
  }, [zeitraum]);

  // -------------------------------------------------------------------------
  // Verfügbarkeiten und Kurstermine des gewählten Zeitraums laden
  // -------------------------------------------------------------------------
  const loadGrid = useCallback(
    async (merge: boolean = false) => {
      if (!selectedTrainerId) return;
      // Schutz gegen parallele Nachlade-Vorgänge: Während ein Ladevorgang
      // läuft, dürfen die Sentinels keinen weiteren auslösen.
      isLoadingRef.current = true;
      if (!merge) setIsGridLoading(true);
      setLoadError(false);

      const von = toDateStr(zeitraum.von);
      const bis = toDateStr(zeitraum.bis);

      try {
        const res = await fetch(
          `/api/verfuegbarkeit?trainerId=${encodeURIComponent(selectedTrainerId)}&von=${von}&bis=${bis}`
        );
        if (!res.ok) {
          throw new Error('Endpunkt antwortete mit einem Fehler.');
        }
        const data = (await res.json()) as {
          verfuegbarkeiten?: VerfuegbarkeitRow[];
          kurse?: KursRow[];
          reservierungen?: ReservierungRow[];
        };

        // Beim Nachladen (merge) werden die bestehenden Daten behalten und
        // nur um die neu geladenen Wochen ergänzt – so gehen optimistische
        // Änderungen des Nutzers nicht verloren.
        const map: Record<string, DayState> = merge
          ? { ...availRef.current }
          : {};
        for (const row of data.verfuegbarkeiten ?? []) {
          if (!map[row.datum]) {
            map[row.datum] = { vm: false, nm: false };
          }
          if (row.status === 'frei' && VM_SLOTS.includes(row.slot_code)) {
            map[row.datum].vm = true;
          }
          if (row.status === 'frei' && NM_SLOTS.includes(row.slot_code)) {
            map[row.datum].nm = true;
          }
        }
        setAvail(map);
        availRef.current = map;

        const kursMap: Record<string, KursRow[]> = {};
        for (const kurs of data.kurse ?? []) {
          if (!kursMap[kurs.datum]) {
            kursMap[kurs.datum] = [];
          }
          kursMap[kurs.datum].push(kurs);
        }
        setKurse(kursMap);

        const resMap: Record<string, ReservierungRow[]> = {};
        for (const res of data.reservierungen ?? []) {
          if (!resMap[res.datum]) {
            resMap[res.datum] = [];
          }
          resMap[res.datum].push(res);
        }
        setReservierungen(resMap);
      } catch (err: unknown) {
        console.error('Fehler beim Laden der Verfügbarkeiten:', err);
        setLoadError(true);
      } finally {
        if (!merge) setIsGridLoading(false);
        setIsAppending(false);
        isLoadingRef.current = false;
      }
    },
    [selectedTrainerId, zeitraum]
  );

  // Vollständiges (Neu-)Laden nur bei Trainerwechsel.
  useEffect(() => {
    if (geladenerTrainerRef.current !== selectedTrainerId) {
      geladenerTrainerRef.current = selectedTrainerId;
      // Nach einem Trainerwechsel erneut zur aktuellen Woche scrollen.
      isInitialScrolled.current = false;
      void loadGrid(false);
    }
  }, [selectedTrainerId, loadGrid]);

  // Ladeauftrag nach dem Rendern der neuen Wochen abarbeiten.
  // Wird durch ladeMehrOben / ladeMehrUnten / springeZuDatum ausgelöst.
  useEffect(() => {
    const auftrag = ladeAuftragRef.current;
    if (!auftrag) return;
    ladeAuftragRef.current = null;
    void loadGrid(auftrag.merge);
    // Scroll-Positions-Korrektur: Vorangestellte Wochen verschieben den
    // sichtbaren Bereich nach unten – scrollTop entsprechend erhöhen.
    if (auftrag.scrollKorrektur !== undefined && scrollRef.current) {
      scrollRef.current.scrollTop +=
        scrollRef.current.scrollHeight - auftrag.scrollKorrektur;
    }
  }, [loadGrid]);

  // -------------------------------------------------------------------------
  // Bidirektionales Infinite Scrolling
  // -------------------------------------------------------------------------

  /** Hängt weitere Wochen am unteren Ende an. */
  const ladeMehrUnten = useCallback(() => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsAppending(true);
    ladeAuftragRef.current = { merge: true };
    setWochenAnzahl((prev) => prev + WOCHEN_NACHLADEN);
  }, []);

  /** Stellt weitere Wochen am oberen Ende voran (mit Scroll-Korrektur). */
  const ladeMehrOben = useCallback(() => {
    if (isLoadingRef.current) return;
    // Nachladen nach oben erst zulassen, wenn die initiale Ausrichtung auf die
    // aktuelle Woche abgeschlossen ist – sonst verschiebt das Voranstellen von
    // Wochen den sichtbaren Bereich, bevor der initiale Scroll stattfand.
    if (!isInitialScrolled.current) return;
    isLoadingRef.current = true;
    setIsAppending(true);
    const container = scrollRef.current;
    ladeAuftragRef.current = {
      merge: true,
      scrollKorrektur: container ? container.scrollHeight : undefined,
    };
    setWochenAnker(
      (prev) =>
        new Date(
          prev.getFullYear(),
          prev.getMonth(),
          prev.getDate() - 7 * WOCHEN_NACHLADEN
        )
    );
    setWochenAnzahl((prev) => prev + WOCHEN_NACHLADEN);
  }, []);

  // IntersectionObserver auf die beiden Sentinels (oben/unten).
  // WICHTIG: Der Effect muss erneut laufen, sobald der Scroll-Container nach
  // dem ersten Laden tatsächlich gerendert ist (isGridLoading-Flag) und ein
  // Trainer gewählt wurde – sonst bliebe der Observer dauerhaft inaktiv.
  useEffect(() => {
    if (!selectedTrainerId) return;
    const container = scrollRef.current;
    const top = topSentinelRef.current;
    const bottom = bottomSentinelRef.current;
    if (!container || !top || !bottom) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.target === top) {
            ladeMehrOben();
          } else if (entry.target === bottom) {
            ladeMehrUnten();
          }
        }
      },
      { root: container, rootMargin: '300px', threshold: 0 }
    );
    observer.observe(top);
    observer.observe(bottom);
    return () => observer.disconnect();
  }, [ladeMehrOben, ladeMehrUnten, selectedTrainerId, isGridLoading]);

  // -------------------------------------------------------------------------
  // Optimistisches Speichern (Auto-Save) für Einzeltage
  // -------------------------------------------------------------------------
  const saveDay = useCallback(
    async (datum: string, naechster: DayState, vorher: DayState) => {
      setSaveStatus('saving');
      try {
        const res = await fetch('/api/verfuegbarkeit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trainerId: Number(selectedTrainerId),
            datum,
            vm: naechster.vm,
            nm: naechster.nm,
          }),
        });
        if (!res.ok) {
          const errData = (await res.json().catch(() => null)) as {
            error?: unknown;
          } | null;
          const rawMsg = errData?.error;
          const msg = rawMsg
            ? String(rawMsg)
            : res.statusText || 'Unbekannter Fehler';
          console.error('API-Fehler beim Speichern:', msg);
          throw new Error(msg);
        }
        setSaveStatus('saved');
      } catch (err: unknown) {
        console.error('Fehler beim Speichern der Verfügbarkeit:', err);
        // Optimistisches Update zurücknehmen.
        setAvail((prev) => ({ ...prev, [datum]: vorher }));
        setSaveStatus('error');
      }
    },
    [selectedTrainerId]
  );

  // -------------------------------------------------------------------------
  // Batch-Speichern über POST /api/trainer/verfuegbarkeit/batch
  // -------------------------------------------------------------------------
  const saveBatch = useCallback(
    async (entries: BatchEintrag[], rollback?: () => void) => {
      if (entries.length === 0) return;
      setSaveStatus('saving');
      try {
        const res = await fetch('/api/trainer/verfuegbarkeit/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trainerId: Number(selectedTrainerId),
            entries,
          }),
        });
        if (!res.ok) {
          const errData = (await res.json().catch(() => null)) as {
            error?: unknown;
          } | null;
          const rawMsg = errData?.error;
          const msg = rawMsg
            ? String(rawMsg)
            : res.statusText || 'Unbekannter Fehler';
          console.error('API-Fehler beim Batch-Speichern:', msg);
          throw new Error(msg);
        }
        setSaveStatus('saved');
      } catch (err: unknown) {
        console.error('Fehler beim Batch-Speichern der Verfügbarkeiten:', err);
        rollback?.();
        setSaveStatus('error');
      }
    },
    [selectedTrainerId]
  );

  const applyDay = useCallback(
    (datum: string, patch: Partial<DayState>) => {
      const aktuell = availRef.current[datum] ?? { vm: false, nm: false };
      const naechster: DayState = { ...aktuell, ...patch };
      setAvail((prev) => ({ ...prev, [datum]: naechster }));
      void saveDay(datum, naechster, aktuell);
    },
    [saveDay]
  );

  const toggleVm = (datum: string) => {
    const aktuell = availRef.current[datum] ?? { vm: false, nm: false };
    // Rücknahme sperren, wenn im VM-Slot (09:00–13:00) bereits Kurse liegen.
    if (
      aktuell.vm &&
      slotBelegtDurchKurse(kurse[datum] ?? [], '09:00', '13:00')
    ) {
      return;
    }
    applyDay(datum, { vm: !aktuell.vm });
  };

  const toggleNm = (datum: string) => {
    const aktuell = availRef.current[datum] ?? { vm: false, nm: false };
    // Rücknahme sperren, wenn im NM-Slot (13:00–17:00) bereits Kurse liegen.
    if (
      aktuell.nm &&
      slotBelegtDurchKurse(kurse[datum] ?? [], '13:00', '17:00')
    ) {
      return;
    }
    applyDay(datum, { nm: !aktuell.nm });
  };

  const toggleGanzerTag = (datum: string) => {
    const aktuell = availRef.current[datum] ?? { vm: false, nm: false };
    const istGanztags = aktuell.vm && aktuell.nm;
    // Ganztags-Rücknahme nur erlauben, wenn kein Slot durch Kurse belegt ist.
    if (istGanztags) {
      const tagesKurse = kurse[datum] ?? [];
      const vmGesperrt = slotBelegtDurchKurse(tagesKurse, '09:00', '13:00');
      const nmGesperrt = slotBelegtDurchKurse(tagesKurse, '13:00', '17:00');
      if (vmGesperrt || nmGesperrt) return;
    }
    applyDay(datum, { vm: !istGanztags, nm: !istGanztags });
  };

  // -------------------------------------------------------------------------
  // Reservierungen (Firmenanfragen): anlegen & löschen
  // -------------------------------------------------------------------------

  /** Öffnet das Reservierungs-Modal für einen konkreten Tag mit intelligenter
   *  Slot-Vorauswahl: Slot 1 (09:00–13:00) bevorzugt, sonst Slot 2 (13:00–17:00). */
  const oeffneReservierungsModal = (datum: string) => {
    const tagesRes = reservierungen[datum] ?? [];
    const slot1Belegt = slotBelegt(tagesRes, '09:00', '13:00');
    const slot2Belegt = slotBelegt(tagesRes, '13:00', '17:00');
    let start = '09:00';
    let ende = '13:00';
    if (slot1Belegt && !slot2Belegt) {
      start = '13:00';
      ende = '17:00';
    }
    setResDatum(datum);
    setResStart(start);
    setResEnde(ende);
    setResKunde('');
    setResBemerkung('');
    setResFehler('');
    setResModalOffen(true);
  };

  /** Legt eine Reservierung über POST /api/trainer/reservierung an. */
  const erstelleReservierung = useCallback(async () => {
    if (!selectedTrainerId) return;
    setResSpeichert(true);
    setResFehler('');
    try {
      const res = await fetch('/api/trainer/reservierung', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trainer_id: Number(selectedTrainerId),
          datum: resDatum,
          start_time: resStart,
          end_time: resEnde,
          kunde: resKunde,
          bemerkung: resBemerkung || null,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        reservierung?: ReservierungRow;
        error?: unknown;
      } | null;

      if (!res.ok) {
        // Fehlermeldung der API sauber im Dialog anzeigen (z. B. 409-Kollision).
        const msg = data?.error
          ? String(data.error)
          : res.statusText || 'Unbekannter Fehler';
        setResFehler(msg);
        return;
      }

      if (data?.reservierung) {
        const neu = data.reservierung;
        setReservierungen((prev) => {
          const next = { ...prev };
          if (!next[neu.datum]) next[neu.datum] = [];
          next[neu.datum] = [...next[neu.datum], neu].sort((a, b) =>
            a.start_time.localeCompare(b.start_time)
          );
          return next;
        });
        setResModalOffen(false);
      }
    } catch (err: unknown) {
      console.error('Fehler beim Anlegen der Reservierung:', err);
      setResFehler(
        err instanceof Error ? err.message : 'Unbekannter Fehler beim Speichern.'
      );
    } finally {
      setResSpeichert(false);
    }
  }, [selectedTrainerId, resDatum, resStart, resEnde, resKunde, resBemerkung]);

  /** Löscht eine Reservierung nach Bestätigung über DELETE /api/trainer/reservierung. */
  const loescheReservierung = useCallback(
    async (res: ReservierungRow) => {
      const bestaetigt = window.confirm(
        `Reservierung für „${res.kunde}“ am ${res.datum} (${formatUhrzeit(
          res.start_time
        )}-${formatUhrzeit(res.end_time)}) wirklich löschen?`
      );
      if (!bestaetigt) return;

      try {
        const response = await fetch(
          `/api/trainer/reservierung?id=${encodeURIComponent(String(res.id))}`,
          { method: 'DELETE' }
        );
        if (!response.ok) {
          const errData = (await response.json().catch(() => null)) as {
            error?: unknown;
          } | null;
          throw new Error(
            errData?.error
              ? String(errData.error)
              : response.statusText || 'Löschen fehlgeschlagen.'
          );
        }
        setReservierungen((prev) => {
          const next = { ...prev };
          next[res.datum] = (next[res.datum] ?? []).filter(
            (r) => r.id !== res.id
          );
          return next;
        });
      } catch (err: unknown) {
        console.error('Fehler beim Löschen der Reservierung:', err);
        window.alert(
          err instanceof Error ? err.message : 'Löschen fehlgeschlagen.'
        );
      }
    },
    []
  );

  // -------------------------------------------------------------------------
  // Werktage (Mo–Fr) zwischen zwei ISO-Daten, ohne gesetzliche Feiertage
  // -------------------------------------------------------------------------

  /** Set aller Feiertags-ISO-Daten innerhalb eines Intervalls. */
  const feiertagsSetFuerIntervall = useCallback(
    (von: string, bis: string): Set<string> =>
      new Set(feiertageFuerZeitraum(von, bis).map((f) => f.datum)),
    []
  );

  const werktageImIntervall = useCallback(
    (von: string, bis: string): string[] => {
      const feiertage = feiertagsSetFuerIntervall(von, bis);
      const tage: string[] = [];
      let d = parseDateStr(von);
      const ende = parseDateStr(bis);
      while (d <= ende) {
        const ds = toDateStr(d);
        if (isoWochentag(d) < 5 && !feiertage.has(ds)) tage.push(ds);
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      }
      return tage;
    },
    [feiertagsSetFuerIntervall]
  );

  // -------------------------------------------------------------------------
  // Zeitraum-Erfassung: alle Werktage im Intervall als verfügbar setzen
  // -------------------------------------------------------------------------
  const schnellZeitraumSetzen = useCallback(
    async (von: string, bis: string): Promise<boolean> => {
      if (!von || !bis) {
        setModalHinweis('Bitte „Von“- und „Bis“-Datum wählen.');
        return false;
      }
      if (von > bis) {
        setModalHinweis('„Von“ muss vor „Bis“ liegen.');
        return false;
      }
      setModalHinweis('');
      setModalInfo('');

      const tage = werktageImIntervall(von, bis);
      if (tage.length === 0) {
        setModalHinweis(
          'Im gewählten Zeitraum liegen keine Werktage (Mo–Fr, ohne Feiertage).'
        );
        return false;
      }

      // Übersprungene Feiertage (nur Werktags-Feiertage) für den Hinweis zählen.
      const uebersprungeneFeiertage = feiertageFuerZeitraum(von, bis).filter(
        (f) => isoWochentag(parseDateStr(f.datum)) < 5
      );
      if (uebersprungeneFeiertage.length > 0) {
        setModalInfo(
          `${tage.length} Werktage gesetzt, ${uebersprungeneFeiertage.length} Feiertag(e) übersprungen (${uebersprungeneFeiertage
            .map((f) => f.name)
            .join(', ')}).`
        );
      }

      const vorher: Record<string, DayState> = {};
      const entries: BatchEintrag[] = tage.map((datum) => {
        vorher[datum] = {
          ...(availRef.current[datum] ?? { vm: false, nm: false }),
        };
        return { datum, vm: true, nm: true };
      });

      const map = { ...availRef.current };
      for (const e of entries) map[e.datum] = { vm: true, nm: true };
      setAvail(map);
      availRef.current = map;

      void saveBatch(entries, () => {
        const rollback = { ...availRef.current };
        for (const [ds, z] of Object.entries(vorher)) rollback[ds] = z;
        setAvail(rollback);
        availRef.current = rollback;
      });
      return true;
    },
    [werktageImIntervall, saveBatch]
  );

  // -------------------------------------------------------------------------
  // Navigation in der Wochenliste
  // -------------------------------------------------------------------------

  /** Zentraler Sprung-Mechanismus: richtet den Wochenanker exakt wie
   *  springeZuHeute() aus (Zielwoche minus WOCHEN_VOR_ZIEL) und merkt sich
   *  die Ziel-Woche als Scroll-Ziel. Der einheitliche Scroll-Effect
   *  positioniert sie danach mit scrollIntoView am oberen Rand. */
  const springeZuWoche = (zielMontag: Date) => {
    const zielMontagStr = toDateStr(zielMontag);
    ladeAuftragRef.current = { merge: false };
    setWochenAnker(
      new Date(zielMontag.getTime() - WOCHEN_VOR_ZIEL * 7 * 24 * 60 * 60 * 1000)
    );
    setWochenAnzahl(WOCHEN_INITIAL);
    setScrollZielWocheId(`woche-${zielMontagStr}`);
    isInitialScrolled.current = false;
  };

  /** Springt zur Woche, die das übergebene Datum (YYYY-MM-DD) enthält. */
  const springeZuDatumStr = (datumStr: string) => {
    const d = parseDateStr(datumStr);
    const zielMontag = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() - isoWochentag(d)
    );
    springeZuWoche(zielMontag);
  };

  // Gezielt zur Woche springen, die das gewählte Datum enthält.
  const springeZuDatum = () => {
    if (!sprungDatum) return;
    springeZuDatumStr(sprungDatum);
  };

  /** Schnellwahl: zur aktuellen Woche (Heute) springen. Nutzt denselben
   *  zentralen Mechanismus wie Monatssprung und Datumssuche. */
  const springeZuHeute = () => {
    const jetzt = new Date();
    const montag = new Date(
      jetzt.getFullYear(),
      jetzt.getMonth(),
      jetzt.getDate() - isoWochentag(jetzt)
    );
    springeZuWoche(montag);
  };

  /** Liefert den Montag der obersten sichtbaren Wochenzeile im Scroll-Container. */
  const obersteSichtbareWoche = (): Date | null => {
    const container = scrollRef.current;
    if (!container) return null;
    const containerTop = container.getBoundingClientRect().top;
    const zeilen = Array.from(
      container.querySelectorAll('[data-woche]')
    ) as HTMLElement[];
    for (const el of zeilen) {
      const elTop = el.getBoundingClientRect().top;
      // Erste Zeile, deren oberer Rand im sichtbaren Bereich des Containers liegt.
      if (elTop >= containerTop - 1) {
        const montag = parseDateStr(el.getAttribute('data-woche') ?? '');
        return montag;
      }
    }
    return null;
  };

 /** Schnellwahl: einen Monat zurück (offset = -1) bzw. vor (offset = +1) springen.
   *  Ermittelt den ersten Donnerstag des Zielmonats (ISO-8601 Anker), damit
   *  die Zielwoche garantiert und eindeutig im neuen Monat liegt. */
  const springeMonat = (offset: number) => {
    // Referenz: oberste sichtbare Woche (bzw. Wochenanker als Fallback).
    const referenzWoche = obersteSichtbareWoche() ?? wochenAnker;
    const donnerstag = new Date(
      referenzWoche.getTime() + 3 * 24 * 60 * 60 * 1000
    );
    const sichtbaresJahr = donnerstag.getFullYear();
    const sichtbarerMonat = donnerstag.getMonth();

    // 1. Tag des Zielmonats
    const zielDatum = new Date(sichtbaresJahr, sichtbarerMonat + offset, 1);

    // Ersten Donnerstag des Zielmonats ermitteln (ISO-Referenz):
    // getDay(): 0 = So, 1 = Mo, 2 = Di, 3 = Mi, 4 = Do, 5 = Fr, 6 = Sa
    const tag = zielDatum.getDay();
    const tageBisDo = tag <= 4 ? 4 - tag : 11 - tag;
    const zielDonnerstag = new Date(
      zielDatum.getFullYear(),
      zielDatum.getMonth(),
      zielDatum.getDate() + tageBisDo
    );

    // Montag dieser Kalenderwoche (Donnerstag minus 3 Tage)
    const zielMontag = new Date(
      zielDonnerstag.getFullYear(),
      zielDonnerstag.getMonth(),
      zielDonnerstag.getDate() - 3
    );

    // Schutzschild: Garantiert immer eine spürbare Bewegung
    if (offset > 0 && zielMontag.getTime() <= referenzWoche.getTime()) {
      zielMontag.setDate(zielMontag.getDate() + 7);
    } else if (offset < 0 && zielMontag.getTime() >= referenzWoche.getTime()) {
      zielMontag.setDate(zielMontag.getDate() - 7);
    }

    springeZuDatumStr(toDateStr(zielMontag));
  };

  // -------------------------------------------------------------------------
  // Wochenzeilen der Wochenliste (chronologisch sortiert)
  // -------------------------------------------------------------------------
  const wochenZeilen = useMemo<Date[][]>(() => {
    const zeilen: Date[][] = [];
    for (let w = 0; w < wochenAnzahl; w++) {
      const tage: Date[] = [];
      for (let t = 0; t < 7; t++) {
        tage.push(
          new Date(
            wochenAnker.getFullYear(),
            wochenAnker.getMonth(),
            wochenAnker.getDate() + w * 7 + t
          )
        );
      }
      zeilen.push(tage);
    }
    return zeilen;
  }, [wochenAnker, wochenAnzahl]);

  // Einheitlicher Sprung-Scroll: positioniert die Zielwoche (scrollZielWocheId)
  // bzw. beim initialen Laden die aktuelle Woche exakt am oberen Rand des
  // Scroll-Containers. Nutzt scrollIntoView – dieselbe Logik, die bei „Heute“
  // fehlerfrei funktioniert. isInitialScrolled wird erst NACH erfolgreichem
  // Scrollen gesetzt, damit der obere Sentinel (Vergangenheit) bis dahin
  // inaktiv bleibt.
  useEffect(() => {
    if (isGridLoading) return;
    if (!selectedTrainerId) return;
    if (isInitialScrolled.current && !scrollZielWocheId) return;

    // Ziel-Element: explizites Sprungziel oder (initial) aktuelle Woche.
    // Jede Wochenkarte trägt die ID `woche-YYYY-MM-DD` (ISO-Format des Montags).
    let zielId = scrollZielWocheId;
    if (!zielId) {
      const jetzt = new Date();
      const montag = new Date(
        jetzt.getFullYear(),
        jetzt.getMonth(),
        jetzt.getDate() - isoWochentag(jetzt)
      );
      zielId = `woche-${toDateStr(montag)}`;
    }

   // Doppelter requestAnimationFrame: stellt sicher, dass das DOM vollständig
    // gezeichnet und das Layout stabil ist, bevor gescrollt wird.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(zielId);
        const container = scrollRef.current;
        if (!el || !container) return;

        // Horizontale Position fest auf 0 fixieren und nur vertikal scrollen:
        const elTop = el.getBoundingClientRect().top;
        const containerTop = container.getBoundingClientRect().top;
        const zielTop = container.scrollTop + (elTop - containerTop);

        container.scrollTo({
          top: zielTop,
          left: 0,
          behavior: 'instant',
        });

        isInitialScrolled.current = true;
        setScrollZielWocheId('');
      });
    });
  }, [isGridLoading, wochenZeilen, selectedTrainerId, scrollZielWocheId]);

  // Modal barrierefrei schließen: ESC-Taste.
  useEffect(() => {
    if (!modalOffen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOffen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOffen]);

  // Reservierungs-Modal barrierefrei schließen: ESC-Taste.
  useEffect(() => {
    if (!resModalOffen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setResModalOffen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [resModalOffen]);

  // Popover für parallele Termine schließen: Klick außerhalb, Escape.
  useEffect(() => {
    if (!offenesPopover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOffenesPopover(null);
    };
    const onClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOffenesPopover(null);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [offenesPopover]);

  const trainerLabel = useCallback(
    (trainer: Trainer) => {
      const name =
        `${trainer.vorname ?? ''} ${trainer.nachname ?? ''}`.trim() ||
        `Trainer #${trainer.id}`;
      return trainer.kuerzel ? `${name} (${trainer.kuerzel})` : name;
    },
    []
  );

  // -------------------------------------------------------------------------
  // Wochenliste: Zeilenlogik
  // -------------------------------------------------------------------------

  /** Werktage (Mo–Fr) einer Woche ohne gesetzliche Feiertage. */
  const werktageOhneFeiertage = (tage: Date[]): Date[] => {
    const feiertage = feiertagsSetFuerIntervall(
      toDateStr(tage[0]),
      toDateStr(tage[tage.length - 1])
    );
    return tage.slice(0, 5).filter((d) => !feiertage.has(toDateStr(d)));
  };

  /** true, wenn alle regulären Werktage (Mo–Fr, ohne Feiertage) frei sind. */
  const wocheMoFrFrei = (tage: Date[]): boolean => {
    const werktage = werktageOhneFeiertage(tage);
    if (werktage.length === 0) return false;
    return werktage.every((d) => {
      const z = avail[toDateStr(d)] ?? { vm: false, nm: false };
      return z.vm && z.nm;
    });
  };

  /** Setzt bzw. hebt die Werktage (Mo–Fr, ohne Feiertage) einer Woche per Batch auf. */
  const toggleWocheMoFr = (tage: Date[]) => {
    const werktage = werktageOhneFeiertage(tage);
    const aktuellFrei = wocheMoFrFrei(tage);
    // Rücknahme der ganzen Woche sperren, wenn an mindestens einem Werktag
    // bereits Kurse in VM oder NM zugewiesen sind.
    if (aktuellFrei) {
      const belegt = werktage.some((d) => {
        const tagesKurse = kurse[toDateStr(d)] ?? [];
        return (
          slotBelegtDurchKurse(tagesKurse, '09:00', '13:00') ||
          slotBelegtDurchKurse(tagesKurse, '13:00', '17:00')
        );
      });
      if (belegt) {
        window.alert(
          'Rücknahme nicht möglich: An mindestens einem Werktag sind bereits Kurse zugewiesen.'
        );
        return;
      }
    }
    const vorher: Record<string, DayState> = {};
    const entries: BatchEintrag[] = werktage.map((d) => {
      const ds = toDateStr(d);
      vorher[ds] = { ...(availRef.current[ds] ?? { vm: false, nm: false }) };
      return { datum: ds, vm: !aktuellFrei, nm: !aktuellFrei };
    });

    const map = { ...availRef.current };
    for (const e of entries) map[e.datum] = { vm: e.vm, nm: e.nm };
    setAvail(map);
    availRef.current = map;

    void saveBatch(entries, () => {
      const rollback = { ...availRef.current };
      for (const [ds, z] of Object.entries(vorher)) rollback[ds] = z;
      setAvail(rollback);
      availRef.current = rollback;
    });
  };

  /** Klickbare Tageszelle einer Wochenzeile: Ganztags-Toggle + VM/NM + Kurs-Slots. */
  const renderWochenTag = (datum: Date) => {
    const datumStr = toDateStr(datum);
    const zustand = avail[datumStr] ?? { vm: false, nm: false };
    const tagesKurse = kurse[datumStr] ?? [];
    const tagesReservierungen = reservierungen[datumStr] ?? [];
    // Standard-Slots für Reservierungen: Slot 1 = 09:00–13:00, Slot 2 = 13:00–17:00.
    const slot1Belegt = slotBelegt(tagesReservierungen, '09:00', '13:00');
    const slot2Belegt = slotBelegt(tagesReservierungen, '13:00', '17:00');
    const beideSlotsBelegt = slot1Belegt && slot2Belegt;
    const istHeute = datumStr === heuteStr;
    const wochenende = datum.getDay() === 0 || datum.getDay() === 6;
    const feiertag = feiertageImZeitraum.get(datumStr) ?? null;
    const frei = zustand.vm && zustand.nm;
    const teilweise = zustand.vm !== zustand.nm;
    // Rücknahme-Sperre: VM/NM darf nicht mehr entfernt werden, wenn in diesem
    // Slot bereits aktive Kurse zugewiesen sind (09:00–13:00 bzw. 13:00–17:00).
    const vmGesperrt = slotBelegtDurchKurse(tagesKurse, '09:00', '13:00');
    const nmGesperrt = slotBelegtDurchKurse(tagesKurse, '13:00', '17:00');

    // Kurse nach zeitlicher Überschneidung gruppieren (Start-/Endzeit).
    const sortierteKurse = [...tagesKurse].sort((a, b) =>
      (a.start_time ?? a.end_time ?? '').localeCompare(
        b.start_time ?? b.end_time ?? ''
      )
    );
    const slotGruppen: KursRow[][] = [];
    for (const kurs of sortierteKurse) {
      const start = kurs.start_time ?? '00:00';
      const ende = kurs.end_time ?? '23:59';
      const gruppe = slotGruppen.find((g) => {
        const ref = g[0];
        return ueberschneidet(
          start,
          ende,
          ref.start_time ?? '00:00',
          ref.end_time ?? '23:59'
        );
      });
      if (gruppe) {
        gruppe.push(kurs);
      } else {
        slotGruppen.push([kurs]);
      }
    }

    return (
      <div
        key={datumStr}
        className={`group flex flex-col rounded-lg p-1 min-h-[96px] transition ${
          feiertag
            ? 'bg-purple-50 text-purple-700 border border-purple-300'
            : wochenende
              ? 'bg-slate-50/70 text-slate-400 border border-slate-200'
              : frei
                ? 'bg-teal-50/70 text-teal-900 border border-teal-300'
                : teilweise
                  ? 'bg-amber-50 text-amber-800 border border-amber-300'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
        } ${istHeute ? 'ring-1 ring-blue-300' : ''}`}
      >
        {/* Datumszeile = Ganztags-Toggle */}
        <button
          type="button"
          onClick={() => toggleGanzerTag(datumStr)}
          title={
            feiertag
              ? `Feiertag: ${feiertagLabel(feiertag)} – Klicken: ganzen Tag verfügbar/nicht verfügbar`
              : 'Klicken: ganzen Tag verfügbar/nicht verfügbar'
          }
          aria-pressed={frei}
          className={`flex items-center justify-between gap-1 rounded px-1 py-0.5 text-[10px] sm:text-xs font-semibold transition ${
            feiertag
              ? 'text-purple-700 hover:bg-purple-100'
              : frei
                ? 'text-teal-900 hover:bg-teal-100'
                : istHeute
                  ? 'text-blue-700 hover:bg-blue-50'
                  : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span className="leading-none whitespace-nowrap shrink-0">
            {formatTageskopf(datum)}
          </span>
          <span className="text-[8px] sm:text-[9px] leading-none font-normal truncate min-w-0 text-right">
            {feiertag
              ? feiertag.name
              : frei
                ? 'GT'
                : teilweise
                  ? zustand.vm
                    ? 'VM'
                    : 'NM'
                  : '–'}
          </span>
        </button>

        {/* VM / NM Segmente (Einzeltag-Umschaltung analog zur Monatskachel).
            Rücknahme gesperrt, wenn der Slot durch Kurse belegt ist. */}
        <div className="mt-0.5 flex gap-0.5">
          <button
            type="button"
            onClick={() => toggleVm(datumStr)}
            disabled={vmGesperrt && zustand.vm}
            aria-pressed={zustand.vm}
            title={
              vmGesperrt && zustand.vm
                ? 'Vormittag durch Kurse belegt – Rücknahme gesperrt'
                : 'Vormittag verfügbar/nicht verfügbar'
            }
            className={`flex-1 min-h-[20px] rounded text-[9px] sm:text-[10px] font-medium transition flex items-center justify-center border disabled:cursor-not-allowed ${
              zustand.vm
                ? 'bg-teal-50/70 border-teal-300 text-teal-900 hover:bg-teal-100'
                : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
            } ${vmGesperrt && zustand.vm ? 'opacity-60' : ''}`}
          >
            VM
          </button>
          <button
            type="button"
            onClick={() => toggleNm(datumStr)}
            disabled={nmGesperrt && zustand.nm}
            aria-pressed={zustand.nm}
            title={
              nmGesperrt && zustand.nm
                ? 'Nachmittag durch Kurse belegt – Rücknahme gesperrt'
                : 'Nachmittag verfügbar/nicht verfügbar'
            }
            className={`flex-1 min-h-[20px] rounded text-[9px] sm:text-[10px] font-medium transition flex items-center justify-center border disabled:cursor-not-allowed ${
              zustand.nm
                ? 'bg-teal-50/70 border-teal-300 text-teal-900 hover:bg-teal-100'
                : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
            } ${nmGesperrt && zustand.nm ? 'opacity-60' : ''}`}
          >
            NM
          </button>
        </div>

        {/* Kurs-Slot-Buttons: [HH:MM – HH:MM] [Kurstitel], farbcodiert nach Status.
            Mehrfachbelegungen werden über den primären Kurs gebündelt (▾ (+N)-Popover). */}
        <div className="mt-0.5 flex-1 space-y-0.5">
          {slotGruppen.map((gruppe, gruppenIndex) => {
            // Primärer Kurs: Rangfolge bestätigt > unter Vorbehalt > ausgeschrieben
            // > abgesagt; bei gleichem Status alphabetisch nach Kurstitel.
            const sortierteGruppe = [...gruppe].sort((a, b) => {
              const rangDiff =
                statusRang(a.zuweisung_status) - statusRang(b.zuweisung_status);
              if (rangDiff !== 0) return rangDiff;
              return (a.kursname ?? '').localeCompare(b.kursname ?? '', 'de');
            });
            const haupt = sortierteGruppe[0];
            if (!haupt) return null;

            const uhrzeit = `${formatUhrzeit(haupt.start_time)}-${formatUhrzeit(haupt.end_time)}`;
            const titel = haupt.kursname ?? 'Kurs';
            const vollerText = `${uhrzeit} ${titel}`;
            const mehrfach = sortierteGruppe.length > 1;
            const popoverKey = `${datumStr}:${gruppenIndex}`;
            const abgesagteInGruppe = sortierteGruppe.filter(
              (k) => !istAktiverStatus(k.zuweisung_status)
            );
            const ersetzt =
              istAktiverStatus(haupt.zuweisung_status) &&
              abgesagteInGruppe.length > 0;

            return (
              <div
                key={popoverKey}
                className="relative flex items-center gap-0.5"
              >
                <button
                  type="button"
                  title={vollerText}
                  className={`flex-1 min-w-0 rounded border px-1 py-1 text-left text-[8px] sm:text-[10px] leading-tight font-medium transition flex items-center ${statusSlotClasses(
                    haupt.zuweisung_status
                  )}`}
                >
                  <span className="flex items-center gap-1 min-w-0 w-full leading-none">
                    <span className="font-semibold shrink-0">{uhrzeit}</span>
                    <span className="truncate flex-1 min-w-0">{titel}</span>
                  </span>
                </button>

                {/* Info-Icon „i“ für ersetzte abgesagte Kurse (nur bei Einzelterminen). */}
                {!mehrfach && ersetzt && (
                  <span
                    title={`Ersetzt abgesagten Kurs: ${abgesagteInGruppe
                      .map(
                        (k) =>
                          `${formatUhrzeit(k.start_time)} – ${formatUhrzeit(k.end_time)} ${k.kursname ?? 'Kurs'}`
                      )
                      .join('; ')}`}
                    aria-label="Ersetzt abgesagten Kurs"
                    className="shrink-0 inline-flex items-center justify-center w-4 h-4 self-center rounded-full bg-slate-200 border border-slate-300 text-slate-600 text-[9px] font-bold cursor-help"
                  >
                    i
                  </span>
                )}

                {/* Badge „▾ (+N)“ für parallele Termine im selben Slot. */}
                {mehrfach && (
                  <button
                    type="button"
                    onClick={() =>
                      setOffenesPopover((prev) =>
                        prev === popoverKey ? null : popoverKey
                      )
                    }
                    title="Parallele Termine anzeigen"
                    aria-label={`Parallele Termine anzeigen (${sortierteGruppe.length - 1} weitere)`}
                    aria-expanded={offenesPopover === popoverKey}
                    className={`shrink-0 inline-flex items-center justify-center px-1 rounded border text-[9px] font-semibold transition self-center ${statusSlotClasses(
                      haupt.zuweisung_status
                    )} hover:brightness-95`}
                  >
                    ▾ (+{sortierteGruppe.length - 1})
                  </button>
                )}

                {/* Popover: alle parallelen Termine des Slots (absolut, ohne Layout-Shift). */}
                {mehrfach && offenesPopover === popoverKey && (
                  <div
                    ref={popoverRef}
                    className="absolute z-50 left-0 top-full mt-1 shadow-lg rounded-md border border-slate-200 bg-white p-2 min-w-[280px]"
                  >
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                      Parallele Termine ({uhrzeit})
                    </div>
                    <ul className="space-y-1">
                      {sortierteGruppe.map((kurs, idx) => (
                        <li key={idx} className="flex items-center gap-1.5">
                          <span
                            className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold border ${statusBadgeClasses(
                              kurs.zuweisung_status
                            )}`}
                          >
                            {statusLabel(kurs.zuweisung_status)}
                          </span>
                          <span className="truncate text-[11px] text-slate-700">
                            {kurs.kursname ?? 'Kurs'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Reservierungs-Badges: [Start-Ende] Reserviert: [Kunde] (Pastell-Orange) */}
        {tagesReservierungen.length > 0 && (
          <div className="mt-0.5 space-y-0.5">
            {tagesReservierungen.map((res) => {
              const uhrzeit = `${formatUhrzeit(res.start_time)}-${formatUhrzeit(res.end_time)}`;
              const vollerText = `${uhrzeit} Reserviert: ${res.kunde}${
                res.bemerkung ? ` – ${res.bemerkung}` : ''
              }`;
              return (
                <div key={res.id} className="group flex items-center justify-between gap-0.5">
                  <button
                    type="button"
                    title={`${vollerText} (Klicken: löschen)`}
                    onClick={() => void loescheReservierung(res)}
                    className="flex-1 min-w-0 rounded border px-1 py-1 text-left text-[8px] sm:text-[10px] leading-tight font-medium transition flex items-center bg-orange-50 text-orange-800 border-orange-300 hover:bg-orange-100"
                  >
                    <span className="flex items-center gap-1 min-w-0 w-full leading-none">
                      <span className="font-semibold shrink-0">{uhrzeit}</span>
                      <span className="truncate flex-1 min-w-0">
                        Reserviert: {res.kunde}
                      </span>
                    </span>
                  </button>
                  {/* Lösch-Icon: nur für Admins, dezent (nur bei Hover der Zeile
                      sichtbar) und mit großzügigem Klickbereich (w-6 h-6). */}
                  {istAdmin && (
                    <button
                      type="button"
                      onClick={() => void loescheReservierung(res)}
                      title="Reservierung löschen"
                      aria-label="Reservierung löschen"
                      className="shrink-0 inline-flex items-center justify-center w-6 h-6 self-center rounded bg-orange-100 border border-orange-300 text-orange-700 hover:bg-orange-200 text-sm font-bold leading-none opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Dezent: Reservierung für diesen Tag anlegen – exklusiv für Admins
            (webinarcenter.de) und nur bei Hover der Tageskachel sichtbar.
            Deaktiviert, wenn beide Standard-Slots 09:00–13:00 und 13:00–17:00
            belegt sind. */}
        {istAdmin && (
          <button
            type="button"
            onClick={() => oeffneReservierungsModal(datumStr)}
            disabled={beideSlotsBelegt}
            title={
              beideSlotsBelegt
                ? 'Kein freier Slot mehr verfügbar (Vormittag und Nachmittag reserviert)'
                : 'Reservierung anlegen (Firmenanfrage)'
            }
            className={`mt-0.5 w-full rounded border border-dashed border-orange-300 text-orange-600 hover:bg-orange-50 text-[8px] sm:text-[9px] py-0.5 font-medium transition opacity-0 group-hover:opacity-100 focus:opacity-100 ${
              beideSlotsBelegt
                ? 'group-hover:opacity-40 cursor-not-allowed'
                : ''
            }`}
          >
            + Res.
          </button>
        )}
      </div>
    );
  };

  /** Eine Wochenzeile: Checkbox „Mo–Fr verfügbar“ + 7 Tageskacheln. */
  const renderWochenZeile = (tage: Date[], index: number) => {
    const montag = tage[0];
    const kw = kalenderwoche(montag);
    const moFrFrei = wocheMoFrFrei(tage);
    // Wochenenden ausblenden: nur Mo–Fr rendern (5 Spalten statt 7).
    const sichtbareTage = wochenendenAnzeigen ? tage : tage.slice(0, 5);
    // Exakte Übereinstimmung von Jahr + Kalenderwoche mit dem heutigen Tag.
    const heute = new Date();
    const istAktuelleWoche =
      montag.getFullYear() === heute.getFullYear() &&
      kalenderwoche(montag) === kalenderwoche(heute);

    return (
      <div
        key={`woche-${toDateStr(montag)}`}
        id={`woche-${toDateStr(montag)}`}
        data-woche={toDateStr(montag)}
        data-aktuell={istAktuelleWoche ? 'true' : undefined}
        className="bg-white rounded-xl border border-slate-200 shadow-sm p-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm sm:text-base font-bold text-slate-900">
            KW {kw}
          </span>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={moFrFrei}
              onChange={() => toggleWocheMoFr(tage)}
              className="w-4 h-4 accent-emerald-600"
            />
            <span className="text-xs font-semibold text-slate-700">
              Mo–Fr verfügbar
            </span>
          </label>
        </div>
        <div
          className={`mt-2 grid ${
            wochenendenAnzeigen ? 'grid-cols-7' : 'grid-cols-5'
          } gap-1`}
        >
          {sichtbareTage.map((d) => renderWochenTag(d))}
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // Dozentenauswahl (aktualisiert zusätzlich die URL)
  // -------------------------------------------------------------------------
  const handleTrainerChange = (value: string) => {
    setSelectedTrainerId(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set('trainer_id', value);
    } else {
      params.delete('trainer_id');
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <div className="max-w-5xl mx-auto p-4 pb-16">
        {/* Kopfzeile */}
        <header className="mb-4 pt-2">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-blue-600" />
            Verfügbarkeit pflegen
          </h1>
          <p className="text-xs text-slate-500">
            Stufenlose Wochenliste mit Vormittag / Nachmittag – Änderungen werden automatisch gespeichert.
          </p>
        </header>

        {/* Toolbar: Dozent + Navigation + Auto-Save-Status */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 items-end">
          <div className="sm:col-span-1">
            <label
              htmlFor="trainer-select"
              className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
            >
              Dozent
            </label>
            <select
              id="trainer-select"
              value={selectedTrainerId}
              onChange={(e) => handleTrainerChange(e.target.value)}
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

          <div className="sm:col-span-2 flex items-end justify-end gap-2">
            {/* Wochenend-Filter (Standard: ausgeblendet) */}
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-slate-600">
              <input
                type="checkbox"
                checked={wochenendenAnzeigen}
                onChange={(e) => setWochenendenAnzeigen(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              Wochenenden anzeigen
            </label>

            {/* Auto-Save-Indikator */}
            <div className="text-xs flex items-center gap-1.5 text-slate-500">
              {saveStatus === 'saving' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Speichere…
                </>
              )}
              {saveStatus === 'saved' && (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-700">Gespeichert</span>
                </>
              )}
              {saveStatus === 'error' && (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                  <span className="text-rose-700">Speichern fehlgeschlagen</span>
                </>
              )}
              {saveStatus === 'idle' && 'Auto-Save aktiv'}
            </div>
          </div>
        </div>

        {/* Zeitraum-Erfassung (Modal) + Datumsfilter */}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={() => {
              setModalVon(toDateStr(new Date()));
              setModalBis(toDateStr(new Date()));
              setModalHinweis('');
              setModalInfo('');
              setModalOffen(true);
            }}
            className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
          >
            Verfügbare Zeiträume erfassen
          </button>

          <div className="w-0.5 h-9 bg-slate-200" />
          <div>
            <label
              htmlFor="sprung-datum"
              className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
            >
              Springen zu
            </label>
            <input
              id="sprung-datum"
              type="date"
              value={sprungDatum}
              onChange={(e) => setSprungDatum(e.target.value)}
              className="text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>
          <button
            type="button"
            onClick={springeZuDatum}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-100 transition"
          >
            Springen
          </button>

          <div className="w-0.5 h-9 bg-slate-200" />

          {/* Schnellwahltasten: Heute / Vorheriger Monat / Nächster Monat */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={springeZuHeute}
              title="Zur aktuellen Woche springen"
              className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
            >
              Heute
            </button>
            <button
              type="button"
              onClick={() => springeMonat(-1)}
              title="Einen Monat zurück springen"
              className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-100 transition"
            >
              ‹ Vorheriger Monat
            </button>
            <button
              type="button"
              onClick={() => springeMonat(1)}
              title="Einen Monat vor springen"
              className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-100 transition"
            >
              Nächster Monat ›
            </button>
          </div>
        </div>

        {/* Lade-/Fehlerzustand */}
        {isGridLoading && selectedTrainerId ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Lade Daten…</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-500">
            <AlertCircle className="w-6 h-6 text-rose-500" />
            <p className="text-sm">Daten konnten nicht geladen werden.</p>
            <button
              type="button"
              onClick={() => void loadGrid(false)}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
            >
              Erneut versuchen
            </button>
          </div>
        ) : (
          <>
            {/* ------------------------------------------------------------
             * Stufenlose Wochenliste mit bidirektionalem Infinite Scrolling
             * ------------------------------------------------------------ */}
            <div
              ref={scrollRef}
              className="overflow-y-scroll overflow-x-hidden [scrollbar-gutter:stable] max-h-[calc(100vh-320px)] min-h-[420px] pr-2"
            >
              <div ref={topSentinelRef} className="h-1" aria-hidden="true" />
              <div className="space-y-2">
                {wochenZeilen.map((tage, i) => renderWochenZeile(tage, i))}
              </div>
              <div ref={bottomSentinelRef} className="h-1" aria-hidden="true" />
              {isAppending && (
                <div className="flex items-center justify-center py-3 text-slate-400 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs">Lade weitere Wochen…</span>
                </div>
              )}
            </div>

            {/* Legende */}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded bg-teal-50/70 border border-teal-300" />
                Verfügbar
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded bg-amber-50 border border-amber-300" />
                Teilweise (nur VM/NM)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded bg-white border border-slate-200" />
                Nicht verfügbar
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded bg-slate-50/70 border border-slate-200" />
                Wochenende
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded bg-blue-50 border border-blue-300" />
                Kurs ausgeschrieben
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded bg-amber-500 border border-amber-600" />
                Kurs unter Vorbehalt
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded bg-emerald-600 border border-emerald-700" />
                Kurs bestätigt
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded bg-rose-50 border border-rose-300" />
                Kurs abgesagt
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded bg-purple-50 border border-purple-300" />
                Feiertag (manuell wählbar)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded bg-orange-50 border border-orange-300" />
                Reservierung (Firmenanfrage)
              </span>
            </div>
          </>
        )}
      </div>

      {/* Modal: Verfügbare Zeiträume erfassen */}
      {modalOffen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-zeitraum-titel"
          onClick={() => setModalOffen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="modal-zeitraum-titel"
              className="text-lg font-bold text-slate-800"
            >
              Verfügbare Zeiträume erfassen
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Wochenenden und gesetzliche Feiertage werden automatisch
              ausgeschlossen.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="modal-von"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
                >
                  Von
                </label>
                <input
                  id="modal-von"
                  type="date"
                  value={modalVon}
                  onChange={(e) => setModalVon(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
              <div>
                <label
                  htmlFor="modal-bis"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
                >
                  Bis
                </label>
                <input
                  id="modal-bis"
                  type="date"
                  value={modalBis}
                  onChange={(e) => setModalBis(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
            </div>

            {modalHinweis && (
              <p className="mt-3 text-xs text-rose-600">{modalHinweis}</p>
            )}
            {modalInfo && (
              <p className="mt-3 text-xs text-emerald-700">{modalInfo}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOffen(false)}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-100 transition"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const ok = await schnellZeitraumSetzen(modalVon, modalBis);
                    if (ok) setModalOffen(false);
                  })();
                }}
                className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
              >
                Zeitraum als verfügbar setzen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reservierung anlegen (unverbindliche Firmenanfrage) */}
      {resModalOffen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-reservierung-titel"
          onClick={() => setResModalOffen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="modal-reservierung-titel"
              className="text-lg font-bold text-slate-800"
            >
              Reservierung anlegen
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Unverbindliche Reservierung für eine Firmenanfrage – noch kein
              Kurs in edoobox.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="res-trainer"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
                >
                  Trainer
                </label>
                <select
                  id="res-trainer"
                  value={selectedTrainerId}
                  disabled
                  className="w-full text-sm font-medium border border-slate-300 rounded px-2.5 py-1.5 bg-slate-50 text-slate-600"
                >
                  {trainers
                    .filter((t) => String(t.id) === selectedTrainerId)
                    .map((t) => (
                      <option key={t.id} value={String(t.id)}>
                        {trainerLabel(t)}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="res-datum"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
                >
                  Datum
                </label>
                <input
                  id="res-datum"
                  type="date"
                  value={resDatum}
                  onChange={(e) => setResDatum(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="res-start"
                    className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
                  >
                    Uhrzeit von
                  </label>
                  <input
                    id="res-start"
                    type="time"
                    value={resStart}
                    onChange={(e) => setResStart(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="res-ende"
                    className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
                  >
                    Uhrzeit bis
                  </label>
                  <input
                    id="res-ende"
                    type="time"
                    value={resEnde}
                    onChange={(e) => setResEnde(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
              </div>

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
                  value={resKunde}
                  onChange={(e) => setResKunde(e.target.value)}
                  placeholder="z. B. Firma XYZ"
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>

              <div>
                <label
                  htmlFor="res-bemerkung"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1"
                >
                  Bemerkung (optional)
                </label>
                <textarea
                  id="res-bemerkung"
                  value={resBemerkung}
                  onChange={(e) => setResBemerkung(e.target.value)}
                  rows={2}
                  className="w-full text-sm border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
            </div>

            {resFehler && (
              <p className="mt-3 text-xs text-rose-600">{resFehler}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResModalOffen(false)}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-100 transition"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => void erstelleReservierung()}
                disabled={resSpeichert}
                className="px-3 py-2 rounded-lg bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 transition disabled:opacity-60"
              >
                {resSpeichert ? 'Speichere…' : 'Reservierung anlegen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** Wrapper-Page: Suspense-Boundary für useSearchParams() (Next.js-Prerender). */
export default function VerfuegbarkeitPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-slate-500">
          Lade Verfügbarkeit...
        </div>
      }
    >
      <VerfuegbarkeitContent />
    </Suspense>
  );
}