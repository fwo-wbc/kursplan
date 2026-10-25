// ---------------------------------------------------------------------------
// Gemeinsame Helfer für die /api/reservations-Routen
// (Sammel-Reservierungen mit reservation_code + Audit-Log reservation_logs)
// ---------------------------------------------------------------------------

/** Zulässige Slot-Codes der Planungsansicht. */
export type SlotCode = 'KT1' | 'KT2' | 'KT3' | 'ganztags';

export const SLOT_CODES: SlotCode[] = ['KT1', 'KT2', 'KT3', 'ganztags'];

/** Zulässige Reservierungs-Status (schlank: angeboten oder bestaetigt). */
export type ReservierungStatus = 'angeboten' | 'bestaetigt';

export const STATUS_WERTE: ReservierungStatus[] = ['angeboten', 'bestaetigt'];

/**
 * Fallback-Code für Protokolleinträge von Einzelterminen ohne reservation_code.
 * reservation_logs.reservation_code ist NOT NULL; Einzeltermine ohne
 * Sammel-Code werden unter diesem Platzhalter auditiert.
 */
export const OHNE_CODE = 'OHNE-CODE';

/** Reservierungs-Datensatz in der API-Antwort. */
export interface Reservierung {
  id: number;
  reservation_code: string | null;
  thema: string | null;
  /** Kundenbezug: Kundennummer (kd_nr), da kein Klartext-Kundenname existiert. */
  kunde: string;
  /** Reservierungsfrist (frist_ende) als YYYY-MM-DD. */
  frist: string;
  /** Trainer-Name (Vorname Nachname) oder null. */
  trainer: string | null;
  trainer_id: number;
  datum: string;
  slot_code: string;
  status: string;
  notiz: string | null;
  created_at: string;
  updated_at: string;
}

/** Protokolleintrag aus public.reservation_logs. */
export interface ReservierungLog {
  id: number;
  reservation_code: string;
  reservation_id: number | null;
  action: string;
  changed_fields: unknown;
  details: string | null;
  created_at: string;
}

/** Ein einzelner buchbarer Termin innerhalb einer Sammel-Reservierung. */
export interface TerminEintrag {
  datum: string;
  slot_code: SlotCode;
}

/**
 * Ausführungs-Schnittstelle für query (außerhalb) bzw. client.query
 * (innerhalb einer Transaktion). Beide liefern rows + rowCount.
 */
export interface DbExec {
  (sql: string, params?: unknown[]): Promise<{
    rows: Record<string, unknown>[];
    rowCount: number | null;
  }>;
}

/**
 * SQL-Fragment für die Reservierungs-Spalten inkl. Trainer-Name.
 * Wird in allen /api/reservations-Routen verwendet (r = termin_reservierung,
 * t = trainer).
 */
export const RESERVIERUNG_SELECT = `
  r.id,
  r.reservation_code,
  r.thema,
  r.kd_nr                                        AS kunde,
  to_char(r.frist_ende, 'YYYY-MM-DD')            AS frist,
  nullif(trim(coalesce(t.vorname, '') || ' ' || coalesce(t.nachname, '')), '') AS trainer,
  r.trainer_id,
  to_char(r.datum, 'YYYY-MM-DD')                 AS datum,
  r.slot_code,
  r.status,
  r.notiz,
  to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  to_char(r.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
`;

/** Wandelt einen unbekannten DB-Fehler in eine lesbare Meldung um. */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Wandelt einen unbekannten Fehler in ein JSONB-taugliches Objekt um. */
export function toErrorObject(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
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

/** Parst eine positive Ganzzahl; liefert null bei ungültigen Eingaben. */
export function parsePositiveInt(value: unknown): number | null {
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

/** Trimmt einen String; liefert null bei fehlendem oder leerem Wert. */
export function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Validiert datum + slot_code eines Termins. */
export function validiereTerminFelder(
  datum: unknown,
  slot_code: unknown
): TerminEintrag {
  if (!isIsoDatum(datum)) {
    throw new Error('datum muss als YYYY-MM-DD übergeben werden.');
  }
  if (
    typeof slot_code !== 'string' ||
    !SLOT_CODES.includes(slot_code as SlotCode)
  ) {
    throw new Error("slot_code muss 'KT1', 'KT2', 'KT3' oder 'ganztags' sein.");
  }
  return { datum: datum as string, slot_code: slot_code as SlotCode };
}

/** Wandelt eine DB-Zeile in ein Reservierungsobjekt um. */
export function mapReservierung(row: Record<string, unknown>): Reservierung {
  return {
    id: Number(row.id),
    reservation_code:
      row.reservation_code == null ? null : String(row.reservation_code),
    thema: row.thema == null ? null : String(row.thema),
    kunde: String(row.kunde),
    frist: String(row.frist),
    trainer: row.trainer == null ? null : String(row.trainer),
    trainer_id: Number(row.trainer_id),
    datum: String(row.datum),
    slot_code: String(row.slot_code),
    status: String(row.status),
    notiz: row.notiz == null ? null : String(row.notiz),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/** Wandelt eine DB-Zeile in ein Protokollobjekt um. */
export function mapReservierungLog(row: Record<string, unknown>): ReservierungLog {
  return {
    id: Number(row.id),
    reservation_code: String(row.reservation_code),
    reservation_id: row.reservation_id == null ? null : Number(row.reservation_id),
    action: String(row.action),
    changed_fields: row.changed_fields,
    details: row.details == null ? null : String(row.details),
    created_at: String(row.created_at),
  };
}

/**
 * Schreibt einen Eintrag in public.reservation_logs.
 *
 * @param exec query (außerhalb) oder client.query (innerhalb einer Transaktion)
 * @param eintrag Log-Daten; changed_fields wird als JSONB gespeichert.
 */
export async function logReservationEvent(
  exec: DbExec,
  eintrag: {
    reservation_code: string | null;
    reservation_id?: number | null;
    action: string;
    changed_fields?: unknown;
    details?: string | null;
  }
): Promise<void> {
  const code = eintrag.reservation_code ?? OHNE_CODE;
  const changedJson =
    eintrag.changed_fields == null
      ? null
      : JSON.stringify(eintrag.changed_fields);
  await exec(
    `INSERT INTO public.reservation_logs
       (reservation_code, reservation_id, action, changed_fields, details)
     VALUES
       ($1, $2, $3, $4::jsonb, $5)`,
    [
      code,
      eintrag.reservation_id ?? null,
      eintrag.action,
      changedJson,
      eintrag.details ?? null,
    ]
  );
}