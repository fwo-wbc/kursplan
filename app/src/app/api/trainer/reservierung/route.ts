import { NextResponse } from 'next/server';
import { PoolClient } from 'pg';
import { query, transaction } from '@/lib/db';
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
  frist_ende: string | null;
  gruppe_code: string | null;
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
  frist_ende?: unknown;
  gruppe_code?: unknown;
  /** Optionale Liste für Multi-Termin-Erfassung: [{ datum, start_time, end_time }]. */
  termine?: unknown;
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

/** Führt eine Abfrage entweder im Transaktions-Client oder im Pool aus. */
function dbQuery(
  client: PoolClient | undefined,
  text: string,
  params?: unknown[]
) {
  return client ? client.query(text, params) : query(text, params);
}

/**
 * Alphabet für den kompakten Gruppencode: bewusst ohne mehrdeutige Zeichen
 * (0/O, 1/I/L), damit der Code gut les- und diktierbar bleibt.
 */
const GRUPPE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Erzeugt einen kompakten Gruppencode der Form "RES-XXXXX". */
function generiereGruppeCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += GRUPPE_ALPHABET[Math.floor(Math.random() * GRUPPE_ALPHABET.length)];
  }
  return `RES-${code}`;
}

/**
 * Erzeugt einen garantiert eindeutigen Gruppencode. Bei einer (sehr seltenen)
 * Kollision wird bis zu fünfmal neu generiert; als letzte Absicherung dient
 * ein zeitbasierter Fallback.
 */
async function generiereEindeutigenGruppeCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = generiereGruppeCode();
    const result = await query(
      `SELECT 1 FROM public.trainer_reservierung
       WHERE gruppe_code = $1::text
       LIMIT 1`,
      [code]
    );
    if ((result.rows.length ?? 0) === 0) return code;
  }
  return `RES-${Date.now().toString(36).toUpperCase()}`;
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
  endTime: string,
  client?: PoolClient
): Promise<boolean> {
  const result = await dbQuery(
    client,
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
  endTime: string,
  ausschliessenId?: number,
  client?: PoolClient
): Promise<boolean> {
  const result = await dbQuery(
    client,
    `SELECT id
     FROM public.trainer_reservierung
     WHERE trainer_id = $1
       AND datum = $2::date
       AND start_time < $4::time
       AND end_time > $3::time
       AND ($5::int IS NULL OR id <> $5::int)
     LIMIT 1`,
    [trainerId, datum, startTime, endTime, ausschliessenId ?? null]
  );
  return (result.rows.length ?? 0) > 0;
}

/** Validiert ein Termin-Objekt (datum, start_time, end_time) und liefert die
 *  normalisierten Werte; wirft bei ungültigen Eingaben einen Error. */
function validiereTermin(
  wert: unknown
): { datum: string; start_time: string; end_time: string } {
  if (!wert || typeof wert !== 'object' || Array.isArray(wert)) {
    throw new Error(
      'Jeder Termin muss ein Objekt mit datum, start_time und end_time sein.'
    );
  }
  const rec = wert as Record<string, unknown>;
  const tDatum = normalizeString(rec.datum);
  const tStart = normalizeString(rec.start_time);
  const tEnde = normalizeString(rec.end_time);
  if (!tDatum || !isIsoDatum(tDatum)) {
    throw new Error('datum muss als YYYY-MM-DD übergeben werden.');
  }
  if (!tStart || !isUhrzeit(tStart)) {
    throw new Error('start_time muss als HH:MM übergeben werden.');
  }
  if (!tEnde || !isUhrzeit(tEnde)) {
    throw new Error('end_time muss als HH:MM übergeben werden.');
  }
  if (tStart >= tEnde) {
    throw new Error('start_time muss vor end_time liegen.');
  }
  return { datum: tDatum, start_time: tStart, end_time: tEnde };
}

/** Spaltenliste für SELECT/RETURNING (inkl. der neuen Felder). */
const RESERVIERUNG_SPALTEN = `
  id,
  trainer_id,
  to_char(datum, 'YYYY-MM-DD') AS datum,
  to_char(start_time, 'HH24:MI') AS start_time,
  to_char(end_time, 'HH24:MI') AS end_time,
  kunde,
  bemerkung,
  to_char(frist_ende, 'YYYY-MM-DD') AS frist_ende,
  gruppe_code,
  created_at`;

/** Mappt eine DB-Zeile auf das TrainerReservierung-Interface. */
function mapZeile(row: Record<string, unknown>): TrainerReservierung {
  return {
    id: Number(row.id),
    trainer_id: Number(row.trainer_id),
    datum: String(row.datum),
    start_time: String(row.start_time),
    end_time: String(row.end_time),
    kunde: String(row.kunde),
    bemerkung: row.bemerkung == null ? null : String(row.bemerkung),
    frist_ende: row.frist_ende == null ? null : String(row.frist_ende),
    gruppe_code: row.gruppe_code == null ? null : String(row.gruppe_code),
    created_at: String(row.created_at),
  };
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
      `SELECT ${RESERVIERUNG_SPALTEN}
       FROM public.trainer_reservierung
       WHERE trainer_id = $1
         AND datum >= $2::date
         AND datum <= $3::date
       ORDER BY datum, start_time`,
      [trainerId, von, bis]
    );

    const reservierungen: TrainerReservierung[] = result.rows.map(
      (row: Record<string, unknown>) => mapZeile(row)
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
//
// Optional können frist_ende (Ablaufdatum) und gruppe_code übergeben werden.
// Wird kein gruppe_code übergeben, erzeugt der Server automatisch einen
// eindeutigen, kompakten Code (z. B. "RES-7K2PQ"). Beim Duplizieren sendet
// der Client den gruppe_code der Original-Reservierung mit – so bleiben
// zusammengehörige Termine als Reservierungsgruppe erkennbar.
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
  const fristEnde = normalizeString(body.frist_ende);
  const gruppeCode = normalizeString(body.gruppe_code);

  // Stammfelder validieren (gelten für alle Termine der Gruppe).
  if (!trainerId) {
    return NextResponse.json(
      { error: 'trainer_id muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }
  if (!kunde) {
    return NextResponse.json(
      { error: 'kunde ist ein Pflichtfeld.' },
      { status: 400 }
    );
  }
  if (fristEnde && !isIsoDatum(fristEnde)) {
    return NextResponse.json(
      { error: 'frist_ende muss als YYYY-MM-DD übergeben werden.' },
      { status: 400 }
    );
  }

  // Termine sammeln: entweder ein Array (Multi-Termin-Erfassung) oder ein
  // Einzeltermin über die bisherigen Felder datum + start_time + end_time.
  let termine: { datum: string; start_time: string; end_time: string }[];
  const rohTermine = body.termine;
  if (rohTermine !== undefined && rohTermine !== null) {
    if (!Array.isArray(rohTermine) || rohTermine.length === 0) {
      return NextResponse.json(
        { error: 'termine muss ein nicht-leeres Array von Terminen sein.' },
        { status: 400 }
      );
    }
    try {
      termine = rohTermine.map((wert) => validiereTermin(wert));
    } catch (err: unknown) {
      return NextResponse.json({ error: toErrorMessage(err) }, { status: 400 });
    }
  } else {
    try {
      termine = [
        validiereTermin({ datum, start_time: startTime, end_time: endTime }),
      ];
    } catch (err: unknown) {
      return NextResponse.json({ error: toErrorMessage(err) }, { status: 400 });
    }
  }

  try {
    // Gruppencode: übergebenen Code übernehmen (Duplizieren) oder neu erzeugen.
    // Der Code gilt für ALLE Termine der Gruppe (Multi-Termin-Erfassung).
    const effektiverGruppeCode =
      gruppeCode ?? (await generiereEindeutigenGruppeCode());

    const angelegt = await transaction(async (client) => {
      const ergebnisse: TrainerReservierung[] = [];
      for (const termin of termine) {
        // Kollisionsprüfung 1: bestätigter Kurs im selben Zeitfenster → 409.
        const kollision = await findeBestaetigteKollision(
          trainerId,
          termin.datum,
          termin.start_time,
          termin.end_time,
          client
        );
        if (kollision) {
          throw new Error(
            'Reservierung nicht möglich: Dozent ist für diesen Zeitraum bereits fest bestätigt.'
          );
        }

        // Kollisionsprüfung 2: bereits existierende Reservierung des Dozenten
        // am selben Tag mit zeitlicher Überschneidung → 409.
        const reservierungsKollision = await findeReservierungsKollision(
          trainerId,
          termin.datum,
          termin.start_time,
          termin.end_time,
          undefined,
          client
        );
        if (reservierungsKollision) {
          throw new Error(
            'Reservierung nicht möglich: Dozent ist für diesen Zeitraum bereits reserviert.'
          );
        }

        const result = await client.query(
          `INSERT INTO public.trainer_reservierung
             (trainer_id, datum, start_time, end_time, kunde, bemerkung, frist_ende, gruppe_code)
           VALUES ($1::int, $2::date, $3::time, $4::time, $5::text, $6::text, $7::date, $8::text)
           RETURNING ${RESERVIERUNG_SPALTEN}`,
          [
            trainerId,
            termin.datum,
            termin.start_time,
            termin.end_time,
            kunde,
            bemerkung,
            fristEnde,
            effektiverGruppeCode,
          ]
        );
        ergebnisse.push(mapZeile(result.rows[0] as Record<string, unknown>));
      }
      return ergebnisse;
    });

    // Einzeltermin antwortet wie bisher mit { reservierung }, Multi-Termin
    // mit { reservierungen: [...] } – so bleiben bestehende Frontends kompatibel.
    return NextResponse.json(
      angelegt.length === 1
        ? { reservierung: angelegt[0] }
        : { reservierungen: angelegt },
      { status: 200 }
    );
  } catch (err: unknown) {
    // Kollisionsmeldungen (409) aus der Transaktion sauber durchreichen.
    const msg = toErrorMessage(err);
    if (msg.startsWith('Reservierung nicht möglich:')) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    console.error('Fehler beim Anlegen der Trainer-Reservierung:', err);
    return NextResponse.json(
      {
        error: 'Datenbankfehler beim Anlegen der Reservierung.',
        detail: msg,
      },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT: Reservierung per ID aktualisieren (Bearbeiten)
//
// Alle Felder außer gruppe_code sind editierbar – der bestehende Gruppencode
// bleibt erhalten, damit zusammengehörige Termine als Reservierungsgruppe
// erkennbar und filterbar bleiben. Die Kollisionsprüfungen schließen die
// eigene ID aus, damit eine unveränderte Reservierung nicht mit sich selbst
// kollidiert.
// ---------------------------------------------------------------------------

export async function PUT(request: Request) {
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
  const fristEnde = normalizeString(body.frist_ende);

  // Pflichtfelder validieren (identisch zu POST).
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
  if (fristEnde && !isIsoDatum(fristEnde)) {
    return NextResponse.json(
      { error: 'frist_ende muss als YYYY-MM-DD übergeben werden.' },
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

    // Kollisionsprüfung 2: andere Reservierung des Dozenten am selben Tag mit
    // zeitlicher Überschneidung → 409 (die eigene ID wird ausgeschlossen).
    const reservierungsKollision = await findeReservierungsKollision(
      trainerId,
      datum,
      startTime,
      endTime,
      id
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
      `UPDATE public.trainer_reservierung
       SET trainer_id = $2::int,
           datum = $3::date,
           start_time = $4::time,
           end_time = $5::time,
           kunde = $6::text,
           bemerkung = $7::text,
           frist_ende = $8::date
       WHERE id = $1::int
       RETURNING ${RESERVIERUNG_SPALTEN}`,
      [
        id,
        trainerId,
        datum,
        startTime,
        endTime,
        kunde,
        bemerkung,
        fristEnde,
      ]
    );

    if ((result.rows.length ?? 0) === 0) {
      return NextResponse.json(
        { error: 'Reservierung nicht gefunden.' },
        { status: 404 }
      );
    }

    const row = result.rows[0] as Record<string, unknown>;
    const reservierung: TrainerReservierung = mapZeile(row);

    return NextResponse.json({ reservierung }, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Aktualisieren der Trainer-Reservierung:', err);
    return NextResponse.json(
      {
        error: 'Datenbankfehler beim Aktualisieren der Reservierung.',
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