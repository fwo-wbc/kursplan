// ---------------------------------------------------------------------------
// Gemeinsame Logik für die Verfügbarkeits-Routen.
//
// Die Oberfläche arbeitet mit den zwei Tagesabschnitten Vormittag (VM) und
// Nachmittag (NM). Ein „ganzer Tag" entspricht VM + NM (V-02). Die Angabe wird
// serverseitig in die betroffenen Einzelslots aufgelöst (V-03), damit die
// Ausbildung in der bestehenden Tabelle public.trainer_verfuegbarkeit
// granular bleibt. Der Abend (AB) bleibt in dieser Ansicht unangetastet.
//
// Zusätzlich werden stundengenaue Zeitfenster unterstützt (L-05 Serienplaner,
// Szenario 2). Ein Zeitfenster wird als eigener Slot gespeichert:
//   * slot_code  = 'z_HHMM_HHMM'  (z. B. 'z_0900_1100') – eindeutig über den
//     bestehenden Constraint (trainer_id, datum, slot_code), sodass der
//     bestehende VM/NM-Mechanismus (HT/K1/K2/K3/K4) unangetastet bleibt.
//   * status     = 'frei'
//   * start_time / end_time (TIME), is_booked (BOOLEAN DEFAULT false)
// Gebuchte Slots (is_booked = true) werden weder gelöscht noch überschrieben.
// ---------------------------------------------------------------------------

import { transaction } from '@/lib/db';

export const VM_SLOTS = ['HT', 'K1', 'K2'];
export const NM_SLOTS = ['K3', 'K4'];
export const TAG_SLOTS = [...VM_SLOTS, ...NM_SLOTS];

/** Status einer freien Freigabe (konsistent zur bestehenden Route / V-09). */
export const STATUS_FREI = 'frei';

/** Ein stundengenaues Zeitfenster (Start/Ende in HH:MM). */
export interface ZeitfensterEintrag {
  /** Beginn (HH:MM). */
  start_time: string;
  /** Ende (HH:MM), muss nach start_time liegen. */
  end_time: string;
}

export interface TageEintrag {
  datum: string;
  vm: boolean;
  nm: boolean;
  /** Stundengenaue Zeitfenster (optional) – werden als 'z_HHMM_HHMM'-Slots gespeichert. */
  zeitfenster?: ZeitfensterEintrag[];
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Prüft, ob ein String das Format YYYY-MM-DD besitzt und ein gültiges Datum ist. */
export function isIsoDatum(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const datum = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(datum.getTime()) && datum.toISOString().startsWith(value);
}

/** Liefert den ersten und letzten Tag eines Kalendermonats `YYYY-MM`. */
export function monatGrenzen(monat: string): { von: string; bis: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(monat);
  if (!m) {
    return null;
  }
  const jahr = Number(m[1]);
  const monatIndex = Number(m[2]) - 1;
  if (monatIndex < 0 || monatIndex > 11) {
    return null;
  }
  const ersterTag = new Date(Date.UTC(jahr, monatIndex, 1));
  const letzterTag = new Date(Date.UTC(jahr, monatIndex + 1, 0));
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { von: fmt(ersterTag), bis: fmt(letzterTag) };
}

/** Parst eine Ganzzahl und prüft, dass sie positiv ist. */
export function parseTrainerId(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const n = Number(trimmed);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Zeitfenster-Helfer (L-05 Serienplaner, Szenario 2)
// ---------------------------------------------------------------------------

const ZEITFENSTER_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Validiert HH:MM und liefert den normalisierten Wert (oder null). */
function normalizeZeit(wert: unknown): string | null {
  if (typeof wert !== 'string') {
    return null;
  }
  const t = wert.trim();
  return ZEITFENSTER_PATTERN.test(t) ? t : null;
}

/** Slot-Code eines Zeitfensters: 'z_HHMM_HHMM' (z. B. 'z_0900_1100'). */
export function zeitfensterSlotCode(start: string, end: string): string {
  return `z_${start.replace(':', '')}_${end.replace(':', '')}`;
}

/**
 * Liefert bei ungültigen Zeitfenstern die Fehlermeldung, sonst null.
 * Prüft Format (HH:MM), end > start sowie Überschneidungsfreiheit der
 * gewünschten Zeitfenster untereinander.
 */
export function validiereZeitfenster(eintraege: ZeitfensterEintrag[]): string | null {
  const normalisiert: ZeitfensterEintrag[] = [];
  for (const e of eintraege) {
    const s = normalizeZeit(e.start_time);
    const et = normalizeZeit(e.end_time);
    if (!s || !et) {
      return 'start_time und end_time müssen als HH:MM übergeben werden.';
    }
    if (et <= s) {
      return 'end_time muss nach start_time liegen.';
    }
    normalisiert.push({ start_time: s, end_time: et });
  }

  // Überlappung innerhalb der gewünschten Liste vermeiden (rechts-/linksoffene
  // Intervalle: [start, ende)).
  const sortiert = [...normalisiert].sort((a, b) =>
    a.start_time.localeCompare(b.start_time)
  );
  for (let i = 1; i < sortiert.length; i++) {
    if (sortiert[i].start_time < sortiert[i - 1].end_time) {
      return 'Zeitfenster dürfen sich nicht überschneiden.';
    }
  }
  return null;
}

/**
 * Liest ein optionales Zeitfenster-Feld aus ({ start_time, end_time }-Objekte).
 * Unvollständige Einträge werden übersprungen; die inhaltliche Validierung
 * übernimmt validiereZeitfenster().
 */
export function parsenZeitfenster(wert: unknown): ZeitfensterEintrag[] {
  if (!Array.isArray(wert)) {
    return [];
  }
  const result: ZeitfensterEintrag[] = [];
  for (const z of wert) {
    const zf = (z ?? {}) as { start_time?: unknown; end_time?: unknown };
    if (zf.start_time == null || zf.end_time == null) {
      continue;
    }
    result.push({
      start_time: String(zf.start_time),
      end_time: String(zf.end_time),
    });
  }
  return result;
}

/**
 * Persistiert den gewünschten VM/NM-Zustand (und optional die Zeitfenster)
 * eines einzelnen Tages.
 * DELETE und INSERT laufen in einer gemeinsamen Transaktion, damit beim
 * Fehlschlagen des (Re-)INSERT keine bereits angelegte Freigabe verloren
 * geht und nie ein halb geschriebener Zustand bestehen bleibt (V-04/V-05).
 *
 * Zeitfenster-Slots (slot_code = 'z_...') werden als vollständige Menge
 * behandelt: Freie Slots des Tages werden entfernt und die gewünschte Liste
 * neu geschrieben. Gebuchte Slots (is_booked = true) bleiben unangetastet und
 * schützen sich gegenseitig per Überschneidungsprüfung.
 */
export async function persistiereTag(
  trainerId: number,
  datum: string,
  vm: boolean,
  nm: boolean,
  zeitfenster?: ZeitfensterEintrag[]
): Promise<void> {
  const codes: string[] = [];
  if (vm) {
    codes.push(...VM_SLOTS);
  }
  if (nm) {
    codes.push(...NM_SLOTS);
  }

  // Zeitfenster normalisieren; ungültige Werte werden verworfen, die
  // Validierung findet in der Route (validiereZeitfenster) statt.
  const zfEintraege: ZeitfensterEintrag[] = (zeitfenster ?? [])
    .map((zf) => ({
      start_time: normalizeZeit(zf.start_time) ?? '',
      end_time: normalizeZeit(zf.end_time) ?? '',
    }))
    .filter((zf) => zf.start_time !== '' && zf.end_time !== '');

  await transaction(async (client) => {
    // 1) VM/NM-Slots: Nur freie VM/NM-Slots entfernen. Bereits
    //    gebuchte/reservierte Slots (status <> 'frei') bleiben unangetastet.
    await client.query(
      `DELETE FROM public.trainer_verfuegbarkeit
       WHERE trainer_id = $1
         AND datum = $2::date
         AND status = $3
         AND slot_code = ANY($4::text[])`,
      [trainerId, datum, STATUS_FREI, TAG_SLOTS]
    );

    // 2) Freie Zeitfenster-Slots des Tages entfernen. Gebuchte Slots
    //    (is_booked = true) bleiben unangetastet.
    await client.query(
      `DELETE FROM public.trainer_verfuegbarkeit
       WHERE trainer_id = $1
         AND datum = $2::date
         AND status = $3
         AND slot_code LIKE 'z\\_%'
         AND (is_booked IS NOT TRUE OR is_booked IS NULL)`,
      [trainerId, datum, STATUS_FREI]
    );

    if (codes.length > 0) {
      // Ein einziger Multi-Row-INSERT hält die Anzahl der Rundläufe klein.
      // Platzhalter-Zuordnung:
      //   $1 = trainer_id, $2 = datum, $3 = status (konstant),
      //   $4..$N = slot_code (beginnt bei $4, daher 4 + index).
      const werte = codes
        .map((_, index) => `($1, $2::date, $${4 + index}, $3)`)
        .join(', ');
      await client.query(
        `INSERT INTO public.trainer_verfuegbarkeit (trainer_id, datum, slot_code, status)
         VALUES ${werte}
         ON CONFLICT (trainer_id, datum, slot_code) DO NOTHING`,
        [trainerId, datum, STATUS_FREI, ...codes]
      );
    }

    if (zfEintraege.length > 0) {
      // 3) Überschneidungsprüfung gegen verbleibende (gebuchte)
      //    Zeitfenster-Slots des Tages. Zwei Slots überlappen, wenn
      //    vorhanden_start < neues_ende UND vorhanden_ende > neues_start
      //    (rechts-/linksoffene Intervalle: [start, ende)).
      for (const zf of zfEintraege) {
        const overlap = await client.query(
          `SELECT id
           FROM public.trainer_verfuegbarkeit
           WHERE trainer_id = $1
             AND datum = $2::date
             AND slot_code LIKE 'z\\_%'
             AND start_time < $3::time
             AND end_time > $4::time
           LIMIT 1`,
          [trainerId, datum, zf.end_time, zf.start_time]
        );
        if (overlap.rows.length > 0) {
          throw new Error(
            'Das Zeitfenster überschneidet sich mit einem bestehenden Slot dieses Trainers.'
          );
        }
      }

      // 4) Multi-Row-INSERT der Zeitfenster-Slots mit IS NULL vermeidenden
      //    TIME-Casts. Platzhalter-Zuordnung:
      //      $1 = trainer_id, $2 = datum, $3 = status (konstant),
      //      $4 + i*3 = slot_code, $5 + i*3 = start_time, $6 + i*3 = end_time
      const werte = zfEintraege
        .map(
          (_, index) =>
            `($1, $2::date, $${4 + index * 3}, $3, $${5 + index * 3}::time, $${6 + index * 3}::time, false)`
        )
        .join(', ');
      const params: unknown[] = [trainerId, datum, STATUS_FREI];
      for (const zf of zfEintraege) {
        params.push(
          zeitfensterSlotCode(zf.start_time, zf.end_time),
          zf.start_time,
          zf.end_time
        );
      }
      await client.query(
        `INSERT INTO public.trainer_verfuegbarkeit
           (trainer_id, datum, slot_code, status, start_time, end_time, is_booked)
         VALUES ${werte}
         ON CONFLICT (trainer_id, datum, slot_code) DO NOTHING`,
        params
      );
    }
  });
}
