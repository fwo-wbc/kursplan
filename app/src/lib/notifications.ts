// ---------------------------------------------------------------------------
// app/src/lib/notifications.ts
// Zentraler Event-Notification-Service für Termin-Änderungen.
//
// Sobald ein Termin seinen Status, seinen Trainer oder seine Zeit ändert,
// wird ein non-blocking POST an den n8n-Webhook gesendet, damit nachgelagerte
// Workflows (z. B. E-Mail-/Benachrichtigungs-Services) darüber informiert
// werden.
//
// Designprinzipien:
//  - Fire-and-Forget: Die aufrufende API-Route wird durch den Fetch niemals
//    verzögert; ein Fehler beim Fetch wird ausschließlich per console.error
//    protokolliert (kein Throw → die Hauptaktion, z. B. das DB-Update, bleibt
//    in jedem Fall unberührt).
//  - Ohne konfigurierte N8N_NOTIFICATION_WEBHOOK_URL wird das Event sicher
//    übersprungen (Warn-Log statt Exception).
//  - Absicherung über den gemeinsamen n8n-Secret: Header "x-sync-secret".
// ---------------------------------------------------------------------------

import { query } from '@/lib/db';

// ---------------------------------------------------------------------------
// Typen (einheitliches Payload-Format für alle Events)
// ---------------------------------------------------------------------------

/** Alle unterstützten Event-Typen für Termin-Änderungen. */
export type TerminChangeEventType =
  | 'TERMIN_STATUS_GEAENDERT'
  | 'TRAINER_ZUGEWIESEN'
  | 'TERMIN_ZEIT_GEAENDERT';

/**
 * Einheitliches Payload-Format, das an den n8n-Webhook übermittelt wird:
 * {
 *   "event": "TERMIN_STATUS_GEAENDERT" | "TRAINER_ZUGEWIESEN" | "TERMIN_ZEIT_GEAENDERT",
 *   "timestamp": "ISO-String",
 *   "termin_id": number,
 *   "kurs_titel": string,
 *   "vorher": { ... },
 *   "nachher": { ... }
 * }
 */
export interface TerminChangeEventPayload {
  event: TerminChangeEventType;
  /** ISO-8601-Zeitstempel (UTC) des Events. */
  timestamp: string;
  /** Numerische Termin-ID (edoobox date_id bzw. Reservierungs-ID). */
  termin_id: number;
  /** Kurs-/Angebotstitel des Termins. */
  kurs_titel: string;
  /** Zustand VOR der Änderung (feldabhängig, z. B. status, trainer_id, datum). */
  vorher: Record<string, unknown>;
  /** Zustand NACH der Änderung (feldabhängig, z. B. status, trainer_id, datum). */
  nachher: Record<string, unknown>;
}

/** On-the-fly-Aufrufer-Typ: event/timestamp werden von triggerChangeEvent ergänzt. */
type TriggerEingabe = Omit<TerminChangeEventPayload, 'event' | 'timestamp'>;

// ---------------------------------------------------------------------------
// Kernfunktion: Event asynchron an n8n melden (non-blocking)
// ---------------------------------------------------------------------------

/**
 * Sendet ein Termin-Änderungs-Event asynchron an den n8n-Webhook.
 *
 * - Liest N8N_NOTIFICATION_WEBHOOK_URL und N8N_SYNC_SECRET aus process.env.
 * - Schlägt der Webhook fehl oder ist keine URL konfiguriert, wird die
 *   Hauptaktion der aufrufenden Route in keinem Fall blockiert
 *   (Graceful Error Handling / Fire-and-Forget).
 *
 * @param event  Einer der Event-Typen (TERMIN_STATUS_GEAENDERT, ...).
 * @param payload Termin-bezogene Felder ohne `event`/`timestamp` (werden hier ergänzt).
 */
export function triggerChangeEvent(
  event: TerminChangeEventType,
  payload: TriggerEingabe
): void {
  const webhookUrl = process.env.N8N_NOTIFICATION_WEBHOOK_URL?.trim();

  // Ohne konfigurierte Webhook-URL wird das Event sicher übersprungen –
  // die Route bleibt in allen Umgebungen voll funktionsfähig.
  if (!webhookUrl) {
    console.warn(
      `[notifications] N8N_NOTIFICATION_WEBHOOK_URL ist nicht gesetzt – ` +
        `Event "${event}" übersprungen.`
    );
    return;
  }

  const secret = process.env.N8N_SYNC_SECRET?.trim() || '';

  const body: TerminChangeEventPayload = {
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  // Fire-and-Forget: Das Promise wird bewusst nicht awaitet und nicht in die
  // Route zurückgereicht. Ein kurzer Timeout verhindert hängende Sockets.
  void fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Gemeinsames Secret gegen unautorisierte Aufrufe (identisch zu den
      // übrigen n8n-Rückkanälen, dort jedoch als "X-Sync-Token" genutzt).
      ...(secret ? { 'x-sync-secret': secret } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  }).catch((err: unknown) => {
    console.error(
      `[notifications] Webhook-Call für Event "${event}" fehlgeschlagen (non-blocking):`,
      err
    );
  });
}

// ---------------------------------------------------------------------------
// Helfer: Termin-Kontext (numerische ID + Kurstitel) aus der Datenbank
// ---------------------------------------------------------------------------

/** Aufbereiteter Termin-Kontext für ein Event-Payload. */
export interface TerminKontext {
  /** Numerische date_id (BIGINT) des edoobox-Termins. */
  termin_id: number;
  /** Angebotstitel (o.name) bzw. null, wenn das Angebot fehlt. */
  kurs_titel: string | null;
}

/**
 * Extrahiert aus einem date_id-String die numerische ID. Unterstützt sowohl
 * reine Zahlen ("12345") als auch die Reservierungs-Prefixe der Kursplanung
 * ("res-123" bzw. "tres-123" → 123). Liefert null für nicht-parsebare Werte.
 */
export function parsiereTerminId(dateId: string): number | null {
  const match = dateId.match(/(\d+)$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Lädt für eine Liste von date_ids den Termin-Kontext (numerische date_id +
 * Angebotstitel) direkt aus edoobox_raw.offer_date/offer. Der Aufrufer kann
 * daraus kurs_titel und termin_id für das Event-Payload beziehen.
 *
 * @param dateIds date_id-Strings (edoobox-Termine)
 * @returns Map date_id -> TerminKontext (nur Treffer, ohne Soft-Deletes).
 */
export async function ladeTerminKontext(
  dateIds: string[]
): Promise<Map<string, TerminKontext>> {
  const kontext = new Map<string, TerminKontext>();
  if (dateIds.length === 0) return kontext;

  const result = await query(
    `SELECT
       od.date_id::text  AS date_id,
       (od.date_id)::int AS termin_id,
       o.name            AS kurs_titel
     FROM edoobox_raw.offer_date od
     LEFT JOIN edoobox_raw.offer o
            ON o.offer_id = od.offer_id
     WHERE od.date_id::text = ANY($1::text[])
       AND od.is_deleted IS NOT TRUE`,
    [dateIds]
  );

  for (const row of result.rows as Array<{
    date_id: string;
    termin_id: number;
    kurs_titel: string | null;
  }>) {
    kontext.set(String(row.date_id), {
      termin_id: Number(row.termin_id),
      kurs_titel: row.kurs_titel ?? null,
    });
  }

  return kontext;
}
