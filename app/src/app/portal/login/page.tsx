'use client';

// =============================================================================
// /portal/login – Login-Maske des Trainer-Portals
// Zentrierter Dialog auf dezentem Hintergrund (bg-slate-50), Logo im
// Bereich der dunkelblauen Brand-Box (#193C6F). Bei Erfolg Weiterleitung
// nach /portal/verfuegbarkeit.
// =============================================================================
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const LOGO_DEFAULT = '/webinarcenter_logo_header.png';
const LOGO_FALLBACK = '/webinarcenter_Logo_2_2021_V2.4_weiss.svg';

export default function PortalLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Bitte E-Mail und Kennwort eingeben.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/portal/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        setError(data.error ?? 'Anmeldung fehlgeschlagen.');
        return;
      }

      // Verzögert, damit das Set-Cookie im Browser verarbeitet ist, bevor
      // die Folge-Route das Session-Cookie benötigt.
      window.setTimeout(() => router.push('/portal/verfuegbarkeit'), 150);
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

        <form
          onSubmit={handleSubmit}
          className="mt-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
        >
          <h1 className="text-xl font-semibold text-slate-800">
            Trainer-Portal
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Bitte mit Ihrer Portal-E-Mail und Ihrem Kennwort anmelden.
          </p>

          <label htmlFor="email" className="mt-6 block text-sm font-medium text-slate-700">
            E-Mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-[#193C6F] focus:outline-none focus:ring-1 focus:ring-[#193C6F]"
            placeholder="name@webinarcenter.de"
          />

          <label htmlFor="password" className="mt-4 block text-sm font-medium text-slate-700">
            Kennwort
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-[#193C6F] focus:outline-none focus:ring-1 focus:ring-[#193C6F]"
            placeholder="••••••••"
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
            className="mt-6 w-full rounded-md bg-[#193C6F] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#152f58] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Anmeldung …' : 'Anmelden'}
          </button>
        </form>
      </div>
    </main>
  );
}
