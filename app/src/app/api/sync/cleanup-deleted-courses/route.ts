import { NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db';

// ---------------------------------------------------------------------------
// POST /api/sync/cleanup-deleted-courses
//
// Bereinigt "Geister-Kurse" in der lokalen PostgreSQL-Datenbank, die im
// edoobox-System bereits gelöscht wurden.
//
// Ablauf:
//   1. edoobox-Daten abrufen:  Alle aktuell gültigen und aktiven Kurs-IDs
//      direkt über die edoobox-API (v2) laden (Auth + offer/list, paginiert).
//   2. Lokale Daten abrufen:   Alle aktiven offer_id aus edoobox_raw.offer.
//   3. Diffing:                offer_ids, die lokal vorhanden sind, aber in
//      der edoobox-Antwort fehlen => "Geister-Kurse".
//   4. Bereinigung:            Abhängige Datensätze werden zuerst entfernt,
//      danach der Kurs selbst. Gemäß Projektregel (keine physischen Löschungen
//      in edoobox_raw) werden offer/offer_date per Soft-Delete markiert;
//      date_leader besitzt keine is_deleted-Spalte und wird physisch entfernt.
//      Die public-Tabellen (trainer_zuweisung, termin_optionen, trainer_kosten)
//      besitzen ebenfalls keine is_deleted-Spalte und werden physisch gelöscht.
//   5. Rückgabe:               JSON-Report mit Anzahl und IDs der gelöschten
//      Kurse (inkl. Kursnummer und Name, z. B. "P97 Test Kurs").
//
// Konfiguration (Umgebungsvariablen):
//   EDOOBOX_API_BASE  – Basis-URL der edoobox-API (Default: https://app1.edoobox.com)
//   EDOOBOX_EDID      – edoobox-Mandantenkennung
//   EDOOBOX_USER      – edoobox-Benutzername (Basic Auth)
//   EDOOBOX_PASSWORD  – edoobox-Passwort (Basic Auth)
// ---------------------------------------------------------------------------

// Route immer dynamisch ausführen – keine statische Optimierung/Cache.
export const dynamic = 'force-dynamic';

const EDOOBOX_API_BASE = process.env.EDOOBOX_API_BASE?.trim() || 'https://app1.edoobox.com';
const EDOOBOX_EDID = process.env.EDOOBOX_EDID?.trim() || '';
const EDOOBOX_USER = process.env.EDOOBOX_USER?.trim() || '';
const EDOOBOX_PASSWORD = process.env.EDOOBOX_PASSWORD?.trim() || '';

/** Timeout für jeden edoobox-API-Aufruf (ms). */
const API_TIMEOUT_MS = 20000;

/**
 * Sicherheits-Schwellenwert: Bricht die Bereinigung ab, wenn der Anteil der
 * als "Geister" erkannten Kurse diesen Wert überschreitet. Schützt vor einem
 * fehlerhaften edoobox-Abruf (z. B. leere oder unvollständige Antwort), der
 * sonst einen Großteil der lokalen Kurse fälschlich löschen würde.
 */
const MAX_GELOESCHTE_ANTEIL = 0.2;

/** Ein in edoobox gelöschter (lokaler) Kurs für den Report. */
interface GeisterKurs {
  offer_id: string;
  offer_number: string | null;
  name: string | null;
}

/** Zähler der entfernten abhängigen Datensätze. */
interface BereinigungsZaehler {
  offer_date: number;
  date_leader: number;
  trainer_zuweisung: number;
  termin_optionen: number;
  trainer_kosten: number;
}

/** Wandelt einen unbekannten Fehler in eine lesbare Meldung um. */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Extrahiert die Angebots-IDs aus einer edoobox-List-Antwort.
 * Die Antwort kann als Array oder als Objekt-Map (id => Eintrag) vorliegen.
 */
function offerIdsAusAntwort(body: unknown): string[] {
  const d = (body as { data?: unknown } | null)?.data;
  const eintraege = Array.isArray(d) ? d : d && typeof d === 'object' ? Object.values(d) : [];
  const ids: string[] = [];
  for (const eintrag of eintraege) {
    if (eintrag && typeof eintrag === 'object') {
      const obj = eintrag as Record<string, unknown>;
      const id = obj.id ?? obj.offer_id;
      if (typeof id === 'string' && id.trim() !== '') ids.push(id.trim());
    }
  }
  return ids;
}

/**
 * Lädt alle aktuell gültigen und aktiven Kurs-IDs direkt von der edoobox-API.
 * Ablauf: Auth (POST /v2/auth) -> paginierte Liste (GET /v2/offer/list).
 */
async function holeAktiveEdooboxOfferIds(): Promise<string[]> {
  if (!EDOOBOX_EDID || !EDOOBOX_USER || !EDOOBOX_PASSWORD) {
    throw new Error(
      'edoobox-Credentials fehlen: EDOOBOX_EDID, EDOOBOX_USER und EDOOBOX_PASSWORD müssen gesetzt sein.'
    );
  }

  // ---- 1. Authentifizierung (analog zu den n8n-Workflows S54/P90) ----
  const authRes = await fetch(`${EDOOBOX_API_BASE}/v2/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'grant-type': 'password',
      Authorization:
        'Basic ' + Buffer.from(`${EDOOBOX_USER}:${EDOOBOX_PASSWORD}`).toString('base64'),
    },
    body: JSON.stringify({
      expire: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!authRes.ok) {
    throw new Error(`edoobox-Auth fehlgeschlagen (HTTP ${authRes.status}).`);
  }

  const authBody = (await authRes.json()) as Record<string, unknown>;
  const token =
    typeof authBody.data === 'string' ? authBody.data : (authBody.access_token as string);
  const edid =
    (authBody.edid as string) ??
    ((authBody.data as Record<string, unknown> | null)?.edid as string | undefined);

  if (!token || !edid) {
    throw new Error('edoobox-Auth-Antwort enthält weder Token noch edid.');
  }

  const headers: Record<string, string> = {
    edid,
    'grant-type': 'access_token',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // ---- 2. Paginierte Liste aller Angebote ----
  const alleIds: string[] = [];
  const reply = 2000;
  let start = 0;

  for (;;) {
    const url = `${EDOOBOX_API_BASE}/v2/offer/list?limit[start]=${start}&limit[reply]=${reply}`;
    const listRes = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!listRes.ok) {
      throw new Error(`edoobox offer/list fehlgeschlagen (HTTP ${listRes.status}).`);
    }

    const body = (await listRes.json()) as Record<string, unknown>;
    const ids = offerIdsAusAntwort(body);
    alleIds.push(...ids);

    // Abbruch, wenn weniger als die angeforderte Seitenlänge zurückkam
    // (letzte Seite erreicht) oder gar keine Einträge mehr folgen.
    if (ids.length < reply) break;
    start += reply;
  }

  return alleIds;
}

export async function POST() {
  try {
    // -----------------------------------------------------------------------
    // 1. edoobox-Daten abrufen: alle aktuell gültigen und aktiven Kurs-IDs.
    // -----------------------------------------------------------------------
    const edooboxIds = await holeAktiveEdooboxOfferIds();
    const edooboxIdSet = new Set(edooboxIds);

    // -----------------------------------------------------------------------
    // 2. Lokale Daten abrufen: alle aktiven Kurs-IDs aus edoobox_raw.offer.
    // -----------------------------------------------------------------------
    const lokalResult = await query(
      `SELECT offer_id, offer_number, name
       FROM edoobox_raw.offer
       WHERE is_deleted IS NOT TRUE
       ORDER BY offer_id`
    );
    const lokaleKurse = lokalResult.rows as GeisterKurs[];

    // -----------------------------------------------------------------------
    // 3. Diffing: lokal vorhanden, aber in edoobox fehlend => Geister-Kurse.
    // -----------------------------------------------------------------------
    const geisterKurse = lokaleKurse.filter((k) => !edooboxIdSet.has(k.offer_id));

    // -----------------------------------------------------------------------
    // 3a. Sicherheitsprüfung: Ein fehlerhafter edoobox-Abruf (leere oder stark
    //     unvollständige Antwort) darf nicht dazu führen, dass ein Großteil der
    //     lokalen Kurse fälschlich als "Geister" bereinigt wird.
    // -----------------------------------------------------------------------
    if (edooboxIds.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Bereinigung abgebrochen: edoobox lieferte keine Kurs-IDs.',
          detail:
            'Eine leere edoobox-Antwort deutet auf einen fehlerhaften Abruf hin. ' +
            'Es wurde nichts gelöscht.',
        },
        { status: 422 }
      );
    }

    const geisterAnteil = lokaleKurse.length > 0 ? geisterKurse.length / lokaleKurse.length : 0;
    if (geisterAnteil > MAX_GELOESCHTE_ANTEIL) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Bereinigung abgebrochen: Sicherheits-Schwellenwert überschritten.',
          detail:
            `${geisterKurse.length} von ${lokaleKurse.length} lokalen Kursen ` +
            `(${(geisterAnteil * 100).toFixed(1)}%) würden als "Geister" markiert. ` +
            `Maximal erlaubt sind ${(MAX_GELOESCHTE_ANTEIL * 100).toFixed(0)}%. ` +
            'Es wurde nichts gelöscht.',
        },
        { status: 422 }
      );
    }

    const zaehler: BereinigungsZaehler = {
      offer_date: 0,
      date_leader: 0,
      trainer_zuweisung: 0,
      termin_optionen: 0,
      trainer_kosten: 0,
    };

    // -----------------------------------------------------------------------
    // 4. Bereinigung: abhängige Datensätze zuerst, dann den Kurs selbst.
    //    Alles in einer Transaktion (alles oder nichts).
    // -----------------------------------------------------------------------
    if (geisterKurse.length > 0) {
      const geisterIds = geisterKurse.map((k) => k.offer_id);

      await transaction(async (client) => {
        // 4a. Abhängige Termine (offer_date) der Geister-Kurse ermitteln.
        const termineResult = await client.query(
          `SELECT date_id
           FROM edoobox_raw.offer_date
           WHERE offer_id = ANY($1::text[])
             AND is_deleted IS NOT TRUE`,
          [geisterIds]
        );
        const dateIds = (termineResult.rows as { date_id: string }[]).map((r) => r.date_id);

        // 4b. Abhängige Datensätze in public.* entfernen (keine is_deleted-Spalte).
        if (dateIds.length > 0) {
          const tz = await client.query(
            `DELETE FROM public.trainer_zuweisung WHERE date_id = ANY($1::text[])`,
            [dateIds]
          );
          zaehler.trainer_zuweisung += tz.rowCount ?? 0;

          const to = await client.query(
            `DELETE FROM public.termin_optionen WHERE date_id = ANY($1::text[])`,
            [dateIds]
          );
          zaehler.termin_optionen += to.rowCount ?? 0;

          const tk = await client.query(
            `DELETE FROM public.trainer_kosten WHERE date_id = ANY($1::text[])`,
            [dateIds]
          );
          zaehler.trainer_kosten += tk.rowCount ?? 0;

          // 4c. date_leader besitzt keine is_deleted-Spalte -> physisch löschen.
          const dl = await client.query(
            `DELETE FROM edoobox_raw.date_leader WHERE date_id = ANY($1::text[])`,
            [dateIds]
          );
          zaehler.date_leader += dl.rowCount ?? 0;
        }

        // 4d. Termine per Soft-Delete markieren (Projektregel: keine physischen
        //     Löschungen in edoobox_raw).
        const od = await client.query(
          `UPDATE edoobox_raw.offer_date
           SET is_deleted = true, last_synced_at = NOW()
           WHERE offer_id = ANY($1::text[])
             AND is_deleted IS NOT TRUE`,
          [geisterIds]
        );
        zaehler.offer_date += od.rowCount ?? 0;

        // 4e. Kurs selbst per Soft-Delete markieren.
        await client.query(
          `UPDATE edoobox_raw.offer
           SET is_deleted = true, last_changed_at = NOW(), last_synced_at = NOW()
           WHERE offer_id = ANY($1::text[])
             AND is_deleted IS NOT TRUE`,
          [geisterIds]
        );
      });
    }

    // -----------------------------------------------------------------------
    // 5. Rückgabe: JSON-Report.
    // -----------------------------------------------------------------------
    return NextResponse.json(
      {
        ok: true,
        geloeschte_kurse: geisterKurse,
        zusammenfassung: {
          edoobox_offer_anzahl: edooboxIds.length,
          lokale_offer_anzahl: lokaleKurse.length,
          geister_kurse: geisterKurse.length,
          geloeschte_kurse: geisterKurse.length,
          geloeschte_termine: zaehler.offer_date,
          geloeschte_date_leader: zaehler.date_leader,
          geloeschte_trainer_zuweisungen: zaehler.trainer_zuweisung,
          geloeschte_termin_optionen: zaehler.termin_optionen,
          geloeschte_trainer_kosten: zaehler.trainer_kosten,
        },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('Fehler bei der Bereinigung gelöschter Kurse:', err);
    return NextResponse.json(
      {
        ok: false,
        error: 'Bereinigung fehlgeschlagen.',
        detail: toErrorMessage(err),
      },
      { status: 500 }
    );
  }
}
