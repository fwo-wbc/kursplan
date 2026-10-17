import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ---------------------------------------------------------------------------
// GET /api/edoobox/basis?category_id=…
// Liefert das zeitlich aktuellste Angebot einer edoobox-Kategorie als
// Klon-Basis ("basis") für den n8n-Duplicate-Call (P95/P96).
//
// Die Basis wird NICHT mehr als feste Vorlagen-ID (Spalte E der Excel) gesetzt,
// sondern IMMER dynamisch über die Kategorie ermittelt.
//
// Sortierung: date_start ist in edoobox_raw.offer als timestamptz hinterlegt
// (kein VARCHAR/Cast nötig). Da aber einzelne Angebote NULL in date_start haben
// (und DESC sonst NULLs zuerst sortieren würde), wird das neueste Angebot über
// den jüngsten Termin aus edoobox_raw.offer_date bestimmt und fällt bei fehlenden
// Terminen auf offer.date_start zurück:
//
//   SELECT o.offer_id, o.offer_number, o.name
//   FROM edoobox_raw.offer o
//   LEFT JOIN edoobox_raw.offer_date d
//          ON d.offer_id = o.offer_id
//         AND (d.is_deleted IS NOT TRUE)
//   WHERE o.category_ref = $1::text
//     AND (o.is_deleted IS NOT TRUE)
//   GROUP BY o.offer_id, o.offer_number, o.name
//   ORDER BY MAX(COALESCE(d.date_start, o.date_start)) DESC NULLS LAST,
//            o.offer_id DESC
//   LIMIT 1
//
// Fehlerfall: Existiert in der Kategorie kein aktives Angebot, wird der Aufruf
// mit HTTP 422 und der Meldung "Kein Basis-Angebot in Kategorie gefunden"
// abgebrochen. Der Kurs wird dann nicht an edoobox übertragen.
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categoryId = String(searchParams.get('category_id') || '').trim();

  if (!/^category_\w+$/.test(categoryId)) {
    return NextResponse.json(
      { error: 'category_id muss das Format category_… besitzen.' },
      { status: 400 }
    );
  }

  try {
    const result = await query(
      `SELECT o.offer_id, o.offer_number, o.name
       FROM edoobox_raw.offer o
       LEFT JOIN edoobox_raw.offer_date d
              ON d.offer_id = o.offer_id
             AND (d.is_deleted IS NOT TRUE)
       WHERE o.category_ref = $1::text
         AND (o.is_deleted IS NOT TRUE)
       GROUP BY o.offer_id, o.offer_number, o.name
       ORDER BY MAX(COALESCE(d.date_start, o.date_start)) DESC NULLS LAST,
                o.offer_id DESC
       LIMIT 1`,
      [categoryId]
    );

    const row = result.rows[0] as
      | { offer_id: string; offer_number: string | null; name: string | null }
      | undefined;

    if (!row) {
      return NextResponse.json(
        { error: 'Kein Basis-Angebot in Kategorie gefunden' },
        { status: 422 }
      );
    }

    return NextResponse.json(
      {
        offer_id: String(row.offer_id),
        offer_number: row.offer_number == null ? null : String(row.offer_number),
        name: row.name == null ? null : String(row.name),
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('Fehler bei der Basis-Ermittlung über Kategorie:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler bei der Ermittlung des Basis-Angebots.' },
      { status: 500 }
    );
  }
}
