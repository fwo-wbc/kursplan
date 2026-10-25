-- ============================================================================
--  Kursplan  |  Migrationsdatei  |  Trainer-Reservierungen  |  Okt. 2026
-- ----------------------------------------------------------------------------
--  Zweck:
--    Ergänzt die beiden optionalen Stammfelder 'thema' (TEXT) und 'kd_nr'
--    (VARCHAR) an public.trainer_reservierung. Beide werden ausschließlich
--    lokal gepflegt (public) – edoobox ist und bleibt Single Source of Truth.
--
--    'thema'   – Thema der angefragten Firmenveranstaltung (freier Text)
--    'kd_nr'   – Kundennummer (z. B. 'KD-10482'), wie in der Dozenten-Planung
--
--  Ausführung:
--    Als Verwaltungskonto mit DDL-Rechten (z. B. kursplan_user) ausführen.
--    Die Datei ist idempotent und kann mehrfach ausgeführt werden.
-- ============================================================================

-- Spalte 'thema' (optional, freier Text) ergänzen, falls noch nicht vorhanden.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'trainer_reservierung'
          AND column_name = 'thema'
    ) THEN
        ALTER TABLE public.trainer_reservierung
            ADD COLUMN thema TEXT;
    END IF;
END
$$;

-- Spalte 'kd_nr' (optional, Kundennummer) ergänzen, falls noch nicht vorhanden.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'trainer_reservierung'
          AND column_name = 'kd_nr'
    ) THEN
        ALTER TABLE public.trainer_reservierung
            ADD COLUMN kd_nr VARCHAR(255);
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
--  Kontrolle: Spaltenübersicht nach der Migration
-- ----------------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'trainer_reservierung'
  AND column_name IN ('thema', 'kd_nr')
ORDER BY column_name;