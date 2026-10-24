-- ===========================================================================
-- series_templates_migration.sql
-- Serien-Vorlagen des L-05 Serienplaners.
--
--   id               : Primärschlüssel
--   topic_id         : Pflicht-Thema (FK auf public.course_topics)
--   planning_mode    : OFFICE_CAPACITY | EXTERNAL_AVAILABILITY
--   course_priority  : Kurspriorität (1..3), nur bei OFFICE_CAPACITY relevant
--   start_date       : erster Serientermin (Datum, Europe/Berlin)
--   interval_days    : Rhythmus in Tagen (Serie: currentDate + intervalDays)
--   occurrences      : Anzahl zu generierender Termine
--   created_at/updated_at : Audit-Stempel
--
-- Idempotent ausführbar (CREATE TABLE IF NOT EXISTS / DO-Block).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.series_templates (
  id              bigserial PRIMARY KEY,
  topic_id        integer NOT NULL REFERENCES public.course_topics(id),
  planning_mode   varchar(32) NOT NULL,
  course_priority smallint,
  start_date      date NOT NULL,
  interval_days   integer NOT NULL,
  occurrences     integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_series_templates_planning_mode'
      AND conrelid = 'public.series_templates'::regclass
  ) THEN
    ALTER TABLE public.series_templates
      ADD CONSTRAINT ck_series_templates_planning_mode
      CHECK (planning_mode IN ('OFFICE_CAPACITY', 'EXTERNAL_AVAILABILITY'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_series_templates_priority'
      AND conrelid = 'public.series_templates'::regclass
  ) THEN
    ALTER TABLE public.series_templates
      ADD CONSTRAINT ck_series_templates_priority
      CHECK (course_priority IS NULL OR course_priority BETWEEN 1 AND 3);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_series_templates_interval'
      AND conrelid = 'public.series_templates'::regclass
  ) THEN
    ALTER TABLE public.series_templates
      ADD CONSTRAINT ck_series_templates_interval
      CHECK (interval_days > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_series_templates_occurrences'
      AND conrelid = 'public.series_templates'::regclass
  ) THEN
    ALTER TABLE public.series_templates
      ADD CONSTRAINT ck_series_templates_occurrences
      CHECK (occurrences > 0);
  END IF;
END $$;