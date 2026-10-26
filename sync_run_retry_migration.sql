-- =====================================================================
-- P05: Wiederanlauf-Mechanismus (Retry-Tracking) fuer fehlgeschlagene
-- oder abgebrochene Sync-Laeufe.
--
-- Erweitert edoobox_raw.sync_run (PK: run_id bigint) um Retry-Metadaten.
-- Idempotent: ADD COLUMN IF NOT EXISTS. Kein DELETE, kein JSON-Merge.
-- =====================================================================

ALTER TABLE edoobox_raw.sync_run
    ADD COLUMN IF NOT EXISTS retry_count     INT     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS retry_of_run_id BIGINT  NULL REFERENCES edoobox_raw.sync_run(run_id),
    ADD COLUMN IF NOT EXISTS retry_status    TEXT    NULL;

COMMENT ON COLUMN edoobox_raw.sync_run.retry_count     IS 'P05: bisherige Wiederanlauf-Versuche dieses Laufs (0 = keiner; Obergrenze: 3)';
COMMENT ON COLUMN edoobox_raw.sync_run.retry_of_run_id IS 'P05: run_id des Alt-Laufs, fuer den dieser Lauf ein Wiederanlauf darstellt (NULL = kein Retry-Lauf)';
COMMENT ON COLUMN edoobox_raw.sync_run.retry_status    IS 'P05: Status des Wiederanlaufs (NULL|pending|in_progress|resolved|failed)';