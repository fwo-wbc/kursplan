import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/kursplan/[id]
// Einzelner Termin der gemeinsamen Planungstabelle.
//
// PUT    { datum?, beginn?, topic_id?, prio?, hinweis?, freigabe?,
//          sync_status?, edoobox_offer_id? }
//        -> Termin aktualisieren. Belegungsregel (UNIQUE
//           (planungsbereich, datum, prio)) wird bei Änderungen geprüft.
// DELETE -> Termin löschen (physisch, public-Schema – kein Soft-Delete-Zwang).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

const SYNC_STATUS = ['offen', 'uebertragen', 'fehler'];

/**
 * Formatiert ein Datum als YYYY-MM-DD. node-pg liefert date-Spalten als
 * Date-Objekt um Mitternacht LOKALER Zeit (z. B. 2027-01-11T00:00:00+01:00
 * = 2027-01-10T23:00:00Z). String(date) bzw. die UTC-Komponenten würden
 * daher einen Tag zurückversetzen. Es werden die lokalen Komponenten
 * verwendet.
 */
function formatDatum(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function validDatum(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  return value;
}

function validBeginn(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${m[1]}:${m[2]}:00`;
}

function toBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    if (value === '1' || value.toLowerCase() === 'true') return true;
    if (value === '0' || value.toLowerCase() === 'false') return false;
  }
  return null;
}

// ---------------------------------------------------------------------------
// PUT – Termin aktualisieren
// ---------------------------------------------------------------------------

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Ungültige Termin-ID.' }, { status: 400 });
    }

    const raw = (await req.json().catch(() => null)) as {
      datum?: unknown;
      beginn?: unknown;
      topic_id?: unknown;
      prio?: unknown;
      hinweis?: unknown;
      freigabe?: unknown;
      sync_status?: unknown;
      edoobox_offer_id?: unknown;
    } | null;

    if (!raw) {
      return NextResponse.json({ error: 'Ungültiger Request-Body.' }, { status: 400 });
    }

    const existing = await query(
      `SELECT id, planungsbereich, datum, prio FROM public.kursplan_termin WHERE id = $1`,
      [id]
    );
    if (existing.rowCount === 0) {
      return NextResponse.json({ error: 'Termin nicht gefunden.' }, { status: 404 });
    }
    const akt = existing.rows[0] as Record<string, unknown>;
    const planungsbereich = String(akt.planungsbereich);

    const datum = raw.datum !== undefined ? validDatum(raw.datum) : undefined;
    const beginn = raw.beginn !== undefined ? validBeginn(raw.beginn) : undefined;
    const topicId =
      raw.topic_id !== undefined
        ? typeof raw.topic_id === 'number' && Number.isInteger(raw.topic_id)
          ? raw.topic_id
          : null
        : undefined;
    const prio =
      raw.prio !== undefined
        ? typeof raw.prio === 'number' && Number.isInteger(raw.prio) &&
          raw.prio >= 1 && raw.prio <= 3
          ? raw.prio
          : null
        : undefined;
    const hinweis =
      raw.hinweis !== undefined
        ? raw.hinweis === null
          ? null
          : typeof raw.hinweis === 'string'
            ? raw.hinweis.trim() || null
            : undefined
        : undefined;
    const freigabe = raw.freigabe !== undefined ? toBool(raw.freigabe) : undefined;
    const syncStatus =
      raw.sync_status !== undefined
        ? typeof raw.sync_status === 'string' && SYNC_STATUS.includes(raw.sync_status)
          ? raw.sync_status
          : null
        : undefined;
    const edooboxOfferId =
      raw.edoobox_offer_id !== undefined
        ? raw.edoobox_offer_id === null
          ? null
          : typeof raw.edoobox_offer_id === 'string'
            ? raw.edoobox_offer_id.trim() || null
            : undefined
        : undefined;

    if (datum === null) {
      return NextResponse.json({ error: 'datum muss ein gültiges Datum sein.' }, { status: 400 });
    }
    if (beginn === null) {
      return NextResponse.json({ error: 'beginn muss eine gültige Uhrzeit sein.' }, { status: 400 });
    }
    if (topicId === null) {
      return NextResponse.json({ error: 'topic_id muss eine gültige Themen-ID sein.' }, { status: 400 });
    }
    if (prio === null) {
      return NextResponse.json({ error: 'prio muss 1, 2 oder 3 sein.' }, { status: 400 });
    }
    if (hinweis === undefined) {
      return NextResponse.json({ error: 'hinweis muss ein String oder null sein.' }, { status: 400 });
    }
    if (freigabe === null) {
      return NextResponse.json({ error: 'freigabe muss ein boolescher Wert sein.' }, { status: 400 });
    }
    if (syncStatus === null) {
      return NextResponse.json(
        { error: `sync_status muss einer der Werte ${SYNC_STATUS.join(', ')} sein.` },
        { status: 400 }
      );
    }
    if (raw.edoobox_offer_id !== undefined && edooboxOfferId === undefined) {
      return NextResponse.json(
        { error: 'edoobox_offer_id muss ein String oder null sein.' },
        { status: 400 }
      );
    }

    // Belegungsregel prüfen, wenn datum oder prio geändert werden.
    const neuesDatum = datum ?? formatDatum(akt.datum);
    const neuePrio = prio ?? Number(akt.prio);
    if (datum !== undefined || prio !== undefined) {
      const belegt = await query(
        `SELECT id FROM public.kursplan_termin
          WHERE planungsbereich = $1 AND datum = $2 AND prio = $3 AND id <> $4`,
        [planungsbereich, neuesDatum, neuePrio, id]
      );
      if ((belegt.rowCount ?? 0) > 0) {
        return NextResponse.json(
          { error: `Am ${neuesDatum} ist im Bereich ${planungsbereich} bereits ein Kurs mit Priorität ${neuePrio} geplant.` },
          { status: 409 }
        );
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (datum !== undefined) {
      updates.push(`datum = $${paramIndex++}`);
      values.push(datum);
    }
    if (beginn !== undefined) {
      updates.push(`beginn = $${paramIndex++}`);
      values.push(beginn);
    }
    if (topicId !== undefined) {
      updates.push(`topic_id = $${paramIndex++}`);
      values.push(topicId);
    }
    if (prio !== undefined) {
      updates.push(`prio = $${paramIndex++}`);
      values.push(prio);
    }
    if (hinweis !== undefined) {
      updates.push(`hinweis = $${paramIndex++}`);
      values.push(hinweis);
    }
    if (freigabe !== undefined) {
      updates.push(`freigabe = $${paramIndex++}`);
      values.push(freigabe);
    }
    if (syncStatus !== undefined) {
      updates.push(`sync_status = $${paramIndex++}`);
      values.push(syncStatus);
    }
    if (edooboxOfferId !== undefined) {
      updates.push(`edoobox_offer_id = $${paramIndex++}`);
      values.push(edooboxOfferId);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'Es muss mindestens ein Feld angegeben werden.' },
        { status: 400 }
      );
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query(
      `UPDATE public.kursplan_termin
          SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, planungsbereich, datum, beginn, prio, topic_id, hinweis,
                  freigabe, sync_status, edoobox_offer_id, kurs_key`,
      values
    );

    const row = result.rows[0] as Record<string, unknown>;
    const thema = await query(
      `SELECT name FROM public.course_topics WHERE id = $1`,
      [row.topic_id]
    );

    return NextResponse.json(
      {
        id: Number(row.id),
        planungsbereich: String(row.planungsbereich),
        datum: formatDatum(row.datum),
        beginn: String(row.beginn).slice(0, 5),
        prio: Number(row.prio),
        topic_id: Number(row.topic_id),
        thema: thema.rows[0]?.name ?? '',
        hinweis: row.hinweis == null ? null : String(row.hinweis),
        freigabe: Boolean(row.freigabe),
        sync_status: String(row.sync_status),
        edoobox_offer_id: row.edoobox_offer_id == null ? null : String(row.edoobox_offer_id),
        kurs_key: row.kurs_key == null ? null : String(row.kurs_key),
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    if (
      err && typeof err === 'object' &&
      (err as { code?: string }).code === '23505'
    ) {
      return NextResponse.json(
        { error: 'Belegungskonflikt: Für diesen Tag und diese Priorität existiert bereits ein Kurs.' },
        { status: 409 }
      );
    }
    console.error('Fehler beim Aktualisieren des Kursplan-Termins:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Aktualisieren des Kursplan-Termins.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE – Termin löschen
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Ungültige Termin-ID.' }, { status: 400 });
    }

    const result = await query(
      `DELETE FROM public.kursplan_termin WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Termin nicht gefunden.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id }, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Löschen des Kursplan-Termins:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Löschen des Kursplan-Termins.' },
      { status: 500 }
    );
  }
}