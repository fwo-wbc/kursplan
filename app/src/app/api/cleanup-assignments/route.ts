import { NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db';

// ---------------------------------------------------------------------------
// POST /api/cleanup-assignments
//
// Bereinigt doppelte Trainer-Zuweisungen, die zwischen Verfügbarkeitspflege
// und Kursplanung entstanden sind.
//
// Ablauf:
//   1. Dubletten-Erkennung: Alle Kurs-Termine (date_id) ermitteln, denen in
//      public.trainer_zuweisung mehr als ein Trainer zugewiesen ist. Nur
//      aktive Termine (is_deleted IS NOT TRUE) werden berücksichtigt.
//   2. Status-Prüfung: Für jede Dublette werden die verknüpften
//      Zuweisungsstatus aus der Kursplanung (public.trainer_zuweisung.status)
//      ausgewertet. Der Wert 'bestätigt' entspricht „Freigegeben/Grün“.
//   3. Automatische Auflösung: Besitzt exakt ein Trainer den Status
//      'bestätigt', gilt diese Zuweisung als korrekt; die Zuordnungen der
//      übrigen Trainer zu diesem Termin werden gelöscht.
//   4. Report (Fallback): Hat keine oder mehr als eine Zuweisung den Status
//      'bestätigt', wird kein Datensatz gelöscht. Der Fall landet im
//      Konflikt-Array (Kursnummer, Titel, Datum, Startzeit, Trainer + Status)
//      zur manuellen Korrektur.
// ---------------------------------------------------------------------------

/** Status „Freigegeben/Grün/Bestätigt“ im einheitlichen Statusmodell. */
const STATUS_FREIGEGEBEN = 'bestätigt';

/** Ein Trainer samt Zuweisungsstatus innerhalb einer Dublette. */
interface TrainerEintrag {
  trainer_id: number;
  name: string;
  kuerzel: string | null;
  status: string | null;
}

/** Gemeinsame Termin-Identifikation für Report und Bereinigung. */
interface TerminKontext {
  date_id: string;
  offer_id: string | null;
  kursnr: string | null;
  titel: string | null;
  datum: string | null;
  start_uhr: number | null;
}

/** Eine automatisch aufgelöste Dublette. */
interface BereinigtEintrag extends TerminKontext {
  behalten: TrainerEintrag;
  entfernt: TrainerEintrag[];
}

/** Eine uneindeutige Dublette, die manuell korrigiert werden muss. */
interface KonfliktEintrag extends TerminKontext {
  trainer: TrainerEintrag[];
}

/** Rohe DB-Zeile der Dubletten-Erkennung. */
interface DubletteRow extends TerminKontext {
  trainer_anzahl: number;
}

/** Rohe DB-Zeile einer Zuweisung mit Trainer-Stammdaten. */
interface ZuweisungRow {
  id: number;
  date_id: string;
  trainer_id: number;
  status: string | null;
  vorname: string;
  nachname: string;
  kuerzel: string | null;
}

/** Wandelt einen unbekannten DB-Fehler in eine lesbare Meldung um. */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Formatiert eine Startzeit (Dezimalstunden) als HH:MM. */
function startzeitText(startUhr: number | null): string {
  if (startUhr === null || !Number.isFinite(startUhr)) return '–';
  const stunden = Math.floor(startUhr);
  const minuten = Math.round((startUhr - stunden) * 60);
  return `${String(stunden).padStart(2, '0')}:${String(minuten).padStart(2, '0')}`;
}

export async function POST() {
  try {
    // -----------------------------------------------------------------------
    // 1. Dubletten-Erkennung: Termine mit mehr als einem zugewiesenen Trainer.
    //    Gruppiert über date_id (eindeutiger Termin); offer_id, Datum und
    //    Startzeit werden für den Report mitgeliefert.
    // -----------------------------------------------------------------------
    const dublettenResult = await query(
      `SELECT
         tz.date_id,
         od.offer_id::text AS offer_id,
         o.offer_number    AS kursnr,
         o.name            AS titel,
         to_char((od.date_start AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS datum,
         (EXTRACT(HOUR FROM (od.date_start AT TIME ZONE 'Europe/Berlin'))
           + EXTRACT(MINUTE FROM (od.date_start AT TIME ZONE 'Europe/Berlin')) / 60.0)::double precision AS start_uhr,
         count(DISTINCT tz.trainer_id) AS trainer_anzahl
       FROM public.trainer_zuweisung tz
       JOIN edoobox_raw.offer_date od ON od.date_id = tz.date_id
       JOIN edoobox_raw.offer o      ON o.offer_id = od.offer_id
       WHERE od.is_deleted IS NOT TRUE
         AND o.is_deleted  IS NOT TRUE
       GROUP BY tz.date_id, od.offer_id, o.offer_number, o.name, od.date_start
       HAVING count(DISTINCT tz.trainer_id) > 1
       ORDER BY datum, start_uhr, tz.date_id`
    );

    const dubletten = dublettenResult.rows as DubletteRow[];

    const bereinigt: BereinigtEintrag[] = [];
    const konflikte: KonfliktEintrag[] = [];
    let geloeschteZuweisungen = 0;

    // -----------------------------------------------------------------------
    // 2. + 3. + 4. Je Dublette Status prüfen, eindeutige Fälle auflösen,
    //    uneindeutige Fälle in den Report übernehmen.
    // -----------------------------------------------------------------------
    for (const dublette of dubletten) {
      const zuweisungenResult = await query(
        `SELECT
           tz.id,
           tz.date_id,
           tz.trainer_id,
           tz.status,
           t.vorname,
           t.nachname,
           t.kuerzel
         FROM public.trainer_zuweisung tz
         JOIN public.trainer t ON t.id = tz.trainer_id
         WHERE tz.date_id = $1
         ORDER BY t.nachname ASC, t.vorname ASC`,
        [dublette.date_id]
      );

      const zuweisungen = zuweisungenResult.rows as ZuweisungRow[];

      const trainerEintraege: TrainerEintrag[] = zuweisungen.map((z) => ({
        trainer_id: z.trainer_id,
        name: `${z.vorname} ${z.nachname}`.trim(),
        kuerzel: z.kuerzel,
        status: z.status,
      }));

      const freigegeben = trainerEintraege.filter(
        (t) => t.status === STATUS_FREIGEGEBEN
      );

      const kontext: TerminKontext = {
        date_id: dublette.date_id,
        offer_id: dublette.offer_id,
        kursnr: dublette.kursnr,
        titel: dublette.titel,
        datum: dublette.datum,
        start_uhr: dublette.start_uhr,
      };

      // Uneindeutig: keine oder mehrere „Freigegeben“-Zuweisungen.
      if (freigegeben.length !== 1) {
        konflikte.push({ ...kontext, trainer: trainerEintraege });
        continue;
      }

      // Eindeutig: exakt ein Trainer ist freigegeben – die übrigen
      // Zuordnungen zu diesem Termin werden gelöscht.
      const behalten = freigegeben[0];
      const entfernt = trainerEintraege.filter(
        (t) => t.trainer_id !== behalten.trainer_id
      );

      if (entfernt.length > 0) {
        await transaction(async (client) => {
          const loeschResult = await client.query(
            `DELETE FROM public.trainer_zuweisung
             WHERE date_id = $1::text
               AND trainer_id <> $2::int`,
            [dublette.date_id, behalten.trainer_id]
          );
          geloeschteZuweisungen += loeschResult.rowCount ?? 0;
        });
      }

      bereinigt.push({ ...kontext, behalten, entfernt });
    }

    return NextResponse.json(
      {
        ok: true,
        bereinigt,
        konflikte,
        zusammenfassung: {
          dubletten: dubletten.length,
          bereinigt: bereinigt.length,
          konflikte: konflikte.length,
          geloeschte_zuweisungen: geloeschteZuweisungen,
        },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('Fehler bei der Bereinigung doppelter Trainer-Zuweisungen:', err);
    return NextResponse.json(
      {
        error: 'Datenbankfehler bei der Bereinigung der Zuweisungen.',
        detail: toErrorMessage(err),
      },
      { status: 500 }
    );
  }
}