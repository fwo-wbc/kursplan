-- ===========================================================================
-- kursthemen_migration.sql
-- Neue Tabelle public."Kursthemen" anlegen und mit eindeutigen, nicht-leeren
-- Kurstiteln aus edoobox_raw.offer befuellen.
--
-- Zweck:
--   Stammtabelle der Kursthemen (duplikatsfrei) als lokale App-Daten in
--   public. Quelle ist ausschliesslich lesend edoobox_raw.offer (Spalte `name`,
--   Textspalte, kein JSON/JSONB). edoobox_raw bleibt unveraenderter Spiegel.
--
-- Idempotent:
--   CREATE TABLE IF NOT EXISTS + ON CONFLICT (titel) DO NOTHING. Bei erneutem
--   Lauf werden keine Duplikate erzeugt und bestehende Zeilen bleiben erhalten.
--
-- Soft-Delete-Regel:
--   Es werden nur aktive Angebote beruecksichtigt (is_deleted IS NOT TRUE).
--   Es findet kein DELETE statt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabelle anlegen (falls nicht vorhanden)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."Kursthemen" (
    id         SERIAL PRIMARY KEY,
    titel      VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT kursthemen_titel_uq UNIQUE (titel)
);

COMMENT ON TABLE public."Kursthemen" IS
    'Duplikatsfreier Kursthemen-Stamm, abgeleitet aus edoobox_raw.offer.name (nur aktive Angebote).';
COMMENT ON COLUMN public."Kursthemen".titel IS
    'Eindeutiger Kurstitel (bereinigt um fuehrende/abschliessende Leerzeichen).';

-- ---------------------------------------------------------------------------
-- 2. Befuellung: alle eindeutigen, nicht-leeren Kurstitel.
--    TRIM (btrim) entfernt fuehrende/abschliessende Leerzeichen.
--    Titel laenger als 255 Zeichen werden verworfen (Passung zu VARCHAR(255)).
--    ON CONFLICT (titel) DO NOTHING => idempotent.
-- ---------------------------------------------------------------------------
INSERT INTO public."Kursthemen" (titel)
SELECT DISTINCT btrim(name)
FROM edoobox_raw.offer
WHERE name IS NOT NULL
  AND is_deleted IS NOT TRUE
  AND btrim(name) <> ''
  AND length(btrim(name)) <= 255
ON CONFLICT (titel) DO NOTHING;