import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  ladeTerminKontext,
  parsiereTerminId,
  triggerChangeEvent,
} from '@/lib/notifications';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Einheitlicher Zuweisungsstatus eines Kurses. */
type KursStatus =
  | 'keine Zuordnung'
  | 'ausgeschrieben'
  | 'unter Vorbehalt'
  | 'bestätigt'
  | 'abgesagt';

const ERLAUBTE_STATUS: KursStatus[] = [
  'keine Zuordnung',
  'ausgeschrieben',
  'unter Vorbehalt',
  'bestätigt',
  'abgesagt',
];

// ---------------------------------------------------------------------------
// PATCH: Zuweisungsstatus eines Termins manuell setzen
//        (Disposition: 'bestätigt' / 'abgesagt' / 'ausgeschrieben')
// ---------------------------------------------------------------------------

export async function PATCH(request: Request) {
  let body: { date_id?: unknown; status?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: 'Ungültiger JSON-Body.' },
      { status: 400 }
    );
  }

  const dateId = typeof body.date_id === 'string' ? body.date_id.trim() : '';
  const status = typeof body.status === 'string' ? body.status.trim() : '';

  if (!dateId) {
    return NextResponse.json(
      { error: 'date_id ist erforderlich.' },
      { status: 400 }
    );
  }

  if (!ERLAUBTE_STATUS.includes(status as KursStatus)) {
    return NextResponse.json(
      {
        error:
          "status muss 'keine Zuordnung', 'ausgeschrieben', 'unter Vorbehalt', 'bestätigt' oder 'abgesagt' sein.",
      },
      { status: 400 }
    );
  }

  try {
    // Vorher-Zustand der Zuweisung lesen, um vorher/nachher im Event-Payload
    // sauber abzubilden (Trainer und bisheriger Status vor dem UPDATE).
    const vorherResult = await query(
      `SELECT trainer_id, status
       FROM public.trainer_zuweisung
       WHERE date_id = $1::text`,
      [dateId]
    );
    const vorher = vorherResult.rows[0] as
      | { trainer_id: number | null; status: string | null }
      | undefined;

    const result = await query(
      `UPDATE public.trainer_zuweisung
       SET status = $2::text,
           updated_at = NOW()
       WHERE date_id = $1::text
       RETURNING id, date_id, trainer_id, status`,
      [dateId, status]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: 'Keine Zuweisung für diese date_id gefunden.' },
        { status: 404 }
      );
    }

    // Event-Notification an n8n (non-blocking): Terminstatus wurde manuell
    // geändert ('bestätigt' / 'abgesagt' / 'ausgeschrieben' / …).
    const terminKontext = await ladeTerminKontext([dateId]);
    const kontext = terminKontext.get(dateId);
    const terminId = kontext?.termin_id ?? parsiereTerminId(dateId);
    if (terminId !== null) {
      triggerChangeEvent('TERMIN_STATUS_GEAENDERT', {
        termin_id: terminId,
        kurs_titel: kontext?.kurs_titel ?? 'Reservierung',
        vorher: {
          trainer_id: vorher?.trainer_id ?? null,
          status: vorher?.status ?? null,
        },
        nachher: {
          trainer_id: vorher?.trainer_id ?? null,
          status,
        },
      });
    }

    return NextResponse.json(
      { ok: true, zuweisung: result.rows[0] },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('Fehler beim Setzen des Zuweisungsstatus:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Setzen des Zuweisungsstatus.' },
      { status: 500 }
    );
  }
}