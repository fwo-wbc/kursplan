// ---------------------------------------------------------------------------
// Gemeinsame Logik für die Verfügbarkeits-Routen.
//
// Die Oberfläche arbeitet mit den zwei Tagesabschnitten Vormittag (VM) und
// Nachmittag (NM). Ein „ganzer Tag" entspricht VM + NM (V-02). Die Angabe wird
// serverseitig in die betroffenen Einzelslots aufgelöst (V-03), damit die
// Ausbildung in der bestehenden Tabelle public.trainer_verfuegbarkeit
// granular bleibt. Der Abend (AB) bleibt in dieser Ansicht unangetastet.
//
// ---------------------------------------------------------------------------

import { transaction } from '@/lib/db';
import type { PoolClient } from 'pg';

export const VM_SLOTS = ['HT', 'K1', 'K2'];
export const NM_SLOTS = ['K3', 'K4'];
export const TAG_SLOTS = [...VM_SLOTS, ...NM_SLOTS];

/** Status einer freien Freigabe (konsistent zur bestehenden Route / V-09). */
export const STATUS_FREI = 'frei';

/** Fehlerklasse: Die Rücknahme einer Verfügbarkeit ist durch eine Reservierung
 *  (Firmenanfrage) gesperrt. Wird von den Routen als HTTP 409 ausgeliefert,
 *  damit der Client die Sperre gezielt darstellen kann. */
export class VerfuegbarkeitSperreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerfuegbarkeitSperreError';
  }
}

/** VM-Zeitfenster für die Reservierungs-Prüfung (konsistent zur UI: 09:00–13:00). */
const VM_FENSTER = { start: '09:00', ende: '13:00' };

/** NM-Zeitfenster für die Reservierungs-Prüfung (konsistent zur UI: 13:00–17:00). */
const NM_FENSTER = { start: '13:00', ende: '17:00' };

export interface TageEintrag {
  datum: string;
  vm: boolean;
  nm: boolean;
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

/** Liefert die aktuell freien VM/NM-Slot-Codes des Tages als Set. */
async function freieSlotsDesTages(
  client: PoolClient,
  trainerId: number,
  datum: string
): Promise<Set<string>> {
  const result = await client.query(
    `SELECT slot_code
     FROM public.trainer_verfuegbarkeit
     WHERE trainer_id = $1
       AND datum = $2::date
       AND status = $3
       AND slot_code = ANY($4::text[])`,
    [trainerId, datum, STATUS_FREI, TAG_SLOTS]
  );
  return new Set(result.rows.map((r) => String(r.slot_code)));
}

/** Prüft, ob am Tag für den Trainer eine Reservierung das Zeitfenster belegt. */
async function reservierungBelegtFenster(
  client: PoolClient,
  trainerId: number,
  datum: string,
  start: string,
  ende: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
     FROM public.trainer_reservierung
     WHERE trainer_id = $1
       AND datum = $2::date
       AND start_time < $4::time
       AND end_time > $3::time
     LIMIT 1`,
    [trainerId, datum, start, ende]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Erzwingt die Rücknahme-Sperre serverseitig (Defense in Depth zur UI-Sperre):
 *  Wird eine aktuell freie VM-/NM-Freigabe entfernt und existiert im jeweiligen
 *  Tagesabschnitt eine Reservierung (Firmenanfrage), ist die Aufhebung nicht
 *  erlaubt. Das Setzen von Freigaben (vm/nm = true) bleibt immer möglich. */
async function pruefeRuecknahmeSperre(
  client: PoolClient,
  trainerId: number,
  datum: string,
  vm: boolean,
  nm: boolean
): Promise<void> {
  // Nur tatsächliche Entfernungen prüfen – reine Freigaben sind nie gesperrt.
  if (vm && nm) return;

  const freie = await freieSlotsDesTages(client, trainerId, datum);

  if (!vm && VM_SLOTS.some((s) => freie.has(s))) {
    const belegt = await reservierungBelegtFenster(
      client,
      trainerId,
      datum,
      VM_FENSTER.start,
      VM_FENSTER.ende
    );
    if (belegt) {
      throw new VerfuegbarkeitSperreError(
        'Vormittag ist durch eine Reservierung belegt – die Aufhebung ist nicht möglich.'
      );
    }
  }

  if (!nm && NM_SLOTS.some((s) => freie.has(s))) {
    const belegt = await reservierungBelegtFenster(
      client,
      trainerId,
      datum,
      NM_FENSTER.start,
      NM_FENSTER.ende
    );
    if (belegt) {
      throw new VerfuegbarkeitSperreError(
        'Nachmittag ist durch eine Reservierung belegt – die Aufhebung ist nicht möglich.'
      );
    }
  }
}

/**
 * Validiert eine ganze Liste von Tageseinträgen gegen die Rücknahme-Sperre,
 * OHNE etwas zu persistieren. Wird vom Batch-Endpunkt vor der Persistenz
 * aufgerufen, damit eine gesperrte Aufhebung keine Teil-Schreibvorgänge
 * hinterlässt (alle Einträge werden gemeinsam angenommen oder abgelehnt).
 */
export async function pruefeRuecknahmeSperren(
  trainerId: number,
  eintraege: TageEintrag[]
): Promise<void> {
  await transaction(async (client) => {
    for (const eintrag of eintraege) {
      await pruefeRuecknahmeSperre(
        client,
        trainerId,
        eintrag.datum,
        eintrag.vm,
        eintrag.nm
      );
    }
  });
}

/**
 * Persistiert den gewünschten VM/NM-Zustand eines einzelnen Tages.
 * DELETE und INSERT laufen in einer gemeinsamen Transaktion, damit beim
 * Fehlschlagen des (Re-)INSERT keine bereits angelegte Freigabe verloren
 * geht und nie ein halb geschriebener Zustand bestehen bleibt (V-04/V-05).
 */
export async function persistiereTag(
  trainerId: number,
  datum: string,
  vm: boolean,
  nm: boolean
): Promise<void> {
  const codes: string[] = [];
  if (vm) {
    codes.push(...VM_SLOTS);
  }
  if (nm) {
    codes.push(...NM_SLOTS);
  }

  await transaction(async (client) => {
    // Rücknahme-Sperre serverseitig erzwingen (Defense in Depth): Eine Freigabe
    // darf nicht entfernt werden, solange eine Reservierung (Firmenanfrage) den
    // betroffenen VM-/NM-Zeitabschnitt belegt. Die UI sperrt dieselben Fälle;
    // diese Prüfung schützt auch direkte API-Aufrufe (z. B. Batch-Endpunkt).
    await pruefeRuecknahmeSperre(client, trainerId, datum, vm, nm);

    // VM/NM-Slots: Nur freie VM/NM-Slots entfernen. Bereits
    // gebuchte/reservierte Slots (status <> 'frei') bleiben unangetastet.
    await client.query(
      `DELETE FROM public.trainer_verfuegbarkeit
       WHERE trainer_id = $1
         AND datum = $2::date
         AND status = $3
         AND slot_code = ANY($4::text[])`,
      [trainerId, datum, STATUS_FREI, TAG_SLOTS]
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
  });
}
