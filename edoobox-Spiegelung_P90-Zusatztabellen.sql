-- ============================================================================
--  edoobox-Spiegelung  |  P90-Zusatztabellen  |  Version 1.0  |  07.09.2026
--  Zweck: Schliesst die offenen Punkte O-2 (fehlende Zieltabellen) und
--         O-3 (sync_run-Protokoll) der Spezifikation produktiver n8n-Workflows.
--
--  O-2: Fuer die sieben Ressourcen ohne Zieltabelle werden datensparsame
--       Tabellen angelegt, damit P90 ALLE zwoelf edoobox-Ressourcen spiegeln
--       kann (Lastenheft E-31e/AK-36, "Umfang der ersten Stufe").
--
--  O-3: sync_run erhaelt eine ergaenzende Detailtabelle sync_run_resource,
--       damit P01/P02/P03 "je Ressource" die von E-31g und AK-36 geforderten
--       Zaehlwerte protokollieren koennen.
--
--  Datensparsamkeit (E-27a, DS-10, E-31b): Name, Anschrift, E-Mail, IP werden
--  NICHT gespeichert. Benutzerbezug ausschliesslich als md5-Streuwert.
--
--  WICHTIG (Verifikationspunkt): Die exakten edoobox-Feldnamen der sieben
--  Ressourcen sind im Workspace nur als Feldpfad-ANZAHL dokumentiert
--  (Ressourcenanalyse). Die normalisierten Kernspalten sind daher gegen die
--  echten API-Antworten zu verifizieren. Bei personenbezugsfreien Referenz-
--  ressourcen sichert die Spalte payload (jsonb) die Verlustfreiheit, bis die
--  normalisierten Spalten abschliessend bestaetigt sind.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1  Zieltabellen fuer die sieben bisher fehlenden Ressourcen (O-2)
-- ----------------------------------------------------------------------------

-- 1.1  Umsatzsteuer (edo_vat, /vat/list, 13 Datensaetze, 9 Feldpfade)
--      Referenzdaten ohne Personenbezug -> payload erlaubt.
CREATE TABLE IF NOT EXISTS edoobox_raw.vat (
    vat_id          text        PRIMARY KEY,
    name            text,
    rate            numeric(6,3),
    payload         jsonb,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_synced_at  timestamptz NOT NULL DEFAULT now(),
    is_deleted      boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS vat_last_synced_idx ON edoobox_raw.vat (last_synced_at);

-- 1.2  Laender (edo_countries, /country/list, 245 Datensaetze, 5 Feldpfade)
--      Referenzdaten ohne Personenbezug -> payload erlaubt.
CREATE TABLE IF NOT EXISTS edoobox_raw.country (
    country_id      text        PRIMARY KEY,
    iso_code        text,
    name            text,
    payload         jsonb,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_synced_at  timestamptz NOT NULL DEFAULT now(),
    is_deleted      boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS country_last_synced_idx ON edoobox_raw.country (last_synced_at);

-- 1.3  Kategorien (edo_categories, /category/list, 823 Datensaetze, 17 Feldpfade)
--      Referenzdaten ohne Personenbezug -> payload erlaubt.
CREATE TABLE IF NOT EXISTS edoobox_raw.category (
    category_id     text        PRIMARY KEY,
    name            text,
    parent_ref      text,
    is_active       boolean,
    payload         jsonb,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_synced_at  timestamptz NOT NULL DEFAULT now(),
    is_deleted      boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS category_last_synced_idx ON edoobox_raw.category (last_synced_at);

-- 1.4  Preiskategorien (edo_pricecategories, /pricecategory/list, 10.498 DS,
--      12 Feldpfade). Grundlage fuer K-09/K-10. Hash-Modus wegen grosser
--      Bestaende und Angebotsbezug. Referenzdaten ohne Personenbezug -> payload.
CREATE TABLE IF NOT EXISTS edoobox_raw.pricecategory (
    pricecategory_id text        PRIMARY KEY,
    offer_id         text,
    name             text,
    amount_net       numeric(12,2),
    currency         char(3)     DEFAULT 'EUR',
    payload          jsonb,
    first_seen_at    timestamptz NOT NULL DEFAULT now(),
    last_synced_at   timestamptz NOT NULL DEFAULT now(),
    last_changed_at  timestamptz NOT NULL DEFAULT now(),
    payload_hash     text,
    is_deleted       boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS pricecategory_offer_idx      ON edoobox_raw.pricecategory (offer_id);
CREATE INDEX IF NOT EXISTS pricecategory_name_idx       ON edoobox_raw.pricecategory (name);
CREATE INDEX IF NOT EXISTS pricecategory_last_synced_idx ON edoobox_raw.pricecategory (last_synced_at);

-- 1.5  Benutzer (edo_users, /user/list, 3.578 DS, 46 Feldpfade).
--      Datensparsamkeit E-27a: es wird AUSSCHLIESSLICH der nicht umkehrbare
--      md5-Streuwert der edoobox-Benutzerkennung gespeichert. Keine Namen,
--      Adressen, E-Mails, IPs und kein payload (Personenbezug im Rohobjekt).
CREATE TABLE IF NOT EXISTS edoobox_raw.user_account (
    user_ref        text        PRIMARY KEY,  -- md5(edoobox-Benutzerkennung)
    is_active       boolean,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_synced_at  timestamptz NOT NULL DEFAULT now(),
    is_deleted      boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS user_account_last_synced_idx ON edoobox_raw.user_account (last_synced_at);

COMMENT ON TABLE edoobox_raw.user_account IS
    'Datensparsame Spiegelung von edo_users: nur md5-Streuwert, kein Personenbezug (E-27a).';

-- 1.6  Anwesenheiten (edo_attendances, /attendance/list, 5.459 DS, 6 Feldpfade).
--      Datensparsamkeit: nur Terminbezug, Benutzer-Hash und Status. Kein payload
--      (Rohobjekt enthaelt Personenbezug). Nicht erloeswirksam; dient der
--      Vollstaendigkeit der Spiegelung.
CREATE TABLE IF NOT EXISTS edoobox_raw.attendance (
    attendance_id   text        PRIMARY KEY,
    date_id         text,
    user_ref        text,        -- md5-Streuwert, kein Personenbezug
    status          text,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_synced_at  timestamptz NOT NULL DEFAULT now(),
    is_deleted      boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS attendance_date_idx        ON edoobox_raw.attendance (date_id);
CREATE INDEX IF NOT EXISTS attendance_user_idx        ON edoobox_raw.attendance (user_ref);
CREATE INDEX IF NOT EXISTS attendance_last_synced_idx ON edoobox_raw.attendance (last_synced_at);

-- 1.7  Vollstaendige Transaktionsressource (edo_transactions, /transaction/list,
--      5.137 DS, 18 Feldpfade). Ohne eingebettete Personendaten (userdata)
--      und ohne payload (Zweckbindung E-27a). Die buchungsbezogenen Vorgaenge
--      bleiben zusaetzlich in booking_transaction; diese Tabelle bildet die
--      Gesamtressource einschliesslich der Vorgaenge ohne Buchungsbezug ab.
CREATE TABLE IF NOT EXISTS edoobox_raw.transaction_full (
    transaction_id     text        PRIMARY KEY,
    booking_id         text,
    offer_id           text,
    transaction_number text,
    amount             numeric(12,2),
    currency           char(3)     DEFAULT 'EUR',
    transaction_time   timestamptz,
    first_seen_at      timestamptz NOT NULL DEFAULT now(),
    last_synced_at     timestamptz NOT NULL DEFAULT now(),
    is_deleted         boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS transaction_full_booking_idx ON edoobox_raw.transaction_full (booking_id);
CREATE INDEX IF NOT EXISTS transaction_full_offer_idx   ON edoobox_raw.transaction_full (offer_id);
CREATE INDEX IF NOT EXISTS transaction_full_time_idx    ON edoobox_raw.transaction_full (transaction_time DESC);

-- ----------------------------------------------------------------------------
-- 2  Protokoll der Abrufe (O-3): sync_run erweitern + Detailtabelle
-- ----------------------------------------------------------------------------

-- 2.1  run_type um die produktiven Kennungen erweitern und Zusatzfelder ergaenzen.
ALTER TABLE edoobox_raw.sync_run DROP CONSTRAINT IF EXISTS sync_run_type_chk;
ALTER TABLE edoobox_raw.sync_run
    ADD CONSTRAINT sync_run_type_chk
    CHECK (run_type IN ('inkrementell','vollabgleich','webhook','einzelabruf',
                        'P01','P02','P03','P04','P05'));
ALTER TABLE edoobox_raw.sync_run ADD COLUMN IF NOT EXISTS abgleichsart text;
ALTER TABLE edoobox_raw.sync_run ADD COLUMN IF NOT EXISTS hinweis      text;

-- 2.2  Detailtabelle "je Ressource" (E-31g, AK-36). Eine Zeile je Ressource und
--      Lauf. Erfuellt: Ressource, gemeldete/gelesene Anzahl, neue/geaenderte/
--      geloeschte Anzahl, API-Aufrufe.
CREATE TABLE IF NOT EXISTS edoobox_raw.sync_run_resource (
    detail_id   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id      bigint      NOT NULL
                            REFERENCES edoobox_raw.sync_run (run_id)
                            ON DELETE CASCADE,
    resource    text        NOT NULL,
    gemeldet    integer,
    gelesen     integer,
    neu         integer     NOT NULL DEFAULT 0,
    geaendert   integer     NOT NULL DEFAULT 0,
    geloescht   integer     NOT NULL DEFAULT 0,
    api_calls   integer     NOT NULL DEFAULT 0,
    CONSTRAINT sync_run_resource_uq UNIQUE (run_id, resource)
);
CREATE INDEX IF NOT EXISTS sync_run_resource_run_idx ON edoobox_raw.sync_run_resource (run_id);

COMMENT ON TABLE edoobox_raw.sync_run_resource IS
    'Protokoll je Ressource und Lauf (E-31g, AK-36).';

-- ----------------------------------------------------------------------------
-- 3  Berechtigungen (E-28b): n8n_writer schreibt in edoobox_raw
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON edoobox_raw.vat                TO n8n_writer;
GRANT SELECT, INSERT, UPDATE ON edoobox_raw.country            TO n8n_writer;
GRANT SELECT, INSERT, UPDATE ON edoobox_raw.category           TO n8n_writer;
GRANT SELECT, INSERT, UPDATE ON edoobox_raw.pricecategory      TO n8n_writer;
GRANT SELECT, INSERT, UPDATE ON edoobox_raw.user_account       TO n8n_writer;
GRANT SELECT, INSERT, UPDATE ON edoobox_raw.attendance         TO n8n_writer;
GRANT SELECT, INSERT, UPDATE ON edoobox_raw.transaction_full   TO n8n_writer;
GRANT SELECT, INSERT, UPDATE ON edoobox_raw.sync_run_resource  TO n8n_writer;
GRANT USAGE, SELECT ON SEQUENCE edoobox_raw.sync_run_resource_detail_id_seq TO n8n_writer;

-- ----------------------------------------------------------------------------
-- 4  Kurze Selbstkontrolle
-- ----------------------------------------------------------------------------
SELECT
    'P90-Zusatztabellen' AS schritt,
    (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'edoobox_raw'
        AND table_name IN ('vat','country','category','pricecategory',
                           'user_account','attendance','transaction_full',
                           'sync_run_resource')) AS angelegte_tabellen;
