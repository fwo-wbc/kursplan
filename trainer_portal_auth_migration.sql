-- =============================================================================
-- Migration: Trainerportal – Authentifizierungsfelder
-- Stand: November 2026
-- Auszuführen als: kursplan_user (PostgreSQL auf Host-Port 5433)
-- Zweck: Schritt 1 Trainerportal – Login-Mechanik für das Trainerportal.
-- Idempotent: Kann mehrfach ausgeführt werden.
-- =============================================================================

ALTER TABLE public.trainer
    ADD COLUMN IF NOT EXISTS portal_email VARCHAR(255) UNIQUE,
    ADD COLUMN IF NOT EXISTS password_hash  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS portal_active  BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS last_login     TIMESTAMP WITH TIME ZONE;

-- Rechte für n8n_writer (konsistent zum übrigen Schema)
GRANT SELECT, UPDATE ON public.trainer TO n8n_writer;
