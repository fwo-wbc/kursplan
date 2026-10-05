import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { kuerzelAusAngebotsnummer } from '@/lib/umwandlung';

// ---------------------------------------------------------------------------
// GET /api/edoobox/vorlagen
// Liefert AUSSCHLIESSLICH die edoobox-Angebote, die der Kategorie
// "Vorlagen für Firmenkurse" zugeordnet sind. Diese Angebote sind die
// Master-Kurstemplates für die Umwandlung einer Terminreservierung in ein
// Firmenkurs-Angebot (P96).
//
// Erkennung (Datenmodell der Spiegelung):
//   * Jedes templatefähige Master-Offer hängt über offer.category_ref an der
//     Kategorie "Vorlagen für Firmenkurse".
//   * Es wird STRICHT auf diese Kategorie gefiltert; kein Fallback über
//     internal_code/offerdef_ref mehr, damit keine Fremd-Angebote (öffentliche
//     Kurse, normale Firmenkurs-Instanzen) hineingeraten.
// ---------------------------------------------------------------------------

/** Name der edoobox-Kategorie, in der die Master-Vorlagen liegen. */
const VORLAGEN_KATEGORIE_NAME = 'Vorlagen für Firmenkurse';

/** Ein Kurstemplate für das Umwandlungs-Dropdown. */
export interface Kurstemplate {
  template_id: string;
  name: string;
  kuerzel: string;
  kategorie: string | null;
}

export async function GET() {
  try {
    // 1) category_id(s) der Vorlagen-Kategorie ermitteln.
    //    Die Spiegelung führt mehrere edoobox-Mandanten in einer Tabelle,
    //    daher können mehrere Kategorien denselben Namen tragen.
    const kategorieResult = await query(
      `SELECT category_id
       FROM edoobox_raw.category
       WHERE name = $1::text
         AND is_deleted IS NOT TRUE`,
      [VORLAGEN_KATEGORIE_NAME]
    );

    const categoryIds = (
      kategorieResult.rows as Array<{ category_id: string }>
    ).map((row) => row.category_id);

    if (categoryIds.length === 0) {
      return NextResponse.json({ vorlagen: [] }, { status: 200 });
    }

    // 2) Strikte Selektion: ausschließlich Angebote, die einer der Vorlagen-
    //    Kategorien zugeordnet sind (kein Papierkorb/Archiv/keine Löschung).
    //    Absteigend nach Angebotsnummer sortiert, damit je Kürzel der neueste
    //    Stand zuerst kommt und deterministisch dedupliziert werden kann.
    const result = await query(
      `SELECT
         o.offer_id,
         o.name,
         o.offer_number AS angebotsnummer,
         c.name       AS kategorie
       FROM edoobox_raw.offer o
       INNER JOIN edoobox_raw.category c ON c.category_id = o.category_ref
       WHERE o.category_ref = ANY($1::text[])
         AND o.offer_type = 'offer'
         AND o.is_deleted IS NOT TRUE
         AND o.is_trash IS NOT TRUE
         AND o.is_archived IS NOT TRUE
       ORDER BY o.offer_number DESC`,
      [categoryIds]
    );

    const vorlagenMap = new Map<string, Kurstemplate>();

    for (const row of result.rows as Array<{
      offer_id: string;
      name: string | null;
      angebotsnummer: string | null;
      kategorie: string | null;
    }>) {
      const kuerzel = kuerzelAusAngebotsnummer(row.angebotsnummer);
      if (!kuerzel || !row.name || vorlagenMap.has(kuerzel)) continue;

      vorlagenMap.set(kuerzel, {
        template_id: row.offer_id,
        name: row.name,
        kuerzel,
        kategorie: row.kategorie,
      });
    }

    const vorlagen = Array.from(vorlagenMap.values()).sort((a, b) =>
      a.kuerzel.localeCompare(b.kuerzel, 'de')
    );

    return NextResponse.json({ vorlagen }, { status: 200 });
  } catch (err: unknown) {
    console.error('Fehler beim Laden der edoobox-Vorlagen:', err);
    return NextResponse.json(
      { error: 'Datenbankfehler beim Laden der Kurstemplates.' },
      { status: 500 }
    );
  }
}