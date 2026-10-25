import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { logEvent } from '@/lib/logger';
import {
  RESERVIERUNG_SELECT,
  isIsoDatum,
  mapReservierung,
  parsePositiveInt,
  toErrorObject,
  toErrorMessage,
} from '@/lib/reservations';

// ---------------------------------------------------------------------------
// GET /api/reservations
// Liefert alle Reservierungen (optional gefiltert nach Trainer + Zeitraum)
// inkl. thema, kunde (Kundennummer), frist, trainer (Name), reservation_code
// sowie Datum/Slot.
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trainerId = parsePositiveInt(searchParams.get('trainerId'));
  const von = searchParams.get('von');
  const bis = searchParams.get('bis');

  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (trainerId) {
    params.push(trainerId);
    whereParts.push(`r.trainer_id = $${params.length}`);
  }
  if (von) {
    if (!isIsoDatum(von)) {
      return NextResponse.json(
        { error: 'von muss als YYYY-MM-DD übergeben werden.' },
        { status: 400 }
      );
    }
    params.push(von);
    whereParts.push(`r.datum >= $${params.length}::date`);
  }
  if (bis) {
    if (!isIsoDatum(bis)) {
      return NextResponse.json(
        { error: 'bis muss als YYYY-MM-DD übergeben werden.' },
        { status: 400 }
      );
    }
    params.push(bis);
    whereParts.push(`r.datum <= $${params.length}::date`);
  }

  const whereSql =
    whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT ${RESERVIERUNG_SELECT}
       FROM public.termin_reservierung r
       LEFT JOIN public.trainer t ON t.id = r.trainer_id
       ${whereSql}
       ORDER BY r.datum ASC, r.slot_code ASC, r.id ASC`,
      params
    );

    const reservierungen = result.rows.map((row: Record<string, unknown>) =>
      mapReservierung(row)
    );

    return NextResponse.json({ reservierungen }, { status: 200 });
  } catch (err: unknown) {
    const msg = toErrorMessage(err);
    console.error('Fehler beim Laden der Reservierungen:', err);
    await logEvent('ERROR', 'API_RESERVATIONS', `Fehler beim Laden der Reservierungen: ${msg}`, {
      fehler: toErrorObject(err),
      endpoint: 'GET /api/reservations',
    });
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Reservierungen.' },
      { status: 500 }
    );
  }
}