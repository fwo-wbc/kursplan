import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { SLOT_ZEITEN } from '@/lib/umwandlung';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Roher DB-Datensatz aus dem Join (eine Zeile je Termin × Zuweisung). */
interface TerminZuweisungRow {
  date_id: string;
  offer_id: string | null;
  date_start: string | null;
  date_end: string | null;
  date_status: string | null;
  /** Roher edoobox-Angebotsstatus (o.status) für die Status-Ableitung. */
  offer_status: string | null;
  offer_name: string | null;
  offer_type: string | null;
  kursnr: string | null;
  teilnehmer: number | null;
  max_plaetze: number | null;
  einnahmen: string | null;
  zuweisung_id: number | null;
  trainer_id: number | null;
  zuweisung_status: string | null;
  zuweisung_notiz: string | null;
  honorar_manuell: string | null;
  trainer_vorname: string | null;
  trainer_nachname: string | null;
  trainer_kuerzel: string | null;
  /** edoobox_admin_id des lokal zugewiesenen Trainers (Vergleich mit Leiter). */
  lokale_edoobox_admin_id: string | null;
  edoo_admin_id: string | null;
  edoo_trainer_id: number | null;
  edoo_trainer_vorname: string | null;
  edoo_trainer_nachname: string | null;
  edoo_trainer_kuerzel: string | null;
  tags: string[] | null;
  termin_datum: string | null;
  start_uhr: number | null;
  end_uhr: number | null;
  /** Persistente Options-Haken aus public.termin_optionen (je date_id). */
  einladungslink: boolean | null;
  last_minute: boolean | null;
  abgerechnet: boolean | null;
}

/** Trainer-Kurzprofil innerhalb einer Zuweisung. */
interface TrainerKurz {
  vorname: string | null;
  nachname: string | null;
  kuerzel: string | null;
}

/** Eine Trainer-Zuweisung. */
interface Zuweisung {
  id: number | null;
  trainer_id: number | null;
  status: string | null;
  notiz: string | null;
  honorar_manuell: number | null;
  quelle?: 'edoobox' | 'lokal';
  trainer: TrainerKurz | null;
}

/** Ein einzelner Termin (offer_date) innerhalb eines Kurses. */
interface KursTermin {
  date_id: string;
  date_start: string | null;
  date_end: string | null;
}

/** Persistente Options-Haken eines Kurses (aggregiert über alle Termine). */
interface KursOptionen {
  einladungslink: boolean;
  last_minute: boolean;
  abgerechnet: boolean;
}

/**
 * Ein Kurs/Angebot (offer) für die API-Antwort. Termine mit identischer
 * Kursnummer (offer_id) werden zu EINER Tabellenzeile zusammengefasst.
 */
interface Kurs {
  offer_id: string | null;
  /** Alle Einzeltermine des Kurses, aufsteigend sortiert. */
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
  offer_status: string | null;
  /** Effektiver Zuweisungsstatus des Kurses (erste Zuweisung). */
  zuweisung_status: string | null;
  /** Verfügbarkeit je aktivem Trainer (trainer_id -> ist_verfuegbar). */
  trainer_verfuegbarkeit: Record<string, boolean>;
  /**
   * Verfügbarkeit des zugewiesenen Trainers für alle Kurstage:
   * null = kein Trainer zugewiesen (oder Status 'keine Zuordnung'),
   * true = zugewiesener Trainer ist für alle Kurstage als 'frei' eingetragen,
   * false = zugewiesener Trainer ist nicht (vollständig) verfügbar.
   */
  trainer_verfuegbar: boolean | null;
  /** Persistente Options-Haken (Einladungslink, Last Minute, abgerechnet). */
  optionen: KursOptionen;
  /** Aktuelles Trainerkürzel der ersten Zuweisung ('n. v.' wenn keiner). */
  trainer_kuerzel?: string | null;
  /** true, wenn der Kurs eine aktive Trainer-Zuweisung besitzt. */
  hat_trainer?: boolean;
}

/**
 * Standard-Rückblick in Tagen, wenn kein ?from= Parameter gesetzt ist.
 * Hält die operative Ansicht performant (letzte 365 Tage bis Zukunft).
 * 365 Tage decken den gesamten historischen Bestand ab (Termine ab
 * Januar 2026) und erlauben das Zurückblättern bis mindestens 01.01.2026.
 */
const STANDARD_RUECKBLICK_TAGE = 365;

/** Liefert den frühesten Termin-Start eines Kurses als Zeitstempel. */
function ersterTerminStart(kurs: Kurs): number {
  const first = kurs.termine[0];
  if (!first || !first.date_start) return Number.MAX_SAFE_INTEGER;
  const zeit = new Date(first.date_start).getTime();
  return Number.isNaN(zeit) ? Number.MAX_SAFE_INTEGER : zeit;
}

/**
 * Lädt aktive Vor-Reservierungen (public.termin_reservierung) und überführt
 * sie in Kurs-Objekte mit dem Status 'Reservierung'. Geladen werden alle
 * gültigen, aktiven Reservierungs-Zustände (Whitelist: 'angeboten',
 * 'bestaetigt', 'reserviert', 'neu'); explizit ausgeschlossen sind
 * stornierte/abgelaufene und Test-Einträge. Diese Reservierungen sind
 * bewusst KEINE edoobox-Angebote (edoobox bleibt Single Source of Truth) –
 * sie werden als zusätzliche Einträge an Monatsübersicht/Kursplanung
 * durchgereicht, damit angefragte Firmenkurse sichtbar sind, bevor sie per
 * P96 in ein Kursangebot umgewandelt werden.
 *
 * Die Slot-Zeiten (KT1/KT2/KT3/ganztags) stammen aus der zentralen
 * Definition SLOT_ZEITEN (lib/umwandlung) und werden als JSON-Parameter
 * übergeben – die DB erzeugt daraus die Berliner date_start/date_end.
 */
async function ladeReservierungen(fromDatum: string | null): Promise<Kurs[]> {
  const slotZeitenJson = JSON.stringify(
    Object.entries(SLOT_ZEITEN).map(([code, z]) => ({
      code,
      von: z.von,
      bis: z.bis,
    }))
  );

  const result = await query(
    `SELECT
       tr.id::text            AS reservierung_id,
       tr.kd_nr,
       tr.thema,
       tr.datum,
       tr.slot_code,
       tr.status              AS reservierung_status,
       t.id                   AS trainer_id,
       t.vorname              AS trainer_vorname,
       t.nachname             AS trainer_nachname,
       t.kuerzel              AS trainer_kuerzel,
       (tr.datum + COALESCE(slot.von, TIME '09:00:00'))
         AT TIME ZONE 'Europe/Berlin' AS date_start,
       (tr.datum + COALESCE(slot.bis, TIME '17:00:00'))
         AT TIME ZONE 'Europe/Berlin' AS date_end
     FROM public.termin_reservierung tr
     LEFT JOIN public.trainer t ON t.id = tr.trainer_id
     -- LEFT JOIN LATERAL statt CROSS JOIN: Schlaegt der Slot-Match fehl
     -- (z. B. abweichende Gross-/Kleinschreibung oder unbekannter
     -- slot_code), bleibt die Reservierung in jedem Fall erhalten. Die
     -- Zeiten fallen dann ueber COALESCE auf 09:00-17:00 Uhr zurueck.
     LEFT JOIN LATERAL (
       SELECT (z->>'von')::time AS von,
              (z->>'bis')::time AS bis
       FROM jsonb_array_elements($2::jsonb) AS z
       WHERE LOWER(z->>'code') = LOWER(tr.slot_code)
     ) slot ON TRUE
     WHERE tr.status IN ('angeboten', 'bestaetigt', 'reserviert', 'neu')
       -- Harte Filterung analog zu den edoobox-Kursen (o.name NOT ILIKE
       -- '%test%'): Test-Eintraege (Thema enthaelt 'Test', case-insensitiv)
       -- werden bereits auf Datenbankebene ausgeschlossen und erscheinen
       -- niemals in Kursplanung/Kalender.
       AND tr.thema NOT ILIKE '%test%'
       AND tr.datum >= COALESCE(
             $1::date,
             (NOW() - ($3::int * INTERVAL '1 day'))::date
           )
     ORDER BY tr.datum ASC, tr.id ASC`,
    [fromDatum, slotZeitenJson, STANDARD_RUECKBLICK_TAGE]
  );

  const rowsWeltA = result.rows as Record<string, unknown>[];

  // Welt B: Unverbindliche Trainer-Reservierungen (public.trainer_reservierung).
  // Diese Reservierungen hängen direkt an einem Trainer (nicht an einem
  // edoobox-Offer) – der LEFT JOIN auf public.trainer liefert das
  // Trainerprofil. Start/Ende setzen sich aus datum + start_time/end_time
  // (TZ Europe/Berlin) zusammen, analog zu Welt A.
  const resultB = await query(
    `SELECT
       tr.id::text            AS reservierung_id,
       tr.trainer_id,
       tr.kunde,
       t.vorname              AS trainer_vorname,
       t.nachname             AS trainer_nachname,
       t.kuerzel              AS trainer_kuerzel,
       (tr.datum + tr.start_time)
         AT TIME ZONE 'Europe/Berlin' AS date_start,
       (tr.datum + tr.end_time)
         AT TIME ZONE 'Europe/Berlin' AS date_end
     FROM public.trainer_reservierung tr
     LEFT JOIN public.trainer t ON t.id = tr.trainer_id
     WHERE tr.datum >= COALESCE(
             $1::date,
             (NOW() - ($2::int * INTERVAL '1 day'))::date
           )
     ORDER BY tr.datum ASC, tr.id ASC`,
    [fromDatum, STANDARD_RUECKBLICK_TAGE]
  );

  const rowsWeltB = resultB.rows as Record<string, unknown>[];

  // Gemeinsame Überführung einer Roh-Zeile in eine Reservierungs-Kursstruktur
  // mit genau einem Termin. Beide Welten teilen sich exakt dieses Muster –
  // unterschieden nur durch die ID-Präfixe der entity-Bereiche.
  const baueKurs = (
    row: Record<string, unknown>,
    praefixOffer: string,
    praefixDate: string
  ): Kurs => {
    const trainerId = row.trainer_id !== null ? Number(row.trainer_id) : null;
    const kuerzel = String(row.trainer_kuerzel ?? '').trim();
    const vorname = String(row.trainer_vorname ?? '').trim();
    const nachname = String(row.trainer_nachname ?? '').trim();
    return {
      offer_id: `${praefixOffer}${String(row.reservierung_id)}`,
      termine: [
        {
          date_id: `${praefixDate}${String(row.reservierung_id)}`,
          // pg liefert timestamptz als Date-Objekt; toJSON() erzeugt den
          // ISO-8601-String (UTC), exakt wie JSON.stringify es für die
          // edoobox-Termine tut – die Monatsübersicht formatiert dann in
          // Europe/Berlin.
          date_start:
            row.date_start !== null ? (row.date_start as Date).toJSON() : null,
          date_end:
            row.date_end !== null ? (row.date_end as Date).toJSON() : null,
        },
      ],
      date_status: 'Reservierung',
      offer_status: null,
      // Welt A liefert 'thema', Welt B 'kunde' – beides fällt auf den
      // gemeinsamen Anzeigenamen.
      offer_name: String(row.thema ?? row.kunde ?? 'Reservierung'),
      offer_type: null,
      kursnr: row.kd_nr !== null ? String(row.kd_nr) : null,
      teilnehmer: 0,
      max_plaetze: null,
      einnahmen: 0,
      tags: [],
      zuweisungen:
        trainerId !== null
          ? [
              {
                id: null,
                trainer_id: trainerId,
                status: 'Reservierung',
                notiz: null,
                honorar_manuell: null,
                quelle: 'lokal' as const,
                trainer: {
                  vorname: vorname !== '' ? vorname : null,
                  nachname: nachname !== '' ? nachname : null,
                  kuerzel: kuerzel !== '' ? kuerzel : null,
                },
              },
            ]
          : [],
      zuweisung_status: 'Reservierung',
      trainer_verfuegbarkeit: {},
      trainer_verfuegbar: null,
      optionen: {
        einladungslink: false,
        last_minute: false,
        abgerechnet: false,
      },
      trainer_kuerzel: kuerzel !== '' ? kuerzel : 'n. v.',
      hat_trainer: trainerId !== null,
    } as Kurs;
  };

  // Beide Reservierungs-Welten zusammenführen und zurückgeben: zuerst
  // Welt A (termin_reservierung), dann Welt B (trainer_reservierung).
  return [
    ...rowsWeltA.map((row) => baueKurs(row, 'reservierung-', 'res-')),
    ...rowsWeltB.map((row) => baueKurs(row, 'trainer-res-', 'tres-')),
  ];
}

// ---------------------------------------------------------------------------
// Verfügbarkeits-Slots gemäß S-01 des Lastenhefts (konsistent zur Route
// /api/verfuegbarkeit): Vormittag = HT/K1/K2, Nachmittag = K3/K4, Ganztags =
// beide. Ein Trainer gilt für einen Kurs als verfügbar, wenn für alle
// Kurstermine sämtliche benötigten Slots mit Status 'frei' eingetragen sind.
// ---------------------------------------------------------------------------

const VM_SLOTS = ['HT', 'K1', 'K2'];
const NM_SLOTS = ['K3', 'K4'];
const TAG_SLOTS = [...VM_SLOTS, ...NM_SLOTS];
const STATUS_FREI = 'frei';

/** Uhrzeit- und Datumszusatzinformationen eines Termins (Europe/Berlin). */
interface TerminMeta {
  datum: string | null;
  startUhr: number | null;
  endUhr: number | null;
}

/** Uhrzeit (Dezimalstunden) der Mittagsgrenze zwischen VM und NM. */
const MITTAG_GRENZE = 13;

/**
 * Ermittelt die für einen Termin benötigten Verfügbarkeits-Slots anhand der
 * Berliner Uhrzeiten. Endet ein Termin spätestens um 13:00 Uhr, gilt er als
 * Vormittag; beginnt er frühestens um 13:00 Uhr, als Nachmittag. Liegt er
 * über die Mittagsgrenze hinweg, werden beide Tageshälften benötigt.
 */
function benoetigteSlots(startUhr: number | null, endUhr: number | null): string[] {
  if (startUhr === null && endUhr === null) {
    return TAG_SLOTS;
  }
  if (startUhr !== null && endUhr !== null) {
    if (endUhr <= MITTAG_GRENZE) return VM_SLOTS;
    if (startUhr >= MITTAG_GRENZE) return NM_SLOTS;
    return TAG_SLOTS;
  }
  if (startUhr !== null) {
    return startUhr < MITTAG_GRENZE ? VM_SLOTS : NM_SLOTS;
  }
  return (endUhr as number) <= MITTAG_GRENZE ? VM_SLOTS : NM_SLOTS;
}

/**
 * Prüft, ob ein Trainer für alle Termine eines Kurses als frei eingetragen ist.
 * Alle benötigten Slots jedes Kurstages müssen den Status 'frei' besitzen.
 */
function istTrainerVerfuegbar(
  kurs: Kurs,
  terminMeta: Map<string, TerminMeta>,
  trainerId: number,
  freiSet: Set<string>
): boolean {
  if (kurs.termine.length === 0) return false;

  for (const termin of kurs.termine) {
    const meta = terminMeta.get(termin.date_id);
    if (!meta || !meta.datum) return false;

    const slots = benoetigteSlots(meta.startUhr, meta.endUhr);
    for (const slot of slots) {
      if (!freiSet.has(`${trainerId}|${meta.datum}|${slot}`)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Lädt die Verfügbarkeiten aller aktiven Trainer für den relevanten
 * Datumsbereich und schreibt jedem Kurs die Map trainer_id -> ist_verfuegbar.
 */
async function ladeTrainerVerfuegbarkeiten(
  kurse: Kurs[],
  terminMeta: Map<string, TerminMeta>
): Promise<void> {
  let minDatum: string | null = null;
  let maxDatum: string | null = null;

  for (const kurs of kurse) {
    for (const termin of kurs.termine) {
      const datum = terminMeta.get(termin.date_id)?.datum ?? null;
      if (!datum) continue;
      if (minDatum === null || datum < minDatum) minDatum = datum;
      if (maxDatum === null || datum > maxDatum) maxDatum = datum;
    }
  }

  // Ohne auswertbare Termine bleiben alle Trainer als nicht verfügbar markiert.
  if (minDatum === null || maxDatum === null) {
    for (const kurs of kurse) kurs.trainer_verfuegbarkeit = {};
    return;
  }

  const trainerResult = await query(
    `SELECT id FROM public.trainer WHERE is_active = true ORDER BY id`
  );
  const aktiveTrainerIds: number[] = trainerResult.rows.map(
    (row: Record<string, unknown>) => Number(row.id)
  );

  if (aktiveTrainerIds.length === 0) {
    for (const kurs of kurse) kurs.trainer_verfuegbarkeit = {};
    return;
  }

  const verfResult = await query(
    `SELECT trainer_id,
            to_char(datum, 'YYYY-MM-DD') AS datum,
            slot_code,
            status
     FROM public.trainer_verfuegbarkeit
     WHERE trainer_id = ANY($1::int[])
       AND datum >= $2::date
       AND datum <= $3::date
       AND slot_code = ANY($4::text[])`,
    [aktiveTrainerIds, minDatum, maxDatum, TAG_SLOTS]
  );

  const freiSet = new Set<string>();
  for (const row of verfResult.rows) {
    const status = String((row as Record<string, unknown>).status ?? '');
    if (status === STATUS_FREI) {
      freiSet.add(
        `${Number((row as Record<string, unknown>).trainer_id)}|${String(
          (row as Record<string, unknown>).datum
        )}|${String((row as Record<string, unknown>).slot_code)}`
      );
    }
  }

  for (const kurs of kurse) {
    const map: Record<string, boolean> = {};
    for (const trainerId of aktiveTrainerIds) {
      map[String(trainerId)] = istTrainerVerfuegbar(
        kurs,
        terminMeta,
        trainerId,
        freiSet
      );
    }
    kurs.trainer_verfuegbarkeit = map;
  }
}

// ---------------------------------------------------------------------------
// Automatische Absage verknüpfter Trainer-Zuweisungen für geschlossene oder
// abgesagte edoobox-Kurse. Läuft vor jedem Laden der Terminübersicht, damit
// die Zuweisungs-Status in der Oberfläche stets aktuell sind.
// ---------------------------------------------------------------------------
async function aktualisiereAbgesagteZuweisungen(): Promise<void> {
  // Nur echte Stornierungen/Schließungen (Status '3' = Geschlossen,
  // '5' = Abgesagt) sowie Archiv-/Lösch-Flags werten eine Zuweisung als
  // abgesagt. Status '4' (Freigegeben) ist bewusst NICHT enthalten.
  await query(
    `UPDATE public.trainer_zuweisung z
     SET status = 'abgesagt',
         updated_at = NOW()
     FROM edoobox_raw.offer_date od
     JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
     WHERE z.date_id = od.date_id
       AND (o.status IN ('3', '5')
            OR o.is_archived IS TRUE
            OR o.is_deleted IS TRUE
            OR od.is_deleted IS TRUE)
       AND z.status IN ('ausgeschrieben', 'unter Vorbehalt')`
  );
}

/**
 * Leitet den effektiven Zuweisungsstatus eines Kurses ab – exakt konsistent
 * zur Trainerverfügbarkeit (/api/verfuegbarkeit): Ein in edoobox abgesagter
 * Kurs (Status '5') sowie ein geschlossener Kurs (Status '3') ohne gebuchte
 * Teilnehmer gelten als 'abgesagt'. Eine manuelle Zuweisung (tz.status) wird
 * dadurch überschrieben, damit abgesagte/geschlossene Angebote in der
 * Kursplanung zuverlässig als abgesagt erscheinen.
 */
function effektiverZuweisungsstatus(
  offerStatus: string | null,
  teilnehmer: number,
  bisherigerStatus: string | null
): string {
  if (
    offerStatus === '5' ||
    offerStatus === '0' ||
    (offerStatus === '3' && teilnehmer === 0)
  ) {
    return 'abgesagt';
  }

  // Schutz-Bedingung (Exklusivität): Die Automatik darf den Zuweisungsstatus
  // NUR dann ändern, wenn er exakt 'ausgeschrieben' ist (bzw. leer / keine
  // Zuordnung). Liegt bereits ein anderer Status vor (manuell gesetzt,
  // 'bestätigt', 'unter Vorbehalt' …), bleibt er unangetastet.
  const automatischBerechtigt =
    bisherigerStatus === null ||
    bisherigerStatus === 'keine Zuordnung' ||
    bisherigerStatus === 'ausgeschrieben';

  if (!automatischBerechtigt) {
    return bisherigerStatus ?? 'ausgeschrieben';
  }

  // Stufe 2: 2 oder mehr Anmeldungen → 'bestätigt'.
  if (teilnehmer >= 2) {
    return 'bestätigt';
  }

  // Stufe 1: genau 1 Anmeldung → 'unter Vorbehalt'.
  if (teilnehmer === 1) {
    return 'unter Vorbehalt';
  }

  // Keine Anmeldungen → 'ausgeschrieben' (Standard).
  return 'ausgeschrieben';
}

// ---------------------------------------------------------------------------
// GET: Anstehende Kurse inkl. Angebotsdaten und Trainer-Zuweisungen.
//      Termine mit gleicher offer_id werden zu einem Kurs gruppiert.
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    // Optionaler Stichtag ?from=YYYY-MM-DD: Termine ab diesem Datum laden.
    // Ohne Parameter greift der Standard-Rückblick (60 Tage).
    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get('from');

    let fromDatum: string | null = null;
    if (fromParam) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam)) {
        return NextResponse.json(
          {
            error:
              'Ungültiger from-Parameter. Erwartet wird das Format YYYY-MM-DD.',
          },
          { status: 400 }
        );
      }
      fromDatum = fromParam;
    }

    // Verknüpfte Zuweisungen geschlossener/abgesagter Kurse automatisch auf
    // 'abgesagt' setzen, bevor die Übersicht geladen wird.
    await aktualisiereAbgesagteZuweisungen();

    const result = await query(
      `SELECT
         od.date_id,
         od.offer_id,
         od.date_start,
         od.date_end,
         CASE
           WHEN o.status = '1' THEN 'Veröffentlicht'
           WHEN o.status = '2' THEN 'Garantierte Durchführung'
           WHEN o.status = '4' THEN 'Freigegeben'
           WHEN o.status = '3' THEN 'Geschlossen'
           WHEN o.status = '5' THEN 'Abgesagt'
           ELSE COALESCE(o.status, 'Unbekannt')
         END                 AS date_status,
         o.status            AS offer_status,
         o.name              AS offer_name,
         o.offer_type,
         o.offer_number     AS kursnr,
         COALESCE(e.teilnehmer, 0)                 AS teilnehmer,
         COALESCE(e.einnahmen, 0)::numeric         AS einnahmen,
         o.user_maximum            AS max_plaetze,
         tz.id               AS zuweisung_id,
         tz.trainer_id,
         tz.status           AS zuweisung_status,
         tz.notiz            AS zuweisung_notiz,
         tz.honorar_manuell  AS honorar_manuell,
         t.vorname           AS trainer_vorname,
         t.nachname          AS trainer_nachname,
         COALESCE(t.kuerzel, 'n. v.') AS trainer_kuerzel,
         t.edoobox_admin_id  AS lokale_edoobox_admin_id,
         dl.admin_id         AS edoo_admin_id,
         edoo_t.id           AS edoo_trainer_id,
         edoo_t.vorname      AS edoo_trainer_vorname,
         edoo_t.nachname     AS edoo_trainer_nachname,
         edoo_t.kuerzel      AS edoo_trainer_kuerzel,
         COALESCE((
           SELECT array_agg(DISTINCT tg.name ORDER BY tg.name)
           FROM edoobox_raw.tag tg
           WHERE tg.is_deleted IS NOT TRUE
             AND tg.tag_id IN (
               SELECT tag_obj.obj->>'tag'
               FROM jsonb_array_elements(
                      CASE
                        WHEN jsonb_typeof(o.payload->'tags') = 'array'
                          THEN o.payload->'tags'
                        ELSE '[]'::jsonb
                      END
                    ) AS tag_obj(obj)
             )
         ), '{}')          AS tags,
         opt.einladungslink,
         opt.last_minute,
         opt.abgerechnet,
         to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS termin_datum,
         (EXTRACT(HOUR FROM (od.date_start AT TIME ZONE 'Europe/Berlin'))
           + EXTRACT(MINUTE FROM (od.date_start AT TIME ZONE 'Europe/Berlin')) / 60.0)::double precision AS start_uhr,
         (EXTRACT(HOUR FROM (od.date_end AT TIME ZONE 'Europe/Berlin'))
           + EXTRACT(MINUTE FROM (od.date_end AT TIME ZONE 'Europe/Berlin')) / 60.0)::double precision AS end_uhr
       FROM edoobox_raw.offer_date od
       LEFT JOIN edoobox_raw.offer o
              ON od.offer_id = o.offer_id
       -- Erloes und Teilnehmer je Angebot direkt aus den Buchungspositionen.
       -- Die Einstufung erfolgt regelbasiert ueber kursplan.einstufung
       -- (Nachholer/Inklusive tragen keinen Erloes, Stornogebuehren tragen
       -- Erloes, aber keinen Teilnehmer usw.).
       --
       -- Stornierungen werden auf zwei Ebenen verlaesslich herausgefiltert:
       --   (1) Booking-Ebene: b.status = 'gebucht' schliesst 'storniert' und
       --       'warteliste' aus; zusaetzlich wird b.is_deleted geprueft.
       --       Eine komplett stornierte Buchung (z. B. 134 EUR netto) besitzt
       --       in der Spiegelung KEINE booking_position-Zeilen mehr und traegt
       --       hier ohnehin nichts bei.
       --   (2) Position-Ebene: booking_position hat zwar kein eigenes
       --       Stornierungs-Flag, aber die Spiegelung hinterlaesst bei einer
       --       Umbenennung der Preiskategorie (Lastenheft K-10a, z. B.
       --       "Last Minute" -> "Last-Minute-Preis (-10%)") fuer denselben
       --       Platz Duplikat-Zeilen mit gleicher Einstufungsklasse und
       --       gleichem Nettobetrag. Diese werden ueber DISTINCT ON
       --       (booking, Klasse, Betrag) auf die juengste Position reduziert,
       --       damit derselbe Platz nicht doppelt gezaehlt wird.
       LEFT JOIN LATERAL (
              WITH pos AS (
                SELECT
                  b.booking_id,
                  p.quantity,
                  p.amount_net,
                  p.last_synced_at,
                  COALESCE(a.ist_erloes,     st.ist_erloes)     AS ist_erloes,
                  COALESCE(a.ist_teilnehmer, st.ist_teilnehmer) AS ist_teilnehmer,
                  st.quelle                                     AS klassenschluessel
                FROM edoobox_raw.booking b
                JOIN edoobox_raw.booking_position p
                  ON p.booking_id = b.booking_id
                CROSS JOIN LATERAL kursplan.einstufung(p.pricecategory_name, p.amount_net)
                       AS st(ist_erloes, ist_teilnehmer, quelle)
                LEFT JOIN kursplan.preiskategorie_ausnahme a
                  ON a.offer_id = b.offer_id
                 AND a.pricecategory_name = p.pricecategory_name
                WHERE b.offer_id = od.offer_id
                  AND b.is_deleted IS NOT TRUE
                  AND b.status = 'gebucht'
                  -- (3) Veraltete Positionen: Wechselt die Preiskategorie einer
                  --     Buchung nachtraeglich (z. B. "Standard Preis" ->
                  --     "Kombibuchung (-5%)"), bleibt die alte Position in der
                  --     Spiegelung liegen, wird aber nicht mehr mitgeliefert und
                  --     behaelt ihr aelteres last_synced_at. Es zaehlen nur
                  --     Positionen aus dem juengsten Spiegelungslauf je Buchung.
                  AND p.last_synced_at = (
                    SELECT MAX(p2.last_synced_at)
                    FROM edoobox_raw.booking_position p2
                    WHERE p2.booking_id = p.booking_id
                  )
             ),
              dedup AS (
                SELECT DISTINCT ON (booking_id, klassenschluessel, amount_net)
                       quantity, amount_net, ist_erloes, ist_teilnehmer
                FROM pos
                ORDER BY booking_id, klassenschluessel, amount_net,
                         last_synced_at DESC NULLS LAST, quantity DESC
              )
              SELECT
                COALESCE(SUM(quantity)
                  FILTER (WHERE ist_teilnehmer), 0)::int          AS teilnehmer,
                COALESCE(SUM(amount_net * quantity)
                  FILTER (WHERE ist_erloes), 0)::numeric          AS einnahmen
              FROM dedup
            ) e ON true
       LEFT JOIN public.termin_optionen opt
              ON od.date_id = opt.date_id
       LEFT JOIN public.trainer_zuweisung tz
              ON od.date_id = tz.date_id
       LEFT JOIN public.trainer t
              ON tz.trainer_id = t.id
       -- Nur die LEITER des juengsten Spiegelungslaufs je Termin heranziehen.
       -- date_leader ist eine n:m-Ablage (date_id, admin_id, last_synced_at);
       -- nach einem Leiterwechsel im Edoobox date.leader[] kann der alte
       -- Leiter als veraltete Zeile liegen bleiben. Ohne Filter wuerde ein
       -- solcher Altbestand (z. B. FW) faelschlich als Fallback-Trainer
       -- auftauchen. Deshalb werden ausschliesslich Admin-Zeilen mit dem
       -- jeweils juengsten last_synced_at beruecksichtigt.
       LEFT JOIN LATERAL (
              SELECT dl2.admin_id
              FROM edoobox_raw.date_leader dl2
              WHERE dl2.date_id = od.date_id
                AND dl2.last_synced_at = (
                  SELECT MAX(dl3.last_synced_at)
                  FROM edoobox_raw.date_leader dl3
                  WHERE dl3.date_id = od.date_id
                )
            ) dl ON true
       LEFT JOIN public.trainer edoo_t
              ON dl.admin_id = edoo_t.edoobox_admin_id
       WHERE od.is_deleted IS NOT TRUE
         AND o.is_deleted IS NOT TRUE
         AND od.date_start >= COALESCE(
               $1::timestamptz,
               NOW() - ($2::int * INTERVAL '1 day')
             )
         AND o.status <> '0'
         -- Harte Filterung: Testkurse (Kursname enthaelt 'Test', case-
         -- insensitiv) werden bereits auf Datenbankebene ausgeschlossen.
         -- Hintergrund-Syncs koennen soft-geloeschte Testdatensaetze immer
         -- wieder neu spiegeln (Edoobox ist Single Source of Truth), deshalb
         -- duerfen sie niemals in Kursplanung/Kalender auftauchen.
         AND o.name NOT ILIKE '%test%'
       -- Deterministische Zuweisungs-Reihenfolge: Bei mehreren Zuweisungen
       -- je Termin (z. B. Altbestaende nach Trainerwechsel) gewinnt stets der
       -- juengste, gueltige Eintrag. Die JS-Deduplizierung (erste Zeile je
       -- trainer_id) erhaelt dadurch garantiert die neueste Zuweisung.
       ORDER BY od.date_start ASC, od.date_id ASC,
                tz.created_at DESC NULLS LAST, tz.id DESC`,
      [fromDatum, STANDARD_RUECKBLICK_TAGE]
    );

    const rows = result.rows as TerminZuweisungRow[];

    // JOIN-Rows nach offer_id (Kurs) gruppieren, da ein Kurs mehrere Termine
    // besitzen kann. Der Join auf date_leader (n:m) bzw. mehrere Zuweisungen
    // koennen Zeilen vervielfachen – lokale Zuweisungen werden ueber die
    // Trainer-ID dedupliziert, edoobox-Leiter ueber die Trainer-ID.
    interface KursBuild {
      kurs: Kurs;
      /** Lokale Zuweisungen (trainer_id -> Zuweisung) als Status-/Honorarquelle. */
      lokaleZuweisungen: Map<number, Zuweisung>;
      edooboxZuweisungen: Map<number, Zuweisung>;
      termineMap: Map<string, KursTermin>;
      /**
       * Kursweit aktive 'n. v.'-Sperre: Mindestens ein Termin trägt eine lokale
       * Zuweisung mit trainer_id NULL und Status 'keine Zuordnung'. Sie
       * unterdrückt sämtliche edoobox-Leiter für den gesamten Kurs.
       */
      aufhebungAktiv: boolean;
    }

    const kursMap = new Map<string, KursBuild>();
    const terminMeta = new Map<string, TerminMeta>();

    for (const row of rows) {
      // Fällt offer_id wider Erwarten aus, wird die date_id als fallback
      // Gruppenschluessel verwendet (Termin bleibt dann einzeln stehen).
      const gruppenSchluessel = row.offer_id ?? row.date_id;

      let build = kursMap.get(gruppenSchluessel);

      if (!build) {
        build = {
          kurs: {
            offer_id: row.offer_id,
            termine: [],
            date_status: row.date_status,
            offer_status: row.offer_status,
            offer_name: row.offer_name,
            offer_type: row.offer_type,
            kursnr: row.kursnr,
            teilnehmer: row.teilnehmer ?? 0,
            max_plaetze: row.max_plaetze ?? null,
            einnahmen: row.einnahmen !== null ? Number(row.einnahmen) : 0,
            tags: row.tags ?? [],
            zuweisungen: [],
            zuweisung_status: null,
            trainer_verfuegbarkeit: {},
            trainer_verfuegbar: null,
            optionen: {
              einladungslink: false,
              last_minute: false,
              abgerechnet: false,
            },
          },
          lokaleZuweisungen: new Map<number, Zuweisung>(),
          edooboxZuweisungen: new Map<number, Zuweisung>(),
          termineMap: new Map<string, KursTermin>(),
          aufhebungAktiv: false,
        };
        kursMap.set(gruppenSchluessel, build);
      }

      // Options-Haken über alle Termine des Kurses aggregieren (OR-Logik):
      // Ist die Option an mindestens einem Termin gesetzt, gilt sie für den
      // gesamten Kurs. Fehlende Zeilen in termin_optionen bleiben false.
      if (row.einladungslink === true) build.kurs.optionen.einladungslink = true;
      if (row.last_minute === true) build.kurs.optionen.last_minute = true;
      if (row.abgerechnet === true) build.kurs.optionen.abgerechnet = true;

      // Einzeltermin genau einmal aufnehmen und Metadaten für die
      // Verfügbarkeitsprüfung (Berliner Datum & Uhrzeit) festhalten.
      if (!build.termineMap.has(row.date_id)) {
        build.termineMap.set(row.date_id, {
          date_id: row.date_id,
          date_start: row.date_start,
          date_end: row.date_end,
        });
        terminMeta.set(row.date_id, {
          datum: row.termin_datum,
          startUhr: row.start_uhr,
          endUhr: row.end_uhr,
        });
      }

      // Lokale Zuweisung: Nur relevant, wenn der zugewiesene Trainer dem
      // edoobox-Leiter entspricht (dann liefert sie Status/Honorar/Notiz fuer
      // den Leiter). Da diese Abfrage ausschliesslich bestehende edoobox-
      // Termine (od.date_id) liefert, wird ein veralteter Eintrag aus
      // public.trainer_zuweisung bei fehlendem edoobox-Leiter (dl.admin_id
      // ist null, z. B. Trainer in edoobox entzogen) NICHT als Trainer
      // uebernommen – der Kurs bleibt dann 'n. v.'. Der Fallback auf lokale
      // Zuweisungen gilt nur fuer rein lokale Termine, die diese Abfrage
      // nicht liefert.
      const passtZuLeiter =
        row.edoo_admin_id !== null &&
        row.lokale_edoobox_admin_id !== null &&
        row.lokale_edoobox_admin_id === row.edoo_admin_id;

      // Lokale 'n. v.'-Aufhebung: Eine Zuweisungszeile mit Status 'keine
      // Zuordnung' markiert den Kurs als bewusst ohne Trainer zu führen
      // (die Zeile trägt weiterhin die trainer_id des zuletzt zugewiesenen
      // Trainers, da trainer_id NOT NULL ist). Sie überschreibt die
      // edoobox-Leiter (primäre Trainerquelle) für den gesamten Kurs –
      // unabhängig davon, ob date_leader den letzten Trainer noch einmal
      // spiegelt (Trainerwechsel-Rückkanal P98 entfernt den Leiter nur für
      // eine einzelne date_id).
      if (
        row.zuweisung_id !== null &&
        row.zuweisung_status === 'keine Zuordnung'
      ) {
        build.aufhebungAktiv = true;
      }

      if (
        row.zuweisung_id !== null &&
        row.trainer_id !== null &&
        !build.lokaleZuweisungen.has(row.trainer_id) &&
        passtZuLeiter
      ) {
        build.lokaleZuweisungen.set(row.trainer_id, {
          id: row.zuweisung_id,
          trainer_id: row.trainer_id,
          status: effektiverZuweisungsstatus(
            row.offer_status,
            row.teilnehmer ?? 0,
            row.zuweisung_status
          ),
          notiz: row.zuweisung_notiz,
          honorar_manuell:
            row.honorar_manuell !== null ? Number(row.honorar_manuell) : null,
          quelle: 'lokal',
          trainer:
            row.trainer_id !== null
              ? {
                  vorname: row.trainer_vorname,
                  nachname: row.trainer_nachname,
                  kuerzel: row.trainer_kuerzel,
                }
              : null,
        });
      }

      // Edoobox-Leiter als primäre Trainerquelle vormerken. Jeder ueber
      // edoobox_admin_id gematchte Trainer wird pro Kurs genau einmal
      // beruecksichtigt.
      if (
        row.edoo_trainer_id !== null &&
        !build.edooboxZuweisungen.has(row.edoo_trainer_id)
      ) {
        build.edooboxZuweisungen.set(row.edoo_trainer_id, {
          id: null,
          trainer_id: row.edoo_trainer_id,
          // Keine manuelle Neubearbeitung: Der Status einer rein aus edoobox
          // gespiegelten Zuweisung haengt am Kursstatus. Nur "Garantierte
          // Durchführung" (offer.status = '2') darf 'bestätigt' sein, sonst
          // 'ausgeschrieben' (Standard). Abgesagte/geschlossene Kurse ohne
          // Teilnehmer werden konsistent zur Trainerverfügbarkeit überschrieben.
          status: effektiverZuweisungsstatus(
            row.offer_status,
            row.teilnehmer ?? 0,
            row.date_status === 'Garantierte Durchführung' ? 'bestätigt' : 'ausgeschrieben'
          ),
          notiz: 'Aus edoobox gespiegelt',
          honorar_manuell: null,
          quelle: 'edoobox',
          trainer: {
            vorname: row.edoo_trainer_vorname,
            nachname: row.edoo_trainer_nachname,
            kuerzel: row.edoo_trainer_kuerzel,
          },
        });
      }
    }

    // Edoobox-Leiter sind die primäre Trainerquelle. Eine passende lokale
    // Zuweisung (gleicher Trainer) liefert Status/Honorar/Notiz für den
    // Leiter; abweichende Altbestände wurden bereits im Loop verworfen.
    // Existiert kein edoobox-Leiter (dl.admin_id null, z. B. Trainer in
    // edoobox entzogen), wird bewusst KEIN veralteter Trainer aus
    // public.trainer_zuweisung übernommen – der Kurs erscheint als 'n. v.'.
    // Lokale Zuweisungen als Fallback gelten nur für rein lokale Termine,
    // die diese edoobox-Abfrage nicht liefert.
    const kurse: Kurs[] = Array.from(kursMap.values()).map((build) => {
      build.kurs.termine = Array.from(build.termineMap.values()).sort((a, b) => {
        const zeitA = a.date_start ? new Date(a.date_start).getTime() : 0;
        const zeitB = b.date_start ? new Date(b.date_start).getTime() : 0;
        return zeitA - zeitB;
      });

      // Bei einer aktiven 'n. v.'-Sperre (trainer_id NULL / 'keine Zuordnung')
      // bleiben sämtliche edoobox-Leiter unberücksichtigt – der Kurs erscheint
      // als 'n. v.', bis er bewusst neu zugewiesen wird.
      if (build.edooboxZuweisungen.size > 0 && !build.aufhebungAktiv) {
        for (const [trainerId, edooZ] of build.edooboxZuweisungen) {
          const lokal = build.lokaleZuweisungen.get(trainerId);
          if (lokal) {
            edooZ.status = lokal.status;
            edooZ.notiz = lokal.notiz;
            edooZ.honorar_manuell = lokal.honorar_manuell;
          }
          build.kurs.zuweisungen.push(edooZ);
        }
      } else if (!build.aufhebungAktiv) {
        build.kurs.zuweisungen.push(...build.lokaleZuweisungen.values());
      }

      return build.kurs;
    });

    // Aktive Vor-Reservierungen (public.termin_reservierung) als zusätzliche
    // Kurse mit Status 'Reservierung' anhängen – sie sind keine edoobox-
    // Angebote, sollen aber in Monatsübersicht/Kursplanung sichtbar sein.
    const reservierungen = await ladeReservierungen(fromDatum);
    kurse.push(...reservierungen);

    // Kurse nach dem fruehesten Termin-Start sortieren.
    kurse.sort((a, b) => ersterTerminStart(a) - ersterTerminStart(b));

    // Verfügbarkeiten der aktiven Trainer für die jeweiligen Kurszeiträume
    // ermitteln und jedem Kurs als trainer_id -> ist_verfuegbar mitgeben.
    await ladeTrainerVerfuegbarkeiten(kurse, terminMeta);

    // Effektiven Zuweisungsstatus je Kurs ableiten (konsistent zur ersten
    // Zuweisung, wie im Frontend verwendet).
    //
    // WICHTIG: Reservierungen (public.termin_reservierung) behalten ihren im
    // ladeReservierungen()-Mapping gesetzten Zustand unverändert. date_status
    // UND zuweisung_status müssen garantiert als String 'Reservierung'
    // durchgereicht werden – auch ohne zugewiesenen Trainer, sonst würde der
    // Fallback zuweisungen[0]?.status den Zuweisungsstatus auf null absenken.
    for (const kurs of kurse) {
      if (kurs.date_status === 'Reservierung') continue;
      kurs.zuweisung_status = kurs.zuweisungen[0]?.status ?? null;
      const ersteZuweisung = kurs.zuweisungen[0] ?? null;
      kurs.trainer_kuerzel = ersteZuweisung?.trainer?.kuerzel?.trim() || 'n. v.';
      kurs.hat_trainer = ersteZuweisung !== null && ersteZuweisung.trainer_id !== null;
    }

    // trainer_verfuegbar je Kurs ableiten: Ohne relevante Zuweisung (kein
    // Trainer oder Status 'keine Zuordnung') bleibt der Wert null (keine
    // Prüfung nötig). Andernfalls gilt der Kurs nur dann als verfügbar, wenn
    // ALLE zugewiesenen Trainer für sämtliche Kurstage als 'frei' eingetragen
    // sind – fehlende Freigabe/Abwesenheit ergibt false.
    // Abgesagte Kurse (effektiver Status 'abgesagt', edoobox-Status '5') sowie
    // geschlossene Kurse (Status '3') ohne Teilnehmer erzeugen grundsätzlich
    // keine Verfügbarkeitswarnung (trainer_verfuegbar = null).
    for (const kurs of kurse) {
      // Reservierungen lösen keine Verfügbarkeitsprüfung aus – sie sind
      // reine Vor-Reservierungen ohne edoobox-Kurshintergrund.
      if (kurs.zuweisung_status === 'Reservierung') {
        kurs.trainer_verfuegbar = null;
        continue;
      }
      const effektivAbgesagt =
        kurs.zuweisung_status === 'abgesagt' ||
        kurs.offer_status === '5' ||
        (kurs.offer_status === '3' && (kurs.teilnehmer ?? 0) === 0);
      if (effektivAbgesagt) {
        kurs.trainer_verfuegbar = null;
        continue;
      }
      const relevanteZuweisungen = kurs.zuweisungen.filter(
        (z) => z.trainer_id !== null && z.status !== 'keine Zuordnung'
      );
      if (relevanteZuweisungen.length === 0) {
        kurs.trainer_verfuegbar = null;
        continue;
      }
      kurs.trainer_verfuegbar = relevanteZuweisungen.every(
        (z) => kurs.trainer_verfuegbarkeit[String(z.trainer_id)] === true
      );
    }

    return NextResponse.json(kurse, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Laden der Termine:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Termine.' },
      { status: 500 }
    );
  }
}