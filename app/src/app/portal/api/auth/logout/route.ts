// =============================================================================
// POST /portal/api/auth/logout
// Entfernt das Session-Cookie 'trainer_session' (Path=/portal).
// =============================================================================
import { NextResponse } from 'next/server';
import { PORTAL_COOKIE_NAME, sessionClearOptions } from '@/lib/portal-session';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PORTAL_COOKIE_NAME, '', sessionClearOptions);
  return response;
}
