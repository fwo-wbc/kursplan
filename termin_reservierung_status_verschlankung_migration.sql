-- -----------------------------------------------------------------------------
-- Verschärfung des Statusmodells von public.termin_reservierung
--
-- Ziel:
--   * Es gibt nur noch 'angeboten' (Standard) und 'bestaetigt' (nach Zusage).
--   * 'abgelaufen' entfällt (das Fristende zeigt die Tabelle ohnehin an).
--   * 'storniert' entfällt (statt Storno wird hart via DELETE gelöscht).
--
-- Vorgehen:
--   1. Alt-Bestand mit den entfallenen Statuswerten physisch entfernen.
--   2. Den CHECK-Constraint auf das schlanke Modell umstellen.
-- -----------------------------------------------------------------------------

BEGIN;

-- 1) Alt-Status-Bestand hart löschen (kein Storno-Update, sondern DELETE).
DELETE FROM public.termin_reservierung
 WHERE status IN ('abgelaufen', 'storniert');

-- 2) CHECK-Constraint auf 'angeboten' | 'bestaetigt' reduzieren.
ALTER TABLE public.termin_reservierung
    DROP CONSTRAINT IF EXISTS termin_reservierung_status_chk;

ALTER TABLE public.termin_reservierung
    ADD CONSTRAINT termin_reservierung_status_chk
        CHECK (status IN ('angeboten', 'bestaetigt'));

COMMIT;