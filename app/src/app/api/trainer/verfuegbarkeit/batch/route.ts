import { NextResponse } from 'next/server';
import {
  isIsoDatum,
  parseTrainerId,
  toErrorMessage,
  persistiereTag,
  TageEintrag,
} from '@/lib/verfuegbarkeit';

// ---------------------------------------------------------------------------
// POST: Verfügbarkeiten mehrerer Tage in einem Request speichern (Batch).
//
// Body: { trainerId: number, entries: [{ datum: 'YYYY-MM-DD', vm: boolean,
//        nm: boolean }, ...] }
//
// Die Persistenz je Tag übernimmt persistiereTag() aus der gemeinsamen Lib
// (identische Slot-Auflösung und Transaktionslogik wie /api/verfuegbarkeit).
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  let body: {
    trainerId?: unknown;
    entries?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: 'Ungültiger JSON-Body.' },
      { status: 400 }
    );
  }

  const trainerId = parseTrainerId(body.trainerId);
  if (!trainerId) {
    return NextResponse.json(
      { error: 'trainerId muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return NextResponse.json(
      { error: 'entries muss ein nicht-leeres Array sein.' },
      { status: 400 }
    );
  }

  const eintraege: TageEintrag[] = body.entries.map((e: unknown) => {
    const entry = (e ?? {}) as {
      datum?: unknown;
      vm?: unknown;
      nm?: unknown;
    };
    return {
      datum: String(entry.datum ?? ''),
      vm: Boolean(entry.vm),
      nm: Boolean(entry.nm),
    };
  });

  for (const eintrag of eintraege) {
    if (!isIsoDatum(eintrag.datum)) {
      return NextResponse.json(
        { error: `Ungültiges Datum: ${eintrag.datum}` },
        { status: 400 }
      );
    }
  }

  try {
    for (const eintrag of eintraege) {
      await persistiereTag(trainerId, eintrag.datum, eintrag.vm, eintrag.nm);
    }
  } catch (err: unknown) {
    console.error('Fehler beim Batch-Speichern der Verfügbarkeiten:', err);
    return NextResponse.json(
      { error: `Datenbankfehler beim Speichern: ${toErrorMessage(err)}` },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { success: true, gespeichert: eintraege.length },
    { status: 200 }
  );
}