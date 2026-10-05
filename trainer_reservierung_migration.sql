-- ============================================================================
--  Kursplan  |  Migrationsdatei  |  Trainer-Reservierungen  |  Okt. 2026
-- ----------------------------------------------------------------------------
--  Zweck:
--    Unverbindliche Reservierungen für Trainer bei Firmenanfragen, bevor ein
--    Kurs in edoobox angelegt wird (P90/P96 werden NICHT automatisiert).
--
--    Fachliche Regel (Validierung in der API):
--      Eine Reservierung ist erlaubt, wenn der Slot frei ist oder ein Kurs im
--      Status 'ausgeschrieben', 'unter Vorbehalt' oder 'abgesagt' vorliegt.
--      Ist ein Kurs jedoch 'bestätigt', ist eine Reservierung für denselben
--      Zeitraum strikt gesperrt (HTTP 409).
--
--  Ausführung:
--    Als Verwaltungskonto mit DDL-Rechten (z. B. kursplan_user) ausführen.
--    Die Datei ist idempotent und kann mehrfach ausgeführt werden.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabelle public.trainer_reservierung
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trainer_reservierung (
    id          SERIAL PRIMARY KEY,
    trainer_id  INTEGER NOT NULL REFERENCES public.trainer (id) ON DELETE CASCADE,
    datum       DATE NOT NULL,
    start_time  TIME WITHOUT TIME ZONE NOT NULL,
    end_time    TIME WITHOUT TIME ZONE NOT NULL,
    kunde       VARCHAR(255) NOT NULL,
    bemerkung   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Zeitraum-Plausibilität: start_time muss vor end_time liegen.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'trainer_reservierung_zeitraum_chk'
          AND conrelid = 'public.trainer_reservierung'::regclass
    ) THEN
        ALTER TABLE public.trainer_reservierung
            ADD CONSTRAINT trainer_reservierung_zeitraum_chk
                CHECK (start_time < end_time);
    END IF;
END
$$;

-- Index auf (trainer_id, datum) für die Wochenansicht / Zeitraum-Abfragen.
CREATE INDEX IF NOT EXISTS idx_trainer_reservierung_trainer_datum
    ON public.trainer_reservierung (trainer_id, datum);

-- Rechte an n8n_writer (konsistent zu den übrigen Tabellen).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_reservierung TO n8n_writer;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.trainer_reservierung_id_seq TO n8n_writer;

-- ----------------------------------------------------------------------------
--  Kontrolle
-- ----------------------------------------------------------------------------
SELECT 'trainer_reservierung' AS tabelle, count(*) AS zeilen
FROM public.trainer_reservierung;