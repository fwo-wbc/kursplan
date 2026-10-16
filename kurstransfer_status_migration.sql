-- ---------------------------------------------------------------------------
-- Migration: kurstransfer_status
-- Serverseitiges Tracking des Kursstatus (Ersatz für localStorage).
-- Schema: public
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kurstransfer_status (
    kurs_key VARCHAR(100) PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'offen', -- 'erledigt' | 'offen'
    edoobox_offer_id VARCHAR(50),
    hinweis TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS set_timestamp ON kurstransfer_status;
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON kurstransfer_status
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();