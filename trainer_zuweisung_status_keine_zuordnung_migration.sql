-- ============================================================================
--  Migration: Neuer Zuweisungsstatus 'keine Zuordnung'
--  Stand: Oktober 2026
--
--  Ergänzt den Status 'keine Zuordnung' im einheitlichen Statusmodell:
--    'keine Zuordnung' – bewusst ohne Trainerzuordnung (Signal: Rot/Gelb)
--    'ausgeschrieben'  – Standard, sobald Kursangebot in edoobox existiert
--                        und der Trainer zugewiesen ist (Blau)
--    'unter Vorbehalt' – automatisch, sobald mindestens 1 Anmeldung vorliegt
--                        (Teilnehmerzahl >= 1) (Gelb)
--    'bestätigt'       – manuell durch die Disposition (Grün)
--    'abgesagt'        – manuell durch die Disposition (Rot)
--
--  Auszuführen als: kursplan_user
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Check-Constraint auf der Status-Spalte erweitern (idempotent).
-- ----------------------------------------------------------------------------
ALTER TABLE public.trainer_zuweisung
    DROP CONSTRAINT IF EXISTS trainer_zuweisung_status_chk;

ALTER TABLE public.trainer_zuweisung
    ADD CONSTRAINT trainer_zuweisung_status_chk
    CHECK (status IN ('keine Zuordnung', 'ausgeschrieben', 'unter Vorbehalt', 'bestätigt', 'abgesagt'));

-- ----------------------------------------------------------------------------
-- 2. Selbstkontrolle
-- ----------------------------------------------------------------------------
SELECT
    status,
    count(*) AS anzahl
FROM public.trainer_zuweisung
GROUP BY status
ORDER BY status;