import { NextResponse } from 'next/server';
import { transaction } from '@/lib/db';
import type { PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// POST /api/admin/clean-test-data
// ---------------------------------------------------------------------------
// Entwickler-Funktion zur Bereinigung verwaister Test-Termine.
//
// Problem: In edoobox manuell geloeschte Test-Termine stehen in PostgreSQL
// weiterhin mit is_deleted = false (die Spiegelung weiss nichts von der
// manuellen Loeschung). Filter ueber is_deleted = true treffen daher exakt
// 0 Zeilen. Die Bereinigung identifiziert Test-Termine deshalb anhand echter
// Marker (Kursname / offer_number / Trainer-Name enthalten "test") und optional
// ueber einen uebergebenen Datumsbereich oder konkrete IDs.
//
// Optionale Request-Body-Felder:
//   { "von": "YYYY-MM-DD", "bis": "YYYY-MM-DD",
//     "dateIds": ["date_..."], "offerIds": ["offer_..."],
//     "reservationIds": [23, 24] }
//
// Alle Schritte laufen in einer einzigen Transaktion (Commit/Rollback).
// ---------------------------------------------------------------------------

/** Zusammenfassung der durchgefuehrten Bereinigung. */
export interface CleanupErgebnis {
  geloeschte_reservierungen_test: number;
  geloeschte_reservierungen_verwaist: number;
  geloeschte_reservierungen_altstatus: number;
  geloeschte_zuweisungen: number;
  geloeschte_date_leader: number;
  geloeschte_ausnahmen: number;
  geloeschte_termine: number;
  geloeschte_angebote: number;
}

/** Kursplan-Ausnahmetabellen mit FK auf edoobox_raw.offer (offer_id). */
const AUSNAHME_TABELLEN = [
  'angebot_kostenausnahme',
  'angebot_trainer_kostenausnahme',
  'termin_ausnahme',
  'termin_kosten_ausnahme',
] as const;

/** Vom Client uebergebene Bereinigungsoptionen. */
interface CleanupOptionen {
  von?: string;
  bis?: string;
  dateIds?: string[];
  offerIds?: string[];
  reservationIds?: number[];
}

/** Prueft, ob ein String das Format YYYY-MM-DD besitzt. */
function isIsoDatum(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Ermittelt die konkreten Ziel-Termine (date_id + offer_id), die bereinigt
 * werden sollen. Standardmaessig greifen die Test-Kriterien (Name/Nummer/
 * Trainer enthalten "test"); ein uebergebener Datumsbereich oder konkrete IDs
 * erweitern die Treffermenge.
 */
async function ermittleZieltermine(
  client: PoolClient,
  opts: CleanupOptionen
): Promise<{ dateIds: string[]; offerIds: string[] }> {
  const bedingungen: string[] = [
    `(
       lower(COALESCE(o.name, '')) LIKE '%test%'
       OR lower(COALESCE(o.offer_number, '')) LIKE '%test%'
       OR lower(COALESCE(tr.vorname, '') || ' ' || COALESCE(tr.nachname, '')) LIKE '%test%'
     )`,
  ];
  const params: unknown[] = [];

  if (opts.von && opts.bis && isIsoDatum(opts.von) && isIsoDatum(opts.bis)) {
    params.push(opts.von, opts.bis);
    bedingungen.push(
      `((od.date_start AT TIME ZONE 'Europe/Berlin')::date BETWEEN $${params.length - 1}::date AND $${params.length}::date)`
    );
  }
  if (opts.dateIds && opts.dateIds.length > 0) {
    params.push(opts.dateIds);
    bedingungen.push(`od.date_id = ANY($${params.length}::text[])`);
  }
  if (opts.offerIds && opts.offerIds.length > 0) {
    params.push(opts.offerIds);
    bedingungen.push(`od.offer_id = ANY($${params.length}::text[])`);
  }

  const result = await client.query(
    `SELECT DISTINCT od.date_id, od.offer_id
     FROM edoobox_raw.offer_date od
     LEFT JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
     LEFT JOIN public.trainer_zuweisung tz ON tz.date_id = od.date_id
     LEFT JOIN public.trainer tr ON tr.id = tz.trainer_id
     WHERE ${bedingungen.join(' OR ')}`,
    params
  );

  const dateIds: string[] = [];
  const offerIds: string[] = [];
  const dateSet = new Set<string>();
  const offerSet = new Set<string>();
  for (const row of result.rows as { date_id: string; offer_id: string }[]) {
    if (!dateSet.has(row.date_id)) {
      dateSet.add(row.date_id);
      dateIds.push(row.date_id);
    }
    if (!offerSet.has(row.offer_id)) {
      offerSet.add(row.offer_id);
      offerIds.push(row.offer_id);
    }
  }
  return { dateIds, offerIds };
}

/**
 * Fuehrt die eigentliche Bereinigungslogik innerhalb einer Transaktion aus.
 * Reihenfolge respektiert die FK-Abhaengigkeiten: erst Reservierungen,
 * anschliessend Kind-Datensaetze (Zuweisungen, date_leader, Ausnahmen) und
 * zuletzt die Haupt-Eintraege (offer_date, offer).
 */
async function bereinigeTestDaten(
  client: PoolClient,
  opts: CleanupOptionen
): Promise<CleanupErgebnis> {
  // A) Test-Reservierungen ueber die Themen-Kennung "test" erkennen.
  const resReservierungenTest = await client.query(
    `DELETE FROM public.termin_reservierung
     WHERE status IN ('bestaetigt', 'angeboten')
       AND lower(thema) LIKE '%test%'`
  );

  // Reservierungen ueber explizit uebergebene IDs loeschen.
  let geloeschteReservierungenIds = 0;
  if (opts.reservationIds && opts.reservationIds.length > 0) {
    const res = await client.query(
      `DELETE FROM public.termin_reservierung
       WHERE id = ANY($1::int[])`,
      [opts.reservationIds]
    );
    geloeschteReservierungenIds = res.rowCount ?? 0;
  }

  // B) Verwaiste Reservierungen ohne aktive, reale edoobox-Verbindung.
  const resReservierungenVerwaist = await client.query(
    `DELETE FROM public.termin_reservierung tr
     WHERE tr.status IN ('bestaetigt', 'angeboten')
       AND NOT EXISTS (
         SELECT 1
         FROM public.trainer_zuweisung tz
         JOIN edoobox_raw.offer_date od ON od.date_id = tz.date_id
         JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
         WHERE tz.trainer_id = tr.trainer_id
           AND (od.date_start AT TIME ZONE 'Europe/Berlin')::date = tr.datum
           AND o.offer_number LIKE (tr.kd_nr || '-%')
           AND od.is_deleted IS NOT TRUE
           AND o.is_deleted IS NOT TRUE
           AND lower(o.name) NOT LIKE '%test%'
           AND lower(o.offer_number) NOT LIKE '%test%'
       )`
  );

  // C) Reservierungen mit nicht mehr gueltigem Status.
  const resReservierungenAltstatus = await client.query(
    `DELETE FROM public.termin_reservierung
     WHERE status IN ('storniert', 'abgelaufen')`
  );

  // Ziel-Termine ermitteln (Test-Kriterien + Datumsbereich/IDs).
  const { dateIds, offerIds } = await ermittleZieltermine(client, opts);

  let geloeschteZuweisungen = 0;
  let geloeschteDateLeader = 0;
  let geloeschteAusnahmen = 0;
  let geloeschteTermine = 0;
  let geloeschteAngebote = 0;

  if (dateIds.length > 0 || offerIds.length > 0) {
    // D) Dozentenzuweisungen zu den Ziel-Terminen entfernen.
    if (dateIds.length > 0) {
      const resZ = await client.query(
        `DELETE FROM public.trainer_zuweisung
         WHERE date_id = ANY($1::text[])`,
        [dateIds]
      );
      geloeschteZuweisungen = resZ.rowCount ?? 0;
    }

    // E) Leiter-Verknuepfungen zu den Ziel-Terminen entfernen (FK-Entlastung).
    if (dateIds.length > 0) {
      const resDl = await client.query(
        `DELETE FROM edoobox_raw.date_leader
         WHERE date_id = ANY($1::text[])`,
        [dateIds]
      );
      geloeschteDateLeader = resDl.rowCount ?? 0;
    }

    // F) Kursplan-Ausnahmen auf die Ziel-Angebote entfernen (FK-Entlastung).
    if (offerIds.length > 0) {
      for (const tabelle of AUSNAHME_TABELLEN) {
        const res = await client.query(
          `DELETE FROM kursplan.${tabelle}
           WHERE offer_id = ANY($1::text[])`,
          [offerIds]
        );
        geloeschteAusnahmen += res.rowCount ?? 0;
      }
    }

    // G) Ziel-Termine hart loeschen.
    if (dateIds.length > 0) {
      const resOd = await client.query(
        `DELETE FROM edoobox_raw.offer_date
         WHERE date_id = ANY($1::text[])`,
        [dateIds]
      );
      geloeschteTermine = resOd.rowCount ?? 0;
    }

    // H) Ziel-Angebote hart loeschen, sofern keine weiteren Termine dran haengen.
    if (offerIds.length > 0) {
      const resOffer = await client.query(
        `DELETE FROM edoobox_raw.offer o
         WHERE o.offer_id = ANY($1::text[])
           AND NOT EXISTS (
             SELECT 1 FROM edoobox_raw.offer_date od2 WHERE od2.offer_id = o.offer_id
           )`,
        [offerIds]
      );
      geloeschteAngebote = resOffer.rowCount ?? 0;
    }
  }

  return {
    geloeschte_reservierungen_test:
      (resReservierungenTest.rowCount ?? 0) + geloeschteReservierungenIds,
    geloeschte_reservierungen_verwaist:
      resReservierungenVerwaist.rowCount ?? 0,
    geloeschte_reservierungen_altstatus:
      resReservierungenAltstatus.rowCount ?? 0,
    geloeschte_zuweisungen: geloeschteZuweisungen,
    geloeschte_date_leader: geloeschteDateLeader,
    geloeschte_ausnahmen: geloeschteAusnahmen,
    geloeschte_termine: geloeschteTermine,
    geloeschte_angebote: geloeschteAngebote,
  };
}

export async function POST(request: Request) {
  // Body optional auslesen; ein fehlender/leerer Body entspricht dem
  // Standardverhalten (nur Test-Kriterien).
  let opts: CleanupOptionen = {};
  try {
    const body = (await request.json()) as CleanupOptionen | null;
    if (body && typeof body === 'object') {
      opts = {
        von: isIsoDatum(body.von) ? body.von : undefined,
        bis: isIsoDatum(body.bis) ? body.bis : undefined,
        dateIds: Array.isArray(body.dateIds)
          ? (body.dateIds.filter((x): x is string => typeof x === 'string'))
          : undefined,
        offerIds: Array.isArray(body.offerIds)
          ? (body.offerIds.filter((x): x is string => typeof x === 'string'))
          : undefined,
        reservationIds: Array.isArray(body.reservationIds)
          ? (body.reservationIds.filter(
              (x): x is number => typeof x === 'number' && Number.isInteger(x)
            ))
          : undefined,
      };
    }
  } catch {
    // Kein JSON-Body: Standardverhalten beibehalten.
    opts = {};
  }

  try {
    const ergebnis = await transaction((client) =>
      bereinigeTestDaten(client, opts)
    );
    return NextResponse.json({ ok: true, ...ergebnis }, { status: 200 });
  } catch (err: unknown) {
    const dbErr = err as {
      code?: string;
      message?: string;
      detail?: string;
      hint?: string;
      constraint?: string;
      table?: string;
    };
    console.error('Fehler bei der Bereinigung der Test-Termine:', {
      code: dbErr.code,
      message: dbErr.message,
      detail: dbErr.detail,
      hint: dbErr.hint,
      constraint: dbErr.constraint,
      table: dbErr.table,
    });
    return NextResponse.json(
      {
        error: 'Datenbankfehler bei der Bereinigung der Test-Termine.',
        code: dbErr.code ?? null,
        message: dbErr.message ?? null,
        detail: dbErr.detail ?? null,
      },
      { status: 500 }
    );
  }
}