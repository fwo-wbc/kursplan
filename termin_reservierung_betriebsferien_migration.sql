-- ============================================================================
--  Kursplan  |  Migrationsdatei  |  Dozenten-Kalender & Planungsansicht  |  Sept. 2026
-- ----------------------------------------------------------------------------
--  Zweck:
--    Stellt die Datengrundlage für die neue chronologische Kalender- und
--    Planungsansicht der Dozenten bereit (Excel-Raster: eine Zeile pro Tag,
--    gruppiert nach Monat und Kalenderwoche):
--
--      1. public.termin_reservierung  – Vor-Reservierungen für geschlossene
--         Kurse (KD-Nr., Thema, Fristende, Status).
--      2. public.betriebsferien        – Betriebliche Schließzeiten /
--         Ferien, die im Kalender als gesperrte Zeiträume erscheinen.
--
--  Fachlicher Kontext (Lastenheft Kursplan v1.6):
--    Die Reservierung ist eine reine Kundennummern-Referenz (kd_nr) und enthält
--    bewusst KEINEN Klartext-Kundennamen. Fristende (frist_ende) steuert die
--    Fristen-Ampel der Planungsansicht (aktiv / abgelaufen).
--
--  Ausführung:
--    Als Verwaltungskonto mit DDL-Rechten (z. B. kursplan_user) ausführen.
--    Die Datei ist idempotent und kann mehrfach ausgeführt werden.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reservierungen für geschlossene Kurse
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.termin_reservierung (
    id          SERIAL PRIMARY KEY,
    trainer_id  INTEGER     NOT NULL REFERENCES public.trainer (id),
    datum       DATE        NOT NULL,
    -- 'KT1' = Vormittag, 'KT2' = Nachmittag, 'KT3' = Abend, 'ganztags'
    slot_code   VARCHAR(10) NOT NULL,
    -- Reine Kundennummer (z. B. KD-10482). Keine Klartext-Kundennamen!
    kd_nr       VARCHAR(50) NOT NULL,
    thema       VARCHAR(255) NOT NULL,
    -- Ablaufdatum des Angebots / der Reservierung
    frist_ende  DATE        NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'angeboten',
    notiz       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sicherung der erlaubten Wertebereiche. ADD CONSTRAINT kennt kein
-- IF NOT EXISTS, daher idempotent über eine DO-Anweisung.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'termin_reservierung_slot_chk'
          AND conrelid = 'public.termin_reservierung'::regclass
    ) THEN
        ALTER TABLE public.termin_reservierung
            ADD CONSTRAINT termin_reservierung_slot_chk
                CHECK (slot_code IN ('KT1', 'KT2', 'KT3', 'ganztags'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'termin_reservierung_status_chk'
          AND conrelid = 'public.termin_reservierung'::regclass
    ) THEN
        ALTER TABLE public.termin_reservierung
            ADD CONSTRAINT termin_reservierung_status_chk
                CHECK (status IN ('angeboten', 'bestaetigt', 'abgelaufen', 'storniert'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_termin_reservierung_trainer
    ON public.termin_reservierung (trainer_id);
CREATE INDEX IF NOT EXISTS idx_termin_reservierung_datum
    ON public.termin_reservierung (datum);
CREATE INDEX IF NOT EXISTS idx_termin_reservierung_frist
    ON public.termin_reservierung (frist_ende);

-- ----------------------------------------------------------------------------
-- 2. Betriebliche Schließzeiten / Ferien
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.betriebsferien (
    id          SERIAL PRIMARY KEY,
    -- z. B. 'Weihnachten / Betriebsferien', 'Sommerpause'
    bezeichnung VARCHAR(100) NOT NULL,
    von         DATE NOT NULL,
    bis         DATE NOT NULL,
    gesperrt    BOOLEAN NOT NULL DEFAULT true
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'betriebsferien_zeitraum_chk'
          AND conrelid = 'public.betriebsferien'::regclass
    ) THEN
        ALTER TABLE public.betriebsferien
            ADD CONSTRAINT betriebsferien_zeitraum_chk CHECK (von <= bis);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_betriebsferien_von_bis
    ON public.betriebsferien (von, bis);

-- ----------------------------------------------------------------------------
--  Kontrolle
-- ----------------------------------------------------------------------------
SELECT 'termin_reservierung' AS tabelle, count(*) AS zeilen
FROM public.termin_reservierung
UNION ALL
SELECT 'betriebsferien', count(*)
FROM public.betriebsferien;