import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Erwarteter Request-Body für die Trainer-Umzuweisung eines Kursangebots. */
interface TrainerZuweisungBody {
  offer_id?: unknown;
  /** Einzeltermine (date_id) des Kurses – mehrtägige Besetzung vereinheitlichen. */
  date_ids?: unknown;
  neuer_trainer_kuerzel?: unknown;
  altes_trainer_kuerzel?: unknown;
}

/** Vom n8n-Workflow P98 zurückgegebene Struktur (sofern als JSON parsen). */
interface WorkflowAntwort {
  success?: unknown;
  offer_id?: unknown;
  neuer_titel?: unknown;
}

// ---------------------------------------------------------------------------
// POST: Trainer-Umzuweisung über den n8n-Workflow P98 ausführen
// ---------------------------------------------------------------------------

/**
 * Leitet eine Trainer-Umzuweisung an den n8n-Workflow „P98 – Einzelfall
 * Trainerzuweisung" weiter. Der Workflow passt in edoobox den Angebotstitel
 * sowie den Termin-Trainer an und aktualisiert anschließend die lokale
 * trainer_zuweisung. Seine Antwort (u. a. neuer_titel) wird unverändert an
 * den Client zurückgegeben.
 */
export async function POST(request: Request) {
  let body: TrainerZuweisungBody;

  try {
    body = (await request.json()) as TrainerZuweisungBody;
  } catch {
    return NextResponse.json(
      { error: 'Ungültiger JSON-Body.' },
      { status: 400 }
    );
  }

  // Validierung: offer_id muss als nicht-leerer String vorliegen.
  const offerId =
    typeof body.offer_id === 'string' ? body.offer_id.trim() : '';

  // neuer_trainer_kuerzel: Nur undefined/null sind ein harter Fehler.
  // Gültig sind nicht-leere Strings sowie 'n. v.' und '' (Aufheben der
  // Zuweisung); ein leerer String wird auf 'n. v.' normalisiert, bevor er
  // an den n8n-Workflow weitergeleitet wird.
  if (
    body.neuer_trainer_kuerzel === undefined ||
    body.neuer_trainer_kuerzel === null
  ) {
    return NextResponse.json(
      { error: 'neuer_trainer_kuerzel fehlt.' },
      { status: 400 }
    );
  }

  const kuerzel =
    typeof body.neuer_trainer_kuerzel === 'string'
      ? body.neuer_trainer_kuerzel.trim()
      : '';

  // altes_trainer_kuerzel: optional. Wird als getrimmter String an den
  // n8n-Workflow weitergeleitet, sofern vorhanden; andernfalls entfällt
  // das Feld im Webhook-Payload.
  const altesKuerzel =
    typeof body.altes_trainer_kuerzel === 'string'
      ? body.altes_trainer_kuerzel.trim()
      : undefined;

  // date_ids (optional): bereinigtes String-Array der betroffenen
  // Einzeltermine. Wird an den Workflow durchgereicht, damit mehrtägige
  // Kurse kursweit vereinheitlicht werden können.
  const dateIds = Array.isArray(body.date_ids)
    ? body.date_ids
        .filter((item): item is string => typeof item === 'string')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    : [];

  if (offerId === '') {
    return NextResponse.json(
      { error: 'offer_id fehlt oder ist kein nicht-leerer String.' },
      { status: 400 }
    );
  }

  // Leerer String wird als Aufheben interpretiert und als 'n. v.' an den
  // n8n-Workflow weitergeleitet.
  const kuerzelFuerWebhook = kuerzel === '' ? 'n. v.' : kuerzel;

  // Webhook-Weiterleitung an den n8n-Workflow P98.
  const webhookUrl = `${
    process.env.N8N_WEBHOOK_URL || 'https://m.webinarcenter.de/webhook'
  }/trainer-update`;

  let res: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const webhookPayload: Record<string, unknown> = {
      offer_id: offerId,
      neuer_trainer_kuerzel: kuerzelFuerWebhook,
      altes_trainer_kuerzel: altesKuerzel,
    };
    if (dateIds.length > 0) {
      webhookPayload.date_ids = dateIds;
    }

    res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Fehler beim Aufruf des n8n-Webhooks (trainer-update):', err);
    return NextResponse.json(
      { error: `Webhook-Aufruf fehlgeschlagen: ${msg}` },
      { status: 502 }
    );
  }

  // Abweichende Statuscodes sauber abfangen.
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // Antworttext ist nicht lesbar – Meldung bleibt ohne Detail.
    }

    const zusatz = detail.trim() ? ` ${detail.trim()}` : '';
    console.error(
      `n8n-Workflow P98 antwortete mit Status ${res.status}:${zusatz}`
    );

    return NextResponse.json(
      {
        error: `n8n-Workflow antwortete mit Status ${res.status}.${zusatz}`,
      },
      { status: 502 }
    );
  }

  // Erfolg: den vom Workflow gelieferten JSON-Body durchreichen.
  let antwort: WorkflowAntwort;
  try {
    antwort = (await res.json()) as WorkflowAntwort;
  } catch {
    // Workflow hat keinen JSON-Body geliefert – Erfolg trotzdem melden.
    return NextResponse.json({ success: true }, { status: 200 });
  }

  return NextResponse.json(antwort, { status: 200 });
}
