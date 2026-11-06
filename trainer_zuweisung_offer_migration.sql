-- =============================================================================
-- Migration: offer_id / offer_number an public.trainer_zuweisung
-- Stand: November 2026
-- Zweck: Die Schreib-Endpunkte /api/zuweisung und /api/zuweisung/bulk schreiben
--        die zugehoerigen edoobox-Schluessel (offer_id, offer_number) je
--        date_id mit, damit Zuweisungen direkt einem edoobox-Angebot zugeordnet
--        werden koennen. Diese Spalten werden idempotent angelegt.
-- Auszufuehren als: kursplan_user
-- =============================================================================

-- 1. offer_id: edoobox-Angebotskennung (text, nullable).
--    Wird nur mitgefuehrt, wenn zum Termin ein aktives edoobox-Offer existiert.
ALTER TABLE public.trainer_zuweisung
    ADD COLUMN IF NOT EXISTS offer_id     text;

-- 2. offer_number: edoobox-Angebotsnummer (text, nullable).
ALTER TABLE public.trainer_zuweisung
    ADD COLUMN IF NOT EXISTS offer_number text;

-- 3. Rechte fuer n8n_writer (analog zu den uebrigen Zuweisungs-Spalten).
GRANT SELECT, INSERT, UPDATE ON public.trainer_zuweisung TO n8n_writer;
