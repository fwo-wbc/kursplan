import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  isIsoDatum,
  monatGrenzen,
  toErrorMessage,
  persistiereTag,
  TageEintrag,
  VerfuegbarkeitSperreError,
} from '@/lib/verfuegbarkeit';
import {
  PORTAL_COOKIE_NAME,
  verifySessionToken,
} from '@/lib/portal-session';

// =============================================================================
// /portal/api/verfuegbarkeit – gesicherte Verfügbarkeits-API des Trainerportals
// -----------------------------------------------------------------------------
// - Jeder Aufruf wird gegen die Portal-Session geprüft (trainer_session-Cookie,
//   Pfad '/portal'). Ungültig oder fehlend → HTTP 401.
// - Die trainer_id stammt AUSSCHLIESSLICH aus der Session. Der Client hat keine
//   Möglichkeit, eine fremde trainer_id zu übergeben – dadurch kann ein Trainer
//   nur die eigenen Verfügbarkeiten lesen und schreiben (kein Tenancy-Bruch).
// - GET:  Verfügbarkeiten + gebuchte Kurse des eingeloggten Trainers im Zeitraum
//         (von/bis bzw. monat, identisches Format wie die Admin-API).
// - POST/PUT: Schreibt/ändert Verfügbarkeiten des eingeloggten Trainers. Die
//         Persistenz nutzt persistiereTag() aus der gemeinsamen Lib: Gebuchte
//         Slots (status <> 'frei') werden niemals überschrieben, und eine
//         Rücknahme durch Reservierungen ist serverseitig gesperrt (409).
// =============================================================================

interface VerfuegbarkeitRow {
  datum: string;
  slot_code: string;
  status: string;
}

interface KursRow {
  datum: string;
  date_id: string | null;
  kursname: string | null;
  kursnr: string | null;
  zuweisung_status: string | null;
  start_time: string | null;
  end_time: string | null;
}

/** Liest die trainer_id aus dem signed 'trainer_session'-Cookie. */
function trainerIdAusRequest(request: Request): number | null {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookies = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean);
  const sessionCookie = cookies.find((c) => c.startsWith(`${PORTAL_COOKIE_NAME}=`));
  if (!sessionCookie) return null;
  const token = sessionCookie.slice(PORTAL_COOKIE_NAME.length + 1);
  const payload = verifySessionToken(token);
  return payload ? payload.tid : null;
}

// ---------------------------------------------------------------------------
// GET: Verfügbarkeiten und Kurstermine des eingeloggten Trainers im Zeitraum
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const sessionTrainerId = trainerIdAusRequest(request);
  if (!sessionTrainerId) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
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
    // 1) Verfügbarkeiten des Trainers im Zeitraum.
    const verfResult = await query(
      `SELECT to_char(datum, 'YYYY-MM-DD') AS datum,
              slot_code,
              status
       FROM public.trainer_verfuegbarkeit
       WHERE trainer_id = $1 AND datum >= $2::date AND datum <= $3::date
       ORDER BY datum, slot_code`,
      [sessionTrainerId, von, bis]
    );

    const verfuegbarkeiten: VerfuegbarkeitRow[] = verfResult.rows.map(
      (row: Record<string, unknown>) => ({
        datum: String(row.datum),
        slot_code: String(row.slot_code),
        status: row.status == null ? '' : String(row.status),
      })
    );

    // 2) Kurstermine des Trainers zur Gegenüberstellung im Kalender – dieselbe
    //    Abfrage wie die Admin-Route /api/verfuegbarkeit (edoobox-Angebote,
    //    lokale Zuweisung + edoobox-Leiter-Fallback als Quellen).
    const kursResult = await query(
      `SELECT
         to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS datum,
         od.date_id,
         o.name AS kursname,
         o.offer_number AS kursnr,
         -- Status-Ableitung (konsistent zur Kursabfrage /api/trainer/zeitplan).
         -- Mindestteilnehmerzahl aus edoobox (o.user_minimal; Fallback 1):
         --   1 bis Mindestanzahl Anmeldungen    → 'unter Vorbehalt'
         --   Mindestanzahl + 1 oder mehr        → 'bestätigt'
         --   0 Anmeldungen                      → bleibt 'ausgeschrieben'
         CASE
           WHEN o.status = '5'
             OR o.status = '0'
             OR (o.status = '3'
                 AND COALESCE(tn.teilnehmer, 0) = 0
                 AND COALESCE(tn.einnahmen, 0) = 0)
           THEN 'abgesagt'
           WHEN tz.status IS NOT NULL
             AND tz.status <> 'ausgeschrieben'
           THEN tz.status
           WHEN COALESCE(tn.teilnehmer, 0) >=
                GREATEST(COALESCE(o.user_minimal, 1), 1) + 1
           THEN 'bestätigt'
           WHEN COALESCE(tn.teilnehmer, 0) >= 1
           THEN 'unter Vorbehalt'
           ELSE COALESCE(tz.status, 'ausgeschrieben')
         END AS zuweisung_status,
         to_char(od.date_start AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS start_time,
         to_char(od.date_end AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS end_time
       FROM edoobox_raw.offer_date od
       LEFT JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
       LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(quantity)
                FILTER (WHERE ist_teilnehmer), 0)::int AS teilnehmer,
                     COALESCE(SUM(amount_net * quantity)
                FILTER (WHERE ist_erloes), 0)::numeric AS einnahmen
              FROM (
                SELECT DISTINCT ON (b.booking_id, st.quelle, p.amount_net)
                       p.quantity, p.amount_net, st.ist_erloes, st.ist_teilnehmer
                FROM edoobox_raw.booking b
                JOIN edoobox_raw.booking_position p ON p.booking_id = b.booking_id
                CROSS JOIN LATERAL kursplan.einstufung(p.pricecategory_name, p.amount_net)
                       AS st(ist_erloes, ist_teilnehmer, quelle)
                WHERE b.offer_id = od.offer_id
                  AND b.is_deleted IS NOT TRUE
                  AND b.status = 'gebucht'
                  AND p.last_synced_at = (
                    SELECT MAX(p2.last_synced_at)
                    FROM edoobox_raw.booking_position p2
                    WHERE p2.booking_id = p.booking_id
                  )
                ORDER BY b.booking_id, st.quelle, p.amount_net,
                         p.last_synced_at DESC NULLS LAST, p.quantity DESC
              ) dedup
            ) tn ON true
       LEFT JOIN public.trainer_zuweisung tz
              ON od.date_id = tz.date_id
             AND tz.trainer_id = $1
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
         AND o.is_deleted IS NOT TRUE
         AND o.status <> '0'
         AND (tz.trainer_id = $1 OR edoo_t.id = $1)
       ORDER BY (od.date_start AT TIME ZONE 'Europe/Berlin')::date, od.date_start`,
      [sessionTrainerId, von, bis]
    );

    const kurse: KursRow[] = kursResult.rows.map((row: Record<string, unknown>) => ({
      datum: String(row.datum),
      date_id: row.date_id == null ? null : String(row.date_id),
      kursname: row.kursname == null ? null : String(row.kursname),
      kursnr: row.kursnr == null ? null : String(row.kursnr),
      zuweisung_status:
        row.zuweisung_status == null ? null : String(row.zuweisung_status),
      start_time: row.start_time == null ? null : String(row.start_time),
      end_time: row.end_time == null ? null : String(row.end_time),
    }));

    return NextResponse.json({ verfuegbarkeiten, kurse }, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Laden der Portal-Verfügbarkeiten:', err);
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
  const sessionTrainerId = trainerIdAusRequest(request);
  if (!sessionTrainerId) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  }

  let body: {
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
      // trainerId aus der Session – der Client kann keine fremde id übergeben.
      await persistiereTag(sessionTrainerId, eintrag.datum, eintrag.vm, eintrag.nm);
    }
  } catch (err: unknown) {
    // Rücknahme-Sperre durch eine Reservierung: HTTP 409 (Konflikt).
    if (err instanceof VerfuegbarkeitSperreError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('Fehler beim Speichern der Portal-Verfügbarkeiten:', err);
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
