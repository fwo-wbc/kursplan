-- ===========================================================================
-- course_events_sync_tracking_migration.sql
-- n8n-Sync-Tracking für public.course_events (L-05 Serienplaner → edoobox).
--
--   edoobox_id : vom n8n-Workflow nach erfolgreicher Übertragung gesetzte
--                edoobox-Kennung (offer_id / date_id), nullable.
--   sync_status: Sync-Zustand der Übertragung an edoobox.
--                  'pending' → wartet auf Übertragung durch n8n (Default)
--                  'synced'  → erfolgreich an edoobox übertragen
--                  'failed'  → Übertragung fehlgeschlagen
--                Beschränkt per CHECK-Constraint auf die drei Werte.
--
-- Idempotent ausführbar: bestehende Zeilen erhalten automatisch
-- sync_status = 'pending' (NOT NULL DEFAULT). Das Constraint wird nur
-- angelegt, wenn es nicht bereits existiert.
-- ===========================================================================

ALTER TABLE public.course_events
  ADD COLUMN IF NOT EXISTS edoobox_id text,
  ADD COLUMN IF NOT EXISTS sync_status varchar(16) NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_course_events_sync_status'
      AND conrelid = 'public.course_events'::regclass
  ) THEN
    ALTER TABLE public.course_events
      ADD CONSTRAINT ck_course_events_sync_status
      CHECK (sync_status IN ('pending', 'synced', 'failed'));
  END IF;
END $$;