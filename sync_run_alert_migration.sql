-- =====================================================================
-- O-7: Benachrichtigungskanal für P04 (E-Mail)
-- Erweitert edoobox_raw.sync_run (PK: run_id bigint) um Alert-Metadaten.
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- =====================================================================

ALTER TABLE edoobox_raw.sync_run
    ADD COLUMN IF NOT EXISTS alert_sent BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS alert_message TEXT NULL;

COMMENT ON COLUMN edoobox_raw.sync_run.alert_sent IS 'O-7: true = P04-Benachrichtigung (E-Mail) für diesen Lauf veranlasst';
COMMENT ON COLUMN edoobox_raw.sync_run.alert_sent_at IS 'O-7: Zeitpunkt des P04-Benachrichtigungsversands (TIMESTAMPTZ)';
COMMENT ON COLUMN edoobox_raw.sync_run.alert_message IS 'O-7: versandter Alarm-/Warnungstext des P04-Laufs (TEXT)';