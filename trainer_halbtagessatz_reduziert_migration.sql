-- ============================================================================
--  Kursplan  |  Migrationsdatei  |  Trainer-Halbtages- und reduzierter Satz  |  26.09.2026
-- ----------------------------------------------------------------------------
--  Zweck:
--    Erweitert die bestehende Tabelle public.trainer um zwei weitere, lokal
--    gepflegte Verguetungssaetze:
--
--      * halbtagessatz      numerischer Halbtageshonorarsatz in EUR (netto)
--      * reduzierter_satz   reduzierter Honorarsatz (Sonderfall 1 TN) in EUR
--
--  Fachlicher Kontext (Lastenheft Kursplan v1.6, Modell A):
--    Die Honorarberechnung nach Modell A benoetigt je Trainer vier Saetze:
--      1. tagessatz
--      2. halbtagessatz
--      3. stundensatz
--      4. reduzierter_satz
--    tagessatz und stundensatz wurden bereits ueber trainer_saetze_migration.sql
--    ergaenzt. Diese Datei liefert die beiden verbleibenden Saetze nach.
--
--  Ausfuehrung:
--    Als Verwaltungskonto mit DDL-Rechten (z. B. kursplan_user) ausfuehren.
--    Die Datei ist idempotent und kann mehrfach ausgefuehrt werden.
-- ============================================================================

ALTER TABLE public.trainer
    ADD COLUMN IF NOT EXISTS halbtagessatz     numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS reduzierter_satz numeric(10,2) NOT NULL DEFAULT 0;

-- Nichts negative Saetze. Idempotent ueber eine DO-Anweisung, da
-- ADD CONSTRAINT kein IF NOT EXISTS kennt.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'trainer_halbtagessatz_chk'
          AND conrelid = 'public.trainer'::regclass
    ) THEN
        ALTER TABLE public.trainer
            ADD CONSTRAINT trainer_halbtagessatz_chk CHECK (halbtagessatz >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'trainer_reduzierter_satz_chk'
          AND conrelid = 'public.trainer'::regclass
    ) THEN
        ALTER TABLE public.trainer
            ADD CONSTRAINT trainer_reduzierter_satz_chk CHECK (reduzierter_satz >= 0);
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
--  Kontrolle
-- ----------------------------------------------------------------------------
SELECT column_name, data_type, numeric_precision, numeric_scale, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'trainer'
  AND column_name IN ('tagessatz', 'halbtagessatz', 'stundensatz', 'reduzierter_satz')
ORDER BY ordinal_position;