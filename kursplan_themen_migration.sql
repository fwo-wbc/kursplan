-- ===========================================================================
-- kursplan_themen_migration.sql
-- Kursthemen-Stamm (public.course_topics) um Planungsfelder erweitern.
--
-- Zweck:
--   Die Tabelle public.course_topics wird zur zentralen Kursthemen-Tabelle
--   ausgebaut. Sie enthaelt ALLE Kursthemen aus edoobox (dedupliziert, nur
--   Themen, keine Termine) und wird automatisch aus edoobox_raw.offer
--   befuellt. Manuell ergaenzt werden ausschliesslich die Planungsdaten:
--     kurs_code, kategorie_id, kategorie_name, vorlage_offer_id,
--     prioritaet, rhythmus_wochen, planungsbereich.
--
-- Schema-Trennung:
--   public = lokale App-Daten (Kursthemen-Stamm, Planung).
--   edoobox_raw bleibt unveraenderter Spiegel; die Ableitung erfolgt
--   ausschliesslich lesend ueber die Sicht v_course_topics_edoobox.
--
-- Idempotent ausfuehrbar (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Planungsfelder ergaenzen
-- ---------------------------------------------------------------------------
ALTER TABLE public.course_topics
    ADD COLUMN IF NOT EXISTS kurs_code        text,
    ADD COLUMN IF NOT EXISTS kategorie_id     text,
    ADD COLUMN IF NOT EXISTS kategorie_name   text,
    ADD COLUMN IF NOT EXISTS vorlage_offer_id text,
    ADD COLUMN IF NOT EXISTS prioritaet       smallint,
    ADD COLUMN IF NOT EXISTS rhythmus_wochen  integer,
    ADD COLUMN IF NOT EXISTS planungsbereich  text;

-- Eindeutiger Themenname (Voraussetzung fuer ON CONFLICT (name) beim
-- automatischen Abgleich und beim Seed). Keine Duplikate im Bestand.
CREATE UNIQUE INDEX IF NOT EXISTS course_topics_name_uq
    ON public.course_topics (name);

-- Eindeutiger Kurs-Code (z. B. 'xls-gl-m1'); nur gesetzt, wenn das Thema
-- tatsaechlich geplant wird. Partieller Index: NULL-Werte bleiben frei.
CREATE UNIQUE INDEX IF NOT EXISTS course_topics_kurs_code_uq
    ON public.course_topics (kurs_code)
    WHERE kurs_code IS NOT NULL;

-- Schnelle Suche nach Planungsbereich (Sicht je Bereich).
CREATE INDEX IF NOT EXISTS course_topics_planungsbereich_idx
    ON public.course_topics (planungsbereich)
    WHERE planungsbereich IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. CHECK-Constraints (idempotent)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_course_topics_prioritaet'
      AND conrelid = 'public.course_topics'::regclass
  ) THEN
    ALTER TABLE public.course_topics
      ADD CONSTRAINT ck_course_topics_prioritaet
      CHECK (prioritaet IS NULL OR prioritaet BETWEEN 1 AND 3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_course_topics_rhythmus'
      AND conrelid = 'public.course_topics'::regclass
  ) THEN
    ALTER TABLE public.course_topics
      ADD CONSTRAINT ck_course_topics_rhythmus
      CHECK (rhythmus_wochen IS NULL OR rhythmus_wochen > 0);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Sicht: automatische Themen-Ableitung aus edoobox_raw.offer
--    Liefert alle aktiven Kursthemen (dedupliziert, nur name).
--    Ein Job/Skript uebernimmt neue Namen per ON CONFLICT (name) DO NOTHING
--    in public.course_topics.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_course_topics_edoobox AS
SELECT DISTINCT name
FROM edoobox_raw.offer
WHERE is_deleted IS NOT TRUE
  AND name IS NOT NULL
  AND btrim(name) <> ''
ORDER BY name;

COMMENT ON VIEW public.v_course_topics_edoobox IS
    'Deduplizierte Kursthemen aus edoobox_raw.offer (nur aktive, nur name). '
    'Grundlage fuer die automatische Befuellung von public.course_topics.';