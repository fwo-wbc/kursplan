import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  isIsoDatum,
  monatGrenzen,
  parseTrainerId,
  toErrorMessage,
  persistiereTag,
  TageEintrag,
} from '@/lib/verfuegbarkeit';

interface VerfuegbarkeitRow {
  datum: string;
  slot_code: string;
  status: string;
}

interface KursRow {
  datum: string;
  date_id: string | null;
  kursname: string | null;
  offer_status: string | null;
  zuweisung_status: string | null;
  teilnehmer: number;
  start_time: string | null;
  end_time: string | null;
}

interface ReservierungRow {
  id: number;
  trainer_id: number;
  datum: string;
  start_time: string;
  end_time: string;
  kunde: string;
  bemerkung: string | null;
  frist_ende: string | null;
  gruppe_code: string | null;
}

// ---------------------------------------------------------------------------
// GET: Verfügbarkeiten und Kurstermine eines Trainers innerhalb eines Zeitraums
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trainerId = parseTrainerId(searchParams.get('trainerId'));

  let von = searchParams.get('von');
  let bis = searchParams.get('bis');
  const monat = searchParams.get('monat');

  // Monat ersetzt fehlende von/bis-Angaben (z. B. monat=2026-09).
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
    // 1) Verfügbarkeiten des gewählten Zeitraums.
    const verfResult = await query(
      `SELECT to_char(datum, 'YYYY-MM-DD') AS datum, slot_code, status
       FROM public.trainer_verfuegbarkeit
       WHERE trainer_id = $1 AND datum >= $2::date AND datum <= $3::date
       ORDER BY datum, slot_code`,
      [trainerId, von, bis]
    );

    const verfuegbarkeiten: VerfuegbarkeitRow[] = verfResult.rows.map(
      (row: Record<string, unknown>) => ({
        datum: String(row.datum),
        slot_code: String(row.slot_code),
        status: row.status == null ? '' : String(row.status),
      })
    );

    // 2) Kurstermine des Trainers zur Gegenüberstellung im Kalender. Die
    //    Abfrage startet bewusst bei edoobox_raw.offer_date und hängt NICHT
    //    davon ab, ob bereits eine Zeile in public.trainer_zuweisung existiert:
    //    Ein frisch synchronisierter Kurs (ohne manuelles Anklicken im
    //    Dropdown) erscheint über den edoobox-Leiter (date_leader →
    //    trainer.edoobox_admin_id) mit dem Standardstatus 'ausgeschrieben'.
    //    Das Datum wird explizit in die Zeitzone Europe/Berlin projiziert,
    //    weil date_start als timestamptz gespeichert ist.
    const kursResult = await query(
      `SELECT
         to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS datum,
         od.date_id,
         o.name AS kursname,
         o.status AS offer_status,
         -- Status-Ableitung: Ein in edoobox abgesagter Kurs (Status '5') sowie
         -- ein geschlossener Kurs (Status '3') ohne gebuchte Teilnehmer gelten
         -- als 'abgesagt'. Eine manuelle Zuweisung (tz.status) wird dadurch
         -- überschrieben, damit abgesagte/geschlossene Angebote in der
         -- Trainerverfügbarkeit zuverlässig als abgesagt erscheinen.
         CASE
           WHEN o.status = '5'
             OR (o.status = '3' AND COALESCE(tn.teilnehmer, 0) = 0)
           THEN 'abgesagt'
           ELSE COALESCE(tz.status, 'ausgeschrieben')
         END AS zuweisung_status,
         COALESCE(tn.teilnehmer, 0) AS teilnehmer,
         to_char(od.date_start AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS start_time,
         to_char(od.date_end AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS end_time
       FROM edoobox_raw.offer_date od
       LEFT JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
       -- Gebuchte Teilnehmer des Angebots (Ist-Teilnehmer, konsistent zur
       -- Kursabfrage in /api/trainer/zeitplan): nur nicht gelöschte Buchungen
       -- mit Status 'gebucht' zählen.
       LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(p.quantity), 0)::int AS teilnehmer
              FROM edoobox_raw.booking b
              JOIN edoobox_raw.booking_position p ON p.booking_id = b.booking_id
              WHERE b.offer_id = od.offer_id
                AND b.is_deleted IS NOT TRUE
                AND b.status = 'gebucht'
            ) tn ON true
       -- Lokale Zuweisung des gewünschten Trainers (falls vorhanden). Der
       -- JOIN filtert bereits auf trainer_id, damit ein Kurs mit mehreren
       -- Zuweisungen nicht vervielfacht wird.
       LEFT JOIN public.trainer_zuweisung tz
              ON od.date_id = tz.date_id
             AND tz.trainer_id = $1
       -- edoobox-Leiter als Fallback-Quelle: Nur der Leiter des jüngsten
       -- Spiegelungslaufs je Termin (konsistent zu /api/termine), damit ein
       -- veralteter Leiter nach einem Wechsel nicht fälschlich auftaucht.
       LEFT JOIN LATERAL (
              SELECT dl2.admin_id
              FROM edoobox_raw.date_leader dl2
              WHERE dl2.date_id = od.date_id
                AND dl2.last_synced_at = (
                  SELECT MAX(dl3.last_synced_at)
                  FROM edoobox_raw.date_leader dl3
                  WHERE dl3.date_id = od.date_id
                )
              LIMIT 1
            ) dl ON true
       LEFT JOIN public.trainer edoo_t
              ON dl.admin_id = edoo_t.edoobox_admin_id
       WHERE (od.date_start AT TIME ZONE 'Europe/Berlin')::date BETWEEN $2::date AND $3::date
         AND od.is_deleted IS NOT TRUE
         -- Angebote im Status 'Entwurf' (Code '0') sowie gelöschte Angebote
         -- ausblenden – konsistent zur Kursabfrage in /api/termine.
         AND o.is_deleted IS NOT TRUE
         AND o.status <> '0'
         AND (tz.trainer_id = $1 OR edoo_t.id = $1)
       ORDER BY (od.date_start AT TIME ZONE 'Europe/Berlin')::date, od.date_start`,
      [trainerId, von, bis]
    );

    const kurse: KursRow[] = kursResult.rows.map(
      (row: Record<string, unknown>) => ({
        datum: String(row.datum),
        date_id: row.date_id == null ? null : String(row.date_id),
        kursname: row.kursname == null ? null : String(row.kursname),
        offer_status: row.offer_status == null ? null : String(row.offer_status),
        zuweisung_status:
          row.zuweisung_status == null ? null : String(row.zuweisung_status),
        teilnehmer: Number(row.teilnehmer ?? 0),
        start_time: row.start_time == null ? null : String(row.start_time),
        end_time: row.end_time == null ? null : String(row.end_time),
      })
    );

    // 3) Unverbindliche Trainer-Reservierungen (Firmenanfragen) im Zeitraum.
    const reservResult = await query(
      `SELECT
         id,
         trainer_id,
         to_char(datum, 'YYYY-MM-DD') AS datum,
         to_char(start_time, 'HH24:MI') AS start_time,
         to_char(end_time, 'HH24:MI') AS end_time,
         kunde,
         bemerkung,
         to_char(frist_ende, 'YYYY-MM-DD') AS frist_ende,
         gruppe_code
       FROM public.trainer_reservierung
       WHERE trainer_id = $1
         AND datum >= $2::date
         AND datum <= $3::date
       ORDER BY datum, start_time`,
      [trainerId, von, bis]
    );

    const reservierungen: ReservierungRow[] = reservResult.rows.map(
      (row: Record<string, unknown>) => ({
        id: Number(row.id),
        trainer_id: Number(row.trainer_id),
        datum: String(row.datum),
        start_time: String(row.start_time),
        end_time: String(row.end_time),
        kunde: String(row.kunde),
        bemerkung: row.bemerkung == null ? null : String(row.bemerkung),
        frist_ende: row.frist_ende == null ? null : String(row.frist_ende),
        gruppe_code: row.gruppe_code == null ? null : String(row.gruppe_code),
      })
    );

    return NextResponse.json(
      { verfuegbarkeiten, kurse, reservierungen },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('Fehler beim Laden der Verfügbarkeiten:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Verfügbarkeiten.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST / PUT: Verfügbarkeiten je Tag speichern (Einzeltag oder Batch)
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  return speichereVerfuegbarkeiten(request);
}

export async function PUT(request: Request) {
  return speichereVerfuegbarkeiten(request);
}

async function speichereVerfuegbarkeiten(request: Request) {
  let body: {
    trainerId?: unknown;
    datum?: unknown;
    vm?: unknown;
    nm?: unknown;
    entries?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: 'Ungültiger JSON-Body.' },
      { status: 400 }
    );
  }

  const trainerId = parseTrainerId(body.trainerId);
  if (!trainerId) {
    return NextResponse.json(
      { error: 'trainerId muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }

  // Normalisierung: Entweder ein Array `entries` (Batch) oder ein Einzeltag.
  let eintraege: TageEintrag[];

  if (Array.isArray(body.entries)) {
    eintraege = body.entries.map((e: unknown) => {
      const entry = (e ?? {}) as {
        datum?: unknown;
        vm?: unknown;
        nm?: unknown;
      };
      return {
        datum: String(entry.datum ?? ''),
        vm: Boolean(entry.vm),
        nm: Boolean(entry.nm),
      };
    });
  } else {
    eintraege = [
      {
        datum: String(body.datum ?? ''),
        vm: Boolean(body.vm),
        nm: Boolean(body.nm),
      },
    ];
  }

  if (eintraege.length === 0) {
    return NextResponse.json(
      { error: 'Keine Einträge übermittelt.' },
      { status: 400 }
    );
  }

  for (const eintrag of eintraege) {
    if (!isIsoDatum(eintrag.datum)) {
      return NextResponse.json(
        { error: `Ungültiges Datum: ${eintrag.datum}` },
        { status: 400 }
      );
    }
  }

  try {
    for (const eintrag of eintraege) {
      await persistiereTag(trainerId, eintrag.datum, eintrag.vm, eintrag.nm);
    }
  } catch (err: unknown) {
    console.error('Fehler beim Speichern der Verfügbarkeiten:', err);
    return NextResponse.json(
      { error: `Datenbankfehler beim Speichern: ${toErrorMessage(err)}` },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { success: true, gespeichert: eintraege.length },
    { status: 200 }
  );
}