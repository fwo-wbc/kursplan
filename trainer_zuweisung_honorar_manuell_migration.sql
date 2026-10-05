-- ============================================================================
--  Kursplan  |  Migrationsdatei  |  Manuelles Dozentenhonorar je Zuweisung  |  26.09.2026
-- ----------------------------------------------------------------------------
--  Zweck:
--    Erweitert die bestehende Tabelle public.trainer_zuweisung um ein manuell
--    überschreibbares Honorar je Kursangebot/Zuweisung:
--
--      * honorar_manuell  numeric(10,2) NULL, CHECK (honorar_manuell >= 0)
--
--    NULL bedeutet: kein manueller Wert, das automatisch nach Modell A
--    (app/src/lib/honorar.ts) berechnete Honorar gilt. Ein gesetzter Wert
--    übersteuert den automatischen Vorschlag.
--
--  Ausfuehrung:
--    Als Verwaltungskonto mit DDL-Rechten (kursplan_user) ausfuehren.
--    Die Datei ist idempotent und kann mehrfach ausgefuehrt werden.
-- ============================================================================

ALTER TABLE public.trainer_zuweisung
    ADD COLUMN IF NOT EXISTS honorar_manuell numeric(10,2) NULL;

-- Keine negativen manuellen Betraege. Idempotent ueber eine DO-Anweisung,
-- da ADD CONSTRAINT kein IF NOT EXISTS kennt.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'trainer_zuweisung_honorar_manuell_chk'
          AND conrelid = 'public.trainer_zuweisung'::regclass
    ) THEN
        ALTER TABLE public.trainer_zuweisung
            ADD CONSTRAINT trainer_zuweisung_honorar_manuell_chk
            CHECK (honorar_manuell >= 0);
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
--  Kontrolle
-- ----------------------------------------------------------------------------
SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'trainer_zuweisung'
  AND column_name = 'honorar_manuell'
ORDER BY ordinal_position;