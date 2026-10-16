import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Route immer dynamisch ausliefern – verhindert statisches Caching durch
// Next.js App Router (GET ohne dynamische Funktionen wird sonst beim Build
// gecacht und liefert veraltete Statuswerte aus).
export const dynamic = 'force-dynamic';

interface StatusRow {
  kurs_key: string;
  status: string;
  edoobox_offer_id: string | null;
  hinweis: string | null;
  updated_at: string;
}

const ERLAUBTE_STATUS = ['erledigt', 'offen'];

function toStatusRow(row: Record<string, unknown>): StatusRow {
  return {
    kurs_key: String(row.kurs_key),
    status: String(row.status),
    edoobox_offer_id: row.edoobox_offer_id == null ? null : String(row.edoobox_offer_id),
    hinweis: row.hinweis == null ? null : String(row.hinweis),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// GET: Liefert alle gespeicherten Kursstatus-Einträge.
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const result = await query(
      `SELECT kurs_key, status, edoobox_offer_id, hinweis, updated_at
       FROM kurstransfer_status
       ORDER BY kurs_key`
    );

    const eintraege: StatusRow[] = result.rows.map((row: Record<string, unknown>) =>
      toStatusRow(row)
    );

    return NextResponse.json(
      { eintraege },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('GET /api/kurs-status fehlgeschlagen:', err);
    return NextResponse.json(
      { error: 'Status-Einträge konnten nicht geladen werden.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST: Legt einen Status-Eintrag an oder ersetzt ihn vollständig (UPSERT).
// Der Client sendet den vollständigen Zustand; fehlende optionale Felder
// werden als NULL gespeichert (kein JSON-Merge).
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

  const kursKey = typeof body.kurs_key === 'string' ? body.kurs_key.trim() : '';
  const status = typeof body.status === 'string' ? body.status.trim() : '';
  // Status normalisieren (case-insensitive): Der Client kann je nach Quelle
  // 'offen', 'Offen' oder 'OFFEN' senden (Anzeigewert aus Excel/UI). Für den
  // Abgleich mit ERLAUBTE_STATUS und für die Persistierung wird immer auf
  // Kleinbuchstaben normalisiert, damit das Zurücksetzen auf "Offen" nie an
  // einer Großschreibung scheitert (HTTP 200 statt 400).
  const statusNormalisiert = status.toLowerCase();
  const edooboxOfferId =
    typeof body.edoobox_offer_id === 'string' && body.edoobox_offer_id.trim() !== ''
      ? body.edoobox_offer_id.trim()
      : null;
  const hinweis =
    typeof body.hinweis === 'string' && body.hinweis.trim() !== ''
      ? body.hinweis.trim()
      : null;

  if (!kursKey) {
    return NextResponse.json(
      { error: 'kurs_key ist ein Pflichtfeld.' },
      { status: 400 }
    );
  }
  if (kursKey.length > 100) {
    return NextResponse.json(
      { error: 'kurs_key darf maximal 100 Zeichen lang sein.' },
      { status: 400 }
    );
  }
  if (!ERLAUBTE_STATUS.includes(statusNormalisiert)) {
    return NextResponse.json(
      { error: `status muss einer der Werte ${ERLAUBTE_STATUS.join(', ')} sein.` },
      { status: 400 }
    );
  }
  if (edooboxOfferId && edooboxOfferId.length > 50) {
    return NextResponse.json(
      { error: 'edoobox_offer_id darf maximal 50 Zeichen lang sein.' },
      { status: 400 }
    );
  }

  try {
    // Bei Zielstatus "Offen" wird der Eintrag über den UPSERT auf den
    // normalisierten Status 'offen' aktualisiert (kein JSON-Merge, keine
    // Verwaiste Altfelder). Damit bleibt der Kurs nach F5 / Excel-Neuladen
    // dauerhaft als "Offen" sichtbar, statt wieder auf den Excel-Status
    // zurückzufallen.
    const result = await query(
      `INSERT INTO kurstransfer_status (kurs_key, status, edoobox_offer_id, hinweis)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (kurs_key) DO UPDATE SET
         status = EXCLUDED.status,
         edoobox_offer_id = EXCLUDED.edoobox_offer_id,
         hinweis = EXCLUDED.hinweis
       RETURNING kurs_key, status, edoobox_offer_id, hinweis, updated_at`,
      [kursKey, statusNormalisiert, edooboxOfferId, hinweis]
    );

    const eintrag = toStatusRow(result.rows[0] as Record<string, unknown>);
    return NextResponse.json({ eintrag }, { status: 200 });
  } catch (err) {
    console.error('POST /api/kurs-status fehlgeschlagen:', err);
    return NextResponse.json(
      { error: 'Status-Eintrag konnte nicht gespeichert werden.' },
      { status: 500 }
    );
  }
}
