-- ============================================================================
--  Kursplan  |  Migrationsdatei  |  Trainer-Honorar 90-Minuten-Satz  |  06.10.2026
-- ----------------------------------------------------------------------------
--  Zweck:
--    Erweitert die bestehende Tabelle public.trainer um einen weiteren, lokal
--    gepflegten Verguetungssatz:
--
--      * honorar_90min  Honorarsatz fuer Einzeltermine bis 90 Minuten in EUR
--
--  Fachlicher Kontext (Modell A):
--    Die Honorarberechnung nach Modell A benoetigt je Trainer zusaetzlich zum
--    Tages-, Halbtages-, Stunden- und reduzierten Satz einen eigenen Satz fuer
--    Einzeltermine mit einer Dauer von maximal 90 Minuten. Liegt dieser Satz
--    vor (honorar_90min > 0), greift er vorrangig gegenueber dem Stundensatz.
--
--  Ausfuehrung:
--    Als Verwaltungskonto mit DDL-Rechten (z. B. kursplan_user) ausfuehren.
--    Die Datei ist idempotent und kann mehrfach ausgefuehrt werden.
-- ============================================================================

ALTER TABLE public.trainer
    ADD COLUMN IF NOT EXISTS honorar_90min numeric(10,2) NOT NULL DEFAULT 0;

-- Keine negativen Saetze. Idempotent ueber eine DO-Anweisung, da
-- ADD CONSTRAINT kein IF NOT EXISTS kennt.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'trainer_honorar_90min_chk'
          AND conrelid = 'public.trainer'::regclass
    ) THEN
        ALTER TABLE public.trainer
            ADD CONSTRAINT trainer_honorar_90min_chk CHECK (honorar_90min >= 0);
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
  AND column_name IN ('tagessatz', 'halbtagessatz', 'stundensatz', 'reduzierter_satz', 'honorar_90min')
ORDER BY ordinal_position;