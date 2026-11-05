// =============================================================================
// POST /portal/api/auth/reset-password
// Nimmt { token, password } entgegen. Prüft, ob ein Trainer mit diesem Token
// existiert und reset_password_expires > NOW() ist. Bei Erfolg wird das neue
// Passwort mit bcryptjs (12 Salts) gehasht und gespeichert, Token + Ablauf
// werden geleert.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

const BCRYPT_SALT_ROUNDS = 12;

export async function POST(request: NextRequest) {
  let body: { token?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ungültiger Request-Body.' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!token || !password) {
    return NextResponse.json(
      { error: 'Token und neues Passwort sind erforderlich.' },
      { status: 400 },
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Das Passwort muss mindestens 8 Zeichen lang sein.' },
      { status: 400 },
    );
  }

  try {
    const { rows } = await query(
      `SELECT id
         FROM public.trainer
        WHERE reset_password_token = $1
          AND reset_password_expires > NOW()
        LIMIT 1`,
      [token],
    );
    const trainer = rows[0];

    if (!trainer) {
      return NextResponse.json(
        { error: 'Der Link ist ungültig oder abgelaufen.' },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    await query(
      `UPDATE public.trainer
          SET password_hash = $1,
              reset_password_token = NULL,
              reset_password_expires = NULL,
              updated_at = NOW()
        WHERE id = $2`,
      [passwordHash, trainer.id],
    );

    return NextResponse.json(
      { message: 'Ihr Passwort wurde erfolgreich zurückgesetzt.' },
      { status: 200 },
    );
  } catch (err) {
    console.error('Portal-Reset-Password: Fehler bei der Datenbankanfrage', err);
    return NextResponse.json({ error: 'Interner Serverfehler.' }, { status: 500 });
  }
}