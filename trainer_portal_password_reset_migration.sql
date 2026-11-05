-- =============================================================================
-- Migration: Trainerportal – Passwort-Rücksetz-Token
-- Stand: November 2026
-- Auszuführen als: kursplan_user (PostgreSQL auf Host-Port 5433)
-- Zweck: Token-Spalten für den Passwort-Reset-Flow des Trainerportals.
-- Idempotent: Kann mehrfach ausgeführt werden.
-- =============================================================================

ALTER TABLE public.trainer
    ADD COLUMN IF NOT EXISTS reset_password_token    VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reset_password_expires  TIMESTAMPTZ;

-- Rechte für n8n_writer (konsistent zum übrigen Schema)
GRANT SELECT, UPDATE ON public.trainer TO n8n_writer;