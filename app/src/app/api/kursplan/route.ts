import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/kursplan
// Gemeinsame Planungstabelle (public.kursplan_termin) – Ablösung der
// Excel-Planungstabellen.
//
// GET  ?planungsbereich=MS-Office[&von=YYYY-MM-DD][&bis=YYYY-MM-DD]
//      -> Termine des Bereichs (Sicht v_kursplan_termin), sortiert nach
//         Datum, Beginn, Prio.
// POST { planungsbereich, datum, beginn, topic_id, prio, hinweis? }
//      -> Termin anlegen. Belegungsregel: pro Tag und Bereich max. 3 Kurse,
//         einer je Priorität (UNIQUE (planungsbereich, datum, prio)).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

interface KursplanRow {
  id: number;
  planungsbereich: string;
  datum: string;
  beginn: string;
  prio: number;
  topic_id: number;
  thema: string;
  kurs_code: string | null;
  kategorie_id: string | null;
  kategorie_name: string | null;
  vorlage_offer_id: string | null;
  hinweis: string | null;
  freigabe: boolean;
  sync_status: string;
  edoobox_offer_id: string | null;
  kurs_key: string | null;
}

const GUELTIGE_BEREICHE = ['MS-Office', 'MS365', 'SQL', 'werner-sql-lo-office'];

/**
 * Formatiert ein Datum als YYYY-MM-DD. node-pg liefert date-Spalten als
 * Date-Objekt um Mitternacht LOKALER Zeit (z. B. 2027-01-11T00:00:00+01:00
 * = 2027-01-10T23:00:00Z). toISOString() bzw. die UTC-Komponenten würden
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

function mapRow(row: Record<string, unknown>): KursplanRow {
  return {
    id: Number(row.id),
    planungsbereich: String(row.planungsbereich),
    datum: formatDatum(row.datum),
    beginn: String(row.beginn).slice(0, 5),
    prio: Number(row.prio),
    topic_id: Number(row.topic_id),
    thema: String(row.thema),
    kurs_code: row.kurs_code == null ? null : String(row.kurs_code),
    kategorie_id: row.kategorie_id == null ? null : String(row.kategorie_id),
    kategorie_name: row.kategorie_name == null ? null : String(row.kategorie_name),
    vorlage_offer_id: row.vorlage_offer_id == null ? null : String(row.vorlage_offer_id),
    hinweis: row.hinweis == null ? null : String(row.hinweis),
    freigabe: Boolean(row.freigabe),
    sync_status: String(row.sync_status),
    edoobox_offer_id: row.edoobox_offer_id == null ? null : String(row.edoobox_offer_id),
    kurs_key: row.kurs_key == null ? null : String(row.kurs_key),
  };
}

/** Validiert ein Datum im Format YYYY-MM-DD. */
function validDatum(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  return value;
}

/** Validiert eine Uhrzeit HH:MM (oder HH:MM:SS). */
function validBeginn(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${m[1]}:${m[2]}:00`;
}

// ---------------------------------------------------------------------------
// GET – Termine eines Planungsbereichs (optionaler Zeitraum)
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const planungsbereich = url.searchParams.get('planungsbereich');
    const von = url.searchParams.get('von');
    const bis = url.searchParams.get('bis');

    if (!planungsbereich) {
      return NextResponse.json(
        { error: 'Der Query-Parameter planungsbereich ist erforderlich.' },
        { status: 400 }
      );
    }

    const params: unknown[] = [planungsbereich];
    let where = 'WHERE planungsbereich = $1';
    let idx = 2;

    if (von) {
      const v = validDatum(von);
      if (!v) {
        return NextResponse.json(
          { error: 'von muss ein gültiges Datum im Format YYYY-MM-DD sein.' },
          { status: 400 }
        );
      }
      where += ` AND datum >= $${idx++}`;
      params.push(v);
    }
    if (bis) {
      const b = validDatum(bis);
      if (!b) {
        return NextResponse.json(
          { error: 'bis muss ein gültiges Datum im Format YYYY-MM-DD sein.' },
          { status: 400 }
        );
      }
      where += ` AND datum <= $${idx++}`;
      params.push(b);
    }

    const result = await query(
      `SELECT id, planungsbereich, datum, beginn, prio, topic_id, thema, kurs_code,
              kategorie_id, kategorie_name, vorlage_offer_id, hinweis, freigabe,
              sync_status, edoobox_offer_id, kurs_key
         FROM public.v_kursplan_termin
        ${where}
        ORDER BY datum ASC, beginn ASC, prio ASC`,
      params
    );

    const rows = (result.rows as Record<string, unknown>[]).map(mapRow);
    return NextResponse.json(rows, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Laden der Kursplan-Termine:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Kursplan-Termine.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST – Termin anlegen
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const raw = (await req.json().catch(() => null)) as {
      planungsbereich?: unknown;
      datum?: unknown;
      beginn?: unknown;
      topic_id?: unknown;
      prio?: unknown;
      hinweis?: unknown;
    } | null;

    if (!raw) {
      return NextResponse.json({ error: 'Ungültiger Request-Body.' }, { status: 400 });
    }

    const planungsbereich =
      typeof raw.planungsbereich === 'string' ? raw.planungsbereich.trim() : '';
    const datum = validDatum(raw.datum);
    const beginn = validBeginn(raw.beginn);
    const topicId =
      typeof raw.topic_id === 'number' && Number.isInteger(raw.topic_id)
        ? raw.topic_id
        : null;
    const prio =
      typeof raw.prio === 'number' && Number.isInteger(raw.prio) &&
      raw.prio >= 1 && raw.prio <= 3
        ? raw.prio
        : null;
    const hinweis =
      raw.hinweis === undefined || raw.hinweis === null
        ? null
        : typeof raw.hinweis === 'string'
          ? raw.hinweis.trim() || null
          : undefined;

    if (!GUELTIGE_BEREICHE.includes(planungsbereich)) {
      return NextResponse.json(
        { error: `planungsbereich muss einer der Werte ${GUELTIGE_BEREICHE.join(', ')} sein.` },
        { status: 400 }
      );
    }
    if (!datum) {
      return NextResponse.json(
        { error: 'datum muss ein gültiges Datum im Format YYYY-MM-DD sein.' },
        { status: 400 }
      );
    }
    if (!beginn) {
      return NextResponse.json(
        { error: 'beginn muss eine gültige Uhrzeit im Format HH:MM sein.' },
        { status: 400 }
      );
    }
    if (topicId === null) {
      return NextResponse.json(
        { error: 'topic_id muss eine gültige Themen-ID sein.' },
        { status: 400 }
      );
    }
    if (prio === null) {
      return NextResponse.json(
        { error: 'prio muss 1, 2 oder 3 sein.' },
        { status: 400 }
      );
    }
    if (hinweis === undefined) {
      return NextResponse.json(
        { error: 'hinweis muss ein String oder null sein.' },
        { status: 400 }
      );
    }

    // Thema muss existieren und aktiv sein.
    const topic = await query(
      `SELECT id FROM public.course_topics WHERE id = $1 AND is_active IS TRUE`,
      [topicId]
    );
    if (topic.rowCount === 0) {
      return NextResponse.json(
        { error: 'Das Kursthema wurde nicht gefunden oder ist deaktiviert.' },
        { status: 404 }
      );
    }

    // Belegungsregel: pro Tag und Bereich max. 3 Kurse, einer je Priorität.
    const belegt = await query(
      `SELECT id FROM public.kursplan_termin
        WHERE planungsbereich = $1 AND datum = $2 AND prio = $3`,
      [planungsbereich, datum, prio]
    );
    if ((belegt.rowCount ?? 0) > 0) {
      return NextResponse.json(
        { error: `Am ${datum} ist im Bereich ${planungsbereich} bereits ein Kurs mit Priorität ${prio} geplant (max. 3-Fach-Belegung, eine je Priorität).` },
        { status: 409 }
      );
    }

    const result = await query(
      `INSERT INTO public.kursplan_termin
         (planungsbereich, datum, beginn, topic_id, prio, hinweis)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, planungsbereich, datum, beginn, prio, topic_id, hinweis,
                 freigabe, sync_status, edoobox_offer_id, kurs_key`,
      [planungsbereich, datum, beginn, topicId, prio, hinweis]
    );

    const row = result.rows[0] as Record<string, unknown>;
    const thema = await query(
      `SELECT name, kurs_code, kategorie_id, kategorie_name, vorlage_offer_id
         FROM public.course_topics WHERE id = $1`,
      [topicId]
    );
    const t = thema.rows[0] as Record<string, unknown> | undefined;

    return NextResponse.json(
      {
        ...mapRow({
          ...row,
          thema: t?.name ?? '',
          kurs_code: t?.kurs_code ?? null,
          kategorie_id: t?.kategorie_id ?? null,
          kategorie_name: t?.kategorie_name ?? null,
          vorlage_offer_id: t?.vorlage_offer_id ?? null,
        }),
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    // 23505 = unique_violation (Belegungsregel, falls parallel eingefügt).
    if (
      err && typeof err === 'object' &&
      (err as { code?: string }).code === '23505'
    ) {
      return NextResponse.json(
        { error: 'Belegungskonflikt: Für diesen Tag und diese Priorität existiert bereits ein Kurs.' },
        { status: 409 }
      );
    }
    console.error('Fehler beim Anlegen des Kursplan-Termins:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Anlegen des Kursplan-Termins.' },
      { status: 500 }
    );
  }
}