-- ===========================================================================
-- planning_drafts_migration.sql
-- Zwischenplanung (Sandbox) für den Kurstransfer.
--
--   public.course_modules   : Modul-Stamm der Kursserien (Takt, Abhängigkeiten,
--                             Priorität). Wird von der Regel-Engine gelesen.
--   public.planning_drafts  : Generierte Kursentwürfe der Sandbox. Status:
--                             'draft' | 'conflict' | 'approved'.
--   public.calendar_blockers: Feiertage, Brückentage, Sommerpause – an diesen
--                             Tagen darf die Regel-Engine NICHT planen.
--
-- Konsistent zur Projektarchitektur: nur `public`-Tabellen (lokale App-Daten),
-- keine Berührung von edoobox_raw. Idempotent ausführbar.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Modul-Stamm (existierte bislang nicht; wird von der Sandbox benötigt)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.course_modules (
  id                        serial PRIMARY KEY,
  name                      text NOT NULL,
  -- Reihenfolge innerhalb der Serie (1, 2, 3, …).
  position                  integer NOT NULL DEFAULT 1,
  -- Takt in Wochen (Standard: 4-Wochen-Takt).
  takt_wochen               integer NOT NULL DEFAULT 4,
  -- Optional: Vorgänger-Modul, von dem dieses Modul abhängt.
  abhaengigkeit_von         integer REFERENCES public.course_modules(id),
  -- Zeitlicher Abstand zum Vorgänger in Tagen (z. B. 7 = "7 Tage +/- 1 Tag").
  abhaengigkeit_offset_tage integer,
  -- Priorität 1 = höchste Priorität (Prio-Konfliktprüfung).
  prio                      integer NOT NULL DEFAULT 1,
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT NOW(),
  updated_at                timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_modules_position
  ON public.course_modules (position);

-- ---------------------------------------------------------------------------
-- 2. Kalender-Blocker (Feiertage, Brückentage, Sommerpause)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calendar_blockers (
  id         serial PRIMARY KEY,
  date       date NOT NULL UNIQUE,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_blockers_date
  ON public.calendar_blockers (date);

-- ---------------------------------------------------------------------------
-- 3. Planungs-Entwürfe (Sandbox)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planning_drafts (
  id            bigserial PRIMARY KEY,
  module_id     integer NOT NULL REFERENCES public.course_modules(id),
  trainer_id    integer REFERENCES public.trainer(id),
  proposed_date date NOT NULL,
  status        varchar(50) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'conflict', 'approved')),
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planning_drafts_status
  ON public.planning_drafts (status);

CREATE INDEX IF NOT EXISTS idx_planning_drafts_module
  ON public.planning_drafts (module_id);

CREATE INDEX IF NOT EXISTS idx_planning_drafts_date
  ON public.planning_drafts (proposed_date);