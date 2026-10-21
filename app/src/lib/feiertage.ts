// ---------------------------------------------------------------------------
// Feiertags-Logik für die Dozenten-Planungsansicht.
//
// Berechnet die deutschen gesetzlichen Feiertage dynamisch für ein beliebiges
// Planungsjahr. Berücksichtigt werden ausschließlich Feiertage, die in
// MINDESTENS DREI Bundesländern gesetzlich gelten (Filter-Kriterium der
// Planungsansicht).
//
// Enthalten:
//   Neujahr, Karfreitag, Ostermontag, Christi Himmelfahrt, Pfingstmontag,
//   1. Mai, Fronleichnam, 3. Oktober, Reformationstag, Allerheiligen,
//   1. & 2. Weihnachtstag, Heilige Drei Könige.
//
// Bewusst ausgeschlossen (weniger als drei Bundesländer bzw. nur regional):
//   Buß- und Bettag (nur SN), Augsburger Friedensfest (nur Stadt Augsburg),
//   Mariä Himmelfahrt (nur SL), Internationaler Frauentag (nur BE, MV).
// ---------------------------------------------------------------------------

/** Ein berechneter Feiertag inkl. betroffener Bundesländer. */
export interface Feiertag {
  /** ISO-Datum, z. B. "2026-06-04". */
  datum: string;
  /** Amtliche Bezeichnung, z. B. "Fronleichnam". */
  name: string;
  /** true = bundesweit (alle 16 Länder), false = nur in einzelnen Ländern. */
  bundesweit: boolean;
  /** Offizielle Kürzel der betroffenen Bundesländer (leer bei bundesweit). */
  laender: string[];
  /** Lesbares Kürzel-Label, z. B. "BW, BY, HE, NW, RP, SL" oder "bundesweit". */
  laenderLabel: string;
}

/** Alle 16 Bundesländer-Kürzel (für bundesweite Feiertage). */
const ALLE_BUNDESLAENDER = [
  'BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE',
  'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH',
];

/** Liefert das Datum des Ostersonntags (gregorianischer Computus nach Meeus). */
function ostersonntag(jahr: number): Date {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31); // 3 = März, 4 = April
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(jahr, monat - 1, tag));
}

/** Formatiert ein Date (UTC-basiert) als ISO-Datum YYYY-MM-DD. */
function formatDatum(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const t = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${t}`;
}

/** Addiert Tage auf ein UTC-Datum und liefert ein neues Date. */
function addTage(d: Date, tage: number): Date {
  const neu = new Date(d.getTime());
  neu.setUTCDate(neu.getUTCDate() + tage);
  return neu;
}

/** Erzeugt ein bundesweites Feiertagsobjekt. */
function bundesweit(datum: Date, name: string): Feiertag {
  return {
    datum: formatDatum(datum),
    name,
    bundesweit: true,
    laender: [],
    laenderLabel: 'bundesweit',
  };
}

/** Erzeugt ein regionales Feiertagsobjekt mit expliziter Länderliste. */
function regional(datum: Date, name: string, laender: string[]): Feiertag {
  return {
    datum: formatDatum(datum),
    name,
    bundesweit: false,
    laender,
    laenderLabel: laender.join(', '),
  };
}

/**
 * Liefert alle Feiertage eines Jahres, die in mindestens drei Bundesländern
 * gelten, aufsteigend nach Datum sortiert.
 */
export function feiertageFuerJahr(jahr: number): Feiertag[] {
  const ostern = ostersonntag(jahr);

  const liste: Feiertag[] = [
    // --- Fixe Feiertage ----------------------------------------------------
    bundesweit(new Date(Date.UTC(jahr, 0, 1)), 'Neujahr'),
    regional(new Date(Date.UTC(jahr, 0, 6)), 'Heilige Drei Könige', [
      'BW', 'BY', 'ST',
    ]),
    bundesweit(new Date(Date.UTC(jahr, 4, 1)), '1. Mai'),
    bundesweit(new Date(Date.UTC(jahr, 9, 3)), '3. Oktober'),
    regional(new Date(Date.UTC(jahr, 9, 31)), 'Reformationstag', [
      'BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH',
    ]),
    regional(new Date(Date.UTC(jahr, 10, 1)), 'Allerheiligen', [
      'BW', 'BY', 'NW', 'RP', 'SL',
    ]),
    bundesweit(new Date(Date.UTC(jahr, 11, 25)), '1. Weihnachtstag'),
    bundesweit(new Date(Date.UTC(jahr, 11, 26)), '2. Weihnachtstag'),

    // --- Bewegliche Feiertage (Osterkreis) ----------------------------------
    bundesweit(addTage(ostern, -2), 'Karfreitag'),
    bundesweit(addTage(ostern, 1), 'Ostermontag'),
    bundesweit(addTage(ostern, 39), 'Christi Himmelfahrt'),
    bundesweit(addTage(ostern, 50), 'Pfingstmontag'),
    regional(addTage(ostern, 60), 'Fronleichnam', [
      'BW', 'BY', 'HE', 'NW', 'RP', 'SL',
    ]),
  ];

  return liste.sort((a, b) => a.datum.localeCompare(b.datum));
}

/**
 * Liefert alle Feiertage für jedes betroffene Kalenderjahr innerhalb eines
 * Zeitraums, dedupliziert und chronologisch sortiert.
 */
export function feiertageFuerZeitraum(von: string, bis: string): Feiertag[] {
  const startJahr = Number(von.slice(0, 4));
  const endJahr = Number(bis.slice(0, 4));

  const jahre = new Set<number>();
  for (let j = startJahr; j <= endJahr; j++) {
    jahre.add(j);
  }

  const alle: Feiertag[] = [];
  for (const jahr of jahre) {
    alle.push(...feiertageFuerJahr(jahr));
  }

  // Nur Feiertage innerhalb des gewünschten Zeitraums behalten.
  return alle.filter((f) => f.datum >= von && f.datum <= bis);
}

/**
 * Liefert den kompakten Anzeigetext eines Feiertags, z. B.
 * "Fronleichnam (BW, BY, HE, NW, RP, SL)" für regionale Feiertage.
 * Bundesweite Feiertage liefern nur den Namen ohne Kürzel.
 */
export function feiertagLabel(feiertag: Feiertag): string {
  return feiertag.bundesweit
    ? feiertag.name
    : `${feiertag.name} (${feiertag.laenderLabel})`;
}

/**
 * Liefert die europäischen Zeitumstellungen (MEZ ↔ MESZ) eines Jahres als
 * Map ISO-Tag → Anzeigetext. Die Termine werden rein kalendarisch dynamisch
 * berechnet:
 *  - Beginn der Sommerzeit (MESZ): letzter Sonntag im März (02:00 → 03:00).
 *  - Ende der Sommerzeit (Normalzeit / MEZ): letzter Sonntag im Oktober
 *    (03:00 → 02:00).
 *
 * WICHTIG: Diese Ereignisse sind KEINE gesetzlichen Feiertage und dürfen die
 * lilane Hintergrundfarbe einer Tageszelle NICHT auslösen – sie werden rein
 * informativ als dezent grauer Text angezeigt (analog zu den Faschings-
 * Hinweisen Rosenmontag/Fastnacht in der Monatsübersicht).
 */
export function zeitumstellungHinweiseFuerJahr(
  jahr: number
): Record<string, string> {
  /** Letzter Sonntag des Monats (0-basiert) als ISO-Datum. */
  const letzterSonntagImMonat = (monat: number): string => {
    // Vom letzten Tag des Monats (Tag 0 des Folgemonats) rückwärts bis zum
    // Sonntag laufen – garantiert den letzten Sonntag des Zielmonats.
    let d = new Date(Date.UTC(jahr, monat + 1, 0));
    while (d.getUTCDay() !== 0) {
      // Exakt einen Tag vom tatsächlichen Datum abziehen (Monatsgrenzen
      // werden von Date.UTC automatisch normalisiert).
      d = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1)
      );
    }
    return formatDatum(d);
  };

  return {
    // März (Index 2): letzter Sonntag im März → Beginn Sommerzeit (MESZ).
    [letzterSonntagImMonat(2)]: '⏰ Beginn Sommerzeit (MESZ)',
    // Oktober (Index 9): letzter Sonntag im Oktober → Ende Sommerzeit (MEZ).
    [letzterSonntagImMonat(9)]: '⏰ Ende Sommerzeit (MEZ)',
  };
}