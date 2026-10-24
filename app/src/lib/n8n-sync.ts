// ---------------------------------------------------------------------------
// app/src/lib/n8n-sync.ts
// n8n-Sync-Benachrichtigung für den L-05 Serienplaner.
//
// Sobald neue bzw. aufgelöste course_events-Einträge bereitstehen, wird ein
// non-blocking Ping an den n8n-Webhook (N8N_EDOOBOX_WEBHOOK_URL) gesendet,
// damit n8n die konfliktfreien Termine an edoobox übertragen kann.
//
// WICHTIG: Die Benachrichtigung ist Fire-and-Forget – die aufrufende
// API-Route wird durch den Fetch niemals verzögert, und ein Fehler beim
// Fetch wird ausschließlich per console.error protokolliert (kein Throw).
// ---------------------------------------------------------------------------

/** Payload-Aktion, mit der n8n über bereitstehende Termine informiert wird. */
export type N8nSyncAction = 'sync_pending_events';

/**
 * Sendet einen non-blocking POST-Ping an den n8n-Webhook.
 *
 * @param action Aktion für n8n; Standard: 'sync_pending_events'.
 */
export function benachrichtigeN8n(action: N8nSyncAction = 'sync_pending_events'): void {
  const webhookUrl = process.env.N8N_EDOOBOX_WEBHOOK_URL?.trim();

  // Ohne konfigurierte Webhook-URL wird der Ping sicher übersprungen –
  // die Route bleibt in lokalen Umgebungen voll funktionsfähig.
  if (!webhookUrl) {
    console.warn(
      'N8N_EDOOBOX_WEBHOOK_URL ist nicht gesetzt – n8n-Sync-Benachrichtigung übersprungen.'
    );
    return;
  }

  // Fire-and-Forget: Das Promise wird nicht awaitet und bewusst nicht in die
  // Route zurückgereicht. Ein kurzer Timeout verhindert hängende Sockets.
  void fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
    signal: AbortSignal.timeout(5000),
  }).catch((err: unknown) => {
    console.error('Fehler beim n8n-Webhook-Call (non-blocking):', err);
  });
}