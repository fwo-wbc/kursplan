-- ============================================================================
--  Migration: Umbenennung des Zuweisungsstatus 'ausgeschrieben' -> 'reserviert'
--  Stand: November 2026
--
--  Fachlicher Hintergrund:
--    Das Kursangebot wird immer genau einem Trainer zugewiesen. Der bisherige
--    Begriff 'ausgeschrieben' war irreführend, da keine trainerübergreifende
--    Ausschreibung/Bewerbung stattfindet, sondern der Termin für diesen Trainer
--    vorläufig reserviert wird.
--
--  Neuer Status-Ablauf der Trainerverfügbarkeit:
--    0 Buchungen                 -> 'reserviert'      (Initialzustand)
--    1 bis minTeilnehmer         -> 'unter Vorbehalt'
--    ab minTeilnehmer + 1        -> 'bestätigt'
--    edoobox-Status 0/5 / Absage -> 'abgesagt'
--
--  Auszuführen als: kursplan_user
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Check-Constraint temporär entfernen (idempotent), damit die Bestands-
--    umbenennung nicht an der alten Werte-Liste scheitert.
-- ----------------------------------------------------------------------------
ALTER TABLE public.trainer_zuweisung
    DROP CONSTRAINT IF EXISTS trainer_zuweisung_status_chk;

-- ----------------------------------------------------------------------------
-- 2. Bestehende Einträge umbenennen: 'ausgeschrieben' -> 'reserviert'.
-- ----------------------------------------------------------------------------
UPDATE public.trainer_zuweisung
SET status = 'reserviert',
    updated_at = NOW()
WHERE status = 'ausgeschrieben';

-- ----------------------------------------------------------------------------
-- 3. Default für künftige Neuanlagen auf 'reserviert' umstellen.
-- ----------------------------------------------------------------------------
ALTER TABLE public.trainer_zuweisung
    ALTER COLUMN status SET DEFAULT 'reserviert';

-- ----------------------------------------------------------------------------
-- 4. Check-Constraint mit neuem Werte-Universum neu setzen.
-- ----------------------------------------------------------------------------
ALTER TABLE public.trainer_zuweisung
    ADD CONSTRAINT trainer_zuweisung_status_chk
    CHECK (status IN ('keine Zuordnung', 'reserviert', 'unter Vorbehalt', 'bestätigt', 'abgesagt'));

COMMIT;

-- ----------------------------------------------------------------------------
-- 5. Selbstkontrolle
-- ----------------------------------------------------------------------------
SELECT
    status,
    count(*) AS anzahl
FROM public.trainer_zuweisung
GROUP BY status
ORDER BY status;
