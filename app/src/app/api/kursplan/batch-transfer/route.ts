import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/kursplan/batch-transfer
// Batch-Transfer markierter Planungstermine an den n8n-Workflow B01
// (Kurstransfer edoobox). B01 erwartet ein kurse-Array; pro Kurs werden
// number, category, sourceOfferId, name und date_start übergeben.
//
// POST { ids: number[] }
//   -> lädt die Termine (inkl. Themen-Stammdaten), baut das kurse-Array,
//      sendet es an den B01-Webhook und setzt bei Erfolg sync_status =
//      'uebertragen' für alle übertragenen Termine.
//
// Termine ohne vollständige Transferdaten (kurs_code, kategorie_id,
// vorlage_offer_id) werden übersprungen und als fehlend gemeldet.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

/** Basis-URL des n8n-Webhooks (wie in trainer-zuweisung/route.ts). */
const N8N_BASE_URL =
  process.env.N8N_WEBHOOK_URL?.trim() || 'https://m.webinarcenter.de/webhook';

/** B01-Webhook-Pfad (Workflow B01_Kurstransfer_edoobox, Webhook "Kurstransfer"). */
const B01_WEBHOOK_URL = `${N8N_BASE_URL}/Kurstransfer`;

/** Gemeinsames Secret für den Header "X-Sync-Token" (optional). */
const N8N_SYNC_SECRET = process.env.N8N_SYNC_SECRET?.trim() || '';

interface TransferZeile {
  id: number;
  kurs_code: string | null;
  kategorie_id: string | null;
  vorlage_offer_id: string | null;
  thema: string;
  datum: string;
  beginn: string;
}

export async function POST(req: Request) {
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Request-Body muss gültiges JSON sein.' },
      { status: 400 }
    );
  }

  const ids = Array.isArray(body.ids) ? body.ids : null;
  if (!ids || ids.length === 0) {
    return NextResponse.json(
      { error: 'ids ist ein Pflichtfeld (nicht-leeres Array von Termin-IDs).' },
      { status: 400 }
    );
  }
  const numIds = ids.map((v) => Number(v));
  if (numIds.some((n) => !Number.isInteger(n) || n <= 0)) {
    return NextResponse.json(
      { error: 'ids darf nur positive Ganzzahlen enthalten.' },
      { status: 400 }
    );
  }

  try {
    // Termine mit Themen-Stammdaten laden (nur noch nicht übertragene).
    const result = await query(
      `SELECT kt.id, ct.kurs_code, ct.kategorie_id, ct.vorlage_offer_id,
              ct.name AS thema, kt.datum::text AS datum, kt.beginn::text AS beginn
         FROM public.kursplan_termin kt
         JOIN public.course_topics ct ON ct.id = kt.topic_id
        WHERE kt.id = ANY($1::bigint[])
          AND kt.sync_status <> 'uebertragen'
        ORDER BY kt.datum ASC, kt.beginn ASC`,
      [numIds]
    );

    const zeilen = (result.rows as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      kurs_code: r.kurs_code == null ? null : String(r.kurs_code),
      kategorie_id: r.kategorie_id == null ? null : String(r.kategorie_id),
      vorlage_offer_id: r.vorlage_offer_id == null ? null : String(r.vorlage_offer_id),
      thema: String(r.thema),
      datum: String(r.datum).slice(0, 10),
      beginn: String(r.beginn).slice(0, 5),
    })) as TransferZeile[];

    if (zeilen.length === 0) {
      return NextResponse.json(
        { error: 'Keine übertragbaren Termine gefunden (IDs ungültig oder bereits übertragen).' },
        { status: 404 }
      );
    }

    // Termine ohne vollständige Transferdaten aussortieren.
    const vollstaendig = zeilen.filter(
      (z) => z.kurs_code && z.kategorie_id && z.vorlage_offer_id
    );
    const unvollstaendig = zeilen.filter(
      (z) => !z.kurs_code || !z.kategorie_id || !z.vorlage_offer_id
    );

    if (vollstaendig.length === 0) {
      return NextResponse.json(
        {
          error:
            'Keiner der markierten Termine hat vollständige Transferdaten (kurs_code, kategorie_id, vorlage_offer_id). Bitte zuerst im Themen-Stamm pflegen.',
          unvollstaendig: unvollstaendig.map((z) => z.id),
        },
        { status: 400 }
      );
    }

    // B01-Payload aufbauen (Format aus B01_Kurstransfer_edoobox).
    const kurse = vollstaendig.map((z) => ({
      number: z.kurs_code,
      category: z.kategorie_id,
      sourceOfferId: z.vorlage_offer_id,
      name: z.thema,
      date_start: `${z.datum} ${z.beginn}`,
      datum: z.datum,
      beginn: z.beginn,
      kursCode: z.kurs_code,
    }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response: Response;
    try {
      response = await fetch(B01_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(N8N_SYNC_SECRET ? { 'X-Sync-Token': N8N_SYNC_SECRET } : {}),
        },
        body: JSON.stringify({ kurse }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return NextResponse.json(
        {
          error: `B01-Webhook antwortete mit Status ${response.status}.`,
          detail: text.slice(0, 500),
          uebertragen: [],
          fehlend: unvollstaendig.map((z) => z.id),
        },
        { status: 502 }
      );
    }

    // Erfolg: sync_status auf 'uebertragen' setzen.
    const uebertrageneIds = vollstaendig.map((z) => z.id);
    await query(
      `UPDATE public.kursplan_termin
          SET sync_status = 'uebertragen', updated_at = NOW()
        WHERE id = ANY($1::bigint[])`,
      [uebertrageneIds]
    );

    return NextResponse.json(
      {
        ok: true,
        uebertragen: uebertrageneIds,
        fehlend: unvollstaendig.map((z) => z.id),
        anzahl: uebertrageneIds.length,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Zeitüberschreitung beim Aufruf des B01-Webhooks (30 s).' },
        { status: 504 }
      );
    }
    console.error('Fehler beim Batch-Transfer an B01:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Batch-Transfer.' },
      { status: 500 }
    );
  }
}