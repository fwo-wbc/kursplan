import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const basicAuth = req.headers.get('authorization');
  const url = req.nextUrl;

  // Trainer-Portal (auffindbar unter /portal/...) ist öffentlich erreichbar:
  // Login-Seite und Portal-API müssen ohne Admin-Basic-Auth funktionieren.
  if (url.pathname === '/portal' || url.pathname.startsWith('/portal/')) {
    return NextResponse.next();
  }

  // Statische Dateien (Bilder, Fonts, CSS, PDFs) grundsätzlich OHNE Basic-Auth
  // ausliefern – sonst würde der Browser bei öffentlichen Seiten (z. B. dem
  // Trainer-Portal, das das Logo /webinarcenter_logo_header.png lädt) ein
  // Login-Popup anzeigen. Der Guard ist bewusst ergänzend zum Matcher unten.
  if (/\.(?:png|jpe?g|svg|webp|gif|ico|css|woff2?|pdf)$/i.test(url.pathname)) {
    return NextResponse.next();
  }

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
    // Alles außer: Next-interne Assets (_next/static|_next/image), Favicon und
    // statische Dateien (Bilder/Fonts/CSS/PDF) – damit z. B. das Logo im
    // öffentlichen Trainer-Portal ohne Browser-Login-Popup geladen werden kann.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|svg|webp|gif|ico|css|woff2?|pdf)$).*)',
  ],
};
