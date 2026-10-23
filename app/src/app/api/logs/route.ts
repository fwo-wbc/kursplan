import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Ein Log-Eintrag für die API-Antwort (GET /api/logs). */
export interface SystemLogEintrag {
  id: string;
  /** ISO-8601-Zeitstempel (UTC), Frontend formatiert in Europe/Berlin. */
  created_at: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  source: string;
  message: string;
  /** Optionaler Zusatzkontext (Stacktrace o. Ä.) – liegt als JSONB in der DB. */
  details: unknown;
}

function toSystemLog(row: Record<string, unknown>): SystemLogEintrag {
  const level = String(row.level);
  return {
    id: String(row.id),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    level:
      level === 'INFO' || level === 'WARN' || level === 'ERROR'
        ? level
        : 'INFO',
    source: String(row.source),
    message: String(row.message),
    details: row.details ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET: Liefert die letzten 100 Einträge aus public.system_logs, absteigend
// nach created_at sortiert (neueste zuerst). Wird von der internen
// Admin-Seite /system-logs zur Überwachung geladen.
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const result = await query(
      `SELECT id, created_at, level, source, message, details
         FROM public.system_logs
        ORDER BY created_at DESC
        LIMIT 100`
    );

    const eintraege = result.rows.map((r) =>
      toSystemLog(r as Record<string, unknown>)
    );
    return NextResponse.json({ eintraege });
  } catch (err) {
    // Bewusst rein serverseitig via console.error geloggt – system_logs selbst
    // könnte die Fehlerquelle sein (z. B. DB nicht erreichbar) und würde sonst
    // den Fehler unnötig verdoppeln.
    console.error('GET /api/logs fehlgeschlagen:', err);
    return NextResponse.json(
      { error: 'Log-Einträge konnten nicht geladen werden.' },
      { status: 500 }
    );
  }
}