-- ===========================================================================
-- course_events_migration.sql
-- Anlegen der Tabellen für die Serienplanung (L-05) und das
-- Konflikt-Dashboard (Szenario 1).
--
--   public.course_topics : Themenstamm (Themennamen der geplanten Kurse)
--   public.course_events : geplante Termine der Serienplanung; das Flag
--                          needs_conflict_resolution = true markiert
--                          Konflikt-Tage (>= 3 Kurse pro Tag), die im
--                          Dashboard aufgelöst werden müssen.
--
-- Konsistent zur Projektarchitektur: nur `public`-Tabellen (lokale
-- App-Daten), keine Berührung von edoobox_raw. Idempotent ausführbar.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.course_topics (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.course_events (
  id                        bigserial PRIMARY KEY,
  -- Referenz auf den Kurs der Serienplanung (wird durch L-05 gesetzt).
  course_id                 integer,
  -- Pflicht-Thema, im Dashboard wird der Name per Join ergänzt.
  topic_id                  integer NOT NULL REFERENCES public.course_topics(id),
  -- Optional zugewiesener Trainer (local public.trainer).
  trainer_id                integer REFERENCES public.trainer(id),
  start_time                timestamptz NOT NULL,
  end_time                  timestamptz,
  -- true  → Konflikt-Tag (>= 3 Kurse), im Dashboard sichtbar und auflösbar.
  -- false → unkritischer Termin bzw. Konflikt bereits behoben.
  needs_conflict_resolution boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT NOW(),
  updated_at                timestamptz NOT NULL DEFAULT NOW()
);

-- Laufende Konflikt-Abfrage im Dashboard (Filter + Sortierung).
CREATE INDEX IF NOT EXISTS idx_course_events_konflikt
  ON public.course_events (needs_conflict_resolution, start_time);

-- Join auf das Thema im Dashboard.
CREATE INDEX IF NOT EXISTS idx_course_events_topic_id
  ON public.course_events (topic_id);
