-- =============================================================================
-- Migration: public.trainer_verfuegbarkeit um Zeitfenster-Slots erweitern
-- Kontext    : L-05 Serienplaner – Verfügbarkeitspflege für externe Trainer (S2)
-- -----------------------------------------------------------------------------
-- Zeitfenster-Slots werden wie folgt gespeichert:
--   * slot_code  = 'z_HHMM_HHMM'  (z. B. 'z_0900_1100') – eindeutig über den
--                  bestehenden Constraint uq_trainer_datum_slot
--                  (trainer_id, datum, slot_code) => keine Constraint-Änderung.
--   * status     = 'frei'          (konsistent zu den bestehenden VM/NM-Slots)
--   * start_time = Beginn (TIME)
--   * end_time   = Ende   (TIME)
--   * is_booked  = false = freier, löschbarer Slot; true = fester Slot,
--                  der über die API nicht mehr gelöscht werden darf.
-- -----------------------------------------------------------------------------
-- Der bestehende Unique-Constraint (trainer_id, datum, slot_code) und das
-- ON CONFLICT in src/lib/verfuegbarkeit.ts bleiben unangetastet.
-- =============================================================================

ALTER TABLE public.trainer_verfuegbarkeit
    ADD COLUMN IF NOT EXISTS start_time TIME,
    ADD COLUMN IF NOT EXISTS end_time   TIME,
    ADD COLUMN IF NOT EXISTS is_booked  BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.trainer_verfuegbarkeit.start_time IS
    'Beginn des Zeitfensters – nur gefüllt bei Zeitfenster-Slots (slot_code LIKE ''z\_%'')';
COMMENT ON COLUMN public.trainer_verfuegbarkeit.end_time IS
    'Ende des Zeitfensters – nur gefüllt bei Zeitfenster-Slots (slot_code LIKE ''z\_%'')';
COMMENT ON COLUMN public.trainer_verfuegbarkeit.is_booked IS
    'true = fester, bereits gebuchter Slot (darf nicht mehr gelöscht werden)';