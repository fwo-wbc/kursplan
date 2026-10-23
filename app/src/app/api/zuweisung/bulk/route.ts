import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { logEvent } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Einheitliches Statusmodell der Trainer-Zuweisung. */
type ZuweisungStatus =
  | 'keine Zuordnung'
  | 'ausgeschrieben'
  | 'unter Vorbehalt'
  | 'bestätigt'
  | 'abgesagt';

/** Datensatz aus public.trainer_zuweisung (DB-Rückgabe). */
interface TrainerZuweisung {
  id: number;
  date_id: string;
  trainer_id: number;
  status: string | null;
  notiz: string | null;
  honorar_manuell: number | null;
}

/** Erwarteter Request-Body für PATCH /api/zuweisung/bulk. */
interface BulkZuweisungBody {
  date_ids?: unknown;
  status?: unknown;
  trainer_id?: unknown;
  trainer_kuerzel?: unknown;
}

const ERLAUBTE_STATUS: readonly ZuweisungStatus[] = [
  'keine Zuordnung',
  'ausgeschrieben',
  'unter Vorbehalt',
  'bestätigt',
  'abgesagt',
];

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Trimmt einen String; liefert null bei fehlendem oder leerem Wert. */
function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalisiert das Pflichtfeld date_ids (Array mit String-Werten).
 * Duplikate werden entfernt, leere/ungültige Einträge verworfen.
 */
function normalizeDateIds(dateIdsValue: unknown): string[] {
  if (!Array.isArray(dateIdsValue)) return [];
  const ids: string[] = [];
  for (const item of dateIdsValue) {
    const norm = normalizeString(item);
    if (norm && !ids.includes(norm)) ids.push(norm);
  }
  return ids;
}

/**
 * Wandelt eine Trainer-ID (Zahl oder Zahl-String) in eine positive Ganzzahl um.
 * Liefert null bei ungültigen Eingaben wie <= 0, NaN oder Dezimalzahlen.
 */
function parseTrainerId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function isValidStatus(value: string): value is ZuweisungStatus {
  return (ERLAUBTE_STATUS as readonly string[]).includes(value);
}

/** Wandelt einen unbekannten DB-Fehler in eine lesbare Meldung um. */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// n8n-Rückkanal: Trainerzuweisung an edoobox melden
// ---------------------------------------------------------------------------

/** Webhook-Endpunkt des n8n-Workflows "Trainer-Sync (edoobox)". */
const N8N_WEBHOOK_URL_TRAINER_SYNC =
  process.env.N8N_WEBHOOK_URL_TRAINER_SYNC?.trim() ||
  'http://localhost:5678/webhook/sync-trainer-to-edoobox';

/** Gemeinsames Secret für den Header "X-Sync-Token". */
const N8N_SYNC_SECRET = process.env.N8N_SYNC_SECRET?.trim() || '';

/**
 * Meldet eine Trainerzuweisung asynchron an den n8n-Workflow. Fehler werden
 * bewusst nur geloggt, damit die lokale Speicherung davon unberührt bleibt.
 *
 * @param alteKuerzelZuDateIds Vorher-Zustand: das bisherige Trainerkürzel je
 *   date_id, ermittelt VOR dem Upsert. n8n ersetzt damit veraltete Kürzel am
 *   Ende der edoobox-Modultitel (Regex inkl. bereits geklammerter Kürzel).
 */
async function notifyTrainerSync(
  trainerId: number,
  dateIds: string[],
  alteKuerzelZuDateIds: Record<string, string>
): Promise<void> {
  if (dateIds.length === 0) return;

  try {
    const trainerResult = await query(
      `SELECT kuerzel, edoobox_admin_id
       FROM public.trainer
       WHERE id = $1::int`,
      [trainerId]
    );

    const trainer = trainerResult.rows[0] as
      | { kuerzel: string | null; edoobox_admin_id: string | null }
      | undefined;

    if (!trainer) {
      console.error(
        `[trainer-sync] Trainer mit id=${trainerId} nicht gefunden; Webhook übersprungen.`
      );
      return;
    }

    const offerResult = await query(
      `SELECT
         o.offer_id::text AS offer_id,
         o.name AS titel,
         array_agg(DISTINCT d.date_id::text ORDER BY d.date_id::text) AS date_ids
       FROM edoobox_raw.offer o
       INNER JOIN edoobox_raw.offer_date d ON d.offer_id = o.offer_id
       WHERE d.is_deleted IS NOT TRUE
         AND o.offer_id IN (
           SELECT DISTINCT offer_id
           FROM edoobox_raw.offer_date
           WHERE date_id::text = ANY($1::text[])
         )
       GROUP BY o.offer_id, o.name`,
      [dateIds]
    );

    const offers = offerResult.rows as Array<{
      offer_id: string;
      date_ids: string[];
      titel: string | null;
    }>;

    for (const offer of offers) {
      // Bisheriges Trainerkürzel dieser offer_id: je Termin das Kürzel des
      // alten Trainers; dedupliziert, leere Werte verworfen.
      const alteKuerzel =
        [
          ...new Set(
            offer.date_ids
              .map((dateId) => alteKuerzelZuDateIds[dateId]?.trim())
              .filter((k): k is string => Boolean(k))
          ),
        ][0] ?? null;

      const payload = {
        offer_id: offer.offer_id,
        date_ids: offer.date_ids,
        titel: offer.titel,
        trainer_id: trainerId,
        trainer_kuerzel: trainer.kuerzel,
        altes_kuerzel: alteKuerzel,
        edoobox_admin_id: trainer.edoobox_admin_id,
      };

      // Debug-Ausgabe: sicherstellen, dass altes_kuerzel, neues_kuerzel
      // (trainer_kuerzel), titel und offer_id wirklich im Payload ankommen.
      console.log('WEBHOOK PAYLOAD:', JSON.stringify(payload));

      const response = await fetch(N8N_WEBHOOK_URL_TRAINER_SYNC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(N8N_SYNC_SECRET ? { 'X-Sync-Token': N8N_SYNC_SECRET } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(
          `[trainer-sync] n8n-Webhook antwortete mit Status ${response.status} für offer_id=${offer.offer_id}.`
        );
      }
    }
  } catch (err) {
    console.error('[trainer-sync] Webhook-Aufruf fehlgeschlagen:', err);
  }
}

// ---------------------------------------------------------------------------
// PATCH: Bulk-Update der Trainer-Zuweisungen für mehrere date_ids.
//        Es werden ausschließlich die Felder aktualisiert, die im Payload
//        übergeben wurden (status und/oder trainer_id/trainer_kuerzel).
// ---------------------------------------------------------------------------

export async function PATCH(request: Request) {
  let body: BulkZuweisungBody;

  try {
    body = (await request.json()) as BulkZuweisungBody;
  } catch {
    return NextResponse.json(
      { error: 'Ungültiger JSON-Body.' },
      { status: 400 }
    );
  }

  const { date_ids, status, trainer_id, trainer_kuerzel } = body;

  // date_ids zwingend erforderlich und nicht leer.
  const dateIds = normalizeDateIds(date_ids);
  if (dateIds.length === 0) {
    return NextResponse.json(
      { error: 'date_ids (nicht-leeres String-Array) ist erforderlich.' },
      { status: 400 }
    );
  }

  // Trainer auflösen: trainer_id hat Vorrang, andernfalls trainer_kuerzel.
  let trainerIdValue = parseTrainerId(trainer_id);
  const kuerzelValue = normalizeString(trainer_kuerzel);

  // Sonderwert 'n. v.': Aufhebung der Zuweisung -> Status 'keine Zuordnung'.
  // Der zuletzt zugewiesene Trainer bleibt erhalten (trainer_id NOT NULL).
  const istAufhebung =
    trainerIdValue === null &&
    kuerzelValue !== null &&
    kuerzelValue.toLowerCase() === 'n. v.';

  if (trainerIdValue === null && kuerzelValue !== null && kuerzelValue !== '') {
    // Bei 'n. v.' bleibt trainerIdValue null – der Trainer wird nicht
    // gewechselt, sondern nur der Status auf 'keine Zuordnung' gesetzt.
    if (!istAufhebung) {
      const trainerResult = await query(
        `SELECT id
         FROM public.trainer
         WHERE kuerzel = $1
           AND COALESCE(is_active, true) = true
         LIMIT 1`,
        [kuerzelValue]
      );
      const trainerRow = trainerResult.rows[0] as { id: number } | undefined;

      if (!trainerRow) {
        return NextResponse.json(
          { error: `Trainer mit Kürzel "${kuerzelValue}" nicht gefunden.` },
          { status: 400 }
        );
      }
      trainerIdValue = trainerRow.id;
    }
  }

  // Status validieren (optional).
  let statusValue: ZuweisungStatus | null = null;
  if (status !== undefined && status !== null) {
    const normalizedStatus = normalizeString(status);
    if (normalizedStatus !== null && isValidStatus(normalizedStatus)) {
      statusValue = normalizedStatus;
    } else {
      return NextResponse.json(
        {
          error:
            "status muss 'keine Zuordnung', 'ausgeschrieben', 'unter Vorbehalt', 'bestätigt' oder 'abgesagt' sein.",
        },
        { status: 400 }
      );
    }
  }

  // Aufhebung ('n. v.'): Status auf 'keine Zuordnung' forcieren, sofern kein
  // expliziter Status übergeben wurde. Der zuletzt zugewiesene Trainer bleibt
  // dabei erhalten (trainer_id NOT NULL, FK auf public.trainer).
  if (istAufhebung && statusValue === null) {
    statusValue = 'keine Zuordnung';
  }

  // Mindestens eine Aktion verlangen: trainer wirksam gesetzt ODER status gesetzt.
  const hatTrainerAenderung = trainerIdValue !== null;
  const hatStatusAenderung = statusValue !== null;
  if (!hatTrainerAenderung && !hatStatusAenderung) {
    return NextResponse.json(
      {
        error:
          'Es muss mindestens eine Änderung übergeben werden: status und/oder trainer_id/trainer_kuerzel.',
      },
      { status: 400 }
    );
  }

  try {
    let result;

    // Vorher-Zustand ermitteln: bisheriges Trainerkürzel je date_id, BEVOR der
    // Upsert die alte Zuweisung ersetzt bzw. entfernt. Nur Trainer, die sich
    // vom neuen unterscheiden (= echter Wechsel), sind relevant. Das alte
    // Kürzel wird später an n8n übermittelt, damit veraltete Kürzel aus den
    // edoobox-Modultiteln entfernt werden können.
    let alteKuerzelZuDateIds: Record<string, string> = {};
    if (trainerIdValue !== null) {
      const alteZuweisungen = await query(
        `SELECT tz.date_id::text AS date_id, t.kuerzel
         FROM public.trainer_zuweisung tz
         INNER JOIN public.trainer t ON t.id = tz.trainer_id
         WHERE tz.date_id = ANY($1::text[])
           AND tz.trainer_id IS DISTINCT FROM $2::int`,
        [dateIds, trainerIdValue]
      );
      alteKuerzelZuDateIds = {};
      for (const row of alteZuweisungen.rows as Array<{
        date_id: string;
        kuerzel: string | null;
      }>) {
        if (row.kuerzel) alteKuerzelZuDateIds[row.date_id] = row.kuerzel;
      }
    }

    if (trainerIdValue !== null) {
      // Trainerwechsel: vorhandene ANDERE Trainer-Zuweisungen derselben
      // date_ids entfernen, damit pro Termin nur eine aktive zuweisung steht.
      await query(
        `DELETE FROM public.trainer_zuweisung
         WHERE date_id = ANY($1::text[])
           AND trainer_id IS DISTINCT FROM $2::int`,
        [dateIds, trainerIdValue]
      );

      // Trainer für alle date_ids einfügen bzw. aktualisieren. Nur wenn status
      // im Payload stand, wird der Status überschrieben; sonst bleibt der
      // bestehende Wert erhalten (bzw. gilt für neue Zeilen 'ausgeschrieben').
      result = await query(
        `INSERT INTO public.trainer_zuweisung (date_id, trainer_id, status)
         SELECT d.date_id, $2::int, COALESCE($3::text, 'ausgeschrieben')
         FROM unnest($1::text[]) AS d(date_id)
         ON CONFLICT (date_id, trainer_id)
         DO UPDATE SET
           status = CASE
             WHEN $3::text IS NOT NULL THEN EXCLUDED.status
             ELSE public.trainer_zuweisung.status
           END
         RETURNING *`,
        [dateIds, trainerIdValue, statusValue]
      );
    } else {
      // Nur Status-Aenderung (inkl. Aufhebung 'keine Zuordnung'): alle
      // vorhandenen Zuweisungs-Zeilen der date_ids aktualisieren,
      // Trainer bleibt unangetastet. statusValue ist hier zwingend gesetzt
      // (siehe Validierung oben).
      result = await query(
        `UPDATE public.trainer_zuweisung
         SET status = $2::text
         WHERE date_id = ANY($1::text[])
         RETURNING *`,
        [dateIds, statusValue as ZuweisungStatus]
      );
    }

    const updatedRows = result.rows as TrainerZuweisung[];

    // Lokaler Speichervorgang loggen (system_logs).
    await logEvent('INFO', 'API_ZUWEISUNG', 'Bulk-Zuweisungs-Update erfolgreich.', {
      date_ids: dateIds,
      trainer_id: trainerIdValue,
      trainer_kuerzel: kuerzelValue,
      status: statusValue,
      anzahl_datenbankzeilen: updatedRows.length,
    });

    // Asynchroner n8n-Rückkanal: Trainerzuweisung an edoobox melden.
    // Bei einer Aufhebung ('keine Zuordnung') wird nichts weitergemeldet,
    // damit der Workflow den Trainersync nicht erneut anstößt.
    if (trainerIdValue !== null && statusValue !== 'keine Zuordnung') {
      void notifyTrainerSync(trainerIdValue, dateIds, alteKuerzelZuDateIds);
    }

    return NextResponse.json(
      { zuweisungen: updatedRows, date_ids: dateIds },
      { status: 200 }
    );
  } catch (err: unknown) {
    // WICHTIG: SQL-Fehler sofort in system_logs protokollieren.
    await logEvent(
      'ERROR',
      'API_ZUWEISUNG',
      'Bulk-Zuweisungs-Update fehlgeschlagen.',
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { message: toErrorMessage(err), date_ids: dateIds }
    );
    console.error('Fehler beim Bulk-Update der Trainer-Zuweisungen:', err);
    return NextResponse.json(
      {
        error: 'Datenbankfehler beim Bulk-Update der Zuweisungen.',
        detail: toErrorMessage(err),
      },
      { status: 500 }
    );
  }
}