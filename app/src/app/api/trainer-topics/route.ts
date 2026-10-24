import { NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/trainer-topics
// Themen-Zuordnung eines Trainers (public.trainer_topics).
//   GET  /api/trainer-topics?trainerId=42  -> übernommene topic_ids inkl.
//        priorisierter (Haupt-)Themen (primaryTopicIds)
//   PUT  /api/trainer-topics               -> Zuordnung ersetzen (Body:
//        { trainerId: number,
//          topicIds: number[],
//          primaryTopicIds?: number[] })   -> Teilmenge von topicIds, markiert
//        den Trainer als Haupttrainer (is_primary = true) je Thema.
// Grundlage für die L-05 Puzzle-Logik (Szenario 2): Welche Themen kann ein
// Trainer, und für welche ist er der Haupttrainer (Priorität)?
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

interface TrainerTopicsBody {
  trainerId?: unknown;
  topicIds?: unknown;
  primaryTopicIds?: unknown;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Erwartet eine positive Ganzzahl. */
function parseId(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return null;
  }
  return n;
}

// ---------------------------------------------------------------------------
// GET: topic_ids + Hauptthemen eines Trainers laden
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trainerId = parseId(searchParams.get('trainerId'));

  if (trainerId === null) {
    return NextResponse.json(
      { error: 'Der Parameter "trainerId" muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }

  try {
    const result = await query(
      `SELECT topic_id, is_primary
       FROM public.trainer_topics
       WHERE trainer_id = $1
       ORDER BY topic_id ASC`,
      [trainerId]
    );

    const topicIds: number[] = [];
    const primaryTopicIds: number[] = [];
    for (const row of result.rows as Record<string, unknown>[]) {
      const topicId = Number(row.topic_id);
      topicIds.push(topicId);
      if (Boolean(row.is_primary)) {
        primaryTopicIds.push(topicId);
      }
    }

    return NextResponse.json(
      { trainerId, topicIds, primaryTopicIds },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('Fehler beim Laden der Trainer-Themen:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Trainer-Themen.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT: Zuordnung ersetzen (löschen + neu einfügen in einer Transaktion)
// ---------------------------------------------------------------------------
export async function PUT(request: Request) {
  let body: TrainerTopicsBody;

  try {
    body = (await request.json()) as TrainerTopicsBody;
  } catch {
    return NextResponse.json(
      { error: 'Ungültiger JSON-Body.' },
      { status: 400 }
    );
  }

  const trainerId = parseId(body.trainerId);
  if (trainerId === null) {
    return NextResponse.json(
      { error: '"trainerId" muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.topicIds)) {
    return NextResponse.json(
      { error: '"topicIds" muss ein Array von Ganzzahlen sein.' },
      { status: 400 }
    );
  }

  const topicIds = body.topicIds.map(parseId);
  if (body.topicIds.length > 0 && topicIds.some((t) => t === null)) {
    return NextResponse.json(
      { error: '"topicIds" darf nur positive Ganzzahlen enthalten.' },
      { status: 400 }
    );
  }

  // Hauptthemen sind optional; fehlen sie, wird nichts als Haupttrainer markiert.
  let primaryTopicIds: number[] = [];
  if (body.primaryTopicIds !== undefined && body.primaryTopicIds !== null) {
    if (!Array.isArray(body.primaryTopicIds)) {
      return NextResponse.json(
        { error: '"primaryTopicIds" muss ein Array von Ganzzahlen sein.' },
        { status: 400 }
      );
    }
    const parsed = body.primaryTopicIds.map(parseId);
    if (
      body.primaryTopicIds.length > 0 &&
      parsed.some((t) => t === null)
    ) {
      return NextResponse.json(
        { error: '"primaryTopicIds" darf nur positive Ganzzahlen enthalten.' },
        { status: 400 }
      );
    }
    primaryTopicIds = parsed.filter((t): t is number => t !== null);
  }

  // Doppelte Einträge entfernen, Reihenfolge stabil halten.
  const eindeutig = Array.from(
    new Set(topicIds.filter((t): t is number => t !== null))
  );
  const eindeutigePrimary = Array.from(new Set(primaryTopicIds));

  // Hauptthemen müssen eine Teilmenge der zugewiesenen Themen sein.
  const gueltigePrimary = eindeutigePrimary.filter((id) =>
    eindeutig.includes(id)
  );
  if (gueltigePrimary.length !== eindeutigePrimary.length) {
    return NextResponse.json(
      {
        error:
          '"primaryTopicIds" darf nur Themen enthalten, die auch in "topicIds" zugewiesen sind.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await transaction(async (client) => {
      // Existiert der Trainer? (FK wirft bei unbekannter ID sonst 23503.)
      const trainerCheck = await client.query(
        `SELECT 1 FROM public.trainer WHERE id = $1`,
        [trainerId]
      );
      if (trainerCheck.rowCount === 0) {
        throw new Error('UNBEKANNTER_TRAINER');
      }

      // Bestehende Zuordnung entfernen.
      await client.query(
        `DELETE FROM public.trainer_topics WHERE trainer_id = $1`,
        [trainerId]
      );

      // Neue Zuordnung einfügen (nur wenn Themen gewählt wurden).
      if (eindeutig.length > 0) {
        const values: unknown[] = [];
        const placeholders = eindeutig
          .map((topicId, index) => {
            const offset = index * 3;
            values.push(
              trainerId,
              topicId,
              gueltigePrimary.includes(topicId)
            );
            return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
          })
          .join(', ');

        await client.query(
          `INSERT INTO public.trainer_topics (trainer_id, topic_id, is_primary)
           VALUES ${placeholders}
           ON CONFLICT (trainer_id, topic_id)
             DO UPDATE SET is_primary = EXCLUDED.is_primary`,
          values
        );
      }

      // Aktuellen Bestand zurückliefern.
      const current = await client.query(
        `SELECT topic_id, is_primary
         FROM public.trainer_topics
         WHERE trainer_id = $1
         ORDER BY topic_id ASC`,
        [trainerId]
      );

      const currentTopics: number[] = [];
      const currentPrimary: number[] = [];
      for (const row of current.rows as Record<string, unknown>[]) {
        const topicId = Number(row.topic_id);
        currentTopics.push(topicId);
        if (Boolean(row.is_primary)) {
          currentPrimary.push(topicId);
        }
      }

      return {
        trainerId,
        topicIds: currentTopics,
        primaryTopicIds: currentPrimary,
      };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    if (toErrorMessage(err) === 'UNBEKANNTER_TRAINER') {
      return NextResponse.json(
        { error: 'Der angegebene Trainer existiert nicht.' },
        { status: 404 }
      );
    }
    console.error('Fehler beim Speichern der Trainer-Themen:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Speichern der Trainer-Themen.' },
      { status: 500 }
    );
  }
}
