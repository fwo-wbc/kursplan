import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { generiereEntwuerfe } from '@/lib/planning-engine';

// Route immer dynamisch ausliefern – verhindert statisches Caching durch den
// Next.js App Router (die Sandbox liest live aus public.planning_drafts).
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET  /api/planung/drafts  – Liste aller Entwürfe (mit Modul- und
//                             Trainer-Infos, sortiert nach Datum).
// POST /api/planung/drafts  – Neue Entwürfe über die Regel-Engine generieren.
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const res = await query(
      `SELECT pd.id,
              pd.module_id,
              cm.name        AS modul_name,
              cm.position    AS modul_position,
              cm.prio        AS modul_prio,
              cm.takt_wochen AS modul_takt,
              pd.trainer_id,
              t.kuerzel      AS trainer_kuerzel,
              t.vorname      AS trainer_vorname,
              t.nachname     AS trainer_nachname,
              pd.proposed_date::text AS proposed_date,
              pd.status,
              pd.created_at::text     AS created_at,
              pd.updated_at::text     AS updated_at
         FROM public.planning_drafts pd
         JOIN public.course_modules cm ON cm.id = pd.module_id
         LEFT JOIN public.trainer t    ON t.id = pd.trainer_id
        ORDER BY pd.proposed_date, cm.position, pd.id`
    );
    return NextResponse.json({ entwuerfe: res.rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Ohne Body wird mit Standardwerten generiert.
  }

  const startDatum = typeof body.startDatum === 'string' && body.startDatum
    ? body.startDatum
    : undefined;
  const anzahlTage = typeof body.anzahlTage === 'number' && body.anzahlTage > 0
    ? body.anzahlTage
    : 60;

  try {
    const ergebnis = await generiereEntwuerfe(startDatum, anzahlTage);
    return NextResponse.json(ergebnis);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}