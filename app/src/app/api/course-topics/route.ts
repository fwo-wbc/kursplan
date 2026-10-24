import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/course-topics
// Themenstamm der lokalen App-Daten (public.course_topics).
//
// GET   (Standard)        -> nur aktive Themen (is_active = TRUE), sortiert
//                            nach Name. Wird u. a. für die Checkboxen-Zuordnung
//                            der Trainer und das L-05 Themen-Dropdown genutzt.
// GET   ?includeInactive=1-> alle Themen inkl. derer mit Löschvermerk
//                            (für das Verwaltungs-Modal).
// POST  { name }          -> neues Thema anlegen (idempotent: existiert bereits
//                            ein Thema mit diesem Namen, wird es reaktiviert).
// PATCH { id, name?, is_active? }
//                          -> Thema umbenennen und/oder Löschvermerk
//                            setzen (is_active=false) / entfernen (is_active=true).
// PUT   – identisch zu PATCH.
//
// Löschungen erfolgen NIE per DELETE, sondern ausschließlich über den
// Löschvermerk is_active = false (Soft-Delete) – das schützt die
// Fremdschlüssel-Beziehungen (public.trainer_topics).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

interface TopicRow {
  id: number;
  name: string;
  is_active: boolean;
  created_at: Date;
  kurs_code: string | null;
  kategorie_id: string | null;
  kategorie_name: string | null;
  vorlage_offer_id: string | null;
  prioritaet: number | null;
  rhythmus_wochen: number | null;
  planungsbereich: string | null;
}

const NAME_MAX_LENGTH = 120;

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Bool aus Query-Parameter / JSON-Wert (1, true, 0, false). */
function toBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    if (value === '1' || value.toLowerCase() === 'true') return true;
    if (value === '0' || value.toLowerCase() === 'false') return false;
  }
  return null;
}

/** Trimmt und validiert einen Themennamen. Liefert null bei ungültiger Eingabe. */
function validName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) return null;
  return name;
}

/**
 * Validiert ein optionales Textfeld (kurs_code, kategorie_id, ...).
 * null/leer -> null (Feld leeren); sonst getrimmter String.
 */
function validNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s.length === 0 ? null : s;
}

/** Validiert die Priorität (1–3). null -> null; sonst 1, 2 oder 3. */
function validPrio(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 3) return null;
  return n;
}

/** Validiert den Rhythmus in Wochen (> 0). null -> null; sonst positive Ganzzahl. */
function validRhythmus(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function mapRow(row: Record<string, unknown>): TopicRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    is_active: Boolean(row.is_active),
    created_at: row.created_at as Date,
    kurs_code: row.kurs_code == null ? null : String(row.kurs_code),
    kategorie_id: row.kategorie_id == null ? null : String(row.kategorie_id),
    kategorie_name: row.kategorie_name == null ? null : String(row.kategorie_name),
    vorlage_offer_id: row.vorlage_offer_id == null ? null : String(row.vorlage_offer_id),
    prioritaet: row.prioritaet == null ? null : Number(row.prioritaet),
    rhythmus_wochen: row.rhythmus_wochen == null ? null : Number(row.rhythmus_wochen),
    planungsbereich: row.planungsbereich == null ? null : String(row.planungsbereich),
  };
}

/** Liest ein einzelnes Thema (id + name + is_active). */
async function findTopicById(id: number): Promise<TopicRow | null> {
  const result = await query(
    `SELECT id, name, is_active, created_at, kurs_code, kategorie_id, kategorie_name,
            vorlage_offer_id, prioritaet, rhythmus_wochen, planungsbereich
       FROM public.course_topics
      WHERE id = $1`,
    [id]
  );
  return result.rowCount === 1 ? mapRow(result.rows[0] as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const includeInactive = toBool(url.searchParams.get('includeInactive'));

    const whereClause = includeInactive ? '' : 'WHERE is_active IS TRUE';

    const result = await query(
      `SELECT id, name, is_active, created_at, kurs_code, kategorie_id, kategorie_name,
              vorlage_offer_id, prioritaet, rhythmus_wochen, planungsbereich
         FROM public.course_topics
        ${whereClause}
        ORDER BY name ASC, id ASC`
    );

    const topics = (result.rows as Record<string, unknown>[]).map(mapRow);
    return NextResponse.json(topics, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Laden der Kursthemen:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Kursthemen.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST – neues Thema anlegen (bzw. deaktiviertes Thema reaktivieren)
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const raw = (await req.json().catch(() => null)) as { name?: unknown } | null;
    const name = validName(raw?.name);

    if (!name) {
      return NextResponse.json(
        { error: 'Ein Themenname ist erforderlich.' },
        { status: 400 }
      );
    }

    // Kein UNIQUE-Constraint auf name vorhanden -> Duplikate explizit per
    // SELECT abfangen. Existiert ein Thema mit diesem Namen (aktiv oder mit
    // Löschvermerk), wird es idempotent reaktiviert statt angelegt.
    const existing = await query(
      `SELECT id FROM public.course_topics WHERE name = $1 LIMIT 1`,
      [name]
    );

    const result =
      existing.rowCount === 1
        ? await query(
            `UPDATE public.course_topics
                SET is_active = TRUE
              WHERE id = $1
              RETURNING id, name, is_active, created_at`,
            [Number(existing.rows[0].id)]
          )
        : await query(
            `INSERT INTO public.course_topics (name, is_active)
             VALUES ($1, TRUE)
             RETURNING id, name, is_active, created_at`,
            [name]
          );

    const topic = mapRow(result.rows[0] as Record<string, unknown>);
    return NextResponse.json(topic, { status: 201 });
  } catch (err: unknown) {
    console.error('Fehler beim Anlegen des Kursthemas:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Anlegen des Kursthemas.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH / PUT – umbenennen und/oder Löschvermerk setzen/entfernen
// ---------------------------------------------------------------------------

async function handleUpdate(req: Request) {
  try {
    const raw = (await req.json().catch(() => null)) as {
      id?: unknown;
      name?: unknown;
      is_active?: unknown;
      kurs_code?: unknown;
      kategorie_id?: unknown;
      kategorie_name?: unknown;
      vorlage_offer_id?: unknown;
      prioritaet?: unknown;
      rhythmus_wochen?: unknown;
      planungsbereich?: unknown;
    } | null;

    if (!raw || typeof raw.id !== 'number' || !Number.isInteger(raw.id)) {
      return NextResponse.json(
        { error: 'Eine gültige Themen-ID (id) ist erforderlich.' },
        { status: 400 }
      );
    }

    const id = raw.id;
    const name = raw.name !== undefined ? validName(raw.name) : undefined;
    const isActive = raw.is_active !== undefined ? toBool(raw.is_active) : undefined;
    const kursCode = raw.kurs_code !== undefined ? validNullableString(raw.kurs_code) : undefined;
    const kategorieId = raw.kategorie_id !== undefined ? validNullableString(raw.kategorie_id) : undefined;
    const kategorieName = raw.kategorie_name !== undefined ? validNullableString(raw.kategorie_name) : undefined;
    const vorlageOfferId = raw.vorlage_offer_id !== undefined ? validNullableString(raw.vorlage_offer_id) : undefined;
    const prioritaet = raw.prioritaet !== undefined ? validPrio(raw.prioritaet) : undefined;
    const rhythmusWochen = raw.rhythmus_wochen !== undefined ? validRhythmus(raw.rhythmus_wochen) : undefined;
    const planungsbereich = raw.planungsbereich !== undefined ? validNullableString(raw.planungsbereich) : undefined;

    if (
      name === undefined && isActive === undefined &&
      kursCode === undefined && kategorieId === undefined &&
      kategorieName === undefined && vorlageOfferId === undefined &&
      prioritaet === undefined && rhythmusWochen === undefined &&
      planungsbereich === undefined
    ) {
      return NextResponse.json(
        { error: 'Es muss mindestens ein Feld angegeben werden (name, is_active oder ein Planungsfeld).' },
        { status: 400 }
      );
    }
    if (name === null) {
      return NextResponse.json(
        { error: `Der Themenname darf nicht leer sein und max. ${NAME_MAX_LENGTH} Zeichen enthalten.` },
        { status: 400 }
      );
    }
    if (isActive === null) {
      return NextResponse.json(
        { error: 'is_active muss ein boolescher Wert sein.' },
        { status: 400 }
      );
    }
    if (prioritaet === null) {
      return NextResponse.json(
        { error: 'prioritaet muss 1, 2 oder 3 sein (oder null zum Leeren).' },
        { status: 400 }
      );
    }
    if (rhythmusWochen === null) {
      return NextResponse.json(
        { error: 'rhythmus_wochen muss eine positive Ganzzahl sein (oder null zum Leeren).' },
        { status: 400 }
      );
    }
    if (kursCode === null || kategorieId === null || kategorieName === null ||
        vorlageOfferId === null || planungsbereich === null) {
      return NextResponse.json(
        { error: 'Textfelder (kurs_code, kategorie_id, kategorie_name, vorlage_offer_id, planungsbereich) müssen Strings oder null sein.' },
        { status: 400 }
      );
    }

    const existing = await findTopicById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Das Kursthema wurde nicht gefunden.' },
        { status: 404 }
      );
    }

    // Expliziter Duplikat-Check beim Umbenennen (kein UNIQUE-Constraint in
    // der Datenbank). Aktive wie deaktivierte Themen blockieren denselben Namen.
    if (name !== undefined && name !== existing.name) {
      const dup = await query(
        `SELECT 1 FROM public.course_topics WHERE name = $1 AND id <> $2 LIMIT 1`,
        [name, id]
      );
      if (dup.rowCount === 1) {
        return NextResponse.json(
          { error: 'Dieser Themenname ist bereits vergeben.' },
          { status: 409 }
        );
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(isActive);
    }
    if (kursCode !== undefined) {
      updates.push(`kurs_code = $${paramIndex++}`);
      values.push(kursCode);
    }
    if (kategorieId !== undefined) {
      updates.push(`kategorie_id = $${paramIndex++}`);
      values.push(kategorieId);
    }
    if (kategorieName !== undefined) {
      updates.push(`kategorie_name = $${paramIndex++}`);
      values.push(kategorieName);
    }
    if (vorlageOfferId !== undefined) {
      updates.push(`vorlage_offer_id = $${paramIndex++}`);
      values.push(vorlageOfferId);
    }
    if (prioritaet !== undefined) {
      updates.push(`prioritaet = $${paramIndex++}`);
      values.push(prioritaet);
    }
    if (rhythmusWochen !== undefined) {
      updates.push(`rhythmus_wochen = $${paramIndex++}`);
      values.push(rhythmusWochen);
    }
    if (planungsbereich !== undefined) {
      updates.push(`planungsbereich = $${paramIndex++}`);
      values.push(planungsbereich);
    }

    values.push(id);

    const result = await query(
      `UPDATE public.course_topics
          SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, name, is_active, created_at, kurs_code, kategorie_id, kategorie_name,
                  vorlage_offer_id, prioritaet, rhythmus_wochen, planungsbereich`,
      values
    );

    const topic = mapRow(result.rows[0] as Record<string, unknown>);
    return NextResponse.json(topic, { status: 200 });
  } catch (err: unknown) {
    // 23505 = unique_violation (z. B. Umbenennen auf einen bereits
    // vergebenen Namen, aktives wie deaktiviertes Thema).
    if (
      err &&
      typeof err === 'object' &&
      (err as { code?: string }).code === '23505'
    ) {
      return NextResponse.json(
        { error: 'Dieser Themenname ist bereits vergeben.' },
        { status: 409 }
      );
    }
    console.error('Fehler beim Aktualisieren des Kursthemas:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Aktualisieren des Kursthemas.' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  return handleUpdate(req);
}

export async function PUT(req: Request) {
  return handleUpdate(req);
}