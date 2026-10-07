-- ============================================================================
--  Kursplan  |  Migrationsdatei  |  Trainer-Reservierungen: Gruppencode + Frist
-- ----------------------------------------------------------------------------
--  Zweck:
--    Erweitert public.trainer_reservierung um zwei optionale Spalten:
--      * gruppe_code  TEXT NULL  – eindeutiger, kompakter Reservierungs-
--                                  Gruppencode (z. B. "RES-7K2PQ"). Beim
--                                  Duplizieren bleibt der Code identisch,
--                                  damit zusammengehörige Termine als
--                                  Reservierungsgruppe erkennbar/filterbar sind.
--      * frist_ende   DATE NULL  – Reservierungsfrist (Ablaufdatum), analog
--                                  zur Dozenten-Planung (public.termin_reservierung).
--
--  Ausführung:
--    Als Verwaltungskonto mit DDL-Rechten (z. B. kursplan_user) ausführen.
--    Die Datei ist idempotent und kann mehrfach ausgeführt werden.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Spalte gruppe_code (TEXT, NULL) – idempotent
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'trainer_reservierung'
          AND column_name  = 'gruppe_code'
    ) THEN
        ALTER TABLE public.trainer_reservierung
            ADD COLUMN gruppe_code TEXT;
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. Spalte frist_ende (DATE, NULL) – idempotent
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'trainer_reservierung'
          AND column_name  = 'frist_ende'
    ) THEN
        ALTER TABLE public.trainer_reservierung
            ADD COLUMN frist_ende DATE;
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 3. Index auf gruppe_code für die Gruppen-Filterung
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_trainer_reservierung_gruppe_code
    ON public.trainer_reservierung (gruppe_code);

-- ----------------------------------------------------------------------------
--  Kontrolle
-- ----------------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'trainer_reservierung'
  AND column_name IN ('gruppe_code', 'frist_ende')
ORDER BY column_name;