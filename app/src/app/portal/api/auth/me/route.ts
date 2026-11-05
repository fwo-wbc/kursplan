// =============================================================================
// GET /portal/api/auth/me
// Liefert { id, vorname, nachname, email } des über das Session-Cookie
// 'trainer_session' angemeldeten Trainers – oder 401 bei fehlender/ungültiger
// Session. Lädt Stammdaten frisch aus der Datenbank.
// =============================================================================
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { PORTAL_COOKIE_NAME, verifySessionToken } from '@/lib/portal-session';

export const runtime = 'nodejs';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(PORTAL_COOKIE_NAME)?.value ?? null;

  const session = verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  }

  try {
    const { rows } = await query(
      `SELECT id, vorname, nachname, portal_email
         FROM public.trainer
        WHERE id = $1 AND is_active = true`,
      [session.tid],
    );
    const trainer = rows[0];
    if (!trainer) {
      return NextResponse.json({ error: 'Trainer nicht gefunden.' }, { status: 401 });
    }

    return NextResponse.json({
      id: trainer.id,
      vorname: trainer.vorname,
      nachname: trainer.nachname,
      email: trainer.portal_email,
    });
  } catch (err) {
    console.error('Portal-/me: Fehler bei der Datenbankanfrage', err);
    return NextResponse.json({ error: 'Interner Serverfehler.' }, { status: 500 });
  }
}
