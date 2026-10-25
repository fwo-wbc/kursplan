import { NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db';
import { logEvent } from '@/lib/logger';
import {
  RESERVIERUNG_SELECT,
  isIsoDatum,
  logReservationEvent,
  mapReservierung,
  mapReservierungLog,
  normalizeString,
  toErrorObject,
  toErrorMessage,
} from '@/lib/reservations';

// ---------------------------------------------------------------------------
// GET /api/reservations/by-code/[code]
//   Liefert alle Reservierungstermine mit demselben reservation_code sowie
//   die zugehörigen Protokolleinträge aus reservation_logs (chronologisch).
// PUT /api/reservations/by-code/[code]
//   Aktualisiert übergreifende Felder (frist, optional thema/kunde) für ALLE
//   Datensätze mit diesem Code und protokolliert jede Änderung.
// DELETE /api/reservations/by-code/[code]
//   Löscht alle Termine mit diesem Code in einer Transaktion und schreibt
//   einen finalen Lösch-Log-Eintrag.
// ---------------------------------------------------------------------------

/** Liest und trimmt den Code aus dem URL-Pfad (params ist in Next.js 15+ ein Promise). */
async function codeAusParams(params: Promise<{ code: string }>): Promise<string> {
  const { code } = await params;
  return code.trim();
}

// ---------------------------------------------------------------------------
// GET: Termine + Logs eines Codes
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = await codeAusParams(params);
  if (!code) {
    return NextResponse.json(
      { error: 'code darf nicht leer sein.' },
      { status: 400 }
    );
  }

  try {
    const res = await query(
      `SELECT ${RESERVIERUNG_SELECT}
       FROM public.termin_reservierung r
       LEFT JOIN public.trainer t ON t.id = r.trainer_id
       WHERE r.reservation_code = $1
       ORDER BY r.datum ASC, r.slot_code ASC, r.id ASC`,
      [code]
    );

    const logsRes = await query(
      `SELECT
         id,
         reservation_code,
         reservation_id,
         action,
         changed_fields,
         details,
         to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
       FROM public.reservation_logs
       WHERE reservation_code = $1
       ORDER BY created_at ASC, id ASC`,
      [code]
    );

    const reservierungen = res.rows.map((row: Record<string, unknown>) =>
      mapReservierung(row)
    );
    const logs = logsRes.rows.map((row: Record<string, unknown>) =>
      mapReservierungLog(row)
    );

    // 404 nur, wenn weder Termine noch Logs existieren – nach einer
    // Sammel-Löschung bleiben die Audit-Logs abrufbar.
    if (reservierungen.length === 0 && logs.length === 0) {
      return NextResponse.json(
        { error: 'Keine Reservierungen mit diesem Code gefunden.' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { code, reservierungen, logs },
      { status: 200 }
    );
  } catch (err: unknown) {
    const msg = toErrorMessage(err);
    console.error('Fehler beim Laden der Sammel-Reservierung:', err);
    await logEvent('ERROR', 'API_RESERVATIONS', `Fehler beim Laden der Sammel-Reservierung: ${msg}`, {
      fehler: toErrorObject(err),
      endpoint: `GET /api/reservations/by-code/${code}`,
    });
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Sammel-Reservierung.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT: Gemeinsames Update übergreifender Felder für alle Datensätze des Codes
// ---------------------------------------------------------------------------

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = await codeAusParams(params);
  if (!code) {
    return NextResponse.json(
      { error: 'code darf nicht leer sein.' },
      { status: 400 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Ungültiger JSON-Body.' }, { status: 400 });
  }

  const frist = typeof body.frist === 'string' ? body.frist.trim() : '';
  const thema = normalizeString(body.thema);
  const kunde = normalizeString(body.kunde);

  if (!frist && thema === null && kunde === null) {
    return NextResponse.json(
      { error: 'Mindestens eines der Felder frist, thema oder kunde muss angegeben werden.' },
      { status: 400 }
    );
  }
  if (frist && !isIsoDatum(frist)) {
    return NextResponse.json(
      { error: 'frist muss als YYYY-MM-DD übergeben werden.' },
      { status: 400 }
    );
  }
  if (thema !== null && thema.length > 255) {
    return NextResponse.json(
      { error: 'thema darf höchstens 255 Zeichen lang sein.' },
      { status: 400 }
    );
  }
  if (kunde !== null && kunde.length > 50) {
    return NextResponse.json(
      { error: 'kunde darf höchstens 50 Zeichen lang sein.' },
      { status: 400 }
    );
  }

  try {
    const ergebnis = await transaction(async (client) => {
      const bestand = await client.query(
        `SELECT
           id,
           reservation_code,
           thema,
           kd_nr,
           to_char(frist_ende, 'YYYY-MM-DD') AS frist_ende
         FROM public.termin_reservierung
         WHERE reservation_code = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [code]
      );

      if (bestand.rowCount === 0) {
        return { status: 404, aktualisiert: [] };
      }

      const aktualisiert: unknown[] = [];
      for (const zeile of bestand.rows) {
        const changed: Record<string, unknown> = {};

        if (frist && String(zeile.frist_ende) !== frist) {
          changed.frist = {
            vorher: String(zeile.frist_ende),
            nachher: frist,
          };
        }
        if (thema !== null && String(zeile.thema ?? '') !== thema) {
          changed.thema = {
            vorher: zeile.thema == null ? null : String(zeile.thema),
            nachher: thema,
          };
        }
        if (kunde !== null && String(zeile.kd_nr) !== kunde) {
          changed.kunde = {
            vorher: String(zeile.kd_nr),
            nachher: kunde,
          };
        }

        if (Object.keys(changed).length === 0) {
          continue;
        }

        const sets: string[] = [];
        const p: unknown[] = [];
        if (changed.frist) {
          p.push(frist);
          sets.push(`frist_ende = $${p.length}::date`);
        }
        if (changed.thema) {
          p.push(thema);
          sets.push(`thema = $${p.length}`);
        }
        if (changed.kunde) {
          p.push(kunde);
          sets.push(`kd_nr = $${p.length}`);
        }
        p.push(zeile.id);
        sets.push('updated_at = NOW()');

        await client.query(
          `UPDATE public.termin_reservierung
           SET ${sets.join(', ')}
           WHERE id = $${p.length}`,
          p
        );

        await logReservationEvent(
          (sql, params) => client.query(sql, params),
          {
            reservation_code: code,
            reservation_id: Number(zeile.id),
            action: 'UPDATED',
            changed_fields: changed,
            details: 'Sammel-Update über reservation_code (frist/thema/kunde).',
          }
        );

        aktualisiert.push({ id: Number(zeile.id), geaendert: changed });
      }

      return { status: 200, aktualisiert };
    });

    if (ergebnis.status === 404) {
      return NextResponse.json(
        { error: 'Keine Reservierungen mit diesem Code gefunden.' },
        { status: 404 }
      );
    }

    // Frische Daten nach dem Update laden.
    const res = await query(
      `SELECT ${RESERVIERUNG_SELECT}
       FROM public.termin_reservierung r
       LEFT JOIN public.trainer t ON t.id = r.trainer_id
       WHERE r.reservation_code = $1
       ORDER BY r.datum ASC, r.slot_code ASC, r.id ASC`,
      [code]
    );

    return NextResponse.json(
      {
        ok: true,
        code,
        aktualisiert: ergebnis.aktualisiert,
        reservierungen: res.rows.map((row: Record<string, unknown>) =>
          mapReservierung(row)
        ),
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const msg = toErrorMessage(err);
    console.error('Fehler beim Sammel-Update der Reservierung:', err);
    await logEvent('ERROR', 'API_RESERVATIONS', `Fehler beim Sammel-Update der Reservierung: ${msg}`, {
      fehler: toErrorObject(err),
      endpoint: `PUT /api/reservations/by-code/${code}`,
    });
    return NextResponse.json(
      { error: 'Datenbankfehler beim Sammel-Update der Reservierung.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE: Alle Termine eines Codes löschen (Transaktion + finaler Log)
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = await codeAusParams(params);
  if (!code) {
    return NextResponse.json(
      { error: 'code darf nicht leer sein.' },
      { status: 400 }
    );
  }

  try {
    const ergebnis = await transaction(async (client) => {
      const bestand = await client.query(
        `SELECT id, datum, slot_code
         FROM public.termin_reservierung
         WHERE reservation_code = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [code]
      );

      if (bestand.rowCount === 0) {
        return { status: 404, geloescht: 0 };
      }

      const ids = bestand.rows.map((r: Record<string, unknown>) => Number(r.id));

      // Finaler Lösch-Log-Eintrag VOR dem physischen Löschen, damit der
      // Audit-Eintrag die betroffenen IDs dokumentiert.
      await logReservationEvent(
        (sql, params) => client.query(sql, params),
        {
          reservation_code: code,
          reservation_id: null,
          action: 'DELETED',
          changed_fields: { anzahl: ids.length, ids },
          details: `Sammel-Löschung: ${ids.length} Termine mit reservation_code ${code} entfernt.`,
        }
      );

      await client.query(
        `DELETE FROM public.termin_reservierung WHERE reservation_code = $1`,
        [code]
      );

      return { status: 200, geloescht: ids.length };
    });

    if (ergebnis.status === 404) {
      return NextResponse.json(
        { error: 'Keine Reservierungen mit diesem Code gefunden.' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { ok: true, code, geloescht: ergebnis.geloescht },
      { status: 200 }
    );
  } catch (err: unknown) {
    const msg = toErrorMessage(err);
    console.error('Fehler beim Sammel-Löschen der Reservierung:', err);
    await logEvent('ERROR', 'API_RESERVATIONS', `Fehler beim Sammel-Löschen der Reservierung: ${msg}`, {
      fehler: toErrorObject(err),
      endpoint: `DELETE /api/reservations/by-code/${code}`,
    });
    return NextResponse.json(
      { error: 'Datenbankfehler beim Sammel-Löschen der Reservierung.' },
      { status: 500 }
    );
  }
}