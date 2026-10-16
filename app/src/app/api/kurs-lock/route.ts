import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface LockRow {
  id: number;
  is_locked: boolean;
  owner_key: string | null;
  hinweis: string | null;
  updated_at: string;
}

function toLockRow(row: Record<string, unknown>): LockRow {
  return {
    id: Number(row.id),
    is_locked: Boolean(row.is_locked),
    owner_key: row.owner_key == null ? null : String(row.owner_key),
    hinweis: row.hinweis == null ? null : String(row.hinweis),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// GET: Liefert den aktuellen Sperrzustand. Die Frontend lädt diesen Status
// beim Start, damit die UI nach einem Reload gesperrt bleibt, solange eine
// Übertragung nach edoobox läuft.
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const result = await query(
      `SELECT id, is_locked, owner_key, hinweis, updated_at
         FROM kurstransfer_lock
        WHERE id = 1`
    );
    const eintrag = result.rows.length > 0 ? toLockRow(result.rows[0] as Record<string, unknown>) : null;
    return NextResponse.json({ gesperrt: eintrag ? eintrag.is_locked : false, eintrag });
  } catch (err) {
    console.error('GET /api/kurs-lock fehlgeschlagen:', err);
    return NextResponse.json(
      { error: 'Sperrzustand konnte nicht geladen werden.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST: Setzt oder hebt die Transfersperre auf (vollständiger Austausch des
// Sperrzustands, kein JSON-Merge). is_locked ist Pflicht.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Request-Body muss gültiges JSON sein.' },
      { status: 400 }
    );
  }

  if (typeof body.is_locked !== 'boolean') {
    return NextResponse.json(
      { error: 'is_locked ist ein Pflichtfeld und muss true oder false sein.' },
      { status: 400 }
    );
  }

  const isLocked = body.is_locked;
  const ownerKey =
    typeof body.owner_key === 'string' && body.owner_key.trim() !== ''
      ? body.owner_key.trim()
      : null;
  const hinweis =
    typeof body.hinweis === 'string' && body.hinweis.trim() !== ''
      ? body.hinweis.trim()
      : null;
  // Ein optionaler Ablaufzeitpunkt (ISO), nach dem die Sperre als verfallen gilt.
  const expiresAt =
    typeof body.expires_at === 'string' && body.expires_at.trim() !== ''
      ? body.expires_at.trim()
      : null;

  try {
    const result = await query(
      `INSERT INTO kurstransfer_lock (id, is_locked, owner_key, hinweis)
       VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         is_locked = EXCLUDED.is_locked,
         owner_key = EXCLUDED.owner_key,
         hinweis = EXCLUDED.hinweis,
         updated_at = NOW()
       RETURNING id, is_locked, owner_key, hinweis, created_at, updated_at`,
      [isLocked, ownerKey, hinweis]
    );

    const eintrag = toLockRow(result.rows[0] as Record<string, unknown>);
    return NextResponse.json({ gesperrt: eintrag.is_locked, eintrag }, { status: 200 });
  } catch (err) {
    console.error('POST /api/kurs-lock fehlgeschlagen:', err);
    return NextResponse.json(
      { error: 'Sperrzustand konnte nicht gespeichert werden.' },
      { status: 500 }
    );
  }
}
