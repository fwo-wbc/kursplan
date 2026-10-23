'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Loader2,
  SearchX,
} from 'lucide-react';
import AppHeader from '../components/AppHeader';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Ein Log-Eintrag – identisch zur Struktur von GET /api/logs. */
interface SystemLogEintrag {
  id: string;
  created_at: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  source: string;
  message: string;
  details: unknown;
}

/** Antwortformat der API. */
interface LogsResponse {
  eintraege: SystemLogEintrag[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Konstanten / Styling
// ---------------------------------------------------------------------------

/** Badge-/Textfarben je Log-Level. */
const LEVEL_STYLES: Record<SystemLogEintrag['level'], string> = {
  ERROR: 'bg-red-100 text-red-700 border-red-200',
  WARN: 'bg-amber-100 text-amber-700 border-amber-200',
  INFO: 'bg-slate-100 text-slate-600 border-slate-200',
};

/** CD-Blau als feste Konstante (wiederverwendet für den Aktualisieren-Button). */
const CD_BLAU = '#285DAA';

/**
 * Formatiert den ISO-Zeitstempel in Europe/Berlin, lesbar für die Anzeige
 * (TT.MM.JJJJ HH:MM:SS).
 */
function formatDatum(iso: string): string {
  const datum = new Date(iso);
  if (Number.isNaN(datum.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(datum);
}

/**
 * Bereitet das JSONB-Details-Feld für die <pre>-Anzeige auf:
 * - Objekte werden pretty-printed, damit Stacktraces lesbar bleiben.
 * - Strings (und alles andere) werden 1:1 als Text ausgegeben.
 */
function renderDetails(details: unknown): string {
  if (details == null) {
    return '';
  }
  if (typeof details === 'string') {
    return details;
  }
  if (typeof details === 'object') {
    try {
      return JSON.stringify(details, null, 2);
    } catch {
      // Nicht serialisierbar (z. B. zirkulär): auf String-Darstellung fallen.
    }
  }
  return String(details);
}

// ---------------------------------------------------------------------------
// Seite
// ---------------------------------------------------------------------------

export default function SystemLogsPage() {
  const [eintraege, setEintraege] = useState<SystemLogEintrag[]>([]);
  const [laedt, setLaedt] = useState<boolean>(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [zuletztAktualisiert, setZuletztAktualisiert] = useState<Date | null>(
    null
  );
  /** IDs der Einträge, deren Details-Zeile aktuell aufgeklappt ist. */
  const [aufgeklappt, setAufgeklappt] = useState<Set<string>>(new Set());

  const ladeDaten = useCallback(async () => {
    setLaedt(true);
    setFehler(null);
    try {
      const res = await fetch('/api/logs');
      const data = (await res.json()) as LogsResponse;
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setEintraege(data.eintraege);
      setZuletztAktualisiert(new Date());
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unbekannter Fehler';
      console.error('system-logs: Laden fehlgeschlagen:', err);
      setFehler(`Log-Einträge konnten nicht geladen werden (${msg}).`);
    } finally {
      setLaedt(false);
    }
  }, []);

  useEffect(() => {
    void ladeDaten();
  }, [ladeDaten]);

  /** Klappt die Details der Zeile mit der übergebenen ID auf bzw. zu. */
  const toggleDetails = useCallback((id: string) => {
    setAufgeklappt((prev) => {
      const neu = new Set(prev);
      if (neu.has(id)) {
        neu.delete(id);
      } else {
        neu.add(id);
      }
      return neu;
    });
  }, []);

  const eintraegeMitDetails = eintraege.filter(
    (e) => e.details != null
  ).length;

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-800 sm:p-6">
      <AppHeader />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-700">
            System-Protokolle
          </h2>
          <p className="text-xs text-slate-500">
            Interne Überwachungsseite – letzte{' '}
            {eintraege.length > 0 ? `${eintraege.length} ` : ''}Einträge aus{' '}
            <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[11px]">
              public.system_logs
            </code>
            {eintraegeMitDetails > 0 &&
              `, davon ${eintraegeMitDetails} mit Details`}
            {zuletztAktualisiert && (
              <>
                {' '}
                · aktualisiert:{' '}
                {new Intl.DateTimeFormat('de-DE', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                }).format(zuletztAktualisiert)}
                &nbsp;Uhr
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void ladeDaten()}
          disabled={laedt}
          className="inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: CD_BLAU }}
        >
          {laedt ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
          Aktualisieren
        </button>
      </div>

      {fehler && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fehler}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-medium">Datum / Uhrzeit</th>
              <th className="px-4 py-3 font-medium">Level</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="w-1/2 px-4 py-3 font-medium">Message</th>
              <th className="w-10 px-2 py-3" aria-label="Details aufklappen" />
            </tr>
          </thead>
          <tbody>
            {!laedt && eintraege.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  <SearchX className="mx-auto mb-2 h-8 w-8" aria-hidden="true" />
                  Keine Log-Einträge vorhanden.
                </td>
              </tr>
            )}
            {eintraege.map((eintrag) => {
              const istAufgeklappt = aufgeklappt.has(eintrag.id);
              const hatDetails = eintrag.details != null;
              return (
                <React.Fragment key={eintrag.id}>
                  <tr
                    onClick={() => hatDetails && toggleDetails(eintrag.id)}
                    className={`border-b border-slate-100 align-top ${
                      hatDetails
                        ? 'cursor-pointer hover:bg-slate-50'
                        : 'hover:bg-slate-50/50'
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">
                      {formatDatum(eintrag.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${LEVEL_STYLES[eintrag.level]}`}
                      >
                        {eintrag.level}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <code className="font-mono text-xs text-slate-700">
                        {eintrag.source}
                      </code>
                    </td>
                    <td className="max-w-0 px-4 py-3">
                      <div className="truncate text-slate-700">
                        {eintrag.message}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right">
                      {hatDetails ? (
                        <button
                          type="button"
                          aria-label={
                            istAufgeklappt
                              ? `Details von ${eintrag.message} schließen`
                              : `Details von ${eintrag.message} anzeigen`
                          }
                          className="inline-flex items-center justify-center text-slate-400 hover:text-CD_BLUE"
                        >
                          {istAufgeklappt ? (
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        <span className="inline-block w-4" aria-hidden="true" />
                      )}
                    </td>
                  </tr>
                  {istAufgeklappt && hatDetails && (
                    <tr className="border-b border-slate-100 bg-slate-50/70">
                      <td colSpan={5} className="px-4 py-3">
                        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">
                          {renderDetails(eintrag.details)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-center text-[11px] text-slate-400">
        Nur für interne Administration – kein Bestandteil der Hauptnavigation.
      </p>
    </main>
  );
}