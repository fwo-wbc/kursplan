// =============================================================================
// POST /portal/api/auth/login
// Prüft portal_email + password_hash gegen public.trainer und setzt bei Erfolg
// das HttpOnly-Session-Cookie 'trainer_session' (Path=/portal, 30 Tage).
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import {
  createSessionToken,
  PORTAL_COOKIE_NAME,
  sessionCookieOptions,
} from '@/lib/portal-session';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ungültiger Request-Body.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json(
      { error: 'E-Mail und Kennwort sind erforderlich.' },
      { status: 400 },
    );
  }

  try {
    const { rows } = await query(
      `SELECT id, vorname, nachname, portal_email, password_hash, portal_active, is_active
         FROM public.trainer
        WHERE lower(portal_email) = $1`,
      [email],
    );
    const trainer = rows[0];

    // Bewusst unspezifische Fehlermeldung, damit keine Accounts enumeriert werden.
    if (
      !trainer ||
      !trainer.password_hash ||
      trainer.portal_active !== true ||
      trainer.is_active !== true
    ) {
      return NextResponse.json(
        { error: 'E-Mail oder Kennwort ist falsch.' },
        { status: 401 },
      );
    }

    const passwordMatches = await bcrypt.compare(password, trainer.password_hash);
    if (!passwordMatches) {
      return NextResponse.json(
        { error: 'E-Mail oder Kennwort ist falsch.' },
        { status: 401 },
      );
    }

    await query(
      'UPDATE public.trainer SET last_login = NOW(), updated_at = NOW() WHERE id = $1',
      [trainer.id],
    );

    const token = createSessionToken(trainer.id);
    const response = NextResponse.json(
      {
        id: trainer.id,
        vorname: trainer.vorname,
        nachname: trainer.nachname,
        email: trainer.portal_email,
      },
      { status: 200 },
    );
    response.cookies.set(PORTAL_COOKIE_NAME, token, sessionCookieOptions);
    return response;
  } catch (err) {
    console.error('Portal-Login: Fehler bei der Datenbankanfrage', err);
    return NextResponse.json({ error: 'Interner Serverfehler.' }, { status: 500 });
  }
}
