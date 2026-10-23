import { query } from '@/lib/db';

/**
 * Zulässige Log-Level für public.system_logs
 * (deckt sich mit dem CHECK-Constraint der Tabelle).
 */
export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/**
 * Log-Quelle. Bekannte Werte: 'API_RESERVIERUNG', 'SYNC_EDOOBOX', 'SYSTEM'.
 * Erweiterbar um weitere Quellen (normales string).
 */
export type LogSource =
  | 'API_RESERVIERUNG'
  | 'SYNC_EDOOBOX'
  | 'SYSTEM'
  | (string & {});

/**
 * Normalisiert `details` zu einem JSONB-tauglichen JSON-String.
 *
 * Error-Objekte werden explizit mit name/message/stack serialisiert, da der
 * native JSON.stringify-Fall für Error-Instanzen nur `{}` liefern würde.
 * Zirkuläre bzw. nicht serialisierbare Werte werden auf String-Darstellung
 * zurückgefahren, damit der Logger nie an einem Serialisierungsfehler scheitert.
 */
function normalizeDetails(details: unknown): string | null {
  if (details == null) {
    return null;
  }
  if (details instanceof Error) {
    return JSON.stringify({
      name: details.name,
      message: details.message,
      stack: details.stack,
    });
  }
  try {
    return JSON.stringify(details);
  } catch {
    return JSON.stringify({ message: String(details) });
  }
}

/**
 * Schreibt einen persistenten Log-Eintrag nach public.system_logs.
 *
 * Fail-Safe: Schlägt das Schreiben fehl (z. B. Datenbank nicht erreichbar),
 * wird der Fehler nur per console.error gemeldet. Es wird NIE eine Exception
 * an den Aufrufer geworfen – der Hauptprozess (API, Sync) läuft weiter.
 *
 * @param level   Log-Level ('INFO' | 'WARN' | 'ERROR')
 * @param source  Herkunft des Eintrags, z. B. 'API_RESERVIERUNG'
 * @param message Kurze, menschenlesbare Beschreibung
 * @param details Optionaler Zusatzkontext (Error-Objekt, Request-Body,
 *                Stacktrace o. Ä.) – wird als JSONB gespeichert.
 */
export async function logEvent(
  level: LogLevel,
  source: string,
  message: string,
  details?: unknown
): Promise<void> {
  try {
    await query(
      `INSERT INTO public.system_logs (level, source, message, details)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [level, source, message, normalizeDetails(details)]
    );
  } catch (err: unknown) {
    console.error('[logger] Fehler beim Schreiben in system_logs:', err);
  }
}