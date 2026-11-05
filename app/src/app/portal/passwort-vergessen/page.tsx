'use client';

// =============================================================================
// /portal/passwort-vergessen – Passwort-Reset anfordern
// Zentrierter Dialog im Stil der Login-Maske (Header-Logo, bg-slate-50).
// Nach dem Absenden wird eine unspezifische Bestätigung angezeigt, um
// E-Mail-Scraping zu verhindern.
// =============================================================================
import { useState, type FormEvent } from 'react';
import Link from 'next/link';

const LOGO_DEFAULT = '/webinarcenter_logo_header.png';
const LOGO_FALLBACK = '/webinarcenter_Logo_2_2021_V2.4_weiss.svg';

export default function PasswortVergessenPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Bitte eine E-Mail-Adresse angeben.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/portal/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        setError(data.error ?? 'Anfrage fehlgeschlagen.');
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Server nicht erreichbar. Bitte später erneut versuchen.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Brand-Box mit Absender */}
        <div className="flex items-center justify-center rounded-xl bg-[#193C6F] px-6 py-5 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_DEFAULT}
            alt="Webinar Center Logo"
            className="h-14 w-auto"
            onError={(event) => {
              const img = event.currentTarget;
              if (img.src.endsWith(LOGO_DEFAULT)) {
                img.src = LOGO_FALLBACK;
              }
            }}
          />
        </div>

        {submitted ? (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-800">
              Anforderung gesendet
            </h1>
            <p className="mt-3 text-sm text-slate-600">
              Falls ein Konto existiert, wurde eine E-Mail versendet. Bitte
              prüfen Sie Ihren Posteingang.
            </p>
            <Link
              href="/portal/login"
              className="mt-6 inline-block w-full rounded-md bg-[#285DAA] px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-[#1f4a88]"
            >
              Zurück zur Anmeldung
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mt-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
          >
            <h1 className="text-xl font-semibold text-slate-800">
              Passwort vergessen
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Geben Sie Ihre Portal-E-Mail-Adresse ein. Wir senden Ihnen einen
              Link zum Zurücksetzen Ihres Passworts.
            </p>

            <label htmlFor="email" className="mt-6 block text-sm font-medium text-slate-700">
              E-Mail-Adresse
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-[#285DAA] focus:outline-none focus:ring-1 focus:ring-[#285DAA]"
              placeholder="name@webinarcenter.de"
            />

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full cursor-pointer rounded-md bg-[#285DAA] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1f4a88] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Wird gesendet …' : 'Link anfordern'}
            </button>

            <p className="mt-4 text-center text-sm">
              <Link
                href="/portal/login"
                className="text-[#285DAA] hover:underline"
              >
                Zurück zur Anmeldung
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}