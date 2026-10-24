-- ---------------------------------------------------------------------------
-- Migration: public.trainer_topics – Spalte is_primary (Trainer-Priorität)
-- ---------------------------------------------------------------------------
-- Zweck (Szenario 2 – flexibler Rhythmus & Trainer-Priorität):
--   Ein Trainer kann für ein Thema der „Haupttrainer" sein (is_primary = true)
--   und für ein anderes Thema lediglich „temporärer Trainer" (is_primary =
--   false / default). Die Zuordnung gilt pro (trainer_id, topic_id)-Paar,
--   mehrere Trainer können dasselbe Thema abdecken.
--
--   Die Serien-Planung (POST /api/course-series, Modus
--   EXTERNAL_AVAILABILITY) sortiert die Kandidaten nach dieser Priorität
--   (is_primary DESC, trainer_id ASC) und versucht zuerst den Haupttrainer.
--
-- Hinweis Backfill:
--   Bestehende Zuordnungen erhalten is_primary = false (Spalten-Default).
--   Da die Suchlogik zuvor ausschließlich nach trainer_id sortierte und
--   is_primary nur als Sortier-Tiebreaker vor trainer_id wirkt, bleibt die
--   Reihenfolge für Bestandsdaten unverändert. Die Prioritäten werden
--   anschließend über das Trainer-Modal gepflegt.
--
-- Schema-Trennung: public = lokale App-Daten (Training), keine edoobox-Daten.
-- Idempotent ausführbar.
-- ---------------------------------------------------------------------------
ALTER TABLE public.trainer_topics
    ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Schnelle Sortierung je Thema: Haupttrainer zuerst (Szenario 2).
CREATE INDEX IF NOT EXISTS trainer_topics_topic_priority_idx
    ON public.trainer_topics (topic_id, is_primary DESC, trainer_id);
