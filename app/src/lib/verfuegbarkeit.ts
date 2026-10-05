// ---------------------------------------------------------------------------
// Gemeinsame Logik für die Verfügbarkeits-Routen.
//
// Die Oberfläche arbeitet mit den zwei Tagesabschnitten Vormittag (VM) und
// Nachmittag (NM). Ein „ganzer Tag" entspricht VM + NM (V-02). Die Angabe wird
// serverseitig in die betroffenen Einzelslots aufgelöst (V-03), damit die
// Ausbildung in der bestehenden Tabelle public.trainer_verfuegbarkeit
// granular bleibt. Der Abend (AB) bleibt in dieser Ansicht unangetastet.
// ---------------------------------------------------------------------------

import { transaction } from '@/lib/db';

export const VM_SLOTS = ['HT', 'K1', 'K2'];
export const NM_SLOTS = ['K3', 'K4'];
export const TAG_SLOTS = [...VM_SLOTS, ...NM_SLOTS];

/** Status einer freien Freigabe (konsistent zur bestehenden Route / V-09). */
export const STATUS_FREI = 'frei';

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
    // Nur freie VM/NM-Slots entfernen. Bereits gebuchte/reservierte Slots
    // (status <> 'frei') bleiben unangetastet (V-04/V-05).
    await client.query(
      `DELETE FROM public.trainer_verfuegbarkeit
       WHERE trainer_id = $1
         AND datum = $2::date
         AND status = $3
         AND slot_code = ANY($4::text[])`,
      [trainerId, datum, STATUS_FREI, TAG_SLOTS]
    );

    if (codes.length === 0) {
      return;
    }

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
  });
}