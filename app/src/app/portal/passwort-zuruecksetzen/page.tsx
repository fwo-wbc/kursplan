'use client';

// =============================================================================
// /portal/passwort-zuruecksetzen – Neues Passwort vergeben
// Liest das Token aus den Query-Parametern (?token=...). Zentrierter Dialog
// mit zwei Passwortfeldern. Bei Erfolg Erfolgsmeldung + Weiterleitung zu
// /portal/login.
// =============================================================================
import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const LOGO_DEFAULT = '/webinarcenter_logo_header.png';
const LOGO_FALLBACK = '/webinarcenter_Logo_2_2021_V2.4_weiss.svg';

function ResetForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError('Der Link ist ungültig oder abgelaufen.');
      return;
    }

    if (password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }

    if (password !== confirm) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/portal/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        setError(data.error ?? 'Zurücksetzen fehlgeschlagen.');
        return;
      }

      setSuccess(true);
    } catch {
      setError('Server nicht erreichbar. Bitte später erneut versuchen.');
    } finally {
      setLoading(false);
    }
  }

  return (
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

      {success ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-800">
            Passwort zurückgesetzt
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            Ihr Passwort wurde erfolgreich geändert. Sie können sich jetzt mit
            Ihrem neuen Passwort anmelden.
          </p>
          <button
            type="button"
            onClick={() => router.push('/portal/login')}
            className="mt-6 w-full cursor-pointer rounded-md bg-[#285DAA] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1f4a88]"
          >
            Zur Anmeldung
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="mt-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
        >
          <h1 className="text-xl font-semibold text-slate-800">
            Neues Kennwort vergeben
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Legen Sie ein neues Passwort für Ihr Trainerportal-Konto fest.
          </p>

          <label htmlFor="password" className="mt-6 block text-sm font-medium text-slate-700">
            Neues Passwort
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-[#285DAA] focus:outline-none focus:ring-1 focus:ring-[#285DAA]"
            placeholder="Mindestens 8 Zeichen"
          />

          <label htmlFor="confirm" className="mt-4 block text-sm font-medium text-slate-700">
            Passwort bestätigen
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-[#285DAA] focus:outline-none focus:ring-1 focus:ring-[#285DAA]"
            placeholder="Passwort wiederholen"
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
            {loading ? 'Wird gespeichert …' : 'Passwort speichern'}
          </button>

          <p className="mt-4 text-center text-sm">
            <Link href="/portal/login" className="text-[#285DAA] hover:underline">
              Zurück zur Anmeldung
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}

export default function PasswortZuruecksetzenPage() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </main>
  );
}