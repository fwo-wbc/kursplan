-- ============================================================================
--  edoobox Tag-Ressource spiegeln
--  Ziel: sprechende Tag-Namen als Badges unter dem Kurstitel anzeigen.
--
--  Verifiziert per authentifiziertem Probeabruf (26.09.2026):
--    * Endpunkt: GET /v2/tag/list  (alias GET /v2/tag) liefert beide 19 Saetze.
--    * Feldstruktur je Tag:
--        id    text   (z. B. "tag_a281f71f5e4a_192620135")
--        name  text   (z. B. "LastMinute", "NextWordOnlineEvent")
--        value text   (leer)
--    * Keine Personenbezugsfelder -> payload (jsonb) als Verlustfreiheits-
--      Sicherung ist zulaessig (entspricht den uebrigen Referenzdaten).
--
--  Verknuepfung Angebot <-> Tag (bereits in der Datenbank vorhanden):
--    * edoobox_raw.offer.payload->'tags' ist ein Array von Objekten der Form
--      [{"tag": "<tag_id>", "type": "normal"}]. Der Klartext-Name wird ueber
--      edoobox_raw.tag aufgeloest (tag_id = tag.id).
--    * Eine separate n:m-Tabelle ist daher NICHT erforderlich.
--
--  Verwendetes Konto: kursplan_user (Verwaltungskonto, kann DDL + GRANT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Zieltabelle in edoobox_raw
--    Kernspalten gemaess Anforderung; first_seen_at/last_synced_at/is_deleted
--    sind die fuer die generische P90-UPSERT-Variante erforderlichen
--    Buchhaltungsspalten (analog offer, trainer_admin, vat, country, ...).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edoobox_raw.tag (
    tag_id          text        PRIMARY KEY,
    name            varchar(255),
    payload         jsonb,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_synced_at  timestamptz NOT NULL DEFAULT now(),
    is_deleted      boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS tag_is_deleted_idx ON edoobox_raw.tag (is_deleted);

-- ----------------------------------------------------------------------------
-- 2. Berechtigungen
--    Schreibender n8n-Benutzer und Lese-Benutzer der App (SELECT, INSERT,
--    UPDATE, DELETE gemaess Anforderung).
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON edoobox_raw.tag TO n8n_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON edoobox_raw.tag TO kursplan_user;

-- ----------------------------------------------------------------------------
-- 3. P90-Ressourcenkonfiguration
--    Die feste Zuordnung (Kennung 'edo_tags', Endpunkt '/tag/list', Zieltabelle
--    'tag', PK 'tag_id') liegt als statische Mapping-Tabelle im Code-Node
--    "P90 Konfiguration aufloesen" (p90_node_konfig.js) und wird dort um den
--    Eintrag 'edo_tags' erweitert. Die Dokumentation derselben Zuordnung wird
--    zusaetzlich in P90_Ressourcen_Konfiguration.sql nachgezogen.
--    Eine eigene Steuertabelle existiert in der Datenbank nicht.
-- ----------------------------------------------------------------------------