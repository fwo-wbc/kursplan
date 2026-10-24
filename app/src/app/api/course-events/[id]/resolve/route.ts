import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { benachrichtigeN8n } from '@/lib/n8n-sync';

// ---------------------------------------------------------------------------
// PATCH /api/course-events/[id]/resolve
// Löst einen Konflikt-Tag-Termin auf. Es wird EXAKT EINES der beiden Felder
// benötigt:
//   new_trainer_id : neuer Trainer (public.trainer.id)
//   new_start_time : neuer Start als lokaler Berliner Zeitstempel
//                    ("YYYY-MM-DDTHH:MM" bzw. mit Sekunden)
//
// Ein Kurs-Slot dauert 1,5 Stunden (SLOT_DAUER_MINUTEN = 90 in lib/planning-utils).
// Bei einer Verschiebung wird end_time automatisch = start_time + 90 Minuten
// gesetzt. In beiden Fällen wird zwingend needs_conflict_resolution = false
// geschrieben, damit der Termin aus dem Konflikt-Dashboard verschwindet.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

/** Dauer eines Kurs-Slots in Minuten (1,5-Stunden-Kurse). */
const SLOT_DAUER_MINUTEN = 90;

/** Erwarteter Request-Body. */
interface ResolveBody {
  new_trainer_id?: unknown;
  new_start_time?: unknown;
}

/** Aufbereiteter Termin – gleiche Struktur wie in der Conflicts-GET-Route. */
interface KursEventAntwort {
  id: number;
  course_id: number | null;
  topic_id: number | null;
  topic_name: string | null;
  trainer_id: number | null;
  trainer_kuerzel: string | null;
  trainer_name: string | null;
  start_time: string;
  end_time: string | null;
  needs_conflict_resolution: boolean;
}

/** Wandelt einen DB-Fehler in eine lesbare Meldung um. */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Baut den Termin nach dem UPDATE inkl. Join-Daten für die Antwort. */
async function ladeTerminMitJoins(id: number) {
  const select = `SELECT
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
     ce.needs_conflict_resolution
   FROM public.course_events ce
   LEFT JOIN public.course_topics ct ON ct.id = ce.topic_id
   LEFT JOIN public.trainer t ON t.id = ce.trainer_id
   WHERE ce.id = $1`;
  const result = await query(select, [id]);
  if (result.rowCount === 0) {
    return null;
  }
  const row = result.rows[0] as Record<string, unknown>;
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
    needs_conflict_resolution: Boolean(row.needs_conflict_resolution),
  } satisfies KursEventAntwort;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json(
      { error: 'id muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }

  // Bodymapping und Basisfehler abfangen.
  let body: ResolveBody;
  try {
    body = (await request.json()) as ResolveBody;
  } catch {
    return NextResponse.json(
      { error: 'Ungültiger JSON-Body.' },
      { status: 400 }
    );
  }

  const hatTrainer = body.new_trainer_id !== undefined;
  const hatZeit = body.new_start_time !== undefined;

  // Exakt eines der beiden Felder ist gültig.
  if (hatTrainer === hatZeit) {
    return NextResponse.json(
      {
        error:
          'Es muss genau eines von new_trainer_id oder new_start_time übergeben werden.',
      },
      { status: 400 }
    );
  }

  const setParts: string[] = [];
  const sqlParams: unknown[] = [];

  if (hatTrainer) {
    const trainerId = Number(body.new_trainer_id);
    if (!Number.isInteger(trainerId) || trainerId <= 0) {
      return NextResponse.json(
        { error: 'new_trainer_id muss eine positive Ganzzahl sein.' },
        { status: 400 }
      );
    }

    // Existenzprüfung gegen public.trainer (keine Vermutungen über IDs).
    try {
      const check = await query('SELECT id FROM public.trainer WHERE id = $1', [
        trainerId,
      ]);
      if (check.rowCount === 0) {
        return NextResponse.json(
          { error: `Trainer mit id ${trainerId} existiert nicht.` },
          { status: 400 }
        );
      }
    } catch (err: unknown) {
      console.error('Fehler bei der Trainer-Existenzprüfung:', err);
      return NextResponse.json(
        { error: 'Datenbankfehler bei der Trainer-Prüfung.' },
        { status: 500 }
      );
    }

    sqlParams.push(trainerId);
    setParts.push(`trainer_id = $${sqlParams.length}`);
  }

  if (hatZeit) {
    const startInput = String(body.new_start_time ?? '').trim();
    const istIso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(startInput);
    if (!istIso || Number.isNaN(Date.parse(startInput))) {
      return NextResponse.json(
        {
          error:
            'new_start_time muss als lokaler Berliner Zeitstempel im Format YYYY-MM-DDTHH:MM (oder mit Sekunden) übergeben werden.',
        },
        { status: 400 }
      );
    }

    // Lokaler Zeitstempel ohne Offset → als Europe/Berlin interpretieren.
    // Ergibt für einen 1,5-Stunden-Kurs: end_time = start + 90 Minuten.
    sqlParams.push(startInput, startInput);
    setParts.push(
      `start_time = ($${sqlParams.length - 1}::timestamp AT TIME ZONE 'Europe/Berlin')`,
      `end_time = (($${sqlParams.length}::timestamp AT TIME ZONE 'Europe/Berlin') + INTERVAL '${SLOT_DAUER_MINUTEN} minutes')`
    );
  }

  // Zwingende Auflösung des Konflikts + Audit-Stempel.
  setParts.push('needs_conflict_resolution = false');
  setParts.push('updated_at = NOW()');
  sqlParams.push(id);

  try {
    const result = await query(
      `UPDATE public.course_events
       SET ${setParts.join(', ')}
       WHERE id = $${sqlParams.length}`,
      sqlParams
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: 'Termin nicht gefunden.' },
        { status: 404 }
      );
    }

    const termin = await ladeTerminMitJoins(id);
    if (!termin) {
      return NextResponse.json(
        { error: 'Termin nach dem Update nicht lesbar.' },
        { status: 500 }
      );
    }

    // n8n-Sync-Benachrichtigung (Fire-and-Forget): Der Termin ist erfolgreich
    // aufgelöst (needs_conflict_resolution = false). Interessiert sich der
    // n8n-Workflow dafür, holt er den aktualisierten Datensatz selbst ab.
    // Der Ping verzögert den Response nicht und crasht die Route nicht.
    benachrichtigeN8n();

    return NextResponse.json({ resolved: true, termin }, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Auflösen des Konflikts:', err);
    return NextResponse.json(
      { error: `Datenbankfehler beim Auflösen des Konflikts: ${toErrorMessage(err)}` },
      { status: 500 }
    );
  }
}
