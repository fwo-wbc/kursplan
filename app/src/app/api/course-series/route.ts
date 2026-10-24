import { NextResponse } from 'next/server';
import { transaction } from '@/lib/db';
import { benachrichtigeN8n } from '@/lib/n8n-sync';
import { NM_SLOTS, STATUS_FREI, VM_SLOTS } from '@/lib/verfuegbarkeit';

// ---------------------------------------------------------------------------
// POST /api/course-series
// Erstellt eine Serienplanung (L-05 Serienplaner).
//
// Request-Body:
//   topicId          : Pflicht – Themen-ID aus public.course_topics
//   planningMode     : Pflicht – 'OFFICE_CAPACITY' | 'EXTERNAL_AVAILABILITY'
//   coursePriority   : optional – Kurspriorität 1..3
//                      (nur bei OFFICE_CAPACITY relevant)
//   startDate        : Pflicht – frühester Serientermin (YYYY-MM-DD, Europe/Berlin)
//   intervalDays     : Pflicht bei OFFICE_CAPACITY – Rhythmus in Tagen (> 0).
//                      Bei EXTERNAL_AVAILABILITY OPTIONAL und inhaltlich
//                      irrelevant: Der Rhythmus ist dort unregelmäßig und
//                      ergibt sich rein aus den Verfügbarkeiten der Trainer
//                      (wird nur als neutraler Wert in series_templates
//                      persistiert).
//   occurrences      : Pflicht – Anzahl zu generierender Termine (> 0)
//
// Ablauf (planningMode === 'OFFICE_CAPACITY'):
//   1. Serien-Vorlage in public.series_templates speichern.
//   2. Datumsfolge erzeugen (startDate + n × intervalDays).
//   3. Pro Datum eine Konfliktprüfung: Liegen am betrachteten Tag bereits
//      >= 3 Kurse in public.course_events an (inkl. der neu generierten),
//      wird needs_conflict_resolution = true gesetzt (Konflikt-Dashboard).
//   4. Einzeltermine in public.course_events anlegen (Slot 09:00–10:30 Uhr).
//
// Ablauf (planningMode === 'EXTERNAL_AVAILABILITY', Szenario 2):
//   Flexibler Rhythmus & Trainer-Priorität (keine starren Intervalle):
//   1. Alle Trainer aus public.trainer_topics für die topicId laden, sortiert
//      nach Priorität (is_primary DESC = Haupttrainer zuerst, dann trainer_id).
//   2. Nacheinander in dieser Reihenfolge: Für den nächsten Trainer die freien
//      Verfügbarkeiten (public.trainer_verfuegbarkeit, status = 'frei',
//      VM/NM-Slots) ab dem startDate chronologisch laden.
//   3. Sind mindestens `occurrences` verfügbare Tage vorhanden, werden die
//      ersten `occurrences` Tage (chronologisch) übernommen und dieser Trainer
//      wird für die gesamte Serie zugewiesen (1 Termin je Tag, Slot
//      09:00–10:30 Uhr).
//   4. Reicht die Verfügbarkeit des Haupttrainers nicht aus, wird der nächste
//      (temporäre) Trainer geprüft. Fällt auch der letzte aus -> HTTP 400.
//   5. Serien-Vorlage + Einzeltermine (Status 'pending') mit direkter
//      trainer_id-Zuweisung. COMMIT + n8n-Ping.
//
// Fire-and-Forget: Nach erfolgreichem COMMIT wird – sofern mindestens
// ein Termin generiert wurde – benachrichtigeN8n('sync_pending_events')
// gefeuert. Der Ping verzögert den Response nicht und crasht die Route nicht.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

/** Dauer eines Kurs-Slots in Minuten (1,5-Stunden-Kurse, konsistent zu
 * planning-utils SLOT_DAUER_MINUTEN). */
const SLOT_DAUER_MINUTEN = 90;

/** Tagesgrenze, ab der ein Tag im Konflikt-Dashboard erscheint. */
const KONFLIKT_GRENZE_TERMINE_PRO_TAG = 3;

/**
 * Neutraler interval_days-Wert für series_templates im EXTERNAL-Modus.
 * Der Rhythmus ist dort unregelmäßig; dieser Wert dient nur als Pflichtfeld-
 * Füllung der Vorlage und wird bei der Terminerzeugung nicht verwendet.
 */
const EXTERNAL_DEFAULT_INTERVAL_DAYS = 7;

/** Erwarteter Request-Body. */
interface SeriesBody {
  topicId?: unknown;
  planningMode?: unknown;
  coursePriority?: unknown;
  startDate?: unknown;
  intervalDays?: unknown;
  occurrences?: unknown;
}

/** Geprüfte Eingabewerte nach Validierung. */
interface SeriesInput {
  topicId: number;
  planningMode: 'OFFICE_CAPACITY' | 'EXTERNAL_AVAILABILITY';
  coursePriority: number | null;
  startDate: string;
  intervalDays: number;
  occurrences: number;
}

/** Wandelt einen DB-Fehler in eine lesbare Meldung um. */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Validiert den Request-Body und liefert die sauberen Werte.
 * Wirft bei ungültigen Eingaben einen Fehler mit aussagekräftiger Meldung.
 */
function parseBody(body: SeriesBody): SeriesInput {
  const topicId = Number(body.topicId);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    throw new Error('topicId muss eine positive Ganzzahl sein.');
  }

  const planningMode = String(body.planningMode ?? '').trim();
  if (
    planningMode !== 'OFFICE_CAPACITY' &&
    planningMode !== 'EXTERNAL_AVAILABILITY'
  ) {
    throw new Error(
      "planningMode muss 'OFFICE_CAPACITY' oder 'EXTERNAL_AVAILABILITY' sein."
    );
  }

  let coursePriority: number | null = null;
  if (body.coursePriority !== undefined && body.coursePriority !== null) {
    const prio = Number(body.coursePriority);
    if (!Number.isInteger(prio) || prio < 1 || prio > 3) {
      throw new Error('coursePriority muss eine Ganzzahl zwischen 1 und 3 sein.');
    }
    coursePriority = prio;
  }

  const startDate = String(body.startDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error('startDate muss im Format YYYY-MM-DD vorliegen.');
  }
  const datum = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(datum.getTime())) {
    throw new Error('startDate ist kein gültiges Datum.');
  }

  // intervalDays: Im EXTERNAL_AVAILABILITY-Modus optional und semantisch
  // belanglos (flexibler Rhythmus aus Trainer-Verfügbarkeiten). Fehlt der
  // Wert, wird ein neutraler Default verwendet. Bei OFFICE_CAPACITY bleibt er
  // Pflicht, dort bestimmt er die Datumsfolge.
  let intervalDays: number;
  if (
    body.intervalDays === undefined ||
    body.intervalDays === null ||
    body.intervalDays === ''
  ) {
    if (planningMode === 'OFFICE_CAPACITY') {
      throw new Error('intervalDays muss eine positive Ganzzahl sein.');
    }
    intervalDays = EXTERNAL_DEFAULT_INTERVAL_DAYS;
  } else {
    const iv = Number(body.intervalDays);
    if (!Number.isInteger(iv) || iv <= 0) {
      throw new Error('intervalDays muss eine positive Ganzzahl sein.');
    }
    intervalDays = iv;
  }

  const occurrences = Number(body.occurrences);
  if (!Number.isInteger(occurrences) || occurrences <= 0) {
    throw new Error('occurrences muss eine positive Ganzzahl sein.');
  }
  if (occurrences > 100) {
    throw new Error('occurrences darf 100 nicht überschreiten.');
  }

  return { topicId, planningMode, coursePriority, startDate, intervalDays, occurrences };
}

/**
 * Liefert das Datum (YYYY-MM-DD) im Format der Europe/Berlin-Zeitzone für einen
 * ISO-String – alle Terminvergleiche laufen in lokaler Tagesdefinition.
 */
function berlinDatum(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Szenario 2 – EXTERNAL_AVAILABILITY (Puzzle-Logik für externe Trainer).
 *
 * Flexibler Rhythmus & Trainer-Priorität:
 *   1. Trainer aus public.trainer_topics laden – Haupttrainer
 *      (is_primary = true) zuerst, dazwischen nach trainer_id.
 *   2. Pro Trainer in dieser Reihenfolge: freie VM/NM-Verfügbarkeiten
 *      (public.trainer_verfuegbarkeit, status = 'frei') ab startDate
 *      chronologisch durchgehen.
 *   3. Der erste Trainer mit mindestens `occurrences` verfügbaren Tagen
 *      übernimmt die gesamte Serie; die ersten `occurrences` Tage werden
 *      chronologisch übernommen (1 Kurs je Tag, 09:00–10:30 Uhr). Bereits
 *      vergebene Slots sind in der Verfügbarkeits-Tabelle nicht mehr
 *      status = 'frei' und scheiden dadurch automatisch aus.
 *   4. Reicht der Haupttrainer nicht aus, wechselt die Suche zum nächsten
 *      (temporären) Trainer.
 *   5. Perfect Match: Serien-Vorlage + Einzeltermine (Status 'pending') mit
 *      direkter trainer_id-Zuweisung. Kein Match -> HTTP 400 + ROLLBACK.
 */
async function handleExternalAvailability(input: SeriesInput) {
  try {
    const ergebnis = await transaction(async (client) => {
      // Themen-Existenzprüfung (keine Vermutungen über IDs).
      const topicCheck = await client.query(
        'SELECT id FROM public.course_topics WHERE id = $1',
        [input.topicId]
      );
      if (topicCheck.rowCount === 0) {
        const err = new Error(`Thema mit id ${input.topicId} existiert nicht.`);
        (err as Error & { statusCode?: number }).statusCode = 404;
        throw err;
      }

      // 1) Qualifizierte Trainer nach Priorität laden (Haupttrainer zuerst).
      const trainerResult = await client.query(
        `SELECT trainer_id
         FROM public.trainer_topics
         WHERE topic_id = $1
         ORDER BY is_primary DESC, trainer_id ASC`,
        [input.topicId]
      );
      const trainerIds = trainerResult.rows.map((row) => Number(row.trainer_id));

      // 2) + 3) + 4) Trainer nacheinander prüfen: Der erste mit genügend
      // freien Verfügbarkeiten (>= occurrences) ab startDate übernimmt.
      let trainerId: number | null = null;
      let gewaehlteTage: string[] = [];

      for (const kandidatId of trainerIds) {
        // Nur Tage mit mindestens einem freien VM/NM-Slot zählen; ein Tag
        // stellt genau einen Termin dar (DISTINCT datum). Sortierung streng
        // chronologisch -> „nächste verfügbare Slots".
        const verfuegbare = await client.query(
          `SELECT DISTINCT datum::text AS datum
           FROM public.trainer_verfuegbarkeit
           WHERE trainer_id = $1
             AND datum >= $2::date
             AND status = $3
             AND slot_code = ANY($4::text[])
           ORDER BY datum ASC`,
          [kandidatId, input.startDate, STATUS_FREI, [...VM_SLOTS, ...NM_SLOTS]]
        );

        if ((verfuegbare.rowCount ?? 0) >= input.occurrences) {
          gewaehlteTage = verfuegbare.rows
            .slice(0, input.occurrences)
            .map((row) => String(row.datum));
          trainerId = kandidatId;
          break;
        }
      }

      // 5) Kein Trainer mit ausreichend Verfügbarkeiten -> Abbruch (ROLLBACK).
      if (trainerId === null) {
        const err = new Error(
          `Für das Thema ${input.topicId} konnte kein Trainer mit mindestens ${input.occurrences} freien Verfügbarkeiten ab ${input.startDate} gefunden werden.`
        );
        (err as Error & { statusCode?: number }).statusCode = 400;
        throw err;
      }

      // 6) Perfect Match: Serien-Vorlage anlegen (interval_days ist im
      // EXTERNAL-Modus nur ein neutrales Pflichtfeld der Vorlage).
      const templateResult = await client.query(
        `INSERT INTO public.series_templates
           (topic_id, planning_mode, course_priority, start_date, interval_days, occurrences)
         VALUES ($1, $2, $3, $4::date, $5, $6)
         RETURNING id`,
        [
          input.topicId,
          input.planningMode,
          input.coursePriority,
          input.startDate,
          input.intervalDays,
          input.occurrences,
        ]
      );
      const serieId = Number(templateResult.rows[0]?.id);

      // 7) Einzeltermine mit direkter Trainer-Zuweisung anlegen (Status 'pending').
      const generierteIds: number[] = [];
      for (const tag of gewaehlteTage) {
        const insertResult = await client.query(
          `INSERT INTO public.course_events
             (course_id, topic_id, trainer_id, start_time, end_time,
              needs_conflict_resolution, sync_status)
           VALUES
             (NULL, $1, $2,
              ($3::date + TIME '09:00') AT TIME ZONE 'Europe/Berlin',
              ($3::date + TIME '09:00') AT TIME ZONE 'Europe/Berlin'
                + INTERVAL '${SLOT_DAUER_MINUTEN} minutes',
              false, 'pending')
           RETURNING id`,
          [input.topicId, trainerId, tag]
        );
        generierteIds.push(Number(insertResult.rows[0].id));
      }

      return { serieId, generierteIds, trainerId, gewaehlteTage };
    });

    // Fire-and-Forget: n8n über bereitstehende Termine informieren (nach COMMIT).
    if (ergebnis.generierteIds.length > 0) {
      benachrichtigeN8n('sync_pending_events');
    }

    return NextResponse.json(
      {
        serie_id: ergebnis.serieId,
        erstellt: ergebnis.generierteIds.length,
        event_ids: ergebnis.generierteIds,
        trainer_id: ergebnis.trainerId,
        termine: ergebnis.gewaehlteTage,
        message: `${ergebnis.generierteIds.length} Termine erfolgreich generiert.`,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const status = (err as Error & { statusCode?: number }).statusCode ?? 500;
    console.error('Fehler bei der Serienplanung (EXTERNAL_AVAILABILITY):', err);
    const message =
      status === 500
        ? `Datenbankfehler bei der Serienplanung: ${toErrorMessage(err)}`
        : toErrorMessage(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  let body: SeriesBody;
  try {
    body = (await request.json()) as SeriesBody;
  } catch {
    return NextResponse.json(
      { error: 'Ungültiger JSON-Body.' },
      { status: 400 }
    );
  }

  let input: SeriesInput;
  try {
    input = parseBody(body);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ungültige Eingabewerte.' },
      { status: 400 }
    );
  }

  if (input.planningMode === 'EXTERNAL_AVAILABILITY') {
    return await handleExternalAvailability(input);
  }

  try {
    const ergebnis = await transaction(async (client) => {
      // Themen-Existenzprüfung (keine Vermutungen über IDs).
      const topicCheck = await client.query(
        'SELECT id FROM public.course_topics WHERE id = $1',
        [input.topicId]
      );
      if (topicCheck.rowCount === 0) {
        const err = new Error(`Thema mit id ${input.topicId} existiert nicht.`);
        (err as Error & { statusCode?: number }).statusCode = 404;
        throw err;
      }

      // 1) Serien-Vorlage anlegen.
      const templateResult = await client.query(
        `INSERT INTO public.series_templates
           (topic_id, planning_mode, course_priority, start_date, interval_days, occurrences)
         VALUES ($1, $2, $3, $4::date, $5, $6)
         RETURNING id`,
        [
          input.topicId,
          input.planningMode,
          input.coursePriority,
          input.startDate,
          input.intervalDays,
          input.occurrences,
        ]
      );
      const serieId = Number(templateResult.rows[0]?.id);

      // 2) Datumsfolge der Serie erzeugen.
      const base = new Date(`${input.startDate}T00:00:00Z`);
      const datumsFolge: string[] = [];
      for (let i = 0; i < input.occurrences; i++) {
        const aktuell = new Date(base.getTime() + i * input.intervalDays * 86400000);
        datumsFolge.push(aktuell.toISOString().slice(0, 10));
      }

      // 3) Bestehende Termine je Tag zählen – Basis der Konfliktprüfung.
      const haeufigkeit = new Map<string, number>();
      if (datumsFolge.length > 0) {
        const existing = await client.query(
          `SELECT (start_time AT TIME ZONE 'Europe/Berlin')::date::text AS tag, COUNT(*)::int AS anzahl
           FROM public.course_events
           WHERE (start_time AT TIME ZONE 'Europe/Berlin')::date IN (
             SELECT unnest($1::date[])::date
           )
           GROUP BY tag`,
          [datumsFolge]
        );
        for (const row of existing.rows as Record<string, unknown>[]) {
          haeufigkeit.set(String(row.tag), Number(row.anzahl));
        }
      }

      // 4) Einzeltermine anlegen und pro Tag die Konflikt-Markierung setzen.
      const generierteIds: number[] = [];
      const kopien: string[] = [];

      for (const tag of datumsFolge) {
        const bisher = haeufigkeit.get(tag) ?? 0;
        haeufigkeit.set(tag, bisher + 1);
        const konflikt = haeufigkeit.get(tag)! >= KONFLIKT_GRENZE_TERMINE_PRO_TAG;

        const insertResult = await client.query(
          `INSERT INTO public.course_events
             (course_id, topic_id, trainer_id, start_time, end_time,
              needs_conflict_resolution, sync_status)
           VALUES
             (NULL, $1, NULL,
              ($2::date + TIME '09:00') AT TIME ZONE 'Europe/Berlin',
              ($2::date + TIME '09:00') AT TIME ZONE 'Europe/Berlin'
                + INTERVAL '${SLOT_DAUER_MINUTEN} minutes',
              $3, 'pending')
           RETURNING id, start_time`,
          [input.topicId, tag, konflikt]
        );
        const row = insertResult.rows[0] as Record<string, unknown>;
        generierteIds.push(Number(row.id));
        if (konflikt) {
          kopien.push(berlinDatum((row.start_time as Date).toISOString()));
        }
      }

      return { serieId, generierteIds, konfliktDatumsfolge: kopien };
    });

    const hatTermine = ergebnis.generierteIds.length > 0;

    // Fire-and-Forget: n8n über bereitstehende Termine informieren.
    // Erfolgt erst NACH dem COMMIT und nur bei mindestens einem Termin.
    if (hatTermine) {
      benachrichtigeN8n('sync_pending_events');
    }

    return NextResponse.json(
      {
        serie_id: ergebnis.serieId,
        erstellt: ergebnis.generierteIds.length,
        event_ids: ergebnis.generierteIds,
        konflikt_tage: ergebnis.konfliktDatumsfolge,
        message: `${ergebnis.generierteIds.length} Termine erfolgreich generiert.`,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const status =
      (err as Error & { statusCode?: number }).statusCode === 404 ? 404 : 500;
    console.error('Fehler bei der Serienplanung:', err);
    return NextResponse.json(
      {
        error: `Datenbankfehler bei der Serienplanung: ${toErrorMessage(err)}`,
      },
      { status }
    );
  }
}
