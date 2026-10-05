import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Status eines Zuweisungs-Datensatzes (einheitliches Statusmodell). */
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

/** Zuweisung inkl. Trainer-Stammdaten für GET-Antworten. */
interface TrainerZuweisungMitTrainer extends TrainerZuweisung {
  vorname: string;
  nachname: string;
  kuerzel: string | null;
}

/** Erwarteter Request-Body für POST. */
interface ZuweisungBody {
  date_id?: unknown;
  date_ids?: unknown;
  trainer_id?: unknown;
  status?: unknown;
  notiz?: unknown;
  honorar_manuell?: unknown;
}

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
 * Normalisiert die Liste der betroffenen date_ids. Akzeptiert entweder ein
 * Array (`date_ids`) oder einen einzelnen Wert (`date_id`). Duplikate werden
 * entfernt, leere/ungültige Einträge verworfen.
 */
function normalizeDateIds(dateIdsValue: unknown, singleIdValue: unknown): string[] {
  if (Array.isArray(dateIdsValue)) {
    const ids: string[] = [];
    for (const item of dateIdsValue) {
      const norm = normalizeString(item);
      if (norm && !ids.includes(norm)) ids.push(norm);
    }
    return ids;
  }

  const single = normalizeString(singleIdValue);
  return single ? [single] : [];
}

function isValidTrainerId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Wandelt eine Trainer-ID (Zahl oder Zahl-String) in eine positive Ganzzahl um.
 * Liefert null bei ungültigen Eingaben wie <= 0, NaN oder Dezimalzahlen.
 */
function parseTrainerId(value: unknown): number | null {
  if (typeof value === 'number') {
    return isValidTrainerId(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return isValidTrainerId(parsed) ? parsed : null;
  }
  return null;
}

function isValidStatus(value: unknown): value is ZuweisungStatus {
  return (
    value === 'keine Zuordnung' ||
    value === 'ausgeschrieben' ||
    value === 'unter Vorbehalt' ||
    value === 'bestätigt' ||
    value === 'abgesagt'
  );
}

/** Wandelt einen unbekannten DB-Fehler in eine lesbare Meldung um. */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
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
 * Meldet eine Trainerzuweisung asynchron an den n8n-Workflow. Die Ermittlung
 * der edoobox-IDs (offer_id, date_ids) sowie der Trainer-Stammdaten
 * (edoobox_admin_id, Kürzel) erfolgt hier; Fehler werden bewusst nur geloggt,
 * damit die lokale Speicherung in der App davon unberührt bleibt.
 */
async function notifyTrainerSync(trainerId: number, dateIds: string[]): Promise<void> {
  if (dateIds.length === 0) return;

  try {
    // Trainer-Stammdaten: edoobox_admin_id und Kürzel.
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

    // Zugehörige edoobox-IDs: je betroffenem Offer die offer_id sowie dessen
    // sämtliche date_ids (nicht nur die übergebenen).
    const offerResult = await query(
      `SELECT
         offer_id::text AS offer_id,
         array_agg(DISTINCT date_id::text ORDER BY date_id::text) AS date_ids
       FROM edoobox_raw.offer_date
       WHERE offer_id IN (
         SELECT DISTINCT offer_id
         FROM edoobox_raw.offer_date
         WHERE date_id::text = ANY($1::text[])
       )
       GROUP BY offer_id`,
      [dateIds]
    );

    const offers = offerResult.rows as Array<{
      offer_id: string;
      date_ids: string[];
    }>;

    for (const offer of offers) {
      const payload = {
        offer_id: offer.offer_id,
        date_ids: offer.date_ids,
        trainer_id: trainerId,
        trainer_kuerzel: trainer.kuerzel,
        edoobox_admin_id: trainer.edoobox_admin_id,
      };

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
// GET: Zuweisungen abrufen (optional gefiltert nach date_id)
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateId = searchParams.get('date_id');

  try {
    let result;

    if (dateId) {
      result = await query(
        `SELECT
           tz.id,
           tz.date_id,
           tz.trainer_id,
           tz.status,
           tz.notiz,
           t.vorname,
           t.nachname,
           t.kuerzel
         FROM public.trainer_zuweisung tz
         INNER JOIN public.trainer t ON t.id = tz.trainer_id
         WHERE tz.date_id = $1
         ORDER BY t.nachname ASC`,
        [dateId]
      );
    } else {
      result = await query(
        `SELECT
           tz.id,
           tz.date_id,
           tz.trainer_id,
           tz.status,
           tz.notiz,
           t.vorname,
           t.nachname,
           t.kuerzel
         FROM public.trainer_zuweisung tz
         INNER JOIN public.trainer t ON t.id = tz.trainer_id
         ORDER BY t.nachname ASC`
      );
    }

    const rows = result.rows as TrainerZuweisungMitTrainer[];

    return NextResponse.json({ zuweisungen: rows }, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Laden der Trainer-Zuweisungen:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Zuweisungen.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST: Zuweisung(en) anlegen oder aktualisieren (UPSERT).
//       Bei mehrtägigen Kursen werden alle betroffenen date_ids einheitlich
//       mit demselben Trainer/Status versorgt.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  let body: ZuweisungBody;

  try {
    body = (await request.json()) as ZuweisungBody;
  } catch {
    return NextResponse.json(
      { error: 'Ungültiger JSON-Body.' },
      { status: 400 }
    );
  }

  const { date_id, date_ids, trainer_id, status, notiz, honorar_manuell } = body;

  // Eingaben normalisieren: Strings trimmen, Trainer-ID strikt validieren.
  const dateIds = normalizeDateIds(date_ids, date_id);
  const trainerIdValue = parseTrainerId(trainer_id);

  // Validierung: Pflichtfelder
  if (dateIds.length === 0 || trainerIdValue === null) {
    return NextResponse.json(
      {
        error:
          'date_ids (String-Array) bzw. date_id (String) und trainer_id (positive Ganzzahl) sind erforderlich.',
      },
      { status: 400 }
    );
  }

  // Status validieren: exakt einer der erlaubten Werte (nach trim).
  let statusValue: ZuweisungStatus = 'ausgeschrieben';
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

  const notizValue = normalizeString(notiz);

  // Honorar-Überschreibung: undefined = Spalte nicht anfassen, null = manuellen
  // Wert zurücksetzen, Zahl = nicht-negativen manuellen Betrag setzen.
  let honorarManuell: number | null | undefined;
  if (honorar_manuell !== undefined) {
    if (honorar_manuell === null) {
      honorarManuell = null;
    } else if (
      typeof honorar_manuell === 'number' &&
      Number.isFinite(honorar_manuell) &&
      honorar_manuell >= 0
    ) {
      honorarManuell = Math.round(honorar_manuell * 100) / 100;
    } else {
      return NextResponse.json(
        { error: 'honorar_manuell muss eine nicht-negative Zahl oder null sein.' },
        { status: 400 }
      );
    }
  }

  try {
    // Einheitlich für alle zugehörigen date_ids aktualisieren. Der
    // UNIQUE-Constraint (date_id, trainer_id) verhindert Duplikate. Wird
    // honorar_manuell nicht übergeben, bleibt der bestehende Wert unangetastet.
    const result =
      honorarManuell !== undefined
        ? await query(
            `INSERT INTO public.trainer_zuweisung (date_id, trainer_id, status, notiz, honorar_manuell)
             SELECT d.date_id, $2::int, $3::text, $4::text, $5::numeric
             FROM unnest($1::text[]) AS d(date_id)
             ON CONFLICT (date_id, trainer_id)
             DO UPDATE SET
               status = EXCLUDED.status,
               notiz = EXCLUDED.notiz,
               honorar_manuell = EXCLUDED.honorar_manuell
             RETURNING *`,
            [dateIds, trainerIdValue, statusValue, notizValue, honorarManuell]
          )
        : await query(
            `INSERT INTO public.trainer_zuweisung (date_id, trainer_id, status, notiz)
             SELECT d.date_id, $2::int, $3::text, $4::text
             FROM unnest($1::text[]) AS d(date_id)
             ON CONFLICT (date_id, trainer_id)
             DO UPDATE SET
               status = EXCLUDED.status,
               notiz = EXCLUDED.notiz
             RETURNING *`,
            [dateIds, trainerIdValue, statusValue, notizValue]
          );

    // Asynchroner n8n-Rückkanal: Trainerzuweisung an edoobox melden.
    // Der Request wird nicht blockiert; Fehler werden intern geloggt.
    void notifyTrainerSync(trainerIdValue, dateIds);

    return NextResponse.json(
      { zuweisungen: result.rows as TrainerZuweisung[], date_ids: dateIds },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('Fehler beim Speichern der Trainer-Zuweisung:', err);
    return NextResponse.json(
      {
        error: 'Datenbankfehler beim Speichern der Zuweisung.',
        detail: toErrorMessage(err),
      },
      { status: 500 }
    );
  }
}
