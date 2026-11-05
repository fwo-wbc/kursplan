// =============================================================================
// Portal-Session: signiertes HttpOnly-Cookie 'trainer_session'
// -----------------------------------------------------------------------------
// - Stateless: Das Cookie trägt { trainerId, exp } + HMAC-SHA256-Signatur.
// - Kein DB-Zugriff nötig, um eine Session zu verifizieren (nur der Trainer-
//   Abgleich in /auth/me lädt frische Stammdaten).
// - Cookie-Pfad ist '/portal': Der Browser sendet das Cookie nur an Seiten und
//   API-Routen unterhalb von /portal (z. B. /portal/api/auth/me).
// - Signatur über SESSION_SECRET aus der Umgebung (siehe .env.production).
// - 'Secure'-Flag: Nur beim Setzen von COOKIE_SECURE=true aktivieren (HTTPS).
//   Bei reinem HTTP-Betrieb (z. B. http://Server-IP:3000) würden Browser ein
//   Secure-Cookie verwerfen und die Session nicht speichern.
// =============================================================================
import { createHmac, timingSafeEqual } from 'crypto';

export const PORTAL_COOKIE_NAME = 'trainer_session';
export const PORTAL_COOKIE_PATH = '/portal';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 Tage

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  'kursplan-dev-session-secret-bitte-in-produktion-ueberschreiben';

interface SessionPayload {
  tid: number; // trainer.id
  exp: number; // Unix-Sekunden
}

function signature(body: string): string {
  return createHmac('sha256', SESSION_SECRET).update(body).digest('hex');
}

export function createSessionToken(trainerId: number): string {
  const payload: SessionPayload = {
    tid: trainerId,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${signature(body)}`;
}

export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signature(body);
  if (sig.length !== expected.length) return null;
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (!timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload || typeof payload.tid !== 'number' || typeof payload.exp !== 'number') {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

const secureCookie = process.env.COOKIE_SECURE === 'true';

export const sessionCookieOptions = {
  httpOnly: true,
  path: PORTAL_COOKIE_PATH,
  sameSite: 'lax' as const,
  secure: secureCookie,
  maxAge: SESSION_MAX_AGE_SECONDS,
};

export const sessionClearOptions = {
  httpOnly: true,
  path: PORTAL_COOKIE_PATH,
  sameSite: 'lax' as const,
  secure: secureCookie,
  maxAge: 0,
};
