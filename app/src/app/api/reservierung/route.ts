import { NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Zulässige Slot-Codes der Planungsansicht. */
type SlotCode = 'KT1' | 'KT2' | 'KT3' | 'ganztags';

/** Zulässige Reservierungs-Status (schlank: angeboten oder bestaetigt). */
type ReservierungStatus = 'angeboten' | 'bestaetigt';

const SLOT_CODES: SlotCode[] = ['KT1', 'KT2', 'KT3', 'ganztags'];
const STATUS_WERTE: ReservierungStatus[] = ['angeboten', 'bestaetigt'];

/** Reservierungs-Datensatz in der API-Antwort. */
interface Reservierung {
  id: number;
  trainer_id: number;
  datum: string;
  slot_code: string;
  kd_nr: string;
  thema: string;
  frist_ende: string;
  status: string;
  notiz: string | null;
}

/** Erwarteter Request-Body für POST/PUT. */
interface ReservierungBody {
  id?: unknown;
  trainer_id?: unknown;
  datum?: unknown;
  slot_code?: unknown;
  kd_nr?: unknown;
  thema?: unknown;
  frist_ende?: unknown;
  status?: unknown;
  notiz?: unknown;
  /** Optionale Liste für Mehrfach-Reservierungen: [{ datum, slot_code }]. */
  termine?: unknown;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Wandelt einen unbekannten DB-Fehler in eine lesbare Meldung um. */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

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
function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/** Trimmt einen String; liefert null bei fehlendem oder leerem Wert. */
function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Wandelt eine DB-Zeile in ein Reservierungsobjekt um. */
function mapReservierung(row: Record<string, unknown>): Reservierung {
  return {
    id: Number(row.id),
    trainer_id: Number(row.trainer_id),
    datum: String(row.datum),
    slot_code: String(row.slot_code),
    kd_nr: String(row.kd_nr),
    thema: String(row.thema),
    frist_ende: String(row.frist_ende),
    status: String(row.status),
    notiz: row.notiz == null ? null : String(row.notiz),
  };
}

/** Termin-unabhängige Stammdaten einer Reservierungs-Serie. */
interface ReservierungStamm {
  trainer_id: number;
  kd_nr: string;
  thema: string;
  frist_ende: string;
  status: ReservierungStatus;
  notiz: string | null;
}

/** Ein einzelner buchbarer Termin innerhalb einer Reservierungs-Serie. */
interface TerminEintrag {
  datum: string;
  slot_code: SlotCode;
}

/**
 * Extrahiert und validiert die termin-unabhängigen Pflichtfelder eines
 * Reservierungs-Bodys. Wirft bei ungültigen Werten einen Error mit Meldung.
 */
function validiereStammfelder(body: ReservierungBody): ReservierungStamm {
  const trainerId = parsePositiveInt(body.trainer_id);
  if (!trainerId) {
    throw new Error('trainer_id muss eine positive Ganzzahl sein.');
  }

  if (!isIsoDatum(body.frist_ende)) {
    throw new Error('frist_ende muss als YYYY-MM-DD übergeben werden.');
  }

  const kdNr = normalizeString(body.kd_nr);
  if (!kdNr) {
    throw new Error('kd_nr (Kundennummer) darf nicht leer sein.');
  }
  if (kdNr.length > 50) {
    throw new Error('kd_nr darf höchstens 50 Zeichen lang sein.');
  }

  const thema = normalizeString(body.thema);
  if (!thema) {
    throw new Error('thema darf nicht leer sein.');
  }
  if (thema.length > 255) {
    throw new Error('thema darf höchstens 255 Zeichen lang sein.');
  }

  const statusValue =
    typeof body.status === 'string' && body.status.trim() !== ''
      ? body.status.trim()
      : 'angeboten';
  if (!STATUS_WERTE.includes(statusValue as ReservierungStatus)) {
    throw new Error("status muss 'angeboten' oder 'bestaetigt' sein.");
  }

  const notiz = normalizeString(body.notiz);

  return {
    trainer_id: trainerId,
    kd_nr: kdNr,
    thema,
    frist_ende: body.frist_ende,
    status: statusValue as ReservierungStatus,
    notiz,
  };
}

/** Validiert datum + slot_code eines Termins. */
function validiereTerminFelder(
  datum: unknown,
  slot_code: unknown
): TerminEintrag {
  if (!isIsoDatum(datum)) {
    throw new Error('datum muss als YYYY-MM-DD übergeben werden.');
  }
  if (
    typeof slot_code !== 'string' ||
    !SLOT_CODES.includes(slot_code as SlotCode)
  ) {
    throw new Error("slot_code muss 'KT1', 'KT2', 'KT3' oder 'ganztags' sein.");
  }
  return { datum: datum as string, slot_code: slot_code as SlotCode };
}

/** Validiert einen Eintrag aus der terminen-Liste. */
function validiereTerminEintrag(value: unknown): TerminEintrag {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      'Jeder Termin muss ein Objekt mit datum und slot_code sein.'
    );
  }
  const rec = value as Record<string, unknown>;
  return validiereTerminFelder(rec.datum, rec.slot_code);
}

/**
 * Extrahiert und validiert die Pflichtfelder eines einzelnen Reservierungs-
 * Bodys (Kompatibilität für PUT und Einzel-POST).
 */
function validierteFelder(
  body: ReservierungBody
): ReservierungStamm & TerminEintrag {
  const stamm = validiereStammfelder(body);
  const termin = validiereTerminFelder(body.datum, body.slot_code);
  return { ...stamm, ...termin };
}

// ---------------------------------------------------------------------------
// GET: Reservierungen abrufen (optional gefiltert nach Trainer + Zeitraum)
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
    whereParts.push(`trainer_id = $${params.length}`);
  }
  if (von) {
    if (!isIsoDatum(von)) {
      return NextResponse.json(
        { error: 'von muss als YYYY-MM-DD übergeben werden.' },
        { status: 400 }
      );
    }
    params.push(von);
    whereParts.push(`datum >= $${params.length}::date`);
  }
  if (bis) {
    if (!isIsoDatum(bis)) {
      return NextResponse.json(
        { error: 'bis muss als YYYY-MM-DD übergeben werden.' },
        { status: 400 }
      );
    }
    params.push(bis);
    whereParts.push(`datum <= $${params.length}::date`);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT
         id,
         trainer_id,
         to_char(datum, 'YYYY-MM-DD')      AS datum,
         slot_code,
         kd_nr,
         thema,
         to_char(frist_ende, 'YYYY-MM-DD') AS frist_ende,
         status,
         notiz
       FROM public.termin_reservierung
       ${whereSql}
       ORDER BY datum ASC, slot_code ASC, id ASC`,
      params
    );

    const reservierungen: Reservierung[] = result.rows.map(
      (row: Record<string, unknown>) => mapReservierung(row)
    );

    return NextResponse.json({ reservierungen }, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Laden der Reservierungen:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Reservierungen.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST: Neue Reservierung anlegen
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  let body: ReservierungBody;
  try {
    body = (await request.json()) as ReservierungBody;
  } catch {
    return NextResponse.json({ error: 'Ungültiger JSON-Body.' }, { status: 400 });
  }

  let stamm: ReservierungStamm;
  try {
    stamm = validiereStammfelder(body);
  } catch (err: unknown) {
    return NextResponse.json({ error: toErrorMessage(err) }, { status: 400 });
  }

  // Termine: entweder ein Array (Mehrfach-Reservierung) oder ein Einzeltermin
  // über die bisherigen Felder datum + slot_code.
  let termine: TerminEintrag[];
  const rohTermine = body.termine;
  if (rohTermine !== undefined && rohTermine !== null) {
    if (!Array.isArray(rohTermine) || rohTermine.length === 0) {
      return NextResponse.json(
        { error: 'termine muss ein nicht-leeres Array von Terminen sein.' },
        { status: 400 }
      );
    }
    try {
      termine = rohTermine.map((wert) => validiereTerminEintrag(wert));
    } catch (err: unknown) {
      return NextResponse.json({ error: toErrorMessage(err) }, { status: 400 });
    }
  } else {
    try {
      termine = [validiereTerminFelder(body.datum, body.slot_code)];
    } catch (err: unknown) {
      return NextResponse.json({ error: toErrorMessage(err) }, { status: 400 });
    }
  }

  const insertSql = `INSERT INTO public.termin_reservierung
     (trainer_id, datum, slot_code, kd_nr, thema, frist_ende, status, notiz)
   VALUES
     ($1, $2::date, $3, $4, $5, $6::date, $7, $8)
   RETURNING
     id,
     trainer_id,
     to_char(datum, 'YYYY-MM-DD')      AS datum,
     slot_code,
     kd_nr,
     thema,
     to_char(frist_ende, 'YYYY-MM-DD') AS frist_ende,
     status,
     notiz`;

  try {
    const angelegt = await transaction(async (client) => {
      const ergebnisse: Reservierung[] = [];
      for (const termin of termine) {
        const res = await client.query(insertSql, [
          stamm.trainer_id,
          termin.datum,
          termin.slot_code,
          stamm.kd_nr,
          stamm.thema,
          stamm.frist_ende,
          stamm.status,
          stamm.notiz,
        ]);
        ergebnisse.push(mapReservierung(res.rows[0]));
      }
      return ergebnisse;
    });

    // Einzeltermin antwortet wie bisher mit einem Objekt, Mehrfachtermine mit
    // einer Liste, damit bestehende Frontends kompatibel bleiben.
    return NextResponse.json(
      angelegt.length === 1 ? angelegt[0] : { reservierungen: angelegt },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error('Fehler beim Anlegen der Reservierung:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Anlegen der Reservierung.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT: Bestehende Reservierung aktualisieren
// ---------------------------------------------------------------------------

export async function PUT(request: Request) {
  let body: ReservierungBody;
  try {
    body = (await request.json()) as ReservierungBody;
  } catch {
    return NextResponse.json({ error: 'Ungültiger JSON-Body.' }, { status: 400 });
  }

  const id = parsePositiveInt(body.id);
  if (!id) {
    return NextResponse.json(
      { error: 'id muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }

  let felder;
  try {
    felder = validierteFelder(body);
  } catch (err: unknown) {
    return NextResponse.json({ error: toErrorMessage(err) }, { status: 400 });
  }

  try {
    const result = await query(
      `UPDATE public.termin_reservierung
       SET trainer_id = $1,
           datum      = $2::date,
           slot_code  = $3,
           kd_nr      = $4,
           thema      = $5,
           frist_ende = $6::date,
           status     = $7,
           notiz      = $8,
           updated_at = NOW()
       WHERE id = $9
       RETURNING
         id,
         trainer_id,
         to_char(datum, 'YYYY-MM-DD')      AS datum,
         slot_code,
         kd_nr,
         thema,
         to_char(frist_ende, 'YYYY-MM-DD') AS frist_ende,
         status,
         notiz`,
      [
        felder.trainer_id,
        felder.datum,
        felder.slot_code,
        felder.kd_nr,
        felder.thema,
        felder.frist_ende,
        felder.status,
        felder.notiz,
        id,
      ]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: 'Reservierung nicht gefunden.' },
        { status: 404 }
      );
    }

    return NextResponse.json(mapReservierung(result.rows[0]), { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Aktualisieren der Reservierung:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Aktualisieren der Reservierung.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE: Reservierung löschen (id als Query-Parameter oder im Body)
// ---------------------------------------------------------------------------

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  let id = parsePositiveInt(searchParams.get('id'));

  if (!id) {
    // Fallback: id aus dem JSON-Body lesen.
    try {
      const body = (await request.json()) as ReservierungBody;
      id = parsePositiveInt(body.id);
    } catch {
      id = null;
    }
  }

  if (!id) {
    return NextResponse.json(
      { error: 'id muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }

  try {
    const result = await query(
      `DELETE FROM public.termin_reservierung WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: 'Reservierung nicht gefunden.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Löschen der Reservierung:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Löschen der Reservierung.' },
      { status: 500 }
    );
  }
}