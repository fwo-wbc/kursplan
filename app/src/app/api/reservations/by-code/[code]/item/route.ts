import { NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db';
import { logEvent } from '@/lib/logger';
import {
  RESERVIERUNG_SELECT,
  STATUS_WERTE,
  ReservierungStatus,
  TerminEintrag,
  isIsoDatum,
  logReservationEvent,
  mapReservierung,
  normalizeString,
  parsePositiveInt,
  toErrorObject,
  toErrorMessage,
  validiereTerminFelder,
} from '@/lib/reservations';

// ---------------------------------------------------------------------------
// POST /api/reservations/by-code/[code]/item
//   Fügt der bestehenden Sammel-Reservierung einen neuen Einzeltermin hinzu.
//   Stammfelder (trainer_id, kunde, thema, frist, status, notiz) werden vom
//   ersten Datensatz des Codes übernommen, sofern sie nicht explizit im Body
//   angegeben werden. Das Hinzufügen wird in reservation_logs protokolliert.
// ---------------------------------------------------------------------------

/** Liest und trimmt den Code aus dem URL-Pfad (params ist in Next.js 15+ ein Promise). */
async function codeAusParams(params: Promise<{ code: string }>): Promise<string> {
  const { code } = await params;
  return code.trim();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = await codeAusParams(params);
  if (!code) {
    return NextResponse.json(
      { error: 'code darf nicht leer sein.' },
      { status: 400 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Ungültiger JSON-Body.' }, { status: 400 });
  }

  let termin: TerminEintrag;
  try {
    termin = validiereTerminFelder(body.datum, body.slot_code);
  } catch (err: unknown) {
    return NextResponse.json({ error: toErrorMessage(err) }, { status: 400 });
  }

  const trainerId = parsePositiveInt(body.trainer_id);
  const thema = normalizeString(body.thema);
  const kunde = normalizeString(body.kunde);
  const frist = typeof body.frist === 'string' ? body.frist.trim() : '';
  const rohStatus =
    typeof body.status === 'string' ? body.status.trim() : '';
  const notiz = normalizeString(body.notiz);

  if (frist && !isIsoDatum(frist)) {
    return NextResponse.json(
      { error: 'frist muss als YYYY-MM-DD übergeben werden.' },
      { status: 400 }
    );
  }
  if (thema !== null && thema.length > 255) {
    return NextResponse.json(
      { error: 'thema darf höchstens 255 Zeichen lang sein.' },
      { status: 400 }
    );
  }
  if (kunde !== null && kunde.length > 50) {
    return NextResponse.json(
      { error: 'kunde darf höchstens 50 Zeichen lang sein.' },
      { status: 400 }
    );
  }

  try {
    const ergebnis = await transaction(async (client) => {
      // Stammdaten vom ersten Datensatz des Codes übernehmen.
      const bestand = await client.query(
        `SELECT
           trainer_id,
           kd_nr,
           thema,
           to_char(frist_ende, 'YYYY-MM-DD') AS frist_ende,
           status,
           notiz
         FROM public.termin_reservierung
         WHERE reservation_code = $1
         ORDER BY id ASC
         LIMIT 1`,
        [code]
      );

      if (bestand.rowCount === 0) {
        return { status: 404, id: null };
      }

      const stamm = bestand.rows[0];
      const effTrainerId = trainerId ?? Number(stamm.trainer_id);
      const effKunde = kunde ?? String(stamm.kd_nr);
      const effThema = thema ?? (stamm.thema == null ? null : String(stamm.thema));
      const effFrist = frist || String(stamm.frist_ende);
      const effStatus = STATUS_WERTE.includes(rohStatus as ReservierungStatus)
        ? rohStatus
        : String(stamm.status);
      const effNotiz = notiz ?? (stamm.notiz == null ? null : String(stamm.notiz));

      const res = await client.query(
        `INSERT INTO public.termin_reservierung
           (trainer_id, datum, slot_code, kd_nr, thema, frist_ende, status, notiz, reservation_code)
         VALUES
           ($1, $2::date, $3, $4, $5, $6::date, $7, $8, $9)
         RETURNING id`,
        [
          effTrainerId,
          termin.datum,
          termin.slot_code,
          effKunde,
          effThema,
          effFrist,
          effStatus,
          effNotiz,
          code,
        ]
      );
      const neueId = Number(res.rows[0].id);

      await logReservationEvent(
        (sql, params) => client.query(sql, params),
        {
          reservation_code: code,
          reservation_id: neueId,
          action: 'APPOINTMENT_ADDED',
          changed_fields: { datum: termin.datum, slot_code: termin.slot_code },
          details: `Neuer Einzeltermin ${termin.datum} (${termin.slot_code}) zur Sammel-Reservierung ${code} hinzugefügt.`,
        }
      );

      return { status: 201, id: neueId };
    });

    if (ergebnis.status === 404) {
      return NextResponse.json(
        { error: 'Keine Reservierungen mit diesem Code gefunden.' },
        { status: 404 }
      );
    }

    const res = await query(
      `SELECT ${RESERVIERUNG_SELECT}
       FROM public.termin_reservierung r
       LEFT JOIN public.trainer t ON t.id = r.trainer_id
       WHERE r.id = $1`,
      [ergebnis.id]
    );

    return NextResponse.json(
      { reservierung: mapReservierung(res.rows[0]) },
      { status: 201 }
    );
  } catch (err: unknown) {
    const msg = toErrorMessage(err);
    console.error('Fehler beim Hinzufügen des Einzeltermins:', err);
    await logEvent('ERROR', 'API_RESERVATIONS', `Fehler beim Hinzufügen des Einzeltermins: ${msg}`, {
      fehler: toErrorObject(err),
      endpoint: `POST /api/reservations/by-code/${code}/item`,
    });
    return NextResponse.json(
      { error: 'Datenbankfehler beim Hinzufügen des Einzeltermins.' },
      { status: 500 }
    );
  }
}