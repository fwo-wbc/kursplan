import { NextResponse } from 'next/server';
import { schliessePlanungAb } from '@/lib/planning-engine';

// Route immer dynamisch ausliefern – verhindert statisches Caching durch den
// Next.js App Router.
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// POST /api/planung/abschliessen
// Übernimmt alle genehmigten Entwürfe in public.course_events.
// Dies ist der spätere Übergabepunkt an den edoobox-Transfer (P90).
// ---------------------------------------------------------------------------

export async function POST() {
  try {
    const ergebnis = await schliessePlanungAb();
    return NextResponse.json(ergebnis);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}