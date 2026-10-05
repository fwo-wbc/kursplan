-- Schema-Erweiterung für Kursplan-Applikation
CREATE SCHEMA IF NOT EXISTS public;

-- 1. Tabelle für Trainer-Verfügbarkeiten
CREATE TABLE IF NOT EXISTS public.trainer_verfuegbarkeit (
    id SERIAL PRIMARY KEY,
    trainer_id INTEGER NOT NULL,
    datum DATE NOT NULL,
    slot_code VARCHAR(50) DEFAULT 'ganztags',
    status VARCHAR(50) DEFAULT 'verfuegbar',
    notiz TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_trainer_datum_slot UNIQUE (trainer_id, datum, slot_code)
);

CREATE INDEX IF NOT EXISTS idx_trainer_verfuegbarkeit_trainer 
    ON public.trainer_verfuegbarkeit (trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_verfuegbarkeit_datum 
    ON public.trainer_verfuegbarkeit (datum);
CREATE INDEX IF NOT EXISTS idx_trainer_verfuegbarkeit_slot 
    ON public.trainer_verfuegbarkeit (slot_code);

-- 2. Tabelle für Trainer-Zuweisungen zu Terminen
CREATE TABLE IF NOT EXISTS public.trainer_zuweisung (
    id SERIAL PRIMARY KEY,
    trainer_id INTEGER NOT NULL,
    date_id INTEGER NOT NULL,
    status VARCHAR(50) DEFAULT 'angefragt',
    notiz TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_trainer_termin UNIQUE (trainer_id, date_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_zuweisung_trainer 
    ON public.trainer_zuweisung (trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_zuweisung_date 
    ON public.trainer_zuweisung (date_id);

-- 3. Tabelle für App-Einstellungen / Benutzerpräferenzen
CREATE TABLE IF NOT EXISTS public.app_benutzer_einstellung (
    id SERIAL PRIMARY KEY,
    trainer_id INTEGER NOT NULL UNIQUE,
    benachrichtigung_aktiv BOOLEAN DEFAULT TRUE,
    ansicht_standard VARCHAR(50) DEFAULT 'monat',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);