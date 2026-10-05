-- ============================================================================
--  Migration: Einheitliches Statusmodell für Trainer-Zuweisungen
--  Stand: Oktober 2026
--
--  Neue Statuswerte (einheitlich in DB, API und UI):
--    'ausgeschrieben'   – Standard, sobald Kursangebot in edoobox existiert
--                         und der Trainer zugewiesen ist (Blau)
--    'unter Vorbehalt'  – automatisch, sobald mindestens 1 Anmeldung vorliegt
--                         (Teilnehmerzahl >= 1) (Gelb)
--    'bestätigt'        – manuell durch die Disposition (Grün)
--    'abgesagt'         – manuell durch die Disposition (Rot)
--
--  Auszuführen als: kursplan_user
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Default für künftige Neuanlagen: IMMER 'ausgeschrieben'.
-- ----------------------------------------------------------------------------
ALTER TABLE public.trainer_zuweisung
    ALTER COLUMN status SET DEFAULT 'ausgeschrieben';

-- ----------------------------------------------------------------------------
-- 2. Einmalige Bestandsbereinigung:
--    - 'offen' / 'angefragt'  -> 'ausgeschrieben'
--    - 'bestaetigt'           -> 'bestätigt'
--    - 'abgesagt'             -> 'abgesagt' (unverändert)
--    - NULL / unbekannte Werte-> 'ausgeschrieben'
-- ----------------------------------------------------------------------------
UPDATE public.trainer_zuweisung
SET status = CASE
    WHEN status IN ('offen', 'angefragt') THEN 'ausgeschrieben'
    WHEN status = 'bestaetigt' THEN 'bestätigt'
    WHEN status = 'abgesagt' THEN 'abgesagt'
    ELSE 'ausgeschrieben'
END
WHERE status IS NULL
   OR status NOT IN ('ausgeschrieben', 'unter Vorbehalt', 'bestätigt', 'abgesagt');

-- ----------------------------------------------------------------------------
-- 3. Check-Constraint auf der Status-Spalte (idempotent).
-- ----------------------------------------------------------------------------
ALTER TABLE public.trainer_zuweisung
    DROP CONSTRAINT IF EXISTS trainer_zuweisung_status_chk;

ALTER TABLE public.trainer_zuweisung
    ADD CONSTRAINT trainer_zuweisung_status_chk
    CHECK (status IN ('ausgeschrieben', 'unter Vorbehalt', 'bestätigt', 'abgesagt'));

-- ----------------------------------------------------------------------------
-- 4. Selbstkontrolle
-- ----------------------------------------------------------------------------
SELECT
    status,
    count(*) AS anzahl
FROM public.trainer_zuweisung
GROUP BY status
ORDER BY status;