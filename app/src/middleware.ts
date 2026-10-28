import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const basicAuth = req.headers.get('authorization');
  const url = req.nextUrl;

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1];
    const [user, pwd] = atob(authValue).split(':');

    const validUser = process.env.ADMIN_USER;
    const validPass = process.env.ADMIN_PASSWORD;

    if (validUser && validPass && user === validUser && pwd === validPass) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Authentifizierung erforderlich', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Kursplan-App Admin Area"',
    },
  });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
