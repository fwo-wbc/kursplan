// ---------------------------------------------------------------------------
// planning-utils.ts – Block-Code → Zeitfenster-Mapping (Vorbereitung L-05).
//
// Übersetzt die Block-Codes der Kursplanung in mathematische Zeitfenster für
// den künftigen Planungs-Algorithmus. Die Werte sind bewusst als PLATZHALTER-
// Standard hinterlegt und werden in L-05 durch die echten Kurszeiten ersetzt.
//
// Platzhalter-Standard:
//   VM / K1 -> 08:00 bis 12:00
//   NM / K2 -> 13:00 bis 17:00
//   GT / HT -> 08:00 bis 17:00
//
// ---------------------------------------------------------------------------

/** Block-Codes, die der Planungs-Algorithmus in Zeitfenster auflösen kann. */
export type BlockCode = 'VM' | 'NM' | 'GT' | 'HT' | 'K1' | 'K2';

/** Mathematisches Zeitfenster eines Blocks. */
export interface Zeitfenster {
  /** Startzeit im Format HH:MM (24h), z. B. "08:00". */
  von: string;
  /** Endzeit im Format HH:MM (24h), z. B. "12:00". */
  bis: string;
  /** Startzeit als Minuten seit Mitternacht (08:00 → 480). */
  vonMinuten: number;
  /** Endzeit als Minuten seit Mitternacht (12:00 → 720). */
  bisMinuten: number;
}

/** Rechnet "HH:MM" in Minuten seit Mitternacht um (08:00 → 480). */
export function uhrzeitZuMinuten(uhrzeit: string): number {
  const teile = /^(\d{2}):(\d{2})$/.exec(uhrzeit);
  if (!teile) {
    throw new Error(`Ungültige Uhrzeit "${uhrzeit}" – erwartet wird das Format HH:MM.`);
  }
  return Number(teile[1]) * 60 + Number(teile[2]);
}

/** Baut aus "HH:MM"-Grenzen ein vollständiges Zeitfenster. */
function zeitfenster(von: string, bis: string): Zeitfenster {
  return {
    von,
    bis,
    vonMinuten: uhrzeitZuMinuten(von),
    bisMinuten: uhrzeitZuMinuten(bis),
  };
}

/**
 * Platzhalter-Standard-Zeitfenster je Block-Code.
 * Wird in L-05 durch die realen Kurszeiten ersetzt bzw. ergänzt.
 */
export const BLOCK_ZEITFENSTER: Readonly<Record<BlockCode, Zeitfenster>> = {
  VM: zeitfenster('08:00', '12:00'),
  K1: zeitfenster('08:00', '12:00'),
  NM: zeitfenster('13:00', '17:00'),
  K2: zeitfenster('13:00', '17:00'),
  GT: zeitfenster('08:00', '17:00'),
  HT: zeitfenster('08:00', '17:00'),
};

/**
 * Liefert das Zeitfenster zu einem Block-Code.
 * Unbekannte Codes liefern `null`, damit der Planungs-Algorithmus sie
 * explizit behandeln kann (z. B. überspringen oder als Konflikt melden).
 */
export function blockZeitfenster(code: string): Zeitfenster | null {
  return BLOCK_ZEITFENSTER[code as BlockCode] ?? null;
}

/** Alle bekannten Block-Codes (für Validierung und Iteration). */
export const BLOCK_CODES: readonly BlockCode[] = Object.keys(BLOCK_ZEITFENSTER) as BlockCode[];

// ---------------------------------------------------------------------------
// Exakte Kurs-Slots für 1,5-Stunden-Kurse (Szenario 1 / L-05 Serienplanung).
//
// Während BLOCK_ZEITFENSTER nur das mathematische Verfügbarkeitsfenster eines
// Blocks beschreibt, werden die Block-Verfügbarkeiten hier in konkrete
// 90-Minuten-Slots übersetzt:
//   Slot 1 (09:00-10:30) + Slot 2 (11:00-12:30)   → Vormittag    (VM / K1)
//   Slot 3 (13:00-14:30) + Slot 4 (15:00-16:30)   → Nachmittag   (NM / K2)
//   Slot 1-4 (ganzer Tag)                         → Ganztags     (GT / HT)
//
// Ein Trainerblock berechtigt zur Planung ausschließlich in den ihm
// zugeordneten Slots; dadurch prüft der Planungs-Algorithmus Mehrfach-
// belegungen taggenau in den 1,5h-Rastern.
// ---------------------------------------------------------------------------

/** Dauer eines Kurs-Slots in Minuten (1,5 Stunden). */
export const SLOT_DAUER_MINUTEN = 90;

/** Ein konkreter Planungs-Slot für 1,5-Stunden-Kurse. */
export interface PlanungsSlot {
  /** Slot-Nummer (1..4) innerhalb eines Tages. */
  slot: number;
  /** Anzeigename, z. B. "Slot 1". */
  bezeichnung: string;
  /** Tageshälfte des Slots: 'VM' (Vormittag) oder 'NM' (Nachmittag). */
  halbtag: 'VM' | 'NM';
  /** Startzeit im Format HH:MM (24h), z. B. "09:00". */
  von: string;
  /** Endzeit im Format HH:MM (24h), z. B. "10:30". */
  bis: string;
  /** Startzeit als Minuten seit Mitternacht (09:00 → 540). */
  vonMinuten: number;
  /** Endzeit als Minuten seit Mitternacht (10:30 → 630). */
  bisMinuten: number;
}

/** Baut aus Slot-Nummer und Zeitgrenzen einen vollständigen Planungs-Slot. */
function planungsSlot(
  slot: number,
  halbtag: PlanungsSlot['halbtag'],
  von: string,
  bis: string
): PlanungsSlot {
  return {
    slot,
    bezeichnung: `Slot ${slot}`,
    halbtag,
    von,
    bis,
    vonMinuten: uhrzeitZuMinuten(von),
    bisMinuten: uhrzeitZuMinuten(bis),
  };
}

/**
 * Alle Kurs-Slots eines Tages für 1,5-Stunden-Kurse.
 * Index 0 = Slot 1, Index 3 = Slot 4.
 */
export const KURS_SLOTS: readonly PlanungsSlot[] = [
  planungsSlot(1, 'VM', '09:00', '10:30'),
  planungsSlot(2, 'VM', '11:00', '12:30'),
  planungsSlot(3, 'NM', '13:00', '14:30'),
  planungsSlot(4, 'NM', '15:00', '16:30'),
];

/**
 * Berechtigte Kurs-Slots je Block-Code (Trainer-Verfügbarkeit).
 *
 *   VM / K1 → Slot 1 + Slot 2 (Vormittag)
 *   NM / K2 → Slot 3 + Slot 4 (Nachmittag)
 *   GT / HT → alle 4 Slots    (Ganztags)
 */
export const BLOCK_SLOTS: Readonly<Record<BlockCode, readonly PlanungsSlot[]>> = {
  VM: [KURS_SLOTS[0], KURS_SLOTS[1]],
  K1: [KURS_SLOTS[0], KURS_SLOTS[1]],
  NM: [KURS_SLOTS[2], KURS_SLOTS[3]],
  K2: [KURS_SLOTS[2], KURS_SLOTS[3]],
  GT: KURS_SLOTS,
  HT: KURS_SLOTS,
};

/**
 * Liefert die für einen Block-Code zulässigen Kurs-Slots.
 * Unbekannte Codes liefern `null`, damit der Planungs-Algorithmus sie
 * explizit behandeln kann (z. B. überspringen oder als Konflikt melden).
 */
export function blockSlots(code: string): readonly PlanungsSlot[] | null {
  return BLOCK_SLOTS[code as BlockCode] ?? null;
}

/**
 * Prüft, ob ein Block-Code in einem konkreten Slot (1..4) planen darf.
 * Nützlich für den Planungs-Algorithmus bei der Kollisionsprüfung.
 */
export function blockErlaubtSlot(code: string, slotNummer: number): boolean {
  const slots = blockSlots(code);
  if (!slots) return false;
  return slots.some((s) => s.slot === slotNummer);
}