// =============================================================================
// POST /portal/api/auth/forgot-password
// Nimmt { email } entgegen, erzeugt ein sicheres Reset-Token (crypto.randomBytes)
// und schreibt es samt Ablaufzeit (2 Stunden) in public.trainer.
// Versendet eine E-Mail mit dem Reset-Link. Gibt IMMER status 200 zurück, um
// E-Mail-Scraping zu verhindern (auch wenn kein Konto existiert).
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { query } from '@/lib/db';
import { sendMail } from '@/lib/mailer';

export const runtime = 'nodejs';

const RESET_LINK_TTL_HOURS = 2;

export async function POST(request: NextRequest) {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ungültiger Request-Body.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!email) {
    return NextResponse.json(
      { error: 'Bitte eine E-Mail-Adresse angeben.' },
      { status: 400 },
    );
  }

  try {
    const { rows } = await query(
      `SELECT id, vorname, nachname, portal_email
         FROM public.trainer
        WHERE lower(portal_email) = $1
          AND portal_active = true
          AND is_active = true
        LIMIT 1`,
      [email],
    );
    const trainer = rows[0];

    // Bewusst identische Antwort, egal ob das Konto existiert oder nicht.
    if (!trainer) {
      return NextResponse.json(
        { message: 'Falls ein Konto existiert, wurde eine E-Mail versendet.' },
        { status: 200 },
      );
    }

    const token = randomBytes(32).toString('hex');

    await query(
      `UPDATE public.trainer
          SET reset_password_token = $1,
              reset_password_expires = NOW() + ($2 || ' hours')::interval,
              updated_at = NOW()
        WHERE id = $3`,
      [token, String(RESET_LINK_TTL_HOURS), trainer.id],
    );

    const baseUrl = (process.env.BASE_URL || '').replace(/\/+$/, '');
    const resetLink = `${baseUrl}/portal/passwort-zuruecksetzen?token=${token}`;

    const vorname = trainer.vorname || '';
    const anrede = vorname ? `Hallo ${vorname},` : 'Hallo,';

    await sendMail({
      to: trainer.portal_email,
      subject: 'Ihr Passwort für das Trainerportal zurücksetzen',
      text: [
        anrede,
        '',
        'Sie haben angefordert, Ihr Passwort für das Trainerportal zurückzusetzen.',
        'Bitte öffnen Sie den folgenden Link, um ein neues Passwort zu vergeben:',
        '',
        resetLink,
        '',
        `Der Link ist ${RESET_LINK_TTL_HOURS} Stunden gültig.`,
        'Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.',
        '',
        'Mit freundlichen Grüßen',
        'Ihr Webinar Center Team',
      ].join('\n'),
      html: [
        `<p>${anrede}</p>`,
        '<p>Sie haben angefordert, Ihr Passwort für das Trainerportal zurückzusetzen.</p>',
        '<p>Bitte öffnen Sie den folgenden Link, um ein neues Passwort zu vergeben:</p>',
        `<p><a href="${resetLink}">Passwort zurücksetzen</a></p>`,
        `<p>Der Link ist ${RESET_LINK_TTL_HOURS} Stunden gültig.</p>`,
        '<p>Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.</p>',
        '<p>Mit freundlichen Grüßen<br/>Ihr Webinar Center Team</p>',
      ].join(''),
    });

    return NextResponse.json(
      { message: 'Falls ein Konto existiert, wurde eine E-Mail versendet.' },
      { status: 200 },
    );
  } catch (err) {
    console.error('Portal-Forgot-Password: Fehler bei der Datenbankanfrage', err);
    return NextResponse.json({ error: 'Interner Serverfehler.' }, { status: 500 });
  }
}