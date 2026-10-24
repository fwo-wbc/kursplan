import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/kursthemen
// Kurstitel-Stamm der lokalen App-Daten (public."Kursthemen").
//
// GET -> alle Kurstitel (id, titel, created_at), alphabetisch nach titel.
//
// Die Tabelle public."Kursthemen" wird idempotent aus den eindeutigen,
// nicht-leeren Kurstiteln von edoobox_raw.offer.name befuellt (siehe
// kursthemen_migration.sql). esoobox_raw bleibt dabei unveraenderter Spiegel.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

interface KursthemaRow {
  id: number;
  titel: string;
  created_at: Date;
}

function mapRow(row: Record<string, unknown>): KursthemaRow {
  return {
    id: Number(row.id),
    titel: String(row.titel),
    created_at: row.created_at as Date,
  };
}

// ---------------------------------------------------------------------------
// GET – alle Kurstitel
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const result = await query(
      `SELECT id, titel, created_at
         FROM public."Kursthemen"
        ORDER BY titel ASC, id ASC`
    );

    const themen = (result.rows as Record<string, unknown>[]).map(mapRow);
    return NextResponse.json(themen, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Laden der Kurstitel:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Kurstitel.' },
      { status: 500 }
    );
  }
}