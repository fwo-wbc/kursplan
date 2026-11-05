import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';

// ---------------------------------------------------------------------------
// Typsicherheit
// ---------------------------------------------------------------------------

/** Trainer-Kürzel-Stammdaten aus public.trainer (DB-Rückgabe & Antwort). */
interface Trainer {
  id: number;
  vorname: string;
  nachname: string;
  kuerzel: string | null;
  is_active: boolean;
  edoobox_admin_id: string | null;
  tagessatz: number;
  halbtagessatz: number;
  stundensatz: number;
  reduzierter_satz: number;
  honorar_90min: number;
  /** Portal-E-Mail (Login /portal/login); niemals password_hash! */
  portal_email: string | null;
  portal_active: boolean;
}

/** Erwarteter Request-Body für POST-Sync. */
interface TrainerSyncBody {
  action?: unknown;
}

/** Erwarteter Request-Body für die Satz-Pflege (PUT/PATCH). */
interface TrainerSaetzeBody {
  id?: unknown;
  edoobox_admin_id?: unknown;
  tagessatz?: unknown;
  halbtagessatz?: unknown;
  stundensatz?: unknown;
  reduzierter_satz?: unknown;
  honorar_90min?: unknown;
  /** Portal-E-Mail fürs Trainerportal (leer = löschen). */
  portal_email?: unknown;
  /** Portal-Zugang aktiv/deaktiviert. */
  portal_active?: unknown;
  /** Neues Klartext-Kennwort – wird serverseitig mit bcrypt gehasht. */
  password?: unknown;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Wandelt einen unbekannten DB-Fehler in eine lesbare Meldung um. */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Wandelt eine DB-Zeile (node-pg liefert numeric-Werte als String) in ein
 * typisiertes Trainer-Objekt um.
 */
function mapTrainer(row: Record<string, unknown>): Trainer {
  return {
    id: Number(row.id),
    vorname: row.vorname == null ? '' : String(row.vorname),
    nachname: row.nachname == null ? '' : String(row.nachname),
    kuerzel:
      row.kuerzel === null || row.kuerzel === undefined
        ? null
        : String(row.kuerzel),
    is_active: Boolean(row.is_active),
    edoobox_admin_id:
      row.edoobox_admin_id === null || row.edoobox_admin_id === undefined
        ? null
        : String(row.edoobox_admin_id),
    tagessatz: Number(row.tagessatz ?? 0),
    halbtagessatz: Number(row.halbtagessatz ?? 0),
    stundensatz: Number(row.stundensatz ?? 0),
    reduzierter_satz: Number(row.reduzierter_satz ?? 0),
    honorar_90min: Number(row.honorar_90min ?? 0),
    portal_email:
      row.portal_email === null || row.portal_email === undefined
        ? null
        : String(row.portal_email),
    portal_active: Boolean(row.portal_active),
  };
}

/**
 * Validiert einen übergebenen Betrag und liefert ihn auf zwei Nachkommastellen
 * gerundet zurück. Wirft bei ungültigen Werten einen Error.
 */
function parseBetrag(value: unknown): number {
  if (value === null) {
    return 0;
  }

  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    n = Number(value.replace(',', '.'));
  } else {
    throw new Error('Betrag muss eine Zahl sein.');
  }

  if (!Number.isFinite(n) || n < 0) {
    throw new Error('Betrag muss eine nicht-negative Zahl sein.');
  }

  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// GET: Alle Trainer-Kürzel inkl. Tages-/Stundensaetze liefern
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    // WICHTIG: password_hash wird bewusst NICHT selektiert – es darf niemals
    // in einer API-Response an den Client auftauchen.
    const result = await query(
      `SELECT id, vorname, nachname, kuerzel, is_active, edoobox_admin_id, tagessatz, halbtagessatz, stundensatz, reduzierter_satz, honorar_90min, portal_email, portal_active
       FROM public.trainer
       WHERE is_active = true
       ORDER BY kuerzel ASC`
    );

    const trainers = result.rows.map(mapTrainer);

    return NextResponse.json(trainers, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Laden der Trainer-Stammdaten:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Trainer-Stammdaten.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT / PATCH: Trainer-Stammdaten aktualisieren
// (Sätze und/oder Portal-Zugang: portal_email, portal_active, password)
// ---------------------------------------------------------------------------

export async function PUT(request: Request) {
  return updateSaetze(request);
}

export async function PATCH(request: Request) {
  return updateSaetze(request);
}

async function updateSaetze(request: Request) {
  let body: TrainerSaetzeBody;

  try {
    body = (await request.json()) as TrainerSaetzeBody;
  } catch {
    return NextResponse.json(
      { error: 'Ungültiger JSON-Body.' },
      { status: 400 }
    );
  }

  // Trainer muss über seine ID referenziert werden.
  const idNumber = Number(body.id);
  if (!Number.isInteger(idNumber) || idNumber <= 0) {
    return NextResponse.json(
      { error: 'id muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }

  const hasTagessatz = body.tagessatz !== undefined;
  const hasHalbtagessatz = body.halbtagessatz !== undefined;
  const hasStundensatz = body.stundensatz !== undefined;
  const hasReduzierterSatz = body.reduzierter_satz !== undefined;
  const hasHonorar90min = body.honorar_90min !== undefined;
  const hasPortalEmail = body.portal_email !== undefined;
  const hasPortalActive = body.portal_active !== undefined;
  const hasPassword = body.password !== undefined;
  if (
    !hasTagessatz &&
    !hasHalbtagessatz &&
    !hasStundensatz &&
    !hasReduzierterSatz &&
    !hasHonorar90min &&
    !hasPortalEmail &&
    !hasPortalActive &&
    !hasPassword
  ) {
    return NextResponse.json(
      {
        error:
          'Mindestens ein Feld (tagessatz, halbtagessatz, stundensatz, reduzierter_satz, honorar_90min, portal_email, portal_active oder password) muss übergeben werden.',
      },
      { status: 400 }
    );
  }

  let tagessatz: number | undefined;
  let halbtagessatz: number | undefined;
  let stundensatz: number | undefined;
  let reduzierterSatz: number | undefined;
  let honorar90min: number | undefined;
  let portalEmail: string | null | undefined;
  let portalActive: boolean | undefined;
  let passwordHash: string | undefined;
  try {
    if (hasTagessatz) tagessatz = parseBetrag(body.tagessatz);
    if (hasHalbtagessatz) halbtagessatz = parseBetrag(body.halbtagessatz);
    if (hasStundensatz) stundensatz = parseBetrag(body.stundensatz);
    if (hasReduzierterSatz) reduzierterSatz = parseBetrag(body.reduzierter_satz);
    if (hasHonorar90min) honorar90min = parseBetrag(body.honorar_90min);

    // Portal-Zugangsdaten: E-Mail validieren & normalisieren.
    if (hasPortalEmail) {
      const roh = typeof body.portal_email === 'string' ? body.portal_email.trim() : '';
      if (roh === '') {
        portalEmail = null;
      } else {
        const normalisiert = roh.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalisiert)) {
          throw new Error('Portal-E-Mail ist keine gültige E-Mail-Adresse.');
        }
        portalEmail = normalisiert;
      }
    }

    if (hasPortalActive) {
      if (typeof body.portal_active !== 'boolean') {
        throw new Error('portal_active muss ein boolescher Wert sein.');
      }
      portalActive = body.portal_active;
    }

    // Kennwort ausschließlich gehasht übernehmen – kein Klartext in der DB.
    if (hasPassword) {
      if (
        typeof body.password !== 'string' ||
        body.password.length < 8 ||
        body.password.length > 128
      ) {
        throw new Error('Kennwort muss zwischen 8 und 128 Zeichen lang sein.');
      }
      passwordHash = await bcrypt.hash(body.password, 12);
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { error: toErrorMessage(err) },
      { status: 400 }
    );
  }

  const setParts: string[] = [];
  const params: unknown[] = [];

  if (tagessatz !== undefined) {
    setParts.push(`tagessatz = $${params.length + 1}`);
    params.push(tagessatz);
  }
  if (halbtagessatz !== undefined) {
    setParts.push(`halbtagessatz = $${params.length + 1}`);
    params.push(halbtagessatz);
  }
  if (stundensatz !== undefined) {
    setParts.push(`stundensatz = $${params.length + 1}`);
    params.push(stundensatz);
  }
  if (reduzierterSatz !== undefined) {
    setParts.push(`reduzierter_satz = $${params.length + 1}`);
    params.push(reduzierterSatz);
  }
  if (honorar90min !== undefined) {
    setParts.push(`honorar_90min = $${params.length + 1}`);
    params.push(honorar90min);
  }
  if (portalEmail !== undefined) {
    setParts.push(`portal_email = $${params.length + 1}`);
    params.push(portalEmail);
  }
  if (portalActive !== undefined) {
    setParts.push(`portal_active = $${params.length + 1}`);
    params.push(portalActive);
  }
  if (passwordHash !== undefined) {
    setParts.push(`password_hash = $${params.length + 1}`);
    params.push(passwordHash);
  }
  setParts.push('updated_at = NOW()');
  params.push(idNumber);

  try {
    // password_hash wird nicht RETURNING zurückgegeben und damit niemals
    // an den Client gesendet.
    const result = await query(
      `UPDATE public.trainer
       SET ${setParts.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, vorname, nachname, kuerzel, is_active, edoobox_admin_id, tagessatz, halbtagessatz, stundensatz, reduzierter_satz, honorar_90min, portal_email, portal_active`,
      params
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: 'Trainer nicht gefunden.' },
        { status: 404 }
      );
    }

    return NextResponse.json(mapTrainer(result.rows[0]), { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Speichern der Trainer-Daten:', err);
    // UNIQUE-Verletzung auf portal_email sauber abfangen (PostgreSQL 23505).
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === '23505'
    ) {
      return NextResponse.json(
        { error: 'Die Portal-E-Mail wird bereits von einem anderen Trainer verwendet.' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Datenbankfehler beim Speichern der Trainer-Daten.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST: Edoobox-Sync – bestehende Trainer aktualisieren und fehlende übernehmen
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  let body: TrainerSyncBody;

  try {
    body = (await request.json()) as TrainerSyncBody;
  } catch {
    return NextResponse.json(
      { error: 'Ungültiger JSON-Body.' },
      { status: 400 }
    );
  }

  // Nur ein expliziter Sync-Aufruf ist erlaubt, damit dieser Endpunkt nicht
  // versehentlich Daten verändert.
  if (body.action !== 'sync') {
    return NextResponse.json(
      { error: "action muss 'sync' sein." },
      { status: 400 }
    );
  }

  // 0) Optional: n8n-Workflow P06 anstoßen, der die edoobox-Spiegelung
  //    (edoobox_raw.trainer_admin) über P90 aktualisiert. Ist die Webhook-URL
  //    nicht konfiguriert, wird dieser Schritt übersprungen und direkt die
  //    lokale Datenbank-Aktualisierung ausgeführt (Fallback).
  const n8nWebhookUrl = process.env.N8N_TRAINER_SYNC_WEBHOOK_URL;
  if (n8nWebhookUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const n8nResponse = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sync-Token': process.env.N8N_SYNC_SECRET ?? '',
        },
        body: JSON.stringify({ action: 'sync' }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!n8nResponse.ok) {
        console.error(
          'n8n-Sync fehlgeschlagen:',
          n8nResponse.status,
          n8nResponse.statusText
        );
        return NextResponse.json(
          { error: 'Fehler bei der edoobox-Spiegelung via n8n' },
          { status: 502 }
        );
      }
    } catch (err: unknown) {
      console.error('n8n-Sync-Aufruf fehlgeschlagen:', err);
      return NextResponse.json(
        { error: 'Fehler bei der edoobox-Spiegelung via n8n' },
        { status: 502 }
      );
    }
  }

  try {
    // 2a) Aktiv-Status für ALLE vorhandenen Trainer immer aus
    //     edoobox_raw.trainer_admin übernehmen (edoobox ist führend).
    const statusResult = await query(
      `UPDATE public.trainer pt
       SET is_active = ta.is_active,
           updated_at = NOW()
       FROM edoobox_raw.trainer_admin ta
       WHERE pt.edoobox_admin_id = ta.admin_id`
    );

    // 2b) Bereits vorhandene Trainer nachziehen, deren Kürzel noch mit 'N/A'
    //     beginnt, obwohl in edoobox_raw inzwischen ein echtes Kürzel liegt.
    const updateResult = await query(
      `UPDATE public.trainer pt
       SET kuerzel = TRIM(ta.shortcut),
           updated_at = NOW()
       FROM edoobox_raw.trainer_admin ta
       WHERE pt.edoobox_admin_id = ta.admin_id
         AND pt.kuerzel LIKE 'N/A%'
         AND TRIM(COALESCE(ta.shortcut, '')) <> ''`
    );

    // 3) Fehlende Trainer aus edoobox_raw.trainer_admin übernehmen.
    const insertResult = await query(
      `WITH kanonisch AS (
         SELECT
           ta.admin_id,
           ta.shortcut,
           ta.is_active,
           TRIM(ta.shortcut) AS shortcut_trimmed,
           CASE
             WHEN NULLIF(TRIM(ta.shortcut), '') IS NOT NULL
               THEN NULLIF(TRIM(ta.shortcut), '')
             ELSE 'N/A-' || right(regexp_replace(ta.admin_id, '[^0-9]', '', 'g'), 5)
           END AS kuerzel_eindeutig
         FROM edoobox_raw.trainer_admin ta
       )
       INSERT INTO public.trainer
         (vorname, nachname, kuerzel, edoobox_admin_id, is_active)
       SELECT
         'Trainer' AS vorname,
         COALESCE(NULLIF(shortcut_trimmed, ''), 'N/A-' || right(regexp_replace(admin_id, '[^0-9]', '', 'g'), 5)) AS nachname,
         kuerzel_eindeutig AS kuerzel,
         admin_id AS edoobox_admin_id,
         COALESCE(is_active, true) AS is_active
       FROM kanonisch
       WHERE admin_id NOT IN (
         SELECT edoobox_admin_id FROM public.trainer WHERE edoobox_admin_id IS NOT NULL
       )
       ON CONFLICT (edoobox_admin_id) DO NOTHING
       RETURNING id`
    );

    return NextResponse.json(
      {
        success: true,
        synced: insertResult.rowCount ?? 0,
        aktualisiert: updateResult.rowCount ?? 0,
        status_sync: statusResult.rowCount ?? 0,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('Fehler beim Edoobox-Trainer-Sync:', err);
    return NextResponse.json(
      {
        error: 'Datenbankfehler beim Edoobox-Trainer-Sync.',
        detail: toErrorMessage(err),
      },
      { status: 500 }
    );
  }
}