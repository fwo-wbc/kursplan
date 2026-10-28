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

  // Fehlende Webhook-URL niemals als Erfolg melden: In Produktion muss der
  // Aufrufer einen echten Fehler sehen, sonst zeigt das Frontend
  // "Synchronisiert", obwohl n8n nie erreicht wurde. Der simulierte Erfolg
  // ist ausschließlich für die lokale Entwicklung ohne n8n gedacht.
  if (!webhookUrl) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        'N8N_P90_WEBHOOK_URL ist nicht gesetzt – P90-Sync kann nicht gestartet werden.'
      );
      return NextResponse.json(
        {
          success: false,
          error:
            'Synchronisierung fehlgeschlagen: N8N_P90_WEBHOOK_URL ist nicht konfiguriert.',
        },
        { status: 500 }
      );
    }

    console.warn(
      'N8N_P90_WEBHOOK_URL ist nicht gesetzt – simulierter P90-Sync-Erfolg (nur Entwicklung).'
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