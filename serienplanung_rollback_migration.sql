-- ===========================================================================
-- serienplanung_rollback_migration.sql
-- Rückbau der Planungs-/Serienplanungs-Schemata aus der Kursplan-App.
--
-- Entfernt werden (nur public – lokale App-Daten, kein edoobox_raw):
--   1. Sichten der Planungstabelle (v_kursplan_*)
--   2. public.kursplan_termin        (Planungstabelle „Kursplanung")
--   3. public.planning_drafts        (Entwürfe der Zwischenplanung/Sandbox)
--   4. public.series_templates       (Serien-Vorlagen des L-05 Serienplaners)
--   5. public.course_modules         (Modul-Stamm der Sandbox)
--   6. public.calendar_blockers      (Kalender-Blocker der Sandbox)
--
-- Nicht berührt werden public.course_events (bleibt als Datenbasis des
-- Kalenders/Kursmanagements bestehen) und alle edoobox_raw-Tabellen.
--
-- Idempotent ausführbar. Reihenfolge: erst referenzierende, dann
-- referenzierte Objekte.
-- ===========================================================================

-- --- 1. Sichten der Planungstabelle ---------------------------------------
DROP VIEW IF EXISTS public.v_kursplan_werner;
DROP VIEW IF EXISTS public.v_kursplan_sql;
DROP VIEW IF EXISTS public.v_kursplan_ms365;
DROP VIEW IF EXISTS public.v_kursplan_ms_office;
DROP VIEW IF EXISTS public.v_kursplan_termin;

-- --- 2. Tabellen ------------------------------------------------------------
DROP TABLE IF EXISTS public.planning_drafts;   -- FK auf course_modules, trainer
DROP TABLE IF EXISTS public.series_templates;  -- FK auf course_topics
DROP TABLE IF EXISTS public.kursplan_termin;   -- FK auf course_topics
DROP TABLE IF EXISTS public.course_modules;    -- Self-FK (Abhängigkeiten)
DROP TABLE IF EXISTS public.calendar_blockers;