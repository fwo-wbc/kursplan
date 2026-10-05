-- =============================================================================
-- Schema-Erweiterung: Trainer-Stammdaten & Zuweisung
-- Stand: September 2026
-- Auszuführen als: kursplan_user
-- =============================================================================

-- 1. Trainer-Stammdaten
CREATE TABLE IF NOT EXISTS public.trainer (
    id SERIAL PRIMARY KEY,
    vorname VARCHAR(100) NOT NULL,
    nachname VARCHAR(100) NOT NULL,
    kuerzel VARCHAR(10) UNIQUE,
    edoobox_admin_id TEXT UNIQUE,
    farbe VARCHAR(20) DEFAULT '#3b82f6',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rechte an n8n_writer
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer TO n8n_writer;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.trainer_id_seq TO n8n_writer;

-- 2. Anpassung trainer_zuweisung: date_id auf text
ALTER TABLE public.trainer_zuweisung ALTER COLUMN date_id TYPE text;

-- 3. Fremdschlüssel und Constraints setzen
ALTER TABLE public.trainer_verfuegbarkeit 
    DROP CONSTRAINT IF EXISTS fk_verfuegbarkeit_trainer,
    ADD CONSTRAINT fk_verfuegbarkeit_trainer 
    FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON DELETE CASCADE;

ALTER TABLE public.trainer_zuweisung 
    DROP CONSTRAINT IF EXISTS fk_zuweisung_trainer,
    ADD CONSTRAINT fk_zuweisung_trainer 
    FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON DELETE CASCADE;

ALTER TABLE public.trainer_zuweisung 
    DROP CONSTRAINT IF EXISTS uq_date_trainer,
    ADD CONSTRAINT uq_date_trainer UNIQUE (date_id, trainer_id);

-- 4. Initialer Stammdatensatz
INSERT INTO public.trainer (vorname, nachname, kuerzel, edoobox_admin_id, is_active)
VALUES ('Frank', 'Woltmann', 'FW', 'admin_4c155f660347_225880320', true)
ON CONFLICT (kuerzel) DO UPDATE 
SET vorname = EXCLUDED.vorname, 
    nachname = EXCLUDED.nachname, 
    edoobox_admin_id = EXCLUDED.edoobox_admin_id;