-- ---------------------------------------------------------------------------
-- Migration: public.course_topics.is_active (Soft-Delete-Löschvermerk)
-- ---------------------------------------------------------------------------
-- Zweck:
--   Kursthemen (public.course_topics) dürfen nie hart per DELETE entfernt
--   werden. Sie sind über public.trainer_topics (ON DELETE CASCADE) mit dem
--   Trainerbestand verknüpft. Stattdessen wird ein Löschvermerk gesetzt:
--     is_active = FALSE  -> Thema ist "deaktiviert"/gelöscht (Löschvermerk)
--     is_active = TRUE   -> Thema ist aktiv und in der Zuordnungs-Maske sichtbar
--
--   - Idempotent ausführbar (ADD COLUMN IF NOT EXISTS).
--   - Bestehende Zeilen erhalten automatisch is_active = TRUE (DEFAULT true).
--   - Kein physisches DELETE im Schema public und schon gar nicht in
--     edoobox_raw; Löschungen laufen ausschließlich über den Löschvermerk.
-- ---------------------------------------------------------------------------
ALTER TABLE public.course_topics
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Optionaler, partieller Index: schnelles Laden aller NICHT deaktivierten
-- Themen (Standard-GET /api/course-topics für die Checkboxen-Zuordnung).
CREATE INDEX IF NOT EXISTS course_topics_is_active_idx
    ON public.course_topics (name)
    WHERE is_active IS TRUE;