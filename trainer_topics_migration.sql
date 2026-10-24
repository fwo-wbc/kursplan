-- ---------------------------------------------------------------------------
-- Migration: public.trainer_topics
-- ---------------------------------------------------------------------------
-- Zweck:
--   Verknüpfung zwischen Trainern (public.trainer) und Kursthemen
--   (public.course_topics). Voraussetzung für die L-05 Puzzle-Logik:
--   ein Trainer kann angeben, welche Themen (aus public.course_topics) er
--   übernehmen kann. Ein Thema kann von mehreren Trainern übernommen werden,
--   ein Trainer kann mehrere Themen übernehmen (m:n).
--
-- Schema-Trennung (App-Logik):
--   * public enthält ausschließlich lokale App-Daten und manuelle
--     Zuweisungen -> diese reine Verknüpfungstabelle gehört hierher.
--   * Kein Bezug zu edoobox-Daten, keine Soft-Delete-Anforderung.
--   * Idempotent ausführbar (CREATE TABLE IF NOT EXISTS / Indizes IF NOT EXISTS).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trainer_topics (
    trainer_id integer NOT NULL,
    topic_id   integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT trainer_topics_pk PRIMARY KEY (trainer_id, topic_id),
    CONSTRAINT trainer_topics_trainer_fk
        FOREIGN KEY (trainer_id) REFERENCES public.trainer (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT trainer_topics_topic_fk
        FOREIGN KEY (topic_id) REFERENCES public.course_topics (id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Schneller Zugriff je Thema (Rückrichtung: Welche Trainer können Thema X?).
CREATE INDEX IF NOT EXISTS trainer_topics_topic_idx
    ON public.trainer_topics (topic_id);