import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { isIsoDatum, parseTrainerId, toErrorMessage } from '@/lib/verfuegbarkeit';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Datensatz aus public.trainer_reservierung (DB-Rückgabe). */
interface TrainerReservierung {
  id: number;
  trainer_id: number;
  datum: string;
  start_time: string;
  end_time: string;
  kunde: string;
  bemerkung: string | null;
  created_at: string;
}

/** Erwarteter Request-Body für POST. */
interface ReservierungBody {
  trainer_id?: unknown;
  datum?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  kunde?: unknown;
  bemerkung?: unknown;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/**
 * true, wenn der Request über die Admin-Domäne webinarcenter.de (oder lokal
 * zur Entwicklung) eintrifft. Reservierungen sind exklusiv für diesen
 * Personenkreis freigegeben – die Prüfung erfolgt serverseitig über den
 * Host-Header, damit sie nicht durch UI-Manipulation umgangen werden kann.
 */
function istAdminRequest(request: Request): boolean {
  // Port entfernen (z. B. "localhost:3000" -> "localhost"), da der
  // Host-Header bei lokalen Requests den Port mitführt.
  const host = (request.headers.get('host') ?? '').toLowerCase().split(':')[0];
  return host === 'localhost' || host.endsWith('webinarcenter.de');
}

/** Prüft, ob ein String das Format HH:MM besitzt (24-Stunden-Uhrzeit). */
function isUhrzeit(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Trimmt einen String; liefert null bei fehlendem oder leerem Wert. */
function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Prüft, ob für den Trainer am angegebenen Datum bereits eine Zuweisung mit
 * Status 'bestätigt' existiert, deren Zeitfenster sich mit dem neuen Slot
 * (start_time/end_time) überschneidet.
 *
 * Überlappungsregel: bestehender Start < neues Ende UND bestehendes Ende >
 * neuer Start. Gespiegelte edoobox-Termine mit Soft-Delete (is_deleted) werden
 * zwingend ausgeschlossen. Der Status wird bewusst in beiden Schreibweisen
 * ('bestätigt' / 'bestaetigt') geprüft, da die DB-Historie beide Varianten kennt.
 */
async function findeBestaetigteKollision(
  trainerId: number,
  datum: string,
  startTime: string,
  endTime: string
): Promise<boolean> {
  const result = await query(
    `SELECT tz.id
     FROM public.trainer_zuweisung tz
     JOIN edoobox_raw.offer_date od ON od.date_id = tz.date_id
     WHERE tz.trainer_id = $1
       AND (od.date_start AT TIME ZONE 'Europe/Berlin')::date = $2::date
       AND (od.date_start AT TIME ZONE 'Europe/Berlin')::time < $4::time
       AND (od.date_end AT TIME ZONE 'Europe/Berlin')::time > $3::time
       AND od.is_deleted IS NOT TRUE
       AND tz.status IN ('bestätigt', 'bestaetigt')
     LIMIT 1`,
    [trainerId, datum, startTime, endTime]
  );
  return (result.rows.length ?? 0) > 0;
}

/**
 * Prüft, ob für den Trainer am angegebenen Datum bereits eine Reservierung
 * (public.trainer_reservierung) existiert, deren Zeitfenster sich mit dem neuen
 * Slot (start_time/end_time) überschneidet.
 *
 * Überlappungsregel: bestehender Start < neues Ende UND bestehendes Ende >
 * neuer Start. Damit werden doppelte Reservierungen im selben Zeitfenster
 * unterbunden, unabhängig vom Status der Reservierung.
 */
async function findeReservierungsKollision(
  trainerId: number,
  datum: string,
  startTime: string,
  endTime: string
): Promise<boolean> {
  const result = await query(
    `SELECT id
     FROM public.trainer_reservierung
     WHERE trainer_id = $1
       AND datum = $2::date
       AND start_time < $4::time
       AND end_time > $3::time
     LIMIT 1`,
    [trainerId, datum, startTime, endTime]
  );
  return (result.rows.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// GET: Reservierungen eines Trainers innerhalb eines Zeitraums laden
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trainerId = parseTrainerId(searchParams.get('trainer_id'));
  const von = searchParams.get('von');
  const bis = searchParams.get('bis');

  if (!trainerId) {
    return NextResponse.json(
      { error: 'trainer_id muss eine positive Ganzzahl sein.' },
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
    const result = await query(
      `SELECT
         id,
         trainer_id,
         to_char(datum, 'YYYY-MM-DD') AS datum,
         to_char(start_time, 'HH24:MI') AS start_time,
         to_char(end_time, 'HH24:MI') AS end_time,
         kunde,
         bemerkung,
         created_at
       FROM public.trainer_reservierung
       WHERE trainer_id = $1
         AND datum >= $2::date
         AND datum <= $3::date
       ORDER BY datum, start_time`,
      [trainerId, von, bis]
    );

    const reservierungen: TrainerReservierung[] = result.rows.map(
      (row: Record<string, unknown>) => ({
        id: Number(row.id),
        trainer_id: Number(row.trainer_id),
        datum: String(row.datum),
        start_time: String(row.start_time),
        end_time: String(row.end_time),
        kunde: String(row.kunde),
        bemerkung: row.bemerkung == null ? null : String(row.bemerkung),
        created_at: String(row.created_at),
      })
    );

    return NextResponse.json({ reservierungen }, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Laden der Trainer-Reservierungen:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Reservierungen.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST: Reservierung anlegen (mit Kollisionsprüfung gegen bestätigte Kurse)
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // Rollentrennung: Reservierungen nur für Admins (webinarcenter.de).
  if (!istAdminRequest(request)) {
    return NextResponse.json(
      { error: 'Nur für Administratoren (webinarcenter.de) freigegeben.' },
      { status: 403 }
    );
  }

  let body: ReservierungBody;

  try {
    body = (await request.json()) as ReservierungBody;
  } catch {
    return NextResponse.json(
      { error: 'Ungültiger JSON-Body.' },
      { status: 400 }
    );
  }

  const trainerId = parseTrainerId(body.trainer_id);
  const datum = normalizeString(body.datum);
  const startTime = normalizeString(body.start_time);
  const endTime = normalizeString(body.end_time);
  const kunde = normalizeString(body.kunde);
  const bemerkung = normalizeString(body.bemerkung);

  // Pflichtfelder validieren.
  if (!trainerId) {
    return NextResponse.json(
      { error: 'trainer_id muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }
  if (!datum || !isIsoDatum(datum)) {
    return NextResponse.json(
      { error: 'datum muss als YYYY-MM-DD übergeben werden.' },
      { status: 400 }
    );
  }
  if (!startTime || !isUhrzeit(startTime)) {
    return NextResponse.json(
      { error: 'start_time muss als HH:MM übergeben werden.' },
      { status: 400 }
    );
  }
  if (!endTime || !isUhrzeit(endTime)) {
    return NextResponse.json(
      { error: 'end_time muss als HH:MM übergeben werden.' },
      { status: 400 }
    );
  }
  if (startTime >= endTime) {
    return NextResponse.json(
      { error: 'start_time muss vor end_time liegen.' },
      { status: 400 }
    );
  }
  if (!kunde) {
    return NextResponse.json(
      { error: 'kunde ist ein Pflichtfeld.' },
      { status: 400 }
    );
  }

  try {
    // Kollisionsprüfung 1: bestätigter Kurs im selben Zeitfenster → 409.
    const kollision = await findeBestaetigteKollision(
      trainerId,
      datum,
      startTime,
      endTime
    );
    if (kollision) {
      return NextResponse.json(
        {
          error:
            'Reservierung nicht möglich: Dozent ist für diesen Zeitraum bereits fest bestätigt.',
        },
        { status: 409 }
      );
    }

    // Kollisionsprüfung 2: bereits existierende Reservierung des Dozenten am
    // selben Tag mit zeitlicher Überschneidung → 409.
    const reservierungsKollision = await findeReservierungsKollision(
      trainerId,
      datum,
      startTime,
      endTime
    );
    if (reservierungsKollision) {
      return NextResponse.json(
        {
          error:
            'Reservierung nicht möglich: Dozent ist für diesen Zeitraum bereits reserviert.',
        },
        { status: 409 }
      );
    }

    const result = await query(
      `INSERT INTO public.trainer_reservierung
         (trainer_id, datum, start_time, end_time, kunde, bemerkung)
       VALUES ($1::int, $2::date, $3::time, $4::time, $5::text, $6::text)
       RETURNING
         id,
         trainer_id,
         to_char(datum, 'YYYY-MM-DD') AS datum,
         to_char(start_time, 'HH24:MI') AS start_time,
         to_char(end_time, 'HH24:MI') AS end_time,
         kunde,
         bemerkung,
         created_at`,
      [trainerId, datum, startTime, endTime, kunde, bemerkung]
    );

    const row = result.rows[0] as Record<string, unknown>;
    const reservierung: TrainerReservierung = {
      id: Number(row.id),
      trainer_id: Number(row.trainer_id),
      datum: String(row.datum),
      start_time: String(row.start_time),
      end_time: String(row.end_time),
      kunde: String(row.kunde),
      bemerkung: row.bemerkung == null ? null : String(row.bemerkung),
      created_at: String(row.created_at),
    };

    return NextResponse.json({ reservierung }, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Anlegen der Trainer-Reservierung:', err);
    return NextResponse.json(
      {
        error: 'Datenbankfehler beim Anlegen der Reservierung.',
        detail: toErrorMessage(err),
      },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE: Reservierung per ID löschen (Auflösung bei Nichtzustandekommen)
// ---------------------------------------------------------------------------

export async function DELETE(request: Request) {
  // Rollentrennung: Reservierungen nur für Admins (webinarcenter.de).
  if (!istAdminRequest(request)) {
    return NextResponse.json(
      { error: 'Nur für Administratoren (webinarcenter.de) freigegeben.' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const idValue = searchParams.get('id');

  if (!idValue || !/^\d+$/.test(idValue)) {
    return NextResponse.json(
      { error: 'id muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }
  const id = Number(idValue);

  try {
    const result = await query(
      `DELETE FROM public.trainer_reservierung
       WHERE id = $1::int
       RETURNING id`,
      [id]
    );

    if ((result.rows.length ?? 0) === 0) {
      return NextResponse.json(
        { error: 'Reservierung nicht gefunden.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, id }, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Löschen der Trainer-Reservierung:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Löschen der Reservierung.' },
      { status: 500 }
    );
  }
}