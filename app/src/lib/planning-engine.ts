// ===========================================================================
// planning-engine.ts
// Regel-Engine der Zwischenplanung (Sandbox) für den Kurstransfer.
//
// Die Engine bildet die harten Geschäftsregeln ab und generiert daraus
// Entwürfe in public.planning_drafts:
//
//   a) Blocker-Tage      – keine Planung an Tagen aus public.calendar_blockers
//                          (Feiertage, Brückentage, Sommerpause).
//   b) Wochentags-Rotation – ein Modul im 4-Wochen-Takt darf nicht auf
//                          denselben Wochentag fallen wie sein Vorgänger-Termin.
//   c) Modul-Abhängigkeit – Modul N muss im definierten Offset (± 1 Tag) nach
//                          seinem Vorgänger-Modul stattfinden.
//   d) Prio-Konflikt      – Warnung, wenn ein Prio-1-Kurs auf demselben Tag
//                          liegt wie ein bereits genehmigter Prio-1-Kurs.
//
// Alle Prüfungen sind als eigenständige, testbare Funktionen aufgebaut, damit
// spätere Verschärfungen (Trainer-Verfügbarkeit, Raumbelegung, …) ergänzt
// werden können, ohne die Generierung umzubauen.
// ===========================================================================

import { query, transaction } from '@/lib/db';

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface Modul {
  id: number;
  name: string;
  position: number;
  takt_wochen: number;
  abhaengigkeit_von: number | null;
  abhaengigkeit_offset_tage: number | null;
  prio: number;
}

export interface Blocker {
  date: string; // YYYY-MM-DD
  reason: string;
}

export type DraftStatus = 'draft' | 'conflict' | 'approved';

export interface PruefErgebnis {
  ok: boolean;
  status: DraftStatus;
  warnungen: string[];
}

export interface GenerierterEntwurf {
  module_id: number;
  trainer_id: number | null;
  proposed_date: string; // YYYY-MM-DD
  status: DraftStatus;
  warnungen: string[];
}

// ---------------------------------------------------------------------------
// Datums-Helfer (Zeitzone Europe/Berlin)
// ---------------------------------------------------------------------------

const TAG_MS = 24 * 60 * 60 * 1000;

/** Formatiert ein Date als YYYY-MM-DD in Berliner Lokalzeit. */
export function zuIsoDatum(d: Date): string {
  const jahr = d.getFullYear();
  const monat = String(d.getMonth() + 1).padStart(2, '0');
  const tag = String(d.getDate()).padStart(2, '0');
  return `${jahr}-${monat}-${tag}`;
}

/** Parst YYYY-MM-DD zu einem Date (lokal, Mitternacht). */
export function vonIsoDatum(iso: string): Date {
  const [jahr, monat, tag] = iso.split('-').map(Number);
  return new Date(jahr, monat - 1, tag);
}

/** Differenz in vollen Tagen zwischen zwei ISO-Daten (b - a). */
export function tageDifferenz(aIso: string, bIso: string): number {
  const a = vonIsoDatum(aIso);
  const b = vonIsoDatum(bIso);
  return Math.round((b.getTime() - a.getTime()) / TAG_MS);
}

/** Addiert n Tage auf ein ISO-Datum. */
export function plusTage(iso: string, n: number): string {
  const d = vonIsoDatum(iso);
  d.setDate(d.getDate() + n);
  return zuIsoDatum(d);
}

// ---------------------------------------------------------------------------
// Regel a) – Blocker-Tage
// ---------------------------------------------------------------------------

/** Liefert alle Blocker-Tage aus public.calendar_blockers. */
export async function ladeBlocker(): Promise<Blocker[]> {
  const res = await query(
    `SELECT date::text AS date, reason
       FROM public.calendar_blockers
      ORDER BY date`
  );
  return res.rows.map((r) => ({ date: r.date, reason: r.reason }));
}

/** Prüft, ob ein Datum ein Blocker-Tag ist. */
export function istBlockerTag(datum: string, blocker: Blocker[]): boolean {
  return blocker.some((b) => b.date === datum);
}

// ---------------------------------------------------------------------------
// Regel b) – Wochentags-Rotation
// ---------------------------------------------------------------------------

/**
 * Prüft die Wochentags-Rotation: Ein Modul im Takt (z. B. 4 Wochen) darf nicht
 * auf denselben Wochentag fallen wie sein letzter geplanter Termin.
 * Liefert true, wenn der Wochentag NICHT kollidiert (Regel erfüllt).
 */
export function pruefeWochentagsRotation(
  modul: Modul,
  datum: string,
  letzterTermin: string | null
): { ok: boolean; warnung: string | null } {
  if (!letzterTermin) {
    return { ok: true, warnung: null };
  }
  const wochentagNeu = vonIsoDatum(datum).getDay();
  const wochentagAlt = vonIsoDatum(letzterTermin).getDay();
  if (wochentagNeu === wochentagAlt) {
    return {
      ok: false,
      warnung: `Wochentags-Rotation: ${datum} fällt auf denselben Wochentag wie der Vorgänger-Termin ${letzterTermin} (Takt ${modul.takt_wochen} Wochen).`,
    };
  }
  return { ok: true, warnung: null };
}

// ---------------------------------------------------------------------------
// Regel c) – Modul-Abhängigkeit
// ---------------------------------------------------------------------------

/**
 * Prüft die Modul-Abhängigkeit: Das Modul muss im Offset ± 1 Tag nach seinem
 * Vorgänger-Modul stattfinden (z. B. Offset 7 → 6–8 Tage Abstand).
 */
export function pruefeModulAbhaengigkeit(
  modul: Modul,
  datum: string,
  vorgaengerDatum: string | null
): { ok: boolean; warnung: string | null } {
  if (!modul.abhaengigkeit_von || !modul.abhaengigkeit_offset_tage || !vorgaengerDatum) {
    return { ok: true, warnung: null };
  }
  const abstand = tageDifferenz(vorgaengerDatum, datum);
  const offset = modul.abhaengigkeit_offset_tage;
  if (abstand < offset - 1 || abstand > offset + 1) {
    return {
      ok: false,
      warnung: `Modul-Abhängigkeit: Abstand zu Modul ${modul.abhaengigkeit_von} beträgt ${abstand} Tage, erlaubt sind ${offset - 1}–${offset + 1} Tage.`,
    };
  }
  return { ok: true, warnung: null };
}

// ---------------------------------------------------------------------------
// Regel d) – Prio-Konfliktprüfung
// ---------------------------------------------------------------------------

/**
 * Prüft, ob auf demselben Tag bereits ein genehmigter Prio-1-Kurs liegt.
 * Liefert eine Warnung (kein harter Fehler), wenn ja.
 */
export async function prüfePrioKonflikt(
  datum: string,
  modulPrio: number
): Promise<{ ok: boolean; warnung: string | null }> {
  if (modulPrio !== 1) {
    return { ok: true, warnung: null };
  }
  const res = await query(
    `SELECT COUNT(*)::int AS anzahl
       FROM public.planning_drafts pd
       JOIN public.course_modules cm ON cm.id = pd.module_id
      WHERE pd.proposed_date = $1
        AND pd.status = 'approved'
        AND cm.prio = 1`,
    [datum]
  );
  const anzahl = Number(res.rows[0].anzahl);
  if (anzahl > 0) {
    return {
      ok: false,
      warnung: `Prio-Konflikt: Am ${datum} liegt bereits ${anzahl} genehmigter Prio-1-Kurs.`,
    };
  }
  return { ok: true, warnung: null };
}

// ---------------------------------------------------------------------------
// Kombinierte Prüfung
// ---------------------------------------------------------------------------

/**
 * Führt alle Regeln für einen Kandidaten-Termin aus.
 * Harte Regeln (Blocker, Rotation, Abhängigkeit) → status 'conflict'.
 * Prio-Konflikt ist eine Warnung und führt nur zu 'conflict', wenn zusätzlich
 * eine harte Regel verletzt ist; ansonsten bleibt der Entwurf 'draft'.
 */
export async function prüfeEntwurf(
  modul: Modul,
  datum: string,
  blocker: Blocker[],
  letzterTermin: string | null,
  vorgaengerDatum: string | null
): Promise<PruefErgebnis> {
  const warnungen: string[] = [];

  if (istBlockerTag(datum, blocker)) {
    const grund = blocker.find((b) => b.date === datum)?.reason ?? 'unbekannt';
    warnungen.push(`Blocker-Tag: ${datum} ist gesperrt (${grund}).`);
  }

  const rotation = pruefeWochentagsRotation(modul, datum, letzterTermin);
  if (!rotation.ok && rotation.warnung) warnungen.push(rotation.warnung);

  const abhaengigkeit = pruefeModulAbhaengigkeit(modul, datum, vorgaengerDatum);
  if (!abhaengigkeit.ok && abhaengigkeit.warnung) warnungen.push(abhaengigkeit.warnung);

  const prio = await prüfePrioKonflikt(datum, modul.prio);
  if (!prio.ok && prio.warnung) warnungen.push(prio.warnung);

  const harteRegelVerletzt = warnungen.some((w) => w.startsWith('Blocker-Tag') || w.startsWith('Wochentags-Rotation') || w.startsWith('Modul-Abhängigkeit'));
  const status: DraftStatus = harteRegelVerletzt ? 'conflict' : 'draft';

  return { ok: warnungen.length === 0, status, warnungen };
}

// ---------------------------------------------------------------------------
// Generierung
// ---------------------------------------------------------------------------

/**
 * Generiert Entwürfe für alle aktiven Module und schreibt sie in
 * public.planning_drafts. Bestehende Entwürfe desselben Moduls werden dabei
 * NICHT gelöscht (Sandbox-Prinzip: manuelle Korrekturen bleiben erhalten);
 * es wird nur der jeweils nächste freie Termin ergänzt.
 *
 * @param startDatum  Erster Kandidaten-Tag (YYYY-MM-DD), Standard: morgen.
 * @param anzahlTage  Wie viele Tage vorausgespäht werden (Standard: 60).
 */
export async function generiereEntwuerfe(
  startDatum?: string,
  anzahlTage: number = 60
): Promise<{ generiert: number; entwuerfe: GenerierterEntwurf[] }> {
  const start = startDatum ?? plusTage(zuIsoDatum(new Date()), 1);

  // Module laden (aktiv, nach Position sortiert).
  const moduleRes = await query(
    `SELECT id, name, position, takt_wochen, abhaengigkeit_von,
            abhaengigkeit_offset_tage, prio
       FROM public.course_modules
      WHERE is_active = true
      ORDER BY position, id`
  );
  const module: Modul[] = moduleRes.rows.map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    takt_wochen: r.takt_wochen,
    abhaengigkeit_von: r.abhaengigkeit_von,
    abhaengigkeit_offset_tage: r.abhaengigkeit_offset_tage,
    prio: r.prio,
  }));

  if (module.length === 0) {
    return { generiert: 0, entwuerfe: [] };
  }

  const blocker = await ladeBlocker();

  // Letzte geplante Termine je Modul (für Rotation) und je Vorgänger-Modul
  // (für Abhängigkeit) aus bestehenden Entwürfen laden.
  const letzteRes = await query(
    `SELECT DISTINCT ON (module_id)
            module_id, proposed_date::text AS proposed_date
       FROM public.planning_drafts
      WHERE status IN ('draft', 'approved')
      ORDER BY module_id, proposed_date DESC`
  );
  const letzteTermine = new Map<number, string>();
  for (const row of letzteRes.rows) {
    letzteTermine.set(row.module_id, row.proposed_date);
  }

  const entwuerfe: GenerierterEntwurf[] = [];

  await transaction(async (client) => {
    for (const modul of module) {
      const vorgaengerDatum = modul.abhaengigkeit_von
        ? (letzteTermine.get(modul.abhaengigkeit_von) ?? null)
        : null;

      // Kandidaten-Tage durchlaufen, bis ein gültiger gefunden ist.
      let gefunden: GenerierterEntwurf | null = null;
      for (let i = 0; i < anzahlTage; i++) {
        const kandidat = plusTage(start, i);
        const ergebnis = await prüfeEntwurf(
          modul,
          kandidat,
          blocker,
          letzteTermine.get(modul.id) ?? null,
          vorgaengerDatum
        );
        if (ergebnis.status === 'draft') {
          gefunden = {
            module_id: modul.id,
            trainer_id: null,
            proposed_date: kandidat,
            status: 'draft',
            warnungen: ergebnis.warnungen,
          };
          break;
        }
      }

      // Kein freier Tag gefunden → Konflikt-Entwurf auf dem ersten Kandidaten
      // mit allen Warnungen, damit der Nutzer manuell korrigieren kann.
      if (!gefunden) {
        const kandidat = plusTage(start, 0);
        const ergebnis = await prüfeEntwurf(
          modul,
          kandidat,
          blocker,
          letzteTermine.get(modul.id) ?? null,
          vorgaengerDatum
        );
        gefunden = {
          module_id: modul.id,
          trainer_id: null,
          proposed_date: kandidat,
          status: 'conflict',
          warnungen: ergebnis.warnungen,
        };
      }

      const inserted = await client.query(
        `INSERT INTO public.planning_drafts (module_id, trainer_id, proposed_date, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [gefunden.module_id, gefunden.trainer_id, gefunden.proposed_date, gefunden.status]
      );
      void inserted; // id wird aktuell nicht weiter benötigt
      entwuerfe.push(gefunden);
    }
  });

  return { generiert: entwuerfe.length, entwuerfe };
}

// ---------------------------------------------------------------------------
// Abschluss: Sandbox → course_events
// ---------------------------------------------------------------------------

/**
 * Übernimmt alle genehmigten Entwürfe in public.course_events.
 * Dies ist der spätere Übergabepunkt an den edoobox-Transfer (P90).
 * @returns Anzahl der übernommenen Entwürfe.
 */
export async function schliessePlanungAb(): Promise<{ uebernommen: number }> {
  const uebernommen = await transaction(async (client) => {
    // 1) Modul-Namen der genehmigten Entwürfe ermitteln.
    const moduleRes = await client.query(
      `SELECT DISTINCT pd.module_id, cm.name
         FROM public.planning_drafts pd
         JOIN public.course_modules cm ON cm.id = pd.module_id
        WHERE pd.status = 'approved'`
    );

    // 2) Topic je Modul sicherstellen. course_topics.name hat keinen
    //    UNIQUE-Constraint → explizit prüfen und ggf. anlegen.
    const topicIds = new Map<number, number>();
    for (const row of moduleRes.rows) {
      const vorhanden = await client.query(
        `SELECT id FROM public.course_topics WHERE name = $1 LIMIT 1`,
        [row.name]
      );
      if (vorhanden.rows.length > 0) {
        topicIds.set(row.module_id, vorhanden.rows[0].id);
      } else {
        const neu = await client.query(
          `INSERT INTO public.course_topics (name) VALUES ($1) RETURNING id`,
          [row.name]
        );
        topicIds.set(row.module_id, neu.rows[0].id);
      }
    }

    // 3) Genehmigte Entwürfe in course_events übernehmen (idempotent:
    //    gleicher Kurs + gleicher Tag wird nicht doppelt angelegt).
    const entwuerfe = await client.query(
      `SELECT pd.id, pd.module_id, pd.trainer_id,
              pd.proposed_date::text AS proposed_date
         FROM public.planning_drafts pd
        WHERE pd.status = 'approved'
        ORDER BY pd.id`
    );

    let anzahl = 0;
    for (const e of entwuerfe.rows) {
      const topicId = topicIds.get(e.module_id);
      if (!topicId) continue;
      const inserted = await client.query(
        `INSERT INTO public.course_events (course_id, topic_id, trainer_id, start_time, end_time)
         SELECT $1, $2, $3,
                ($4::date::timestamp AT TIME ZONE 'Europe/Berlin'),
                (($4::date::timestamp + INTERVAL '90 minutes') AT TIME ZONE 'Europe/Berlin')
          WHERE NOT EXISTS (
            SELECT 1 FROM public.course_events ce
             WHERE ce.course_id = $1
               AND (ce.start_time AT TIME ZONE 'Europe/Berlin')::date = $4::date
          )
          RETURNING id`,
        [e.module_id, topicId, e.trainer_id, e.proposed_date]
      );
      anzahl += inserted.rowCount ?? 0;
    }
    return anzahl;
  });
  return { uebernommen };
}