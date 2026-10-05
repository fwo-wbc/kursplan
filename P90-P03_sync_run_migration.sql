-- ============================================================================
--  P90/P03-Migration: fehlende sync_run-Aggregatspalten  (Maßnahme M4)
--
--  VORAUSSETZUNG (Maßnahme M7): Vorher die Zusatztabellen aus
--  "edoobox-Spiegelung_P90-Zusatztabellen.sql" anwenden. Diese legt an:
--    vat, country, category, pricecategory, user_account, attendance,
--    transaction_full, sync_run_resource
--  und erweitert sync_run um abgleichsart/hinweis sowie die erweiterte
--  run_type-Pruefung (u. a. 'P01'..'P05').
--
--  ZWECK: Der Workflow P03 schreibt in "P03 Lauf abschliessen" die
--  zusammengefassten Zaehlwerte in edoobox_raw.sync_run. Diese Spalten
--  fehlen im Basis-Schema und werden hier ergaenzt.
--
--  AUSFUEHRUNG: administrative PostgreSQL-Verbindung (kursplan_user),
--  nicht die n8n_writer-Schreibverbindung.
-- ============================================================================

ALTER TABLE edoobox_raw.sync_run
    ADD COLUMN IF NOT EXISTS resources_total   integer,
    ADD COLUMN IF NOT EXISTS resources_failed  integer,
    ADD COLUMN IF NOT EXISTS records_seen      integer,
    ADD COLUMN IF NOT EXISTS records_new       integer,
    ADD COLUMN IF NOT EXISTS records_changed   integer,
    ADD COLUMN IF NOT EXISTS records_deleted   integer,
    ADD COLUMN IF NOT EXISTS api_calls_total   integer;

-- ----------------------------------------------------------------------------
--  Nachkontrolle: Soll 7 Spalten liefern.
-- ----------------------------------------------------------------------------
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'edoobox_raw'
  AND table_name   = 'sync_run'
  AND column_name IN ('resources_total','resources_failed','records_seen',
                      'records_new','records_changed','records_deleted',
                      'api_calls_total')
ORDER BY column_name;