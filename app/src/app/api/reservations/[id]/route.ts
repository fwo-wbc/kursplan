import { NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db';
import { logEvent } from '@/lib/logger';
import { triggerChangeEvent } from '@/lib/notifications';
import {
  RESERVIERUNG_SELECT,
  STATUS_WERTE,
  ReservierungStatus,
  isIsoDatum,
  logReservationEvent,
  mapReservierung,
  normalizeString,
  parsePositiveInt,
  toErrorObject,
  toErrorMessage,
  validiereTerminFelder,
} from '@/lib/reservations';

// ---------------------------------------------------------------------------
// PUT /api/reservations/[id]
//   Aktualisiert die termin-bezogenen Felder eines einzelnen Termins
//   (datum, slot_code, status, notiz). Übergreifende Stammfelder (thema,
//   kunde, frist) DÜRFEN hier nicht geändert werden – sie werden synchron
//   für alle Termine eines Codes über PUT /api/reservations/by-code/[code]
//   aktualisiert. Jede Änderung wird in public.reservation_logs protokolliert
//   (action 'UPDATED').
// ---------------------------------------------------------------------------

/** Liest und trimmt die id aus dem URL-Pfad (params ist in Next.js 15+ ein Promise). */
async function idAusParams(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  return id.trim();
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const idRaw = await idAusParams(params);
  const id = parsePositiveInt(idRaw);
  if (!id) {
    return NextResponse.json(
      { error: 'id muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Ungültiger JSON-Body.' }, { status: 400 });
  }

  let termin;
  try {
    termin = validiereTerminFelder(body.datum, body.slot_code);
  } catch (err: unknown) {
    return NextResponse.json({ error: toErrorMessage(err) }, { status: 400 });
  }

  const rohStatus = typeof body.status === 'string' ? body.status.trim() : '';
  const nichtVerfuegbarStatus = !rohStatus;
  const notiz = body.notiz === undefined ? null : normalizeString(body.notiz);
  const nichtVerfuegbarNotiz = body.notiz === undefined;

  try {
    const ergebnis = await transaction(async (client) => {
      const bestand = await client.query(
        `SELECT
           id,
           reservation_code,
           to_char(datum, 'YYYY-MM-DD') AS datum,
           slot_code,
           status,
           notiz
         FROM public.termin_reservierung
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );

      if (bestand.rowCount === 0) {
        return { status: 404, changed: {}, zeile: {}, effektiverStatus: '' };
      }

      const zeile = bestand.rows[0];
      const changed: Record<string, unknown> = {};

      if (String(zeile.datum) !== termin.datum) {
        changed.datum = {
          vorher: String(zeile.datum),
          nachher: termin.datum,
        };
      }
      if (String(zeile.slot_code) !== termin.slot_code) {
        changed.slot_code = {
          vorher: String(zeile.slot_code),
          nachher: termin.slot_code,
        };
      }

      const effektiverStatus = STATUS_WERTE.includes(
        rohStatus as ReservierungStatus
      )
        ? rohStatus
        : String(zeile.status);
      if (String(zeile.status) !== effektiverStatus) {
        changed.status = {
          vorher: String(zeile.status),
          nachher: effektiverStatus,
        };
      }

      // notiz nur ändern, wenn sie mitgeschickt wurde (undefined = unverändert).
      const zeileNotiz = zeile.notiz == null ? null : String(zeile.notiz);
      if (!nichtVerfuegbarNotiz && zeileNotiz !== notiz) {
        changed.notiz = { vorher: zeileNotiz, nachher: notiz };
      }

      const sets: string[] = [`datum = $1::date`, `slot_code = $2`];
      const p: unknown[] = [termin.datum, termin.slot_code];

      if (!nichtVerfuegbarStatus) {
        p.push(effektiverStatus);
        sets.push(`status = $${p.length}`);
      }
      if (!nichtVerfuegbarNotiz) {
        p.push(notiz);
        sets.push(`notiz = $${p.length}`);
      }
      p.push(id);
      sets.push(`updated_at = NOW()`);

      await client.query(
        `UPDATE public.termin_reservierung
         SET ${sets.join(', ')}
         WHERE id = $${p.length}`,
        p
      );

      if (Object.keys(changed).length > 0) {
        await logReservationEvent(
          (sql, params) => client.query(sql, params),
          {
            reservation_code:
              zeile.reservation_code == null
                ? null
                : String(zeile.reservation_code),
            reservation_id: id,
            action: 'UPDATED',
            changed_fields: changed,
            details: `Einzeltermin ${String(zeile.datum)} (${
              String(zeile.slot_code)
            }) aktualisiert.`,
          }
        );
      }

      return { status: 200, changed, zeile, effektiverStatus };
    });

    if (ergebnis.status === 404) {
      return NextResponse.json(
        { error: 'Reservierung nicht gefunden.' },
        { status: 404 }
      );
    }

    // NACH dem Update: Termin erneut laden, damit auch der frisch geänderte
    // Trainer/Kurs-Titel für die Benachrichtigung zur Verfügung steht.
    const res = await query(
      `SELECT ${RESERVIERUNG_SELECT}
       FROM public.termin_reservierung r
       LEFT JOIN public.trainer t ON t.id = r.trainer_id
       WHERE r.id = $1`,
      [id]
    );

    const reservierung = mapReservierung(res.rows[0]);
    const changed: Record<string, unknown> = ergebnis.changed ?? {};
    const zeile: Record<string, unknown> = ergebnis.zeile ?? {};
    const effektiverStatus = String(ergebnis.effektiverStatus ?? zeile.status ?? '');

    // Event-Notifications an n8n (non-blocking): Für jeden geänderten Aspekt
    // des Termins wird gemäß dem einheitlichen Payload-Format ein Event mit
    // vorher/nachher gesendet. termin_id ist die Reservierungs-ID.
    const kursTitel = reservierung.thema ?? 'Reservierung';
    const zeitaenderung = changed.datum ?? changed.slot_code;
    const statusAenderung = changed.status;
    const trainerAenderung =
      typeof zeile.trainer_id === 'number' &&
      reservierung.trainer_id !== Number(zeile.trainer_id);

    if (zeitaenderung) {
      triggerChangeEvent('TERMIN_ZEIT_GEAENDERT', {
        termin_id: id,
        kurs_titel: kursTitel,
        vorher: {
          datum: String(zeile.datum),
          slot_code: String(zeile.slot_code),
        },
        nachher: {
          datum: termin.datum,
          slot_code: termin.slot_code,
        },
      });
    }
    if (statusAenderung) {
      triggerChangeEvent('TERMIN_STATUS_GEAENDERT', {
        termin_id: id,
        kurs_titel: kursTitel,
        vorher: { status: String(zeile.status) },
        nachher: { status: effektiverStatus },
      });
    }
    if (trainerAenderung) {
      triggerChangeEvent('TRAINER_ZUGEWIESEN', {
        termin_id: id,
        kurs_titel: kursTitel,
        vorher: { trainer_id: zeile.trainer_id ?? null },
        nachher: { trainer_id: reservierung.trainer_id },
      });
    }

    return NextResponse.json(
      { reservierung: mapReservierung(res.rows[0]) },
      { status: 200 }
    );
  } catch (err: unknown) {
    const msg = toErrorMessage(err);
    console.error('Fehler beim Aktualisieren der Reservierung:', err);
    await logEvent('ERROR', 'API_RESERVATIONS', `Fehler beim Aktualisieren der Reservierung: ${msg}`, {
      fehler: toErrorObject(err),
      endpoint: `PUT /api/reservations/${id}`,
    });
    return NextResponse.json(
      { error: 'Datenbankfehler beim Aktualisieren der Reservierung.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/reservations/[id]
//   Löscht einen einzelnen Termin und hinterlässt einen Protokolleintrag
//   (action 'DELETED') in public.reservation_logs. Der Log-Eintrag wird
//   VOR dem physischen Löschen in derselben Transaktion geschrieben, damit
//   die alten Werte dokumentiert sind.
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idRaw } = await params;
  const id = parsePositiveInt(idRaw);
  if (!id) {
    return NextResponse.json(
      { error: 'id muss eine positive Ganzzahl sein.' },
      { status: 400 }
    );
  }

  try {
    const ergebnis = await transaction(async (client) => {
      const bestand = await client.query(
        `SELECT
           id,
           reservation_code,
           to_char(datum, 'YYYY-MM-DD') AS datum,
           slot_code,
           kd_nr,
           thema,
           to_char(frist_ende, 'YYYY-MM-DD') AS frist_ende,
           status,
           notiz
         FROM public.termin_reservierung
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );

      if (bestand.rowCount === 0) {
        return { status: 404 };
      }

      const zeile = bestand.rows[0];

      await logReservationEvent(
        (sql, params) => client.query(sql, params),
        {
          reservation_code:
            zeile.reservation_code == null
              ? null
              : String(zeile.reservation_code),
          reservation_id: id,
          action: 'DELETED',
          changed_fields: {
            datum: String(zeile.datum),
            slot_code: String(zeile.slot_code),
            kd_nr: String(zeile.kd_nr),
            thema: zeile.thema == null ? null : String(zeile.thema),
            frist_ende: String(zeile.frist_ende),
            status: String(zeile.status),
            notiz: zeile.notiz == null ? null : String(zeile.notiz),
          },
          details: `Einzeltermin ${String(zeile.datum)} (${String(zeile.slot_code)}) gelöscht.`,
        }
      );

      await client.query(
        `DELETE FROM public.termin_reservierung WHERE id = $1`,
        [id]
      );

      return { status: 200 };
    });

    if (ergebnis.status === 404) {
      return NextResponse.json(
        { error: 'Reservierung nicht gefunden.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    const msg = toErrorMessage(err);
    console.error('Fehler beim Löschen der Reservierung:', err);
    await logEvent('ERROR', 'API_RESERVATIONS', `Fehler beim Löschen der Reservierung: ${msg}`, {
      fehler: toErrorObject(err),
      endpoint: `DELETE /api/reservations/${id}`,
    });
    return NextResponse.json(
      { error: 'Datenbankfehler beim Löschen der Reservierung.' },
      { status: 500 }
    );
  }
}