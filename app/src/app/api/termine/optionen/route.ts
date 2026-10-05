import { NextResponse } from 'next/server';
import { transaction } from '@/lib/db';

// ---------------------------------------------------------------------------
// POST: Persistente Options-Haken (Einladungslink, Last Minute, abgerechnet)
//       für einen oder mehrere Termine speichern. Die Änderung gilt einheitlich
//       für alle übergebenen date_ids (Kurs = mehrere Termine).
// ---------------------------------------------------------------------------

interface OptionenBody {
  date_ids?: unknown;
  einladungslink?: unknown;
  last_minute?: unknown;
  abgerechnet?: unknown;
}

/** Whitelist der schreibbaren Options-Spalten (Schutz vor SQL-Injection). */
const OPTIONEN_SPALTEN = ['einladungslink', 'last_minute', 'abgerechnet'] as const;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OptionenBody;

    // date_ids: nicht-leeres Array aus nicht-leeren Strings.
    const dateIds = Array.isArray(body.date_ids)
      ? body.date_ids.filter(
          (id): id is string => typeof id === 'string' && id.trim() !== ''
        )
      : [];

    if (dateIds.length === 0) {
      return NextResponse.json(
        { error: 'Es müssen mindestens eine date_id übergeben werden.' },
        { status: 400 }
      );
    }

    // Optionen: nur explizit übergebene boolesche Werte werden geschrieben.
    const optionen: Partial<Record<(typeof OPTIONEN_SPALTEN)[number], boolean>> = {};
    for (const spalte of OPTIONEN_SPALTEN) {
      if (typeof body[spalte] === 'boolean') {
        optionen[spalte] = body[spalte] as boolean;
      }
    }

    if (Object.keys(optionen).length === 0) {
      return NextResponse.json(
        {
          error:
            'Mindestens eine Option (einladungslink, last_minute, abgerechnet) muss übergeben werden.',
        },
        { status: 400 }
      );
    }

    // Dynamisches UPSERT: Es werden ausschließlich die übergebenen Spalten
    // gesetzt (NOT-NULL-Spalten bleiben bei Teil-Updates unangetastet).
    const spalten = Object.keys(optionen) as (typeof OPTIONEN_SPALTEN)[number][];
    const setClauses = spalten.map((spalte, index) => `${spalte} = $${index + 2}`);
    setClauses.push('updated_at = NOW()');

    await transaction(async (client) => {
      for (const dateId of dateIds) {
        await client.query(
          `INSERT INTO public.termin_optionen
             (date_id, ${spalten.join(', ')}, updated_at)
           VALUES ($1, ${spalten.map((_, index) => `$${index + 2}`).join(', ')}, NOW())
           ON CONFLICT (date_id) DO UPDATE SET
             ${setClauses.join(', ')}`,
          [dateId, ...spalten.map((spalte) => optionen[spalte])]
        );
      }
    });

    return NextResponse.json({ ok: true, date_ids: dateIds }, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Speichern der Termin-Optionen:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Speichern der Termin-Optionen.' },
      { status: 500 }
    );
  }
}