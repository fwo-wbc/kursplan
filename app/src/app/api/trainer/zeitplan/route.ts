import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { feiertageFuerZeitraum, feiertagLabel } from '@/lib/feiertage';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Zeitslot der Planungsansicht (KT1 = VM, KT2 = NM, KT3 = Abend). */
type SlotCode = 'KT1' | 'KT2' | 'KT3';

/** Einheitlicher Zuweisungsstatus eines belegten Kurses. */
type KursStatus = 'ausgeschrieben' | 'unter Vorbehalt' | 'bestätigt' | 'abgesagt';

/** Belegter edoobox-Kurs eines Tages innerhalb eines Slots. */
interface KursEintrag {
  slot: SlotCode;
  kursname: string | null;
  status: KursStatus;
  teilnehmer: number;
  zuweisung_status: string | null;
  offer_status: string | null;
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

/** Anzeige-Feiertag eines Tages (ggf. null). */
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
  /** true, wenn der Trainer an diesem Tag eine Freigabe besitzt. */
  freigabe: boolean;
  kurse: KursEintrag[];
  reservierungen: ReservierungEintrag[];
  feiertag: FeiertagEintrag | null;
  betriebsferien: BetriebsferienEintrag[];
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Prüft, ob ein String das Format YYYY-MM-DD besitzt und ein gültiges Datum ist. */
function isIsoDatum(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const datum = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(datum.getTime()) && datum.toISOString().startsWith(value);
}

/** Parst eine positive Ganzzahl; liefert null bei ungültigen Eingaben. */
function parseTrainerId(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const n = Number(trimmed);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/** Liefert den ersten und letzten Tag eines Kalendermonats `YYYY-MM`. */
function monatGrenzen(monat: string): { von: string; bis: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(monat);
  if (!m) {
    return null;
  }
  const jahr = Number(m[1]);
  const monatIndex = Number(m[2]) - 1;
  if (monatIndex < 0 || monatIndex > 11) {
    return null;
  }
  const ersterTag = new Date(Date.UTC(jahr, monatIndex, 1));
  const letzterTag = new Date(Date.UTC(jahr, monatIndex + 1, 0));
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { von: fmt(ersterTag), bis: fmt(letzterTag) };
}

/** Bildet eine Startuhrzeit (Dezimalstunden) auf den Slot der Planung ab. */
function slotFuerStart(startUhr: number | null): SlotCode {
  if (startUhr === null || Number.isNaN(startUhr)) {
    return 'KT1';
  }
  if (startUhr < 13) {
    return 'KT1'; // Vormittag
  }
  if (startUhr < 17) {
    return 'KT2'; // Nachmittag
  }
  return 'KT3'; // Abend
}

/**
 * Leitet den einheitlichen Kursstatus ab:
 * - 'abgesagt'   bei edoobox-Status '0' oder manuell abgesagter Zuweisung
 * - 'bestätigt'  bei manuell bestätigter Zuweisung oder edoobox-Status '2'
 * - 'unter Vorbehalt' sobald mindestens 1 Anmeldung vorliegt
 * - sonst 'ausgeschrieben' (Standard)
 */
function kursStatus(
  offerStatus: string | null,
  zuweisungStatus: string | null,
  teilnehmer: number
): KursStatus {
  if (offerStatus === '0' || zuweisungStatus === 'abgesagt') {
    return 'abgesagt';
  }
  if (zuweisungStatus === 'bestätigt' || offerStatus === '2') {
    return 'bestätigt';
  }
  if (teilnehmer >= 1) {
    return 'unter Vorbehalt';
  }
  return 'ausgeschrieben';
}

/** Erzeugt alle ISO-Datumsangaben zwischen von und bis (jeweils inklusive). */
function alleTage(von: string, bis: string): string[] {
  const tage: string[] = [];
  const start = new Date(`${von}T00:00:00Z`);
  const ende = new Date(`${bis}T00:00:00Z`);
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= ende.getTime()) {
    tage.push(cursor.toISOString().split('T')[0]);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return tage;
}

/** true, wenn ein ISO-Datum auf einen Samstag oder Sonntag fällt. */
function istWochenende(datum: string): boolean {
  const tag = new Date(`${datum}T00:00:00Z`).getUTCDay();
  return tag === 0 || tag === 6;
}

// ---------------------------------------------------------------------------
// GET: Chronologische Jahres-/Quartalsübersicht eines Trainers
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trainerId = parseTrainerId(searchParams.get('trainerId'));

  let von = searchParams.get('von');
  let bis = searchParams.get('bis');
  const monat = searchParams.get('monat');

  // Monat ersetzt fehlende von/bis-Angaben (z. B. monat=2026-11).
  if ((!von || !bis) && monat) {
    const grenzen = monatGrenzen(monat);
    if (!grenzen) {
      return NextResponse.json(
        { error: 'monat muss das Format YYYY-MM haben.' },
        { status: 400 }
      );
    }
    von = grenzen.von;
    bis = grenzen.bis;
  }

  if (!trainerId) {
    return NextResponse.json(
      { error: 'trainerId muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }

  if (!isIsoDatum(von) || !isIsoDatum(bis)) {
    return NextResponse.json(
      { error: 'von und bis müssen als YYYY-MM-DD übergeben werden.' },
      { status: 400 }
    );
  }

  if (von > bis) {
    return NextResponse.json(
      { error: 'von darf nicht nach bis liegen.' },
      { status: 400 }
    );
  }

  try {
    // 1) Trainer-Stammdaten (Kürzel für die Freigabe-Spalte).
    const trainerResult = await query(
      `SELECT id, vorname, nachname, kuerzel
       FROM public.trainer
       WHERE id = $1`,
      [trainerId]
    );

    if (trainerResult.rowCount === 0) {
      return NextResponse.json(
        { error: 'Trainer nicht gefunden.' },
        { status: 404 }
      );
    }
    const trainerRow = trainerResult.rows[0] as {
      id: number;
      vorname: string | null;
      nachname: string | null;
      kuerzel: string | null;
    };

    // 2) Freigaben: Tage, an denen mindestens ein freier Slot besteht.
    const freigabeResult = await query(
      `SELECT DISTINCT to_char(datum, 'YYYY-MM-DD') AS datum
       FROM public.trainer_verfuegbarkeit
       WHERE trainer_id = $1
         AND datum >= $2::date
         AND datum <= $3::date
         AND status = 'frei'`,
      [trainerId, von, bis]
    );
    const freigabeTage = new Set(
      freigabeResult.rows.map((row: Record<string, unknown>) => String(row.datum))
    );

    // 3) Belegte edoobox-Kurse des Trainers, aufgeteilt nach KT1/KT2/KT3.
    const kursResult = await query(
      `SELECT
         to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS datum,
         tz.date_id AS date_id,
         o.name AS kursname,
         o.status AS offer_status,
         tz.status AS zuweisung_status,
         (EXTRACT(HOUR FROM (od.date_start AT TIME ZONE 'Europe/Berlin'))
           + EXTRACT(MINUTE FROM (od.date_start AT TIME ZONE 'Europe/Berlin')) / 60.0)::double precision AS start_uhr,
         COALESCE(tn.teilnehmer, 0) AS teilnehmer
       FROM public.trainer_zuweisung tz
       JOIN edoobox_raw.offer_date od ON od.date_id = tz.date_id
       LEFT JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(p.quantity), 0)::int AS teilnehmer
         FROM edoobox_raw.booking b
         JOIN edoobox_raw.booking_position p ON p.booking_id = b.booking_id
         WHERE b.offer_id = od.offer_id
           AND b.is_deleted IS NOT TRUE
           AND b.status = 'gebucht'
       ) tn ON true
       WHERE tz.trainer_id = $1
         AND (od.date_start AT TIME ZONE 'Europe/Berlin')::date BETWEEN $2::date AND $3::date
         AND od.is_deleted IS NOT TRUE
       ORDER BY datum ASC, start_uhr ASC`,
      [trainerId, von, bis]
    );

    interface KursRoheZeile {
      datum: string;
      date_id: string;
      kursname: string | null;
      offer_status: string | null;
      zuweisung_status: string | null;
      start_uhr: number | null;
      teilnehmer: number | null;
    }

    const kursMap = new Map<string, KursEintrag[]>();
    for (const row of kursResult.rows as KursRoheZeile[]) {
      const datum = String(row.datum);
      const teilnehmer = Number(row.teilnehmer ?? 0);
      const eintrag: KursEintrag = {
        slot: slotFuerStart(row.start_uhr),
        kursname: row.kursname == null ? null : String(row.kursname),
        status: kursStatus(
          row.offer_status == null ? null : String(row.offer_status),
          row.zuweisung_status == null ? null : String(row.zuweisung_status),
          teilnehmer
        ),
        teilnehmer,
        zuweisung_status:
          row.zuweisung_status == null ? null : String(row.zuweisung_status),
        offer_status: row.offer_status == null ? null : String(row.offer_status),
        date_id: String(row.date_id),
      };
      const liste = kursMap.get(datum) ?? [];
      liste.push(eintrag);
      kursMap.set(datum, liste);
    }

    // Menge aller belegten Tage+Slots (gebuchte edoobox-Kurse). Dient dazu,
    // "bestaetigt"-Reservierungen auszublenden, deren Kurs bereits als
    // edoobox-Block im selben Tag/Slot dargestellt wird (keine Duplikate).
    const kursSlotSet = new Set<string>();
    for (const [kursDatum, eintraege] of kursMap.entries()) {
      for (const kurs of eintraege) {
        kursSlotSet.add(`${kursDatum}|${kurs.slot}`);
      }
    }

    // 4) Vor-Reservierungen des Trainers im Zeitraum.
    const reservierungResult = await query(
      `SELECT
         id,
         to_char(datum, 'YYYY-MM-DD')      AS datum,
         slot_code,
         kd_nr,
         thema,
         to_char(frist_ende, 'YYYY-MM-DD') AS frist_ende,
         status,
         notiz
       FROM public.termin_reservierung
       WHERE trainer_id = $1
         AND datum >= $2::date
         AND datum <= $3::date
         AND status <> 'storniert'
       ORDER BY datum ASC, slot_code ASC, id ASC`,
      [trainerId, von, bis]
    );

    const reservierungMap = new Map<string, ReservierungEintrag[]>();
    for (const row of reservierungResult.rows as Record<string, unknown>[]) {
      const datum = String(row.datum);
      const status = String(row.status);
      const slotCode = String(row.slot_code);

      // Bestätigte Reservierungen ausblenden, sobald für denselben Tag+Slot
      // bereits ein gebuchter edoobox-Kurs existiert. Der Kursblock ersetzt dann
      // die Reservierungszeile, damit keine doppelten Einträge entstehen.
      if (status === 'bestaetigt') {
        const hatKurs =
          slotCode === 'ganztags'
            ? (['KT1', 'KT2', 'KT3'] as const).some((s) =>
                kursSlotSet.has(`${datum}|${s}`)
              )
            : kursSlotSet.has(`${datum}|${slotCode}`);
        if (hatKurs) {
          continue;
        }
      }

      const eintrag: ReservierungEintrag = {
        id: Number(row.id),
        slot_code: slotCode,
        kd_nr: String(row.kd_nr),
        thema: String(row.thema),
        frist_ende: String(row.frist_ende),
        status,
        notiz: row.notiz == null ? null : String(row.notiz),
      };
      const liste = reservierungMap.get(datum) ?? [];
      liste.push(eintrag);
      reservierungMap.set(datum, liste);
    }

    // 5) Feiertage (>= 3 Bundesländer) im Zeitraum.
    const feiertagMap = new Map<string, FeiertagEintrag>();
    for (const feiertag of feiertageFuerZeitraum(von, bis)) {
      feiertagMap.set(feiertag.datum, {
        name: feiertag.name,
        laenderLabel: feiertag.laenderLabel,
        label: feiertagLabel(feiertag),
      });
    }

    // 6) Betriebliche Schließzeiten mit Überlappung zum Zeitraum.
    const ferienResult = await query(
      `SELECT
         id,
         bezeichnung,
         to_char(von, 'YYYY-MM-DD') AS von,
         to_char(bis, 'YYYY-MM-DD') AS bis,
         gesperrt
       FROM public.betriebsferien
       WHERE NOT (bis < $1::date OR von > $2::date)
       ORDER BY von ASC`,
      [von, bis]
    );

    const ferienListe: BetriebsferienEintrag[] = ferienResult.rows.map(
      (row: Record<string, unknown>) => ({
        id: Number(row.id),
        bezeichnung: String(row.bezeichnung),
        von: String(row.von),
        bis: String(row.bis),
        gesperrt: Boolean(row.gesperrt),
      })
    );

    // 7) Chronologisches Tagesraster aufbauen.
    const tage: TagEintrag[] = alleTage(von, bis).map((datum) => {
      const betriebsferien = ferienListe.filter(
        (f) => datum >= f.von && datum <= f.bis
      );
      return {
        datum,
        wochenende: istWochenende(datum),
        freigabe: freigabeTage.has(datum),
        kurse: kursMap.get(datum) ?? [],
        reservierungen: reservierungMap.get(datum) ?? [],
        feiertag: feiertagMap.get(datum) ?? null,
        betriebsferien,
      };
    });

    return NextResponse.json(
      {
        trainer: {
          id: Number(trainerRow.id),
          vorname: trainerRow.vorname ?? '',
          nachname: trainerRow.nachname ?? '',
          kuerzel: trainerRow.kuerzel,
        },
        von,
        bis,
        tage,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('Fehler beim Laden des Trainer-Zeitplans:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden des Trainer-Zeitplans.' },
      { status: 500 }
    );
  }
}