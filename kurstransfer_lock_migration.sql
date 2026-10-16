-- ---------------------------------------------------------------------------
-- Migration: kurstransfer_lock
-- Persistente, serverseitige Transfersperre (Singleton).
--
-- Zweck: Die UI muss auch nach einem Seiten-Reload gesperrt bleiben, solange
-- eine Übertragung nach edoobox läuft. Statt eines Browser-localStorage-Locks
-- wird der Sperrzustand serverseitig in einer Ein-Zeilen-Tabelle abgelegt.
--
-- Aufbau:
--   * id = 1 ist die einzige erlaubte Zeile (CONSTRAINT single_row CHECK).
--   * is_locked = TRUE solange eine Übertragung aktiv ist.
--   * owner_key / hinweis optional zur Diagnose, wer/wofür die Sperre gilt.
--   * updated_at wird über den Trigger automatisch gepflegt.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kurstransfer_lock (
    id          INT PRIMARY KEY DEFAULT 1,
    is_locked   BOOLEAN NOT NULL DEFAULT FALSE,
    owner_key   VARCHAR(100),
    hinweis     TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT single_row CHECK (id = 1)
);

-- Standardzeile anlegen, falls sie noch fehlt (ungesperrt).
INSERT INTO kurstransfer_lock (id, is_locked)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Trigger: Aktualisiert updated_at bei jedem UPDATE (analog Status-Tabelle).
-- Die Funktion update_modified_column() existiert bereits aus der
-- kurstransfer_status-Migration und wird wiederverwendet.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_timestamp ON kurstransfer_lock;
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON kurstransfer_lock
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();
