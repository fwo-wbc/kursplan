import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ladeBlocker, prüfeEntwurf, vonIsoDatum, zuIsoDatum } from '@/lib/planning-engine';

// Route immer dynamisch ausliefern – verhindert statisches Caching durch den
// Next.js App Router.
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// PATCH /api/planung/drafts/[id]
// Manuelle Korrektur eines Entwurfs: proposed_date und/oder status änderbar.
// Vor dem Speichern wird das neue Datum erneut durch die Regel-Engine geprüft;
// bei Verletzung harter Regeln wird der Status automatisch auf 'conflict'
// gesetzt (der Nutzer kann ihn trotzdem manuell auf 'approved' heben).
// ---------------------------------------------------------------------------

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const draftId = Number(id);
  if (!Number.isInteger(draftId) || draftId <= 0) {
    return NextResponse.json({ error: 'Ungültige Entwurfs-ID.' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Request-Body muss gültiges JSON sein.' },
      { status: 400 }
    );
  }

  const neuesDatum = typeof body.proposed_date === 'string' ? body.proposed_date : null;
  const neuerStatus = typeof body.status === 'string' ? body.status : null;

  if (!neuesDatum && !neuerStatus) {
    return NextResponse.json(
      { error: 'Mindestens proposed_date oder status angeben.' },
      { status: 400 }
    );
  }

  try {
    // Bestehenden Entwurf laden (inkl. Modul-Infos für die Regelprüfung).
    const bestehend = await query(
      `SELECT pd.id, pd.module_id, pd.proposed_date::text AS proposed_date, pd.status,
              cm.name, cm.position, cm.takt_wochen, cm.abhaengigkeit_von,
              cm.abhaengigkeit_offset_tage, cm.prio
         FROM public.planning_drafts pd
         JOIN public.course_modules cm ON cm.id = pd.module_id
        WHERE pd.id = $1`,
      [draftId]
    );
    if (bestehend.rows.length === 0) {
      return NextResponse.json({ error: 'Entwurf nicht gefunden.' }, { status: 404 });
    }
    const row = bestehend.rows[0];

    const zielDatum = neuesDatum ?? row.proposed_date;
    // Datumsformat validieren (YYYY-MM-DD).
    const geparst = vonIsoDatum(zielDatum);
    if (Number.isNaN(geparst.getTime()) || zuIsoDatum(geparst) !== zielDatum) {
      return NextResponse.json(
        { error: 'proposed_date muss das Format YYYY-MM-DD haben.' },
        { status: 400 }
      );
    }

    // Regelprüfung für das (ggf. neue) Datum.
    const blocker = await ladeBlocker();
    const letzterRes = await query(
      `SELECT proposed_date::text AS proposed_date
         FROM public.planning_drafts
        WHERE module_id = $1 AND id <> $2
          AND status IN ('draft', 'approved')
        ORDER BY proposed_date DESC
        LIMIT 1`,
      [row.module_id, draftId]
    );
    const letzterTermin = letzterRes.rows.length > 0 ? letzterRes.rows[0].proposed_date : null;

    let vorgaengerDatum: string | null = null;
    if (row.abhaengigkeit_von) {
      const vorgRes = await query(
        `SELECT proposed_date::text AS proposed_date
           FROM public.planning_drafts
          WHERE module_id = $1 AND status IN ('draft', 'approved')
          ORDER BY proposed_date DESC
          LIMIT 1`,
        [row.abhaengigkeit_von]
      );
      vorgaengerDatum = vorgRes.rows.length > 0 ? vorgRes.rows[0].proposed_date : null;
    }

    const modul = {
      id: row.module_id,
      name: row.name,
      position: row.position,
      takt_wochen: row.takt_wochen,
      abhaengigkeit_von: row.abhaengigkeit_von,
      abhaengigkeit_offset_tage: row.abhaengigkeit_offset_tage,
      prio: row.prio,
    };

    const ergebnis = await prüfeEntwurf(modul, zielDatum, blocker, letzterTermin, vorgaengerDatum);

    // Status: explizit gesetzt → übernehmen; sonst Ergebnis der Engine.
    const zielStatus = neuerStatus ?? ergebnis.status;
    if (!['draft', 'conflict', 'approved'].includes(zielStatus)) {
      return NextResponse.json(
        { error: 'status muss draft, conflict oder approved sein.' },
        { status: 400 }
      );
    }

    const updated = await query(
      `UPDATE public.planning_drafts
          SET proposed_date = $1, status = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, module_id, trainer_id, proposed_date::text AS proposed_date, status`,
      [zielDatum, zielStatus, draftId]
    );

    return NextResponse.json({
      entwurf: updated.rows[0],
      regelpruefung: { status: ergebnis.status, warnungen: ergebnis.warnungen },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}