-- ============================================================================
--  Kursplan  |  Migrationsdatei  |  Reservierungen: reservation_code + Audit-Log
-- ----------------------------------------------------------------------------
--  Zweck:
--    * public.termin_reservierung.thema wird optional (NULL erlaubt), damit
--      Sammel-Reservierungen ohne Themenangabe angelegt werden können.
--    * public.termin_reservierung.reservation_code (VARCHAR 40, NULL) fasst
--      zusammengehörige Einzeltermine zu einer Sammel-Reservierung zusammen
--      (analog gruppe_code bei public.trainer_reservierung).
--    * public.reservation_logs protokolliert Änderungen an Reservierungen
--      (CREATED / UPDATED / DELETED / APPOINTMENT_ADDED / APPOINTMENT_REMOVED).
--
--  Hinweis Audit-Dauerhaftigkeit:
--    reservation_logs.reservation_id besitzt bewusst KEINE Fremdschlüssel-
--    Constraint auf public.termin_reservierung. Dadurch bleiben die
--    Protokolleinträge auch nach dem Löschen der zugehörigen Reservierung
--    erhalten (Audit-Pflicht).
--
--  Ausführung:
--    Als Verwaltungskonto mit DDL-Rechten (z. B. kursplan_user) ausführen.
--    Die Datei ist idempotent und kann mehrfach ausgeführt werden.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. thema optional machen (idempotent)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'termin_reservierung'
          AND column_name  = 'thema'
          AND is_nullable  = 'NO'
    ) THEN
        ALTER TABLE public.termin_reservierung
            ALTER COLUMN thema DROP NOT NULL;
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. Spalte reservation_code (VARCHAR 40, NULL) – idempotent
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'termin_reservierung'
          AND column_name  = 'reservation_code'
    ) THEN
        ALTER TABLE public.termin_reservierung
            ADD COLUMN reservation_code VARCHAR(40);
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 3. Index auf reservation_code für die Gruppen-Filterung
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_termin_reservierung_reservation_code
    ON public.termin_reservierung (reservation_code);

-- ----------------------------------------------------------------------------
-- 4. Tabelle public.reservation_logs (Audit-Log)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reservation_logs (
    id                SERIAL PRIMARY KEY,
    reservation_code  VARCHAR(40) NOT NULL,
    reservation_id    INTEGER,
    action            VARCHAR(40) NOT NULL,
    changed_fields    JSONB,
    details           TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 5. Indizes auf reservation_logs
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reservation_logs_reservation_code
    ON public.reservation_logs (reservation_code);

CREATE INDEX IF NOT EXISTS idx_reservation_logs_created_at
    ON public.reservation_logs (created_at);

-- ----------------------------------------------------------------------------
--  Kontrolle
-- ----------------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'termin_reservierung'
  AND column_name IN ('thema', 'reservation_code')
ORDER BY column_name;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'reservation_logs'
ORDER BY ordinal_position;