-- ============================================================================
-- Migration: system_logs
-- ----------------------------------------------------------------------------
-- Zentrales, persistentes Logging für die Kursplan-App. Ergänzt loses
-- console.error/console.log um dauerhafte Einträge für Fehler, Warnungen
-- und Sync-Ereignisse (edoobox, Reservierungen, System).
--
-- Anwenden:
--   node scripts/apply_system_logs_migration.cjs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.system_logs (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ  NOT NULL    DEFAULT NOW(),
    level      VARCHAR(10)  NOT NULL    DEFAULT 'INFO',
    source     VARCHAR(100) NOT NULL,
    message    TEXT         NOT NULL,
    details    JSONB,
    CONSTRAINT chk_system_logs_level
        CHECK (level IN ('INFO', 'WARN', 'ERROR'))
);

-- Schneller Zugriff auf die neuesten Einträge (Datenbank / Debugging).
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at
    ON public.system_logs (created_at DESC);

-- Filter nach Log-Quelle (z. B. alle ERROR-Einträge der Reservierung).
CREATE INDEX IF NOT EXISTS idx_system_logs_source
    ON public.system_logs (source);