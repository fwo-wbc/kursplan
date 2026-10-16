-- ---------------------------------------------------------------------------
-- Migration: public.kurs_kategorie_mapping
-- ---------------------------------------------------------------------------
-- Zweck:
--   Einordnung eines edoobox-Kurses beim Kurstransfer: Beim Import hängt der
--   Kurstitel über edoobox_raw.offer.category_ref an einer edoobox-Kategorie.
--   Die Ermittlung der category_id erfolgt primär über den exakten
--   Kategorie-Namen (edoobox_raw.category.name). Weicht der Import-Titel jedoch
--   vom Kategorie-Namen ab (z. B. 'Word - Seriendruck' vs. 'Word - Seriendruck
--   (kompakt)'), greift diese Mapping-Tabelle: Sie übersetzt den Import-Titel
--   deterministisch in die zugehörige edoobox-category_id.
--
-- Schema-Trennung (App-Logik):
--   * unter public liegen ausschließlich lokale App-Daten/Referenztabellen
--     (kein Personenbezug in dieser Tabelle -> payload erlaubt).
--   * Der eigentliche Kurstransfer liest weiterhin aus edoobox_raw.category.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kurs_kategorie_mapping (
    id           serial      PRIMARY KEY,
    import_titel text        NOT NULL,
    category_id  text        NOT NULL,
    is_deleted   boolean     NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Ein Import-Titel darf nur auf GENAU EINE edoobox-Kategorie abgebildet werden
-- (deterministische Auflösung im Kurstransfer-Pfad).
CREATE UNIQUE INDEX IF NOT EXISTS kurs_kategorie_mapping_titel_uidx
    ON public.kurs_kategorie_mapping (import_titel)
    WHERE is_deleted IS NOT TRUE;

-- Für die Rückrichtung (Kategorie-ID -> Import-Titel) bei Verifikation.
CREATE INDEX IF NOT EXISTS kurs_kategorie_mapping_category_idx
    ON public.kurs_kategorie_mapping (category_id);

-- ---------------------------------------------------------------------------
-- Seed: Bekannte Abweichung zwischen Import-Titel und edoobox-Kategorie-Name.
--   'Word - Seriendruck'  ->  Kategorie 'Word - Seriendruck (kompakt)'
--                             (category_25ea33c5e986_4391280140).
-- ---------------------------------------------------------------------------
INSERT INTO public.kurs_kategorie_mapping (import_titel, category_id)
VALUES ('Word - Seriendruck', 'category_25ea33c5e986_4391280140')
ON CONFLICT (import_titel) WHERE is_deleted IS NOT TRUE DO NOTHING;
