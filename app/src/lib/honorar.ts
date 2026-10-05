// ---------------------------------------------------------------------------
// Honorarberechnung nach Modell A
// ---------------------------------------------------------------------------
// Wiederverwendbare, pure Hilfsfunktionen zur Berechnung des Trainer-Honorars
// je Kurs/Termin. Die vier Vergütungssätze stammen aus public.trainer.
// ---------------------------------------------------------------------------

/**
 * Die vier je Trainer gepflegten Honorarsätze (public.trainer).
 * Beträge in EUR (netto).
 */
export interface HonorarSaetze {
  tagessatz: number;
  halbtagessatz: number;
  stundensatz: number;
  reduzierter_satz: number;
}

/** Ein einzelner Kurstermin mit Start- und Endzeitpunkt. */
export interface HonorarTermin {
  date_start: string | null;
  date_end: string | null;
}

/**
 * Eingabemodell eines Kurses/Angebots für die Honorarberechnung.
 * Die Termine repräsentieren die einzelnen Kurstage.
 */
export interface HonorarKurs {
  /** Anzahl der tatsächlich gebuchten Teilnehmer (Ist-Teilnehmer). */
  teilnehmer: number;
  /** Angebotskategorie (z. B. "Coaching"). */
  offer_type: string | null;
  /** Optionale Tags des Angebots. */
  tags?: string[] | null;
  /** Die Kurstermine (üblicherweise ein Termin je Kurstag). */
  termine: HonorarTermin[];
}

/** Die Vergütungsregeln nach Modell A. */
export type HonorarRegel = 'ein_teilnehmer' | 'coaching' | 'standard';

/** Ergebnis einer detaillierten Honorarberechnung. */
export interface HonorarBerechnung {
  regel: HonorarRegel;
  betrag: number;
}

/**
 * Wird ein Kurs als Coaching behandelt? Entweder über die Kategorie
 * `offer_type` oder über einen entsprechenden Tag.
 */
export function istCoaching(kurs: HonorarKurs): boolean {
  const kategorie = (kurs.offer_type ?? '').trim().toLowerCase();
  if (kategorie === 'coaching') return true;

  return (kurs.tags ?? []).some(
    (tag) => tag.trim().toLowerCase() === 'coaching'
  );
}

/** Berechnet die Dauer eines Termins in Minuten (end - start). */
export function dauerInMinuten(termin: HonorarTermin): number {
  if (!termin.date_start || !termin.date_end) return 0;

  const start = new Date(termin.date_start).getTime();
  const ende = new Date(termin.date_end).getTime();
  if (Number.isNaN(start) || Number.isNaN(ende)) return 0;

  const minuten = (ende - start) / 60000;
  return minuten > 0 ? minuten : 0;
}

/** Rundet Minuten auf den nächsten vollen 15-Minuten-Takt auf. */
export function rundeAuf15Minuten(minuten: number): number {
  return Math.ceil(minuten / 15) * 15;
}

/** Rundet einen EUR-Betrag kaufmännisch auf zwei Nachkommastellen. */
export function rundeAufCent(betrag: number): number {
  return Math.round(betrag * 100) / 100;
}

/**
 * Berechnet das Honorar eines Kurses für einen Trainer nach Modell A und
 * liefert die Summe.
 */
export function berechneHonorar(
  kurs: HonorarKurs,
  saetze: HonorarSaetze
): number {
  return berechneHonorarDetail(kurs, saetze).betrag;
}

/**
 * Berechnet das Honorar eines Kurses für einen Trainer nach Modell A und
 * liefert zusätzlich die angewandte Regel.
 *
 * Regel 1 (Sonderfall 1 TN): teilnehmer === 1 && reduzierter_satz > 0
 *   → reduzierter_satz × Anzahl Termine (bei mehrtägigen Kursen).
 * Regel 2 (Coaching): Kategorie/Tag "Coaching" oder Gesamtdauer ≤ 2 Stunden
 *   → (auf 15-Min-Takt aufgerundete Gesamtminuten / 60) × stundensatz.
 * Regel 3 (Standard): je Termin (Kurstag)
 *   → Dauer ≤ 4,5 h ⇒ 1 × halbtagessatz, sonst 1 × tagessatz;
 *     Summe aller Kurstage.
 */
export function berechneHonorarDetail(
  kurs: HonorarKurs,
  saetze: HonorarSaetze
): HonorarBerechnung {
  const anzahlTermine = Math.max(kurs.termine.length, 1);

  // Regel 1: Sonderfall mit genau einem Teilnehmer.
  if (kurs.teilnehmer === 1 && saetze.reduzierter_satz > 0) {
    return {
      regel: 'ein_teilnehmer',
      betrag: rundeAufCent(saetze.reduzierter_satz * anzahlTermine),
    };
  }

  // Geplante Gesamtdauer über alle Kurstage.
  const gesamtMinuten = kurs.termine.reduce(
    (summe, termin) => summe + dauerInMinuten(termin),
    0
  );

  // Regel 2: Coaching-Kurse oder kurze Kurse (≤ 2 Stunden).
  if (istCoaching(kurs) || gesamtMinuten <= 120) {
    const taktMinuten = rundeAuf15Minuten(gesamtMinuten);
    return {
      regel: 'coaching',
      betrag: rundeAufCent((taktMinuten / 60) * saetze.stundensatz),
    };
  }

  // Regel 3: Standard – Tages- bzw. Halbtagssatz je Kurstag.
  let betrag = 0;
  for (const termin of kurs.termine) {
    const minuten = dauerInMinuten(termin);
    betrag += minuten <= 270 ? saetze.halbtagessatz : saetze.tagessatz;
  }

  return { regel: 'standard', betrag: rundeAufCent(betrag) };
}