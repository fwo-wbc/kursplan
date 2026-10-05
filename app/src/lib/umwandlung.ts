// ---------------------------------------------------------------------------
// Gemeinsame Helfer für die Umwandlung einer Terminreservierung in ein
// edoobox-Kursangebot (Schema C). Wird sowohl vom Frontend (Anzeige) als auch
// von der API (Validierung und Berechnung) verwendet.
// ---------------------------------------------------------------------------

/** Zulässige Slot-Codes der Planungsansicht. */
export type SlotCode = 'KT1' | 'KT2' | 'KT3' | 'ganztags';

/** Zeitfenster je Slot (Europe/Berlin, reine Uhrzeiten ohne Datum). */
export interface SlotZeit {
  von: string;
  bis: string;
  label: string;
}

export const SLOT_ZEITEN: Record<SlotCode, SlotZeit> = {
  KT1: { von: '09:00', bis: '13:00', label: 'Vormittag' },
  KT2: { von: '13:30', bis: '17:00', label: 'Nachmittag' },
  KT3: { von: '18:00', bis: '20:00', label: 'Abend' },
  ganztags: { von: '09:00', bis: '17:00', label: 'Ganztags' },
};

/** Liefert die definierten Uhrzeiten zu einem Slot-Code. */
export function slotZeit(slotCode: string): SlotZeit {
  return SLOT_ZEITEN[slotCode as SlotCode] ?? SLOT_ZEITEN.KT1;
}

// ---------------------------------------------------------------------------
// Datums-/Zeitzonen-Helfer
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Ermittelt den aktuellen UTC-Offset (in Minuten) der Zeitzone Europe/Berlin
 * für den übergebenen Zeitpunkt, ohne auf die Serverzeitzone angewiesen zu
 * sein (sommerzeitfest über Intl.DateTimeFormat).
 */
function berlinOffsetMinuten(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const map: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') {
      map[part.type] = Number(part.value);
    }
  }

  const alsUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour,
    map.minute,
    map.second
  );

  return Math.round((alsUtc - date.getTime()) / 60000);
}

/**
 * Bildet ein lokales Berliner Datum (YYYY-MM-DD) plus Uhrzeit (HH:mm) auf
 * einen ISO-8601-Zeitstempel mit explizitem lokalem Offset ab
 * (z. B. 2026-10-24T09:00:00+02:00). edoobox V2 liefert und erwartet
 * Zeitstempel mit Offset statt UTC ("Z").
 */
export function isoInBerlin(datum: string, uhrzeit: string): string {
  const [y, m, d] = datum.split('-').map(Number);

  // Offset über einen Mittags-Probezug bestimmen; für die hier genutzten
  // Uhrzeiten (09:00–20:00) ist das auf Nicht-Übergangstagen zuverlässig.
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offset = berlinOffsetMinuten(probe);

  const vorzeichen = offset >= 0 ? '+' : '-';
  const absMinuten = Math.abs(offset);
  const offsetStunden = pad(Math.floor(absMinuten / 60));
  const offsetMinuten = pad(absMinuten % 60);

  return `${datum}T${uhrzeit}:00${vorzeichen}${offsetStunden}:${offsetMinuten}`;
}

/**
 * Anmeldeschluss = Vortag des Kurstermins um 17:00 Uhr Europe/Berlin.
 * Liefert einen ISO-8601-Zeitstempel mit Offset (z. B. 2026-10-25T17:00:00+02:00).
 */
export function berechneAnmeldeschluss(datum: string): string {
  const [y, m, d] = datum.split('-').map(Number);
  const vortag = new Date(Date.UTC(y, m - 1, d - 1));
  const datumStr = `${vortag.getUTCFullYear()}-${pad(vortag.getUTCMonth() + 1)}-${pad(vortag.getUTCDate())}`;
  return isoInBerlin(datumStr, '17:00');
}

// ---------------------------------------------------------------------------
// Kursnummern-Berechnung
// ---------------------------------------------------------------------------

/**
 * Monats-Schlüssel im Format MMJJ, z. B. "1026" für Oktober 2026.
 */
export function monatJJ(datum: string): string {
  return `${datum.slice(5, 7)}${datum.slice(2, 4)}`;
}

/**
 * Kursnummern-Basis (ohne fortlaufenden Index):
 *   [kdnr]-[thema-kuerzel]-[MMJJ]
 */
export function kursnrBasis(kdnr: string, themaKuerzel: string, datum: string): string {
  return `${kdnr}-${themaKuerzel}-${monatJJ(datum)}`;
}

/**
 * Leitet das Themen-Kürzel aus einer edoobox-Angebotsnummer (Vorlage) ab.
 *
 * Vorlagen tragen die Nummer als Kursnummern-Muster:
 *   [kdnr]-[kuerzel]-[MMJJ]      (z. B. "kdnr-xls-gl-m1-1026")
 *   [kdnr]-[kuerzel]-[MMJJ]-N    (z. B. "kdnr-xls-gl-m1-1026-1")
 *   [kdnr]-[kuerzel]-            (Master-Vorlage ohne Monatsstempel, z. B. "kdnr-xls-gl-m1-")
 * wobei "kdnr" ein fester Platzhalter ist, der erst bei der Umwandlung durch
 * die echte Kundennummer ersetzt wird. Zusätzlich werden historische Nummern
 * ohne "kdnr-"-Präfix unterstützt ([kuerzel]-MMJJ bzw. [kuerzel]-MMJJ-N).
 *
 * Liefert null, wenn sich kein Kürzel ableiten lässt.
 */
export function kuerzelAusAngebotsnummer(angebotsnummer: string | null): string | null {
  if (!angebotsnummer) return null;

  let nummer = angebotsnummer.trim();
  if (!nummer) return null;

  // Festen Platzhalter-Präfix entfernen, damit das reine Themen-Kürzel übrig bleibt.
  const kdnrPraefix = 'kdnr-';
  if (nummer.startsWith(kdnrPraefix)) {
    nummer = nummer.slice(kdnrPraefix.length);
  }

  // Muster A: [kuerzel]-MMJJ oder [kuerzel]-MMJJ-N
  const mitDatum = /^(.*?)-(\d{4})(?:-(\d+))?$/.exec(nummer);
  if (mitDatum) {
    const basis = mitDatum[1].trim();
    return basis.length > 0 ? basis : null;
  }

  // Muster B: [kuerzel]- (Master-Vorlage ohne Monatsstempel)
  const ohneDatum = /^(.*?)-$/.exec(nummer);
  if (ohneDatum) {
    const basis = ohneDatum[1].trim();
    return basis.length > 0 ? basis : null;
  }

  return null;
}

/**
 * Escaped einen String für die Verwendung in einem RegExp-Literal.
 */
export function regexEscape(wert: string): string {
  return wert.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ermittelt den kleinsten noch freien kursnr-Index beginnend bei 1.
 * Belegte Indizes werden als Set übergeben (1 = Basisnummer ohne Anhang).
 */
export function naechsterFreierIndex(belegte: ReadonlySet<number>): number {
  let index = 1;
  while (belegte.has(index)) {
    index += 1;
  }
  return index;
}

/**
 * Prüft grob das Format einer fertigen Kursnummer:
 *   [kdnr]-[kuerzel]-[MMJJ]-[index]
 */
export function istGueltigeKursnummer(wert: string): boolean {
  return /^.+-\d{4}-\d+$/.test(wert);
}