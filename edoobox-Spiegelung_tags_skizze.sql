-- ============================================================================
--  SKIZZE (vor produktivem Rollout live verifizieren):
--  edoobox Tag-Ressource spiegeln (sprechende Namen als Badges unter Kurstitel)
-- ============================================================================
--
--  Befund (Prüfung Tag-Klarnamen):
--    * In der Datenbank kursplan existiert aktuell KEINE Tag-Tabelle.
--      (Suchtreffer "feiertag" in kursplan.gehört zum Feiertagskalender,
--       nicht zu edoobox-Tags.)
--    * Die zwölf bereits gespiegelten edoobox-Ressourcen (siehe
--      P90_Ressourcen_Konfiguration.sql) enthalten Tags nicht als eigene
--      Ressource. Analog zur bestehenden Endpunkt-Konvention ist als
--      Listenendpunkt GET /v2/tag/list (alternativ GET /v2/tag) zu prüfen.
--      Die exakte Feld-/Pfadstruktur muss per authentifiziertem Probeabruf
--      bestätigt werden, bevor die Spalten final festgezurrt werden.
--    * Der Klartext steckt üblicherweise im Feld "name" (Referenzdaten ohne
--      Personenbezug -> payload als Verlustfreiheits-Sicherung zulässig).
--
--  Vorgehen:
--    1) Endpunkt live prüfen (authentifizierter GET auf /tag/list bzw. /tag).
--    2) Zieltabellen und Konfigurationszeile ergänzen (dieses Skript).
--    3) P90-Ressourcenkonfiguration (statischer Code-Node) um die Kennung
--       erweitern (keine dynamischen Tabellennamen, E-31c/E-31j).
--    4) In der App: n:m-Verknüpfung offer<->tag auflösen und die Namen als
--       Badges unter dem Kurstitel anzeigen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Zieltabellen in edoobox_raw
-- ----------------------------------------------------------------------------

-- 1.1 Stammtabelle Tag
CREATE TABLE IF NOT EXISTS edoobox_raw.tag (
    tag_id          text        PRIMARY KEY,
    name            text,
    payload         jsonb,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_synced_at  timestamptz NOT NULL DEFAULT now(),
    is_deleted      boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS tag_last_synced_idx ON edoobox_raw.tag (last_synced_at);

-- 1.2 Verknüpfung Tag <-> Angebot (n:m).
--     Falls edoobox die Zuordnung bereits in offer[] mitliefert (z. B.
--     offer.tags[]), kann diese Tabelle entfallen und in P90 aus der Liste
--     abgeleitet werden (analog date_leader / booking_position).
CREATE TABLE IF NOT EXISTS edoobox_raw.offer_tag (
    offer_id        text        NOT NULL,
    tag_id          text        NOT NULL,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (offer_id, tag_id)
);
CREATE INDEX IF NOT EXISTS offer_tag_tag_idx ON edoobox_raw.offer_tag (tag_id);

-- ----------------------------------------------------------------------------
-- 2. P90-Ressourcenkonfiguration ergänzen (analog Referenzdatei)
-- ----------------------------------------------------------------------------
-- Ergänzende Zeile (Kennung 'edo_tags'), sobald der Endpunkt live bestätigt ist:
--
--   ('edo_tags', '/tag/list', 'tag', 'tag_id', 2000, true, false, true, true,
--    'Tags/Etiketten. Referenzdaten ohne Personenbezug; payload als Sicherung.'),
--
-- Diese Zuordnung ist zusätzlich im P90-Code-Node (statische Mapping-Tabelle)
-- nachzuziehen. Die Verknüpfungsoffer_tag wird - je nach API-Struktur -
-- entweder direkt aus offer.tags[] abgeleitet oder separat gespiegelt.

-- ----------------------------------------------------------------------------
-- 3. Berechtigungen
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON edoobox_raw.tag      TO n8n_writer;
GRANT SELECT, INSERT, UPDATE ON edoobox_raw.offer_tag TO n8n_writer;

-- ----------------------------------------------------------------------------
-- 4. Anzeige-Vorschlag (App/GET /api/termine)
-- ----------------------------------------------------------------------------
--   LEFT JOIN edoobox_raw.offer_tag ot ON ot.offer_id = od.offer_id
--   LEFT JOIN edoobox_raw.tag      t  ON t.tag_id   = ot.tag_id
--                                   AND t.is_deleted IS NOT TRUE
--   ... anschliessend je offer_id die Namen zu ARRAY_AGG(t.name) gruppieren
--   und als Badges unter dem Kurstitel rendern.
-- ============================================================================