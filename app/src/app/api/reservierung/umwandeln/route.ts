import { NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db';
import {
  berechneAnmeldeschluss,
  isoInBerlin,
  istGueltigeKursnummer,
  kursnrBasis,
  kuerzelAusAngebotsnummer,
  naechsterFreierIndex,
  regexEscape,
  slotZeit,
} from '@/lib/umwandlung';

// ---------------------------------------------------------------------------
// POST /api/reservierung/umwandeln
//   GET  = Vorschau: berechnet Kursnummer + Anmeldeschluss für eine Reservierung
//          und ein Kurstemplate.
//   POST = Verbindliche Umwandlung: legt über den n8n-Webhook "P96" ein
//          edoobox-Angebot an und bucht die Reservierung auf "bestaetigt".
// ---------------------------------------------------------------------------

const N8N_WEBHOOK_URL_CREATE_OFFER =
  process.env.N8N_WEBHOOK_URL_CREATE_OFFER?.trim() ||
  'https://m.webinarcenter.de/webhook/create-edoobox-offer';

const N8N_SYNC_SECRET = process.env.N8N_SYNC_SECRET?.trim() || '';

// ---------------------------------------------------------------------------
// Typen & Helfer
// ---------------------------------------------------------------------------

interface ReservierungZeile {
  id: number;
  trainer_id: number;
  datum: string;
  slot_code: string;
  kd_nr: string;
  thema: string;
  status: string;
}

interface TemplateZeile {
  offer_id: string;
  name: string;
  offer_number: string | null;
  offerdef_ref: string | null;
  mode: string | null;
  user_minimal: number | null;
  user_maximum: number | null;
  image: Record<string, unknown> | null;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isIsoDatum(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const datum = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(datum.getTime()) && datum.toISOString().startsWith(value);
}

/** Lädt eine Reservierung oder liefert null. */
async function ladeReservierung(id: number): Promise<ReservierungZeile | null> {
  const result = await query(
    `SELECT
       id,
       trainer_id,
       to_char(datum, 'YYYY-MM-DD') AS datum,
       slot_code,
       kd_nr,
       thema,
       status
     FROM public.termin_reservierung
     WHERE id = $1::int`,
    [id]
  );
  const row = result.rows[0] as
    | {
        id: number;
        trainer_id: number;
        datum: string;
        slot_code: string;
        kd_nr: string;
        thema: string;
        status: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    trainer_id: Number(row.trainer_id),
    datum: String(row.datum),
    slot_code: String(row.slot_code),
    kd_nr: String(row.kd_nr),
    thema: String(row.thema),
    status: String(row.status),
  };
}

/** Lädt ein Template von edoobox_raw.offer oder liefert null. */
async function ladeTemplate(templateId: string): Promise<TemplateZeile | null> {
  const result = await query(
    `SELECT
       offer_id,
       name,
       offer_number,
       offerdef_ref,
       mode,
       user_minimal,
       user_maximum,
       payload->'image' AS image
     FROM edoobox_raw.offer
     WHERE offer_id = $1::text
       AND is_deleted IS NOT TRUE`,
    [templateId]
  );
  const row = result.rows[0] as
    | {
        offer_id: string;
        name: string | null;
        offer_number: string | null;
        offerdef_ref: string | null;
        mode: string | null;
        user_minimal: number | null;
        user_maximum: number | null;
        image: unknown;
      }
    | undefined;
  if (!row) return null;

  // Das Template-Bild wird 1:1 aus dem gespiegelten GET /v2/offer/{id}-Payload
  // übernommen. Gültige Bild-Objekte besitzen { url, name, type, url300 };
  // die Vorlagen ohne Bild liefern hier false/null, was nicht übernommen wird.
  const image =
    row.image && typeof row.image === 'object' && !Array.isArray(row.image)
      ? (row.image as Record<string, unknown>)
      : null;

  return {
    offer_id: String(row.offer_id),
    name: row.name ?? '',
    offer_number: row.offer_number == null ? null : String(row.offer_number),
    offerdef_ref: row.offerdef_ref == null ? null : String(row.offerdef_ref),
    mode: row.mode == null ? null : String(row.mode),
    user_minimal: row.user_minimal == null ? null : Number(row.user_minimal),
    user_maximum: row.user_maximum == null ? null : Number(row.user_maximum),
    image,
  };
}

/** Ermittelt den nächsten freien kursnr-Index anhand bestehender edoobox-Angebote. */
async function naechsterIndex(prefix: string): Promise<number> {
  const result = await query(
    `SELECT offer_number
     FROM edoobox_raw.offer
     WHERE is_deleted IS NOT TRUE
       AND (offer_number LIKE $1::text || '-%'
            OR offer_number = $1::text)`,
    [prefix]
  );

  const belegte = new Set<number>();
  const musterBasis = new RegExp(`^${regexEscape(prefix)}$`);
  const musterIndex = new RegExp(`^${regexEscape(prefix)}-(\\d+)$`);

  for (const row of result.rows as Array<{ offer_number: string | null }>) {
    const nummer = row.offer_number;
    if (!nummer) continue;
    if (musterBasis.test(nummer)) {
      belegte.add(1);
      continue;
    }
    const m = musterIndex.exec(nummer);
    if (m) {
      belegte.add(Number(m[1]));
    }
  }

  return naechsterFreierIndex(belegte);
}

// ---------------------------------------------------------------------------
// Gezielter Einzel-Sync: Helfer zum Normalisieren der von P96 zurückgegebenen
// edoobox-Rohdatensätze (GET /v2/offer/{id} bzw. GET /v2/date/{id}).
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function firstString(value: unknown, keys: string[]): string | null {
  const rec = asRecord(value);
  if (!rec) return null;
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim().length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function firstNullableString(value: unknown, keys: string[]): string | null {
  const rec = asRecord(value);
  if (!rec) return null;
  for (const key of keys) {
    const v = rec[key];
    if (v === null || v === undefined) continue;
    // edoobox markiert "nicht gesetzte" Zeit-/Referenzfelder als false (boolean).
    // Boolean-Werte duerfen daher NICHT als Inhalt (String "false") landen,
    // sonst scheitert die timestamptz-Konvertierung bzw. der UPSERT.
    if (typeof v === 'string') return v.trim().length > 0 ? v : null;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function firstInt(value: unknown, keys: string[]): number | null {
  const rec = asRecord(value);
  if (!rec) return null;
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) {
      const n = Number(v.trim());
      if (Number.isSafeInteger(n)) return n;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET: Vorschau von Kursnummer und Anmeldeschluss
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const reservierungId = parsePositiveInt(searchParams.get('reservierung_id'));
  const templateId = normalizeString(searchParams.get('template_id'));

  if (!reservierungId) {
    return NextResponse.json(
      { error: 'reservierung_id muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }
  if (!templateId) {
    return NextResponse.json(
      { error: 'template_id darf nicht leer sein.' },
      { status: 400 }
    );
  }

  try {
    const reservierung = await ladeReservierung(reservierungId);
    if (!reservierung) {
      return NextResponse.json(
        { error: 'Reservierung nicht gefunden.' },
        { status: 404 }
      );
    }

    const template = await ladeTemplate(templateId);
    if (!template) {
      return NextResponse.json(
        { error: 'Kurstemplate nicht gefunden.' },
        { status: 404 }
      );
    }

    const kuerzel = kuerzelAusAngebotsnummer(template.offer_number);
    if (!kuerzel) {
      return NextResponse.json(
        { error: 'Kurstemplate besitzt kein gültiges Themen-Kürzel.' },
        { status: 422 }
      );
    }

    const prefix = kursnrBasis(reservierung.kd_nr, kuerzel, reservierung.datum);
    const index = await naechsterIndex(prefix);

    return NextResponse.json(
      {
        kursnr: `${prefix}-${index}`,
        anmeldeschluss: berechneAnmeldeschluss(reservierung.datum),
        kdnr: reservierung.kd_nr,
        kuerzel,
        monat: prefix.slice(-4),
        index,
        datum: reservierung.datum,
        slot_code: reservierung.slot_code,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('Fehler bei der Umwandlungs-Vorschau:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler bei der Vorschau-Berechnung.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST: Verbindliche Umwandlung
// ---------------------------------------------------------------------------

interface UmwandlungBody {
  reservierung_id?: unknown;
  template_id?: unknown;
  firmenname?: unknown;
  kursnr?: unknown;
  anmeldeschluss?: unknown;
  freigeben_alternativen?: unknown;
}

export async function POST(request: Request) {
  let body: UmwandlungBody;
  try {
    body = (await request.json()) as UmwandlungBody;
  } catch {
    return NextResponse.json({ error: 'Ungültiger JSON-Body.' }, { status: 400 });
  }

  const reservierungId = parsePositiveInt(body.reservierung_id);
  const templateId = normalizeString(body.template_id);
  const firmenname = normalizeString(body.firmenname);
  const kursnr = normalizeString(body.kursnr);
  const anmeldeschluss = normalizeString(body.anmeldeschluss);

  if (!reservierungId) {
    return NextResponse.json(
      { error: 'reservierung_id muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }
  if (!templateId) {
    return NextResponse.json(
      { error: 'template_id darf nicht leer sein.' },
      { status: 400 }
    );
  }
  if (!firmenname) {
    return NextResponse.json(
      { error: 'firmenname darf nicht leer sein.' },
      { status: 400 }
    );
  }
  if (firmenname.length > 100) {
    return NextResponse.json(
      { error: 'firmenname darf höchstens 100 Zeichen lang sein.' },
      { status: 400 }
    );
  }
  if (!kursnr || !istGueltigeKursnummer(kursnr)) {
    return NextResponse.json(
      { error: 'kursnr muss dem Format [kdnr]-[kuerzel]-[MMJJ]-[index] folgen.' },
      { status: 400 }
    );
  }
  if (!anmeldeschluss || Number.isNaN(Date.parse(anmeldeschluss))) {
    return NextResponse.json(
      { error: 'anmeldeschluss muss ein gültiger ISO-Zeitstempel sein.' },
      { status: 400 }
    );
  }

  // "Weitere Alternativ-Reservierungen freigeben" ist standardmäßig aktiviert.
  const freigebenAlternativen = body.freigeben_alternativen !== false;

  try {
    const reservierung = await ladeReservierung(reservierungId);
    if (!reservierung) {
      return NextResponse.json(
        { error: 'Reservierung nicht gefunden.' },
        { status: 404 }
      );
    }
    if (reservierung.status === 'bestaetigt') {
      return NextResponse.json(
        { error: 'Diese Reservierung wurde bereits umgewandelt.' },
        { status: 409 }
      );
    }

    const template = await ladeTemplate(templateId);
    if (!template) {
      return NextResponse.json(
        { error: 'Kurstemplate nicht gefunden.' },
        { status: 404 }
      );
    }
    const kuerzel = kuerzelAusAngebotsnummer(template.offer_number);
    if (!kuerzel) {
      return NextResponse.json(
        { error: 'Kurstemplate besitzt kein gültiges Themen-Kürzel.' },
        { status: 422 }
      );
    }

    // Server-seitige Kursnummer- und Zeitberechnung als Quelle der Wahrheit.
    const prefix = kursnrBasis(reservierung.kd_nr, kuerzel, reservierung.datum);
    const index = await naechsterIndex(prefix);
    const erwarteteKursnummer = `${prefix}-${index}`;
    if (erwarteteKursnummer !== kursnr) {
      return NextResponse.json(
        { error: 'Kursnummer ist nicht mehr aktuell (Index bereits vergeben).' },
        { status: 409 }
      );
    }

    // edoobox_admin_id und Kürzel des Trainers ermitteln.
    const trainerResult = await query(
      `SELECT kuerzel, edoobox_admin_id
       FROM public.trainer
       WHERE id = $1::int`,
      [reservierung.trainer_id]
    );
    const trainer = trainerResult.rows[0] as
      | { kuerzel: string | null; edoobox_admin_id: string | null }
      | undefined;
    if (!trainer?.edoobox_admin_id) {
      return NextResponse.json(
        { error: 'Für den Trainer ist keine edoobox_admin_id hinterlegt.' },
        { status: 422 }
      );
    }

    const zeiten = slotZeit(reservierung.slot_code);
    const payload = {
      reservierung_id: reservierung.id,
      template_id: template.offer_id,
      vorlagen_name: template.name,
      kurstitel: template.name,
      offerdef_ref: template.offerdef_ref,
      mode: template.mode,
      user_minimal: template.user_minimal,
      user_maximum: template.user_maximum,
      image: template.image,
      kdnr: reservierung.kd_nr,
      thema: reservierung.thema,
      firmenname,
      kursnr,
      anmeldeschluss: berechneAnmeldeschluss(reservierung.datum),
      datum: reservierung.datum,
      start: isoInBerlin(reservierung.datum, zeiten.von),
      ende: isoInBerlin(reservierung.datum, zeiten.bis),
      trainer_admin_id: trainer.edoobox_admin_id,
      trainer_kuerzel: trainer.kuerzel ?? '',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let n8nResponse: Response;
    try {
      n8nResponse = await fetch(N8N_WEBHOOK_URL_CREATE_OFFER, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(N8N_SYNC_SECRET ? { 'X-Sync-Token': N8N_SYNC_SECRET } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!n8nResponse.ok) {
      const roherText = await n8nResponse.text().catch(() => '');
      console.error('n8n P96 antwortete mit Fehler:', n8nResponse.status, roherText);

      let n8nMeldung = '';
      try {
        const fehlerBody: Record<string, unknown> = JSON.parse(roherText);
        const fehlerError = fehlerBody?.error as Record<string, unknown> | undefined;
        const details =
          fehlerBody?.details ??
          fehlerError?.details ??
          fehlerError?.message ??
          fehlerBody?.message ??
          null;
        if (typeof details === 'string' && details.length > 0) {
          n8nMeldung = details;
        }
      } catch {
        if (roherText && roherText.trim().length > 0) {
          n8nMeldung = roherText.trim().slice(0, 500);
        }
      }

      return NextResponse.json(
        {
          error: n8nMeldung
            ? `n8n P96: ${n8nMeldung}`
            : 'Fehler beim Anlegen des edoobox-Angebots (n8n P96).',
          status: n8nResponse.status,
        },
        { status: 502 }
      );
    }

    const quittung = (await n8nResponse.json().catch(() => ({}))) as {
      offer_id?: unknown;
      date_id?: unknown;
      offer?: unknown;
      offer_date?: unknown;
    };

    // Reservierung auf "bestaetigt", gezielter Einzel-Sync der edoobox-
    // Rohdaten sowie Dozentenzuweisung; alle weiteren Alternativ-Reservierungen
    // derselben KD-Nr. werden sofort hart gelöscht (DELETE statt Storno).
    await transaction(async (client) => {
      const offerRoh = asRecord(quittung.offer);
      const dateRoh = asRecord(quittung.offer_date);

      const offerId =
        normalizeString(quittung.offer_id) ??
        firstString(offerRoh, ['id', 'offer_id']);
      const dateId =
        normalizeString(quittung.date_id) ??
        firstString(dateRoh, ['id', 'date_id']);

      if (offerId) {
        await client.query(
          `INSERT INTO edoobox_raw.offer
             (offer_id, offer_number, name, category_ref, offerdef_ref,
              date_start, date_end, date_close, user_minimal, user_maximum,
              status, mode, offer_type, payload, is_deleted, last_changed_at)
           VALUES
             ($1::text, $2::text, $3::text, $4::text, $5::text,
              $6::timestamptz, $7::timestamptz, $8::timestamptz, $9::int, $10::int,
              $11::text, $12::text, $13::text, $14::jsonb, false, NOW())
           ON CONFLICT (offer_id) DO UPDATE SET
             offer_number = EXCLUDED.offer_number,
             name = EXCLUDED.name,
             category_ref = EXCLUDED.category_ref,
             offerdef_ref = EXCLUDED.offerdef_ref,
             date_start = EXCLUDED.date_start,
             date_end = EXCLUDED.date_end,
             date_close = EXCLUDED.date_close,
             user_minimal = EXCLUDED.user_minimal,
             user_maximum = EXCLUDED.user_maximum,
             status = EXCLUDED.status,
             mode = EXCLUDED.mode,
             offer_type = EXCLUDED.offer_type,
             payload = EXCLUDED.payload,
             is_deleted = false,
             last_changed_at = NOW(),
             last_synced_at = NOW()`,
          [
            offerId,
            firstNullableString(offerRoh, ['number', 'offer_number']) ?? kursnr,
            firstNullableString(offerRoh, ['name']) ?? template.name,
            firstNullableString(offerRoh, ['category', 'category_ref', 'category_id']),
            firstNullableString(offerRoh, ['offerdef', 'offerdef_ref']) ?? template.offerdef_ref,
            firstNullableString(offerRoh, ['date_start']) ?? payload.start,
            firstNullableString(offerRoh, ['date_end']) ?? payload.ende,
            firstNullableString(offerRoh, ['date_close', 'date_signupend']) ?? payload.anmeldeschluss,
            firstInt(offerRoh, ['user_minimal']) ?? template.user_minimal,
            firstInt(offerRoh, ['user_maximum']) ?? template.user_maximum,
            firstNullableString(offerRoh, ['status']) ?? '2',
            firstNullableString(offerRoh, ['mode']) ?? template.mode,
            firstNullableString(offerRoh, ['type', 'offer_type']),
            offerRoh ? JSON.stringify(offerRoh) : null,
          ]
        );
      }

      if (dateId) {
        await client.query(
          `INSERT INTO edoobox_raw.offer_date
             (date_id, offer_id, date_start, date_end, place_ref, room_ref, is_deleted)
           VALUES
             ($1::text, $2::text, $3::timestamptz, $4::timestamptz, $5::text, $6::text, false)
           ON CONFLICT (date_id) DO UPDATE SET
             offer_id = EXCLUDED.offer_id,
             date_start = EXCLUDED.date_start,
             date_end = EXCLUDED.date_end,
             place_ref = EXCLUDED.place_ref,
             room_ref = EXCLUDED.room_ref,
             is_deleted = false,
             last_synced_at = NOW()`,
          [
            dateId,
            offerId ?? firstNullableString(dateRoh, ['offer', 'offer_id']),
            firstNullableString(dateRoh, ['date_start']) ?? payload.start,
            firstNullableString(dateRoh, ['date_end']) ?? payload.ende,
            firstNullableString(dateRoh, ['place', 'place_ref']),
            firstNullableString(dateRoh, ['room', 'room_ref']),
          ]
        );

        // Dozentenzuweisung anlegen (lokale Quelle der Wahrheit).
        await client.query(
          `INSERT INTO public.trainer_zuweisung (date_id, trainer_id, status)
           VALUES ($1::text, $2::int, 'bestätigt')
           ON CONFLICT (date_id, trainer_id) DO UPDATE SET
             status = 'bestätigt',
             updated_at = NOW()`,
          [dateId, reservierung.trainer_id]
        );
      }

      const bestaetigtResult = await client.query(
        `UPDATE public.termin_reservierung
         SET status = 'bestaetigt', updated_at = NOW()
         WHERE id = $1::int`,
        [reservierung.id]
      );

      let geloeschtCount = 0;
      if (freigebenAlternativen) {
        // Alternativ-Reservierungen derselben KD-Nr. tragen im Bestand
        // unterschiedliche thema-Schreibweisen (z. B. "Excel Grundlagen" vs.
        // "Excel Grundlagen Modul 1"). Gelöscht wird daher robust ausschließlich
        // über kd_nr + abweichende id; bereits bestätigte Datensätze bleiben
        // unangetastet. Statt eines 'storniert'-Updates erfolgt ein hartes
        // DELETE, damit überflüssige Alternativen physisch aus der Tabelle
        // entfernt sind und im Zeitplan nicht mehr auftauchen.
        const geloeschtResult = await client.query(
          `DELETE FROM public.termin_reservierung
           WHERE kd_nr = $1::text
             AND id <> $2::int
             AND status <> 'bestaetigt'`,
          [reservierung.kd_nr, reservierung.id]
        );
        geloeschtCount = geloeschtResult.rowCount ?? 0;
      }

      console.log(
        `Reservierung bestätigt: ${bestaetigtResult.rowCount ?? 0}, Alternativen gelöscht: ${geloeschtCount}`
      );
    });

    return NextResponse.json(
      {
        ok: true,
        reservierung_id: reservierung.id,
        kursnr,
        status: 'bestaetigt',
        offer_id: quittung.offer_id ?? null,
        date_id: quittung.date_id ?? null,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('Fehler bei der Reservierungs-Umwandlung:', err);
    return NextResponse.json(
      { error: toErrorMessage(err) },
      { status: 500 }
    );
  }
}