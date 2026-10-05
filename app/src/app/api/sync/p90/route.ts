import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

// ---------------------------------------------------------------------------
// POST /api/sync/p90
// Manueller Auslöser für den edoobox-Synchronisations-Workflow P90.
// Leitet den Aufruf an den n8n-Webhook weiter (Quelle: "manual_ui").
// ---------------------------------------------------------------------------

// Route immer dynamisch ausführen – keine statische Optimierung/Cache.
export const dynamic = 'force-dynamic';

export async function POST() {
  const webhookUrl = process.env.N8N_P90_WEBHOOK_URL?.trim();

  // Lokaler Entwicklungs-Fallback: Ohne konfigurierte Webhook-URL wird ein
  // simulierter Erfolg zurückgegeben, damit die Oberfläche ohne n8n testbar ist.
  if (!webhookUrl) {
    console.warn(
      'N8N_P90_WEBHOOK_URL ist nicht gesetzt – simulierter P90-Sync-Erfolg.'
    );
    revalidatePath('/');
    return NextResponse.json(
      { success: true, message: 'Synchronisierung erfolgreich gestartet' },
      { status: 200 }
    );
  }

  const payload = {
    source: 'manual_ui',
    triggered_at: new Date().toISOString(),
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Festes Timeout, damit die Route bei hängendem n8n-Webhook nicht blockiert.
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(
        `n8n P90-Webhook antwortete mit Status ${response.status}.`
      );
      return NextResponse.json(
        {
          success: false,
          error: `Synchronisierung fehlgeschlagen: n8n-Webhook antwortete mit Status ${response.status}.`,
        },
        { status: 500 }
      );
    }

    // Cache der Startseite nach erfolgreichem Sync invalidieren.
    revalidatePath('/');

    return NextResponse.json(
      { success: true, message: 'Synchronisierung erfolgreich gestartet' },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('Fehler beim Aufruf des n8n P90-Webhooks:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'Synchronisierung fehlgeschlagen: n8n-Webhook ist nicht erreichbar.',
      },
      { status: 500 }
    );
  }
}