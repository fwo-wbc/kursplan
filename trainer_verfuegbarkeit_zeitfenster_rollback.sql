-- =============================================================================
-- Rollback: Zeitfenster-Slots aus public.trainer_verfuegbarkeit zurückbauen
-- Kontext    : L-05 Serienplaner – die manuelle Eingabe exakter Uhrzeiten durch
--              den Trainer war fachlich falsch und wird zurückgebaut. Die exakten
--              Kurszeiten werden später systemseitig durch den Serien-Algorithmus
--              berechnet (VM/NM-Blöcke bleiben als einzige Eingabequelle).
-- -----------------------------------------------------------------------------
-- Hinweis zur Soft-Delete-Regel: Diese gilt ausschließlich für das Schema
-- edoobox_raw. public.trainer_verfuegbarkeit ist eine lokale App-Tabelle; die
-- fachlich falschen 'z_HHMM_HHMM'-Slots werden daher entfernt.
-- =============================================================================

-- 1) Alle 'z_HHMM_HHMM'-Zeitfenster-Slots entfernen (freie und gebuchte).
DELETE FROM public.trainer_verfuegbarkeit
WHERE slot_code LIKE 'z\_%';

-- 2) Zeitfenster-Metadaten-Spalten entfernen (falls vorhanden).
ALTER TABLE public.trainer_verfuegbarkeit
    DROP COLUMN IF EXISTS start_time,
    DROP COLUMN IF EXISTS end_time,
    DROP COLUMN IF EXISTS is_booked;
