import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Route immer dynamisch ausliefern – verhindert statisches Caching durch den
// Next.js App Router (die Prüfung liest live aus edoobox_raw).
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Kollisions- und Zähler-Prüfung für den Kurstransfer (VOR dem n8n-Webhook).
//
// Für jede übergebene Zeile (kursCode + Datum + Beginn) wird gegen edoobox_raw
// geprüft:
//   1) Kollision: Existiert bereits ein AKTIVES Angebot (is_deleted IS NOT
//      TRUE, Status ungleich '0'=Entwurf) desselben Kurs-Codes an exakt diesem
//      Tag? -> kollision = true (die Zeile darf NICHT an edoobox gesendet
//      werden, sonst entsteht ein zweiter Kurs für denselben Tag).
//   2) Monatszähler: Wie viele AKTIVE Angebote mit diesem Kürzel existieren
//      bereits im selben Monat (MMYY)? -> monatAnzahl (Basis für die
//      Vergabe der nächsten freien Nummer -1, -2, …).
//
// Soft-Delete-Regel: Soft-deleted Bestände (is_deleted = true) gelten NICHT
// als vorhanden und blockieren weder die Kollisionsprüfung noch den Zähler.
// ---------------------------------------------------------------------------

interface CheckEintrag {
  kurs_key: string;
  kursCode: string;
  datum: string;
  beginn: string;
  mmyy: string;
  gueltig: boolean;
  kollision: boolean;
  monatAnzahl: number;
  /** Optionaler Grund, warum die Zeile als Kollision gilt. */
  grund?: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Parst "06.12.2027" -> { tag, monat, jahr }; bei ungültiger Eingabe null. */
function parseDatum(wert: unknown): { tag: number; monat: number; jahr: number } | null {
  const s = typeof wert === 'string' ? wert.trim() : '';
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (!m) return null;
  const tag = Number(m[1]);
  const monat = Number(m[2]);
  const jahr = Number(m[3]);
  if (monat < 1 || monat > 12 || tag < 1 || tag > 31) return null;
  return { tag, monat, jahr };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Request-Body muss gültiges JSON sein.' },
      { status: 400 }
    );
  }

  const zeilen = Array.isArray(body.zeilen) ? body.zeilen : null;
  if (!zeilen || zeilen.length === 0) {
    return NextResponse.json(
      { error: 'zeilen ist ein Pflichtfeld (nicht-leeres Array).' },
      { status: 400 }
    );
  }

  // Eingaben normalisieren. kurs_key folgt exakt dem Frontend-Format
  // "DD.MM.YYYY|HH:MM|kurs_code" (getRowKey), damit das Frontend die
  // Ergebnisse 1:1 über den kurs_key zuordnen kann.
  const eingaben: Array<{
    kursCode: string;
    datum: string;
    beginn: string;
    kurs_key: string;
    mmyy: string;
    isoDatum: string;
  }> = [];

  for (const raw of zeilen) {
    const zeile = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const kursCode = typeof zeile.kursCode === 'string' ? zeile.kursCode.trim() : '';
    const datumRaw = typeof zeile.datum === 'string' ? zeile.datum.trim() : '';
    const beginn = typeof zeile.beginn === 'string' ? zeile.beginn.trim() : '';
    const geparst = parseDatum(datumRaw);

    eingaben.push({
      kursCode,
      datum: datumRaw,
      beginn,
      kurs_key: datumRaw && beginn && kursCode ? `${datumRaw}|${beginn}|${kursCode}` : '',
      mmyy: geparst ? `${pad2(geparst.monat)}${String(geparst.jahr).slice(-2)}` : '',
      isoDatum: geparst ? `${geparst.jahr}-${pad2(geparst.monat)}-${pad2(geparst.tag)}` : '',
    });
  }

  try {
    const gueltige = eingaben.filter((e) => e.kurs_key && e.mmyy && e.isoDatum);

    // --- 1) Kollision je (kursCode, Datum) --------------------------------
    const kollisionByKey = new Map<string, boolean>();
    if (gueltige.length > 0) {
      const codes = gueltige.map((e) => e.kursCode);
      const mmyys = gueltige.map((e) => e.mmyy);
      const daten = gueltige.map((e) => e.isoDatum);

      const kollisionsResult = await query(
        `WITH eingaben(kurs_code, mmyy, datum) AS (
           SELECT * FROM unnest($1::text[], $2::text[], $3::date[])
         )
         SELECT e.kurs_code, e.datum::text AS datum,
                EXISTS (
                  SELECT 1
                  FROM edoobox_raw.offer o
                  JOIN edoobox_raw.offer_date od ON od.offer_id = o.offer_id
                  WHERE (o.offer_number = e.kurs_code
                         OR o.offer_number = e.kurs_code || '-' || e.mmyy
                         OR o.offer_number LIKE e.kurs_code || '-' || e.mmyy || '-%')
                    AND (od.date_start AT TIME ZONE 'Europe/Berlin')::date = e.datum
                    AND o.is_deleted IS NOT TRUE
                    AND od.is_deleted IS NOT TRUE
                    AND o.status <> '0'
                ) AS kollision
         FROM eingaben e`,
        [codes, mmyys, daten]
      );

      for (const row of kollisionsResult.rows as Array<{
        kurs_code: string;
        datum: string;
        kollision: boolean;
      }>) {
        kollisionByKey.set(`${row.kurs_code}|${row.datum}`, Boolean(row.kollision));
      }
    }

    // --- 1b) Kollision via kurstransfer_status (Zwei-Stufen-Prüfung) --------
    // Ein frisch übertragener Kurs liegt evtl. noch nicht in edoobox_raw, ist
    // aber bereits in public.kurstransfer_status als 'erledigt' vermerkt.
    // Ein solcher Eintrag zählt ebenfalls als Kollision (Duplikat-Schutz).
    const kollisionStatusByKey = new Map<string, boolean>();
    if (gueltige.length > 0) {
      const statusResult = await query(
        `WITH eingaben(kurs_key, datum, kurs_code) AS (
           SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
         )
         SELECT e.kurs_key, e.datum, e.kurs_code,
                EXISTS (
                  SELECT 1
                  FROM public.kurstransfer_status ks
                  WHERE ks.status = 'erledigt'
                    AND ks.edoobox_offer_id IS NOT NULL
                    AND ks.edoobox_offer_id <> ''
                    AND ks.edoobox_offer_id <> 'undefined'
                    AND (ks.kurs_key = e.kurs_key
                         OR ks.kurs_key LIKE e.datum || '|%|' || e.kurs_code)
                ) AS kollision
         FROM eingaben e`,
        [
          gueltige.map((e) => e.kurs_key),
          gueltige.map((e) => e.datum),
          gueltige.map((e) => e.kursCode),
        ]
      );

      for (const row of statusResult.rows as Array<{
        kurs_key: string;
        kollision: boolean;
      }>) {
        kollisionStatusByKey.set(row.kurs_key, Boolean(row.kollision));
      }
    }

    // --- 2) Monatszähler je (kursCode, MMYY) ------------------------------
    const monatByKey = new Map<string, number>();
    const eindeutigeMonate = new Map<string, { kursCode: string; mmyy: string }>();
    for (const e of gueltige) {
      eindeutigeMonate.set(`${e.kursCode}|${e.mmyy}`, { kursCode: e.kursCode, mmyy: e.mmyy });
    }

    if (eindeutigeMonate.size > 0) {
      const monatListe = [...eindeutigeMonate.values()];
      const monatResult = await query(
        `WITH eingaben(kurs_code, mmyy) AS (
           SELECT * FROM unnest($1::text[], $2::text[])
         )
         SELECT e.kurs_code, e.mmyy,
                (SELECT COUNT(*)
                 FROM edoobox_raw.offer o
                 WHERE o.is_deleted IS NOT TRUE
                   AND o.status <> '0'
                   AND (o.offer_number = e.kurs_code || '-' || e.mmyy
                        OR o.offer_number LIKE e.kurs_code || '-' || e.mmyy || '-%')
                ) AS monat_anzahl
         FROM eingaben e`,
        [monatListe.map((m) => m.kursCode), monatListe.map((m) => m.mmyy)]
      );

      for (const row of monatResult.rows as Array<{
        kurs_code: string;
        mmyy: string;
        monat_anzahl: string;
      }>) {
        monatByKey.set(`${row.kurs_code}|${row.mmyy}`, Number(row.monat_anzahl) || 0);
      }
    }

    // --- 2b) Monatszähler via kurstransfer_status ---------------------------
    // Frisch übertragene Kurse (noch nicht in edoobox_raw synchronisiert)
    // müssen ebenfalls mitgezählt werden, damit Folgetermine im selben Monat
    // nicht dieselbe Nummer erhalten.
    const monatStatusByKey = new Map<string, number>();
    if (eindeutigeMonate.size > 0) {
      const monatListe = [...eindeutigeMonate.values()];
      const monatStatusResult = await query(
        `WITH eingaben(kurs_code, mmyy) AS (
           SELECT * FROM unnest($1::text[], $2::text[])
         )
         SELECT e.kurs_code, e.mmyy,
                (SELECT COUNT(*)
                 FROM public.kurstransfer_status ks
                 WHERE ks.status = 'erledigt'
                   AND ks.edoobox_offer_id IS NOT NULL
                   AND ks.edoobox_offer_id <> ''
                   AND ks.edoobox_offer_id <> 'undefined'
                   AND ks.kurs_key LIKE '%.' || left(e.mmyy, 2) || '.' || right(e.mmyy, 2) || '|%'
                   AND ks.kurs_key LIKE '%|' || e.kurs_code
                ) AS monat_anzahl
         FROM eingaben e`,
        [monatListe.map((m) => m.kursCode), monatListe.map((m) => m.mmyy)]
      );

      for (const row of monatStatusResult.rows as Array<{
        kurs_code: string;
        mmyy: string;
        monat_anzahl: string;
      }>) {
        monatStatusByKey.set(`${row.kurs_code}|${row.mmyy}`, Number(row.monat_anzahl) || 0);
      }
    }

    // --- Antwort 1:1 zu den Eingabezeilen aufbauen -------------------------
    const eintraege: CheckEintrag[] = eingaben.map((e) => {
      const gueltig = Boolean(e.kurs_key && e.mmyy && e.isoDatum);
      const kollisionEdoobox = gueltig
        ? (kollisionByKey.get(`${e.kursCode}|${e.isoDatum}`) ?? false)
        : false;
      const kollisionStatus = gueltig
        ? (kollisionStatusByKey.get(e.kurs_key) ?? false)
        : false;
      const kollision = kollisionEdoobox || kollisionStatus;

      let grund: string | undefined;
      if (gueltig) {
        if (kollisionStatus) {
          grund = 'Bereits übertragen / in kurstransfer_status als erledigt vermerkt';
        } else if (kollisionEdoobox) {
          grund = 'Bereits in edoobox_raw vorhanden';
        }
      }

      return {
        kurs_key: e.kurs_key,
        kursCode: e.kursCode,
        datum: e.datum,
        beginn: e.beginn,
        mmyy: e.mmyy,
        gueltig,
        kollision,
        monatAnzahl: gueltig
          ? (monatByKey.get(`${e.kursCode}|${e.mmyy}`) ?? 0) +
            (monatStatusByKey.get(`${e.kursCode}|${e.mmyy}`) ?? 0)
          : 0,
        grund,
      };
    });

    return NextResponse.json({ eintraege });
  } catch (err) {
    console.error('POST /api/kurstransfer/check fehlgeschlagen:', err);
    return NextResponse.json(
      { error: 'Kollisionsprüfung konnte nicht durchgeführt werden.' },
      { status: 500 }
    );
  }
}
