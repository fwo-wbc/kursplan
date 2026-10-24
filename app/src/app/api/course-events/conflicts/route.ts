import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ---------------------------------------------------------------------------
// GET /api/course-events/conflicts
// Lädt alle Termine mit needs_conflict_resolution = true aus public.course_events,
// joind den Themennamen (public.course_topics) und das Trainerprofil
// (public.trainer) und gruppiert das Ergebnis nach Datum (Europe/Berlin) des
// Termin-Starts.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

/** Rohzeile aus dem Konflikt-Join. */
interface KonfliktRow {
  id: string;
  course_id: string | number | null;
  topic_id: number | null;
  topic_name: string | null;
  trainer_id: number | null;
  trainer_kuerzel: string | null;
  trainer_name: string | null;
  start_time: Date | null;
  end_time: Date | null;
  datum: string;
}

/** Aufbereiteter Konflikt-Termin für das Dashboard. */
interface KonfliktTermin {
  id: number;
  course_id: number | null;
  topic_id: number | null;
  topic_name: string | null;
  trainer_id: number | null;
  trainer_kuerzel: string | null;
  trainer_name: string | null;
  start_time: string;
  end_time: string | null;
}

/** Tagesgruppe: alle Konflikt-Termine eines Datums (YYYY-MM-DD, Berlin). */
interface Konflikttag {
  datum: string;
  /** Anzahl der betroffenen Kurse an diesem Tag (Rot-Badge im Dashboard). */
  anzahl: number;
  termine: KonfliktTermin[];
}

/** Wandelt eine DB-Zeile in einen Konflikt-Termin für die API-Antwort um. */
function mapKonflikt(row: Record<string, unknown>): KonfliktTermin {
  return {
    id: Number(row.id),
    course_id:
      row.course_id === null || row.course_id === undefined || row.course_id === ''
        ? null
        : Number(row.course_id),
    topic_id: row.topic_id === null ? null : Number(row.topic_id),
    topic_name: row.topic_name == null ? null : String(row.topic_name),
    trainer_id: row.trainer_id === null ? null : Number(row.trainer_id),
    trainer_kuerzel:
      row.trainer_kuerzel == null ? null : String(row.trainer_kuerzel),
    trainer_name: row.trainer_name == null ? null : String(row.trainer_name),
    start_time:
      row.start_time === null || row.start_time === undefined
        ? ''
        : (row.start_time as Date).toJSON(),
    end_time:
      row.end_time === null || row.end_time === undefined
        ? null
        : (row.end_time as Date).toJSON(),
  };
}

export async function GET() {
  try {
    const result = await query(
      `SELECT
         ce.id,
         ce.course_id,
         ce.topic_id,
         ct.name                                 AS topic_name,
         ce.trainer_id,
         t.kuerzel                               AS trainer_kuerzel,
         CASE
           WHEN COALESCE(t.vorname, '') = '' THEN t.nachname
           WHEN COALESCE(t.nachname, '') = '' THEN t.vorname
           ELSE t.vorname || ' ' || t.nachname
         END                                     AS trainer_name,
         ce.start_time,
         ce.end_time,
         (ce.start_time AT TIME ZONE 'Europe/Berlin')::date AS datum
       FROM public.course_events ce
       LEFT JOIN public.course_topics ct ON ct.id = ce.topic_id
       LEFT JOIN public.trainer t ON t.id = ce.trainer_id
       WHERE ce.needs_conflict_resolution = true
       ORDER BY ce.start_time ASC, ce.id ASC`
    );

    // Gruppierung nach Datum (Beibehaltung der aufsteigenden Reihenfolge).
    const gruppen = new Map<string, Konflikttag>();
    for (const row of result.rows as Record<string, unknown>[]) {
      const datum =
        row.datum === null || row.datum === undefined
          ? 'unbekannt'
          : String(row.datum);
      let gruppe = gruppen.get(datum);
      if (!gruppe) {
        gruppe = { datum, anzahl: 0, termine: [] };
        gruppen.set(datum, gruppe);
      }
      gruppe.termine.push(mapKonflikt(row));
      gruppe.anzahl = gruppe.termine.length;
    }

    return NextResponse.json(Array.from(gruppen.values()), { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Laden der Konflikt-Termine:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Konflikt-Termine.' },
      { status: 500 }
    );
  }
}
