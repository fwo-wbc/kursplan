-- ============================================================================
--  edoobox-Spiegelung  |  PostgreSQL-Schema  |  Version 1.0  |  04.09.2026
--  Zweck: verlustfreie Spiegelung der edoobox-Buchungsdaten als Grundlage
--         fuer die Deckungsbeitragsrechnung der Kursterminplanung.
--  Schreibender Zugriff:  ausschliesslich n8n
--  Lesender Zugriff:      ausschliesslich ueber kursplan.v_termin_kennzahlen
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS edoobox_raw;
CREATE SCHEMA IF NOT EXISTS kursplan;

-- ----------------------------------------------------------------------------
-- 1  Rohdaten aus edoobox
-- ----------------------------------------------------------------------------

-- 1.1  Buchung (Kopfsatz). Eine Zeile je edoobox-Buchung.
CREATE TABLE edoobox_raw.booking (
    booking_id        text        PRIMARY KEY,
    offer_id          text        NOT NULL,
    status            text,
    booking_time      timestamptz,
    is_b2b            boolean,
    is_multi_offer    boolean,
    -- Bewusst NICHT gespeichert: Name, Rechnungsanschrift, IP-Adresse, E-Mail.
    -- Nur ein nicht umkehrbarer Streuwert, um Mehrfachbuchungen derselben
    -- Person zu erkennen, ohne die Person zu kennen.
    user_ref          text,
    source            text        NOT NULL DEFAULT 'api',
    first_seen_at     timestamptz NOT NULL DEFAULT now(),
    last_synced_at    timestamptz NOT NULL DEFAULT now(),
    -- Zeitpunkt der letzten inhaltlichen Aenderung, NICHT bei jedem Lauf gesetzt
    last_changed_at   timestamptz NOT NULL DEFAULT now(),
    payload_hash      text,
    is_deleted        boolean     NOT NULL DEFAULT false,
    CONSTRAINT booking_source_chk CHECK (source IN ('api', 'webhook', 'manuell'))
);

CREATE INDEX booking_offer_idx        ON edoobox_raw.booking (offer_id);
CREATE INDEX booking_time_idx         ON edoobox_raw.booking (booking_time DESC);
CREATE INDEX booking_last_synced_idx  ON edoobox_raw.booking (last_synced_at);

COMMENT ON COLUMN edoobox_raw.booking.offer_id IS
    'edoobox-Angebotskennung. Verbindungsschluessel zum Termin der Planungs-App (E-01).';
COMMENT ON COLUMN edoobox_raw.booking.user_ref IS
    'Nicht umkehrbarer Streuwert der edoobox-Benutzerkennung. Kein Personenbezug.';
COMMENT ON COLUMN edoobox_raw.booking.payload_hash IS
    'Streuwert der Rohantwort. Aendert er sich nicht, bleibt last_changed_at unveraendert.';

-- 1.2  Buchungsposition. Eine Zeile je Preiskategorie einer Buchung.
--      Behebt Einschraenkung 1 aus E-24a: es wird nicht mehr nur die erste
--      Kategorie uebernommen.
CREATE TABLE edoobox_raw.booking_position (
    position_id       bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id        text        NOT NULL
                                  REFERENCES edoobox_raw.booking (booking_id)
                                  ON DELETE CASCADE,
    pricecategory_id  text        NOT NULL,
    pricecategory_name text       NOT NULL,
    -- Nettobetrag JE PLATZ dieser Kategorie
    amount_net        numeric(12,2) NOT NULL,
    currency          char(3)     NOT NULL DEFAULT 'EUR',
    -- Anzahl der Plaetze in dieser Kategorie innerhalb der Buchung
    quantity          integer     NOT NULL DEFAULT 1,
    is_default        boolean,
    last_synced_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT booking_position_uq  UNIQUE (booking_id, pricecategory_id),
    CONSTRAINT booking_position_qty CHECK (quantity >= 0)
);

CREATE INDEX booking_position_booking_idx ON edoobox_raw.booking_position (booking_id);
CREATE INDEX booking_position_name_idx    ON edoobox_raw.booking_position (pricecategory_name);

COMMENT ON TABLE edoobox_raw.booking_position IS
    'Eine Zeile je Preiskategorie. Massgeblich fuer Erloes und Teilnehmerzahl.';

-- 1.3  Transaktion. Nur fuer den Abgleich mit dem tatsaechlichen Zahlungseingang.
--      Getrennt gefuehrt, damit Teilzahlungen den Erloes NICHT vervielfachen
--      (Einschraenkung 4 aus E-24a).
CREATE TABLE edoobox_raw.booking_transaction (
    transaction_id     text        PRIMARY KEY,
    booking_id         text        NOT NULL
                                   REFERENCES edoobox_raw.booking (booking_id)
                                   ON DELETE CASCADE,
    transaction_number text,
    amount             numeric(12,2),
    currency           char(3)     DEFAULT 'EUR',
    transaction_time   timestamptz,
    last_synced_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX booking_transaction_booking_idx
    ON edoobox_raw.booking_transaction (booking_id);

-- 1.4  Eingegangene Webhook-Ereignisse. Rohablage vor der Verarbeitung.
CREATE TABLE edoobox_raw.webhook_event (
    event_id       bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id    text,
    event_type     text,
    booking_id     text,
    received_at    timestamptz NOT NULL DEFAULT now(),
    processed_at   timestamptz,
    process_status text        NOT NULL DEFAULT 'offen',
    attempt_count  integer     NOT NULL DEFAULT 0,
    error_text     text,
    payload        jsonb       NOT NULL,
    CONSTRAINT webhook_event_status_chk
        CHECK (process_status IN ('offen', 'verarbeitet', 'fehler', 'ignoriert'))
);

-- Verhindert Doppelverarbeitung bei wiederholter Zustellung.
CREATE UNIQUE INDEX webhook_event_external_uq
    ON edoobox_raw.webhook_event (external_id)
    WHERE external_id IS NOT NULL;

CREATE INDEX webhook_event_offen_idx
    ON edoobox_raw.webhook_event (received_at)
    WHERE process_status = 'offen';

-- 1.5  Protokoll der Abrufe. Macht Ausfaelle und Luecken sichtbar.
CREATE TABLE edoobox_raw.sync_run (
    run_id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_type        text        NOT NULL,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    status          text        NOT NULL DEFAULT 'laeuft',
    bookings_seen   integer     NOT NULL DEFAULT 0,
    bookings_changed integer    NOT NULL DEFAULT 0,
    api_calls       integer     NOT NULL DEFAULT 0,
    error_text      text,
    CONSTRAINT sync_run_type_chk
        CHECK (run_type IN ('inkrementell', 'vollabgleich', 'webhook', 'einzelabruf')),
    CONSTRAINT sync_run_status_chk
        CHECK (status IN ('laeuft', 'erfolgreich', 'fehler', 'abgebrochen'))
);

CREATE INDEX sync_run_started_idx ON edoobox_raw.sync_run (started_at DESC);

-- ----------------------------------------------------------------------------
-- 2  Einstufung der Preiskategorien (K-10)
-- ----------------------------------------------------------------------------

-- 2.1  Normalisierung. Muss mit K-10a1 uebereinstimmen.
CREATE OR REPLACE FUNCTION kursplan.normalisiere(bezeichnung text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT btrim(
             regexp_replace(
               replace(
                 replace(
                   replace(
                     replace(lower(bezeichnung), 'ä', 'ae'),
                   'ö', 'oe'),
                 'ü', 'ue'),
               'ß', 'ss'),
               '[^a-z0-9]+', ' ', 'g'
             )
           );
$$;

COMMENT ON FUNCTION kursplan.normalisiere(text) IS
    'Kleinschreibung, Umlaute aufgeloest, Sonderzeichen zu Leerzeichen. Vgl. K-10a1.';

-- 2.2  Regelwerk. Reihenfolge entscheidet, die erste Trefferregel gewinnt.
CREATE TABLE kursplan.preiskategorie_regel (
    regel_id        integer     PRIMARY KEY,
    reihenfolge     integer     NOT NULL UNIQUE,
    muster          text        NOT NULL,
    bezeichnung     text        NOT NULL,
    ist_erloes      boolean     NOT NULL,
    ist_teilnehmer  boolean     NOT NULL,
    ist_aktiv       boolean     NOT NULL DEFAULT true,
    bemerkung       text
);

COMMENT ON TABLE kursplan.preiskategorie_regel IS
    'Musterbasierte Einstufung nach K-10. Ausnahmeregeln haben kleine Reihenfolgewerte.';

INSERT INTO kursplan.preiskategorie_regel
    (regel_id, reihenfolge, muster, bezeichnung, ist_erloes, ist_teilnehmer, bemerkung)
VALUES
    (10, 10, 'stornogebuehr|stornogebuhr|diff nach verrechnung',
        'Ausgleichsbetrag nach Storno', true,  false,
        'Ausnahme, muss vor der Nachholer-Regel stehen. Vgl. K-10a2 und K-10d.'),
    (20, 20, 'nachholtermin|ersatztermin',
        'Nachholer',                    false, true,
        'Bereits im Ursprungstermin bezahlt, traegt hier keinen Erloes.'),
    (30, 30, 'inklusive',
        'Im Gruppenpreis enthalten',    false, true,  NULL),
    (40, 40, 'organisator',
        'Eigene Teilnahme',             false, true,  NULL),
    (50, 50, 'kombibuchung|kombirabatt',
        'Kombirabatt',                  true,  true,  NULL),
    (60, 60, 'last ?-? ?mi[a-z]*te|last minute',
        'Last-Minute-Preis',            true,  true,
        'Erfasst auch die Schreibvarianten Last Miunte und Last--Minute-Preis.'),
    (70, 70, 'standard ?preis|^standard$',
        'Standardpreis',                true,  true,  NULL),
    (80, 80, 'partner',
        'Partnerrabatt',                true,  true,  NULL),
    (90, 90, 'privatbucher|behoerdenrabatt|behordenrabatt|kundenrabatt|vereinsrabatt|'
             || 'rabatt fuer schulen|schulen|anschluss|paket|gruppenrabatt',
        'Sonstiger Rabatt',             true,  true,  NULL),
    (100, 100, 'weitere person|pro person|personen|pro angefangene|workshop|webinarpreis',
        'Personen- oder Gruppenpreis',  true,  true,
        'Gruppenpreise gelten fuer die Gruppe und duerfen nicht je Person vervielfacht werden.');

-- 2.3  Manuelle Uebersteuerung je Angebot und Kategorie (K-10 Stufe 3).
CREATE TABLE kursplan.preiskategorie_ausnahme (
    offer_id           text        NOT NULL,
    pricecategory_name text        NOT NULL,
    ist_erloes         boolean     NOT NULL,
    ist_teilnehmer     boolean     NOT NULL,
    begruendung        text,
    erfasst_von        text,
    erfasst_am         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (offer_id, pricecategory_name)
);

-- 2.4  Einstufung einer Bezeichnung. Erste Trefferregel gewinnt.
CREATE OR REPLACE FUNCTION kursplan.einstufung(
    bezeichnung text,
    betrag      numeric
)
RETURNS TABLE (ist_erloes boolean, ist_teilnehmer boolean, quelle text)
LANGUAGE sql
STABLE
AS $$
    WITH n AS (SELECT kursplan.normalisiere(coalesce(bezeichnung, '')) AS wert),
    treffer AS (
        SELECT r.ist_erloes, r.ist_teilnehmer, r.bezeichnung
        FROM kursplan.preiskategorie_regel r, n
        WHERE r.ist_aktiv
          AND n.wert <> ''
          AND n.wert ~ r.muster
        ORDER BY r.reihenfolge
        LIMIT 1
    )
    SELECT t.ist_erloes, t.ist_teilnehmer, 'regel: ' || t.bezeichnung
    FROM treffer t
    UNION ALL
    -- Betragsregel als Absicherung, wenn keine Musterregel greift
    SELECT false, true, 'betrag ist null'
    WHERE NOT EXISTS (SELECT 1 FROM treffer)
      AND betrag IS NOT NULL
      AND betrag = 0
    UNION ALL
    SELECT NULL, NULL, 'ungeklaert'
    WHERE NOT EXISTS (SELECT 1 FROM treffer)
      AND (betrag IS NULL OR betrag <> 0);
$$;

-- ----------------------------------------------------------------------------
-- 3  Sicht fuer die Anwendung (E-27, E-27a)
--    Enthaelt keinerlei personenbezogene Felder.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW kursplan.v_termin_kennzahlen AS
WITH pos AS (
    SELECT
        b.offer_id,
        p.pricecategory_name,
        p.amount_net,
        p.quantity,
        coalesce(a.ist_erloes,     e.ist_erloes)     AS ist_erloes,
        coalesce(a.ist_teilnehmer, e.ist_teilnehmer) AS ist_teilnehmer,
        CASE WHEN a.offer_id IS NOT NULL THEN 'manuell' ELSE e.quelle END AS einstufung_quelle,
        greatest(b.last_synced_at, p.last_synced_at)  AS stand
    FROM edoobox_raw.booking b
    JOIN edoobox_raw.booking_position p
      ON p.booking_id = b.booking_id
    CROSS JOIN LATERAL kursplan.einstufung(p.pricecategory_name, p.amount_net) e
    LEFT JOIN kursplan.preiskategorie_ausnahme a
      ON a.offer_id = b.offer_id
     AND a.pricecategory_name = p.pricecategory_name
    WHERE NOT b.is_deleted
)
SELECT
    offer_id,
    -- Teilnehmer, die fuer Mindestteilnehmerzahl und Kapazitaet zaehlen
    coalesce(sum(quantity) FILTER (WHERE ist_teilnehmer), 0)               AS teilnehmer_gesamt,
    -- davon solche, die keinen Erloes tragen (Nachholer, Inklusive)
    coalesce(sum(quantity) FILTER (WHERE ist_teilnehmer
                                     AND ist_erloes IS FALSE), 0)          AS teilnehmer_ohne_erloes,
    -- Nettoerloes des Termins
    coalesce(sum(amount_net * quantity) FILTER (WHERE ist_erloes), 0)      AS erloes_netto,
    -- Positionen, deren Einstufung offen ist. Solange > 0 ist der Wert unvollstaendig.
    coalesce(sum(quantity) FILTER (WHERE ist_erloes IS NULL), 0)           AS positionen_ungeklaert,
    count(*)                                                               AS positionen_gesamt,
    max(stand)                                                             AS stand
FROM pos
GROUP BY offer_id;

COMMENT ON VIEW kursplan.v_termin_kennzahlen IS
    'Einzige Schnittstelle der Planungsanwendung zur Buchungsspiegelung (E-27). '
    'Enthaelt keine personenbezogenen Daten (E-27a, DS-10).';

-- Aufschluesselung je Preiskategorie, fuer die Anzeige nach K-09.
CREATE OR REPLACE VIEW kursplan.v_termin_preiskategorien AS
SELECT
    b.offer_id,
    p.pricecategory_name,
    sum(p.quantity)                  AS anzahl,
    sum(p.amount_net * p.quantity)   AS betrag_netto,
    e.ist_erloes,
    e.ist_teilnehmer,
    e.quelle                         AS einstufung_quelle,
    max(p.last_synced_at)            AS stand
FROM edoobox_raw.booking b
JOIN edoobox_raw.booking_position p
  ON p.booking_id = b.booking_id
CROSS JOIN LATERAL kursplan.einstufung(p.pricecategory_name, p.amount_net) e
WHERE NOT b.is_deleted
GROUP BY b.offer_id, p.pricecategory_name,
         e.ist_erloes, e.ist_teilnehmer, e.quelle;

-- Abgleich Erloes gegen tatsaechlichen Zahlungseingang.
CREATE OR REPLACE VIEW kursplan.v_termin_zahlungsabgleich AS
SELECT
    b.offer_id,
    sum(t.amount) AS zahlungseingang,
    max(t.last_synced_at) AS stand
FROM edoobox_raw.booking b
JOIN edoobox_raw.booking_transaction t
  ON t.booking_id = b.booking_id
WHERE NOT b.is_deleted
GROUP BY b.offer_id;

-- ----------------------------------------------------------------------------
-- 4  Rollen und Rechte
-- ----------------------------------------------------------------------------

-- Die Rollen werden absichtlich ohne Anmeldung und ohne Kennwort angelegt.
-- Nach dem Einspielen wird nur die jeweils benoetigte Rolle mit LOGIN und
-- einem lokal erzeugten Kennwort aktiviert. Dadurch stehen keine Geheimnisse
-- in dieser Datei oder in ihrer Versionshistorie.
CREATE ROLE n8n_writer NOLOGIN;
CREATE ROLE app_reader NOLOGIN;

-- n8n: schreibt ausschliesslich in die Rohdaten
GRANT USAGE ON SCHEMA edoobox_raw TO n8n_writer;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA edoobox_raw TO n8n_writer;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA edoobox_raw TO n8n_writer;

-- Anwendung: liest ausschliesslich die Sichten, keine Rohtabelle
GRANT USAGE ON SCHEMA kursplan TO app_reader;
GRANT SELECT ON kursplan.v_termin_kennzahlen      TO app_reader;
GRANT SELECT ON kursplan.v_termin_preiskategorien TO app_reader;
GRANT SELECT ON kursplan.v_termin_zahlungsabgleich TO app_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON kursplan.preiskategorie_ausnahme TO app_reader;
GRANT SELECT ON kursplan.preiskategorie_regel     TO app_reader;

-- Ausdrueckliche Absicherung: kein Zugriff auf die Rohdaten
REVOKE ALL ON SCHEMA edoobox_raw FROM app_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA edoobox_raw FROM app_reader;

-- Sichten laufen mit den Rechten ihres Eigentuemers, daher ist der Lesezugriff
-- auf die Rohtabellen ueber die Sicht moeglich, direkt jedoch gesperrt.
