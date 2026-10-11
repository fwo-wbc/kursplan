-- =============================================================================
-- Migration: Trainerkosten-Import (Excel/CSV)
-- Stand: 07.10.2026
-- Auszufuehren als: kursplan_user (Standard-Schema: public)
--
-- Faktenbasis (verifiziert):
--   * admin_id  -> public.trainer.edoobox_admin_id  (TEXT, UNIQUE)
--   * date_id   -> public.trainer_zuweisung.date_id (TEXT, gejoint mit
--                  edoobox_raw.offer_date.date_id)
--   * Standard-Schema der App: public
--
-- HINWEIS: Diese Datei wurde erstellt, aber NOCH NICHT ausgefuehrt.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Trainer-Kosten (produktive Tabelle)
--    Eine Zeile je Termin und Dozent (UNIQUE date_id + admin_id).
--    Standardkosten ohne Termin (date_id IS NULL) sind je Dozent mehrfach
--    erlaubt (kein partieller UNIQUE-Index auf admin_id).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trainer_kosten (
    id             SERIAL PRIMARY KEY,
    admin_id       TEXT           NOT NULL
                   REFERENCES public.trainer (edoobox_admin_id),
    date_id        TEXT
                   REFERENCES edoobox_raw.offer_date (date_id)
                   ON DELETE SET NULL,
    kursnr         VARCHAR(50),
    leistungsdatum DATE           NOT NULL,
    betrag         NUMERIC(10, 2) NOT NULL,
    kostenart      VARCHAR(30)    NOT NULL DEFAULT 'kurs',
    ist_standard   BOOLEAN        NOT NULL DEFAULT FALSE,
    bemerkung      TEXT,
    created_at     TIMESTAMPTZ    DEFAULT NOW(),
    updated_at     TIMESTAMPTZ    DEFAULT NOW(),
    CONSTRAINT uq_trainer_kosten_date_admin UNIQUE (date_id, admin_id)
);

-- Indizes fuer die haeufigsten Zugriffspfade
CREATE INDEX IF NOT EXISTS idx_trainer_kosten_admin
    ON public.trainer_kosten (admin_id);
CREATE INDEX IF NOT EXISTS idx_trainer_kosten_date
    ON public.trainer_kosten (date_id);
CREATE INDEX IF NOT EXISTS idx_trainer_kosten_leistungsdatum
    ON public.trainer_kosten (leistungsdatum);

-- Rechte (konsistent zu trainer_zuweisung_schema.sql)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_kosten TO n8n_writer;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.trainer_kosten_id_seq TO n8n_writer;

-- -----------------------------------------------------------------------------
-- 2. Staging-Tabelle fuer den CSV-/Excel-Import
--    Spalten passend zum Excel-Export (Rohwerte als TEXT, Konvertierung
--    erfolgt beim Uebernehmen in public.trainer_kosten).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staging_trainer_kosten (
    id            SERIAL PRIMARY KEY,
    kursnr        TEXT,
    kursdatum     TEXT,
    trainer_kuerzel TEXT,
    betrag        TEXT,
    importiert_am TIMESTAMPTZ DEFAULT NOW()
);

-- Rechte
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staging_trainer_kosten TO n8n_writer;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.staging_trainer_kosten_id_seq TO n8n_writer;