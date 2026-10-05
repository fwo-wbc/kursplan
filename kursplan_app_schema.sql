-- ============================================================================
--  Kursplan  |  App-Schema der Planungsanwendung  |  Version 1.0  |  23.09.2026
-- ----------------------------------------------------------------------------
--  Zweck: alle Tabellen der Planungs- und Kommunikationsanwendung gemaess
--         Lastenheft Kursplan v1.6. Die edoobox-Spiegelung (Schema edoobox_raw)
--         und die Regel-/Sichttabellen des Deckungsbeitrags (kursplan.* aus
--         Ausbaustufe 0) bleiben unberuehrt.
--
--  Konventionen:
--    - deutsche Bezeichner ohne Umlaute (konsistent zu trainer_verfuegbarkeit)
--    - Betraege als numeric(12,2), Waehrung als char(3)
--    - alle Tabellen liegen im Schema kursplan
--    - idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE
--
--  Die Datei ist mit dem Verwaltungskonto (z. B. kursplan_user) auszufuehren.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS kursplan;

-- ----------------------------------------------------------------------------
-- 1  Authentisierung und Benutzer (Kapitel 4, R-01 bis R-08, DS-09)
-- ----------------------------------------------------------------------------

-- 1.1  Rollen. Als Stammtabelle angelegt, damit weitere Rollen spaeter ohne
--      Umbau ergaenzbar bleiben (R-03). Co-Organisator ist derzeit entfallen.
CREATE TABLE IF NOT EXISTS kursplan.rolle (
    rolle_id     bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kuerzel      text        NOT NULL UNIQUE,
    bezeichnung  text        NOT NULL,
    ist_aktiv    boolean     NOT NULL DEFAULT true
);

COMMENT ON TABLE kursplan.rolle IS
    'Fachliche Rollen der Anwendung (R-01 bis R-04). Erweiterbar ohne Umbau.';

-- 1.2  Benutzerkonten. Personenbezogene Anmeldung mit E-Mail und Passwort (R-06).
--      Nutzer koennen deaktiviert, aber nicht geloescht werden (R-08).
CREATE TABLE IF NOT EXISTS kursplan.benutzer (
    benutzer_id        bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rolle_id           bigint      NOT NULL
                                   REFERENCES kursplan.rolle (rolle_id),
    email              text        NOT NULL UNIQUE,
    passwort_hash      text        NOT NULL,
    vorname            text,
    nachname           text,
    zwei_faktor_aktiv  boolean     NOT NULL DEFAULT false,      -- R-07 (SOLL)
    ist_aktiv          boolean     NOT NULL DEFAULT true,       -- R-08
    letzte_anmeldung   timestamptz,
    angelegt_am        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT benutzer_aktiv_und_email_chk
        CHECK (email <> '')
);

CREATE INDEX IF NOT EXISTS benutzer_rolle_idx ON kursplan.benutzer (rolle_id);

COMMENT ON TABLE kursplan.benutzer IS
    'Anmeldekonten fuer Organisator, Trainer und Leseansicht (R-06).';

-- 1.3  Einmal-Links ("Magic Links") fuer die Traineranmeldung (R-06).
CREATE TABLE IF NOT EXISTS kursplan.magic_link (
    token_hash     text        PRIMARY KEY,
    benutzer_id    bigint      NOT NULL
                               REFERENCES kursplan.benutzer (benutzer_id)
                               ON DELETE CASCADE,
    erstellt_am    timestamptz NOT NULL DEFAULT now(),
    gueltig_bis    timestamptz NOT NULL,
    genutzt_am     timestamptz
);

CREATE INDEX IF NOT EXISTS magic_link_benutzer_idx ON kursplan.magic_link (benutzer_id);

-- 1.4  Protokoll fehlgeschlagener Anmeldeversuche (DS-09).
CREATE TABLE IF NOT EXISTS kursplan.login_versuch (
    versuch_id     bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    benutzer_id    bigint      REFERENCES kursplan.benutzer (benutzer_id)
                               ON DELETE CASCADE,
    email          text        NOT NULL,
    erfolg         boolean     NOT NULL,
    ip_verschleiert text,
    zeitpunkt      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_versuch_email_idx ON kursplan.login_versuch (email, zeitpunkt DESC);

-- ----------------------------------------------------------------------------
-- 2  Stammdaten (Kapitel 5)
-- ----------------------------------------------------------------------------

-- 2.1  Zeitfenster / Slots (S-01, S-03). Konfigurierbare Stammdaten.
CREATE TABLE IF NOT EXISTS kursplan.slot (
    slot_code      text        PRIMARY KEY,
    bezeichnung    text        NOT NULL,
    anfang         time        NOT NULL,
    ende           time        NOT NULL,
    tagesabschnitt text        NOT NULL,
    sortierung     integer     NOT NULL DEFAULT 0,
    ist_aktiv      boolean     NOT NULL DEFAULT true,
    CONSTRAINT slot_zeit_chk        CHECK (anfang < ende),
    CONSTRAINT slot_tagesabschnitt_chk
        CHECK (tagesabschnitt IN ('Vormittag', 'Nachmittag', 'Abend'))
);

-- 2.2  Systemweite Einstellungen, u. a. Mindestpause (S-02) und
--      Entscheidungsfrist (T-06 / Annahme A-1).
CREATE TABLE IF NOT EXISTS kursplan.systemeinstellung (
    schluessel     text        PRIMARY KEY,
    wert           text,
    beschreibung   text
);

-- 2.3  Kursarten (S-04a, S-04b). Mindestteilnehmer je Kursart als Vorgabe,
--      je Kurstitel ueberschreibbar. Firmenkurs ignoriert die Mindestzahl.
CREATE TABLE IF NOT EXISTS kursplan.kursart (
    kursart_id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bezeichnung                text        NOT NULL UNIQUE,
    dauer_minuten              integer,
    mindestteilnehmer          integer,
    hoechstteilnehmer          integer,
    ignoriert_mindestteilnehmer boolean    NOT NULL DEFAULT false,  -- S-04b
    ist_aktiv                  boolean     NOT NULL DEFAULT true,
    CONSTRAINT kursart_min_chk CHECK (mindestteilnehmer IS NULL OR mindestteilnehmer >= 0),
    CONSTRAINT kursart_minmax_chk CHECK (
        hoechstteilnehmer IS NULL OR mindestteilnehmer IS NULL
        OR hoechstteilnehmer >= mindestteilnehmer)
);

-- 2.3a  Zulaessige Slots je Kursart (S-04a).
CREATE TABLE IF NOT EXISTS kursplan.kursart_slot (
    kursart_id   bigint      NOT NULL
                             REFERENCES kursplan.kursart (kursart_id)
                             ON DELETE CASCADE,
    slot_code    text        NOT NULL
                             REFERENCES kursplan.slot (slot_code),
    PRIMARY KEY (kursart_id, slot_code)
);

-- 2.4  Kurskategorie (S-04, L-09).
CREATE TABLE IF NOT EXISTS kursplan.kurskategorie (
    kategorie_id   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bezeichnung    text        NOT NULL UNIQUE,
    ist_aktiv      boolean     NOT NULL DEFAULT true
);

-- 2.5  Kurstitel (S-04, S-05). Ueber 80 Titel, mit Prio-Rhythmus.
CREATE TABLE IF NOT EXISTS kursplan.kurs (
    kurs_id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kursart_id        bigint      REFERENCES kursplan.kursart (kursart_id),
    kategorie_id      bigint      REFERENCES kursplan.kurskategorie (kategorie_id),
    titel             text        NOT NULL,
    kurzbezeichnung   text        NOT NULL UNIQUE,
    teile_anzahl      integer     NOT NULL DEFAULT 1,              -- mehrteilige Kurse (T-12)
    prioritaet        integer     NOT NULL DEFAULT 2,              -- 1, 2 oder 3 (S-04)
    rhythmus_wochen   integer     NOT NULL DEFAULT 4,              -- S-05
    mindestteilnehmer integer,                                     -- Uebersteuerung je Titel (S-04a)
    hoechstteilnehmer integer,
    ist_aktiv         boolean     NOT NULL DEFAULT true,           -- Status aktiv/inaktiv (S-04)
    CONSTRAINT kurs_prio_chk  CHECK (prioritaet IN (1, 2, 3)),
    CONSTRAINT kurs_parts_chk CHECK (teile_anzahl >= 1),
    CONSTRAINT kurs_rhythmus_chk CHECK (rhythmus_wochen > 0)
);

CREATE INDEX IF NOT EXISTS kurs_kursart_idx  ON kursplan.kurs (kursart_id);
CREATE INDEX IF NOT EXISTS kurs_kategorie_idx ON kursplan.kurs (kategorie_id);

-- 2.6  Bevorzugte Slots je Kurstitel (S-04, L-05).
CREATE TABLE IF NOT EXISTS kursplan.kurs_slot (
    kurs_id     bigint      NOT NULL
                            REFERENCES kursplan.kurs (kurs_id)
                            ON DELETE CASCADE,
    slot_code   text        NOT NULL
                            REFERENCES kursplan.slot (slot_code),
    PRIMARY KEY (kurs_id, slot_code)
);

-- 2.7  Trainerstammdaten (S-07, S-02a, V-02). Farbe fuer den Kalender,
--      Obergrenzen fuer Unterrichtsstunden, Voreinstellung "ganzer Tag".
CREATE TABLE IF NOT EXISTS kursplan.trainer (
    trainer_id       bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    benutzer_id      bigint      REFERENCES kursplan.benutzer (benutzer_id),
    name             text        NOT NULL,
    initialen        text        NOT NULL UNIQUE,                 -- eindeutig (S-07)
    email            text,
    farbe            text        NOT NULL DEFAULT '#3B82F6',       -- Kalenderfarbe (S-07)
    stundenlimit_tag    integer,                                  -- S-02a
    stundenlimit_woche  integer,                                  -- S-02a
    abend_bei_ganztag   boolean   NOT NULL DEFAULT false,         -- V-02
    ist_aktiv        boolean     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS trainer_benutzer_idx ON kursplan.trainer (benutzer_id);

-- 2.8  Trainer-Kurs-Qualifikation (S-06). Abstufung "kann" / "in Einarbeitung".
CREATE TABLE IF NOT EXISTS kursplan.trainer_qualifikation (
    trainer_id   bigint      NOT NULL
                             REFERENCES kursplan.trainer (trainer_id)
                             ON DELETE CASCADE,
    kurs_id      bigint      NOT NULL
                             REFERENCES kursplan.kurs (kurs_id)
                             ON DELETE CASCADE,
    stufe        text        NOT NULL DEFAULT 'kann',
    PRIMARY KEY (trainer_id, kurs_id),
    CONSTRAINT qualifikation_stufe_chk CHECK (stufe IN ('kann', 'in_einarbeitung'))
);

-- 2.9  Kostenkategorien je Trainer (S-07a). Anzahl nicht begrenzt.
CREATE TABLE IF NOT EXISTS kursplan.trainer_kostenkategorie (
    kategorie_id   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trainer_id     bigint      NOT NULL
                               REFERENCES kursplan.trainer (trainer_id)
                               ON DELETE RESTRICT,                 -- bleibt in Terminen erhalten
    bezeichnung    text        NOT NULL,
    betrag_netto   numeric(12,2) NOT NULL,
    ist_standard   boolean     NOT NULL DEFAULT false,            -- genau eine je Trainer
    ist_aktiv      boolean     NOT NULL DEFAULT true,             -- deaktivierbar
    angelegt_am    timestamptz NOT NULL DEFAULT now(),
    geaendert_am   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kostenkategorie_betrag_chk CHECK (betrag_netto >= 0)
);

CREATE INDEX IF NOT EXISTS kostenkategorie_trainer_idx
    ON kursplan.trainer_kostenkategorie (trainer_id);

-- 2.10  Historie der Satzaenderungen (S-07a). Betragsaenderungen wirken nur
--       auf kuenftige Zuordnungen; bereits erfasste Termine behalten ihren Wert.
CREATE TABLE IF NOT EXISTS kursplan.trainer_kostenkategorie_historie (
    historie_id    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kategorie_id   bigint      NOT NULL
                               REFERENCES kursplan.trainer_kostenkategorie (kategorie_id)
                               ON DELETE CASCADE,
    betrag_alt     numeric(12,2),
    betrag_neu     numeric(12,2) NOT NULL,
    geaendert_von  bigint      REFERENCES kursplan.benutzer (benutzer_id),
    geaendert_am   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kostenkategorie_historie_idx
    ON kursplan.trainer_kostenkategorie_historie (kategorie_id, geaendert_am DESC);

-- 2.11  Deutsche Feiertage (S-10, S-10a). Nur solche mit Geltung in mindestens
--       drei Bundeslaendern; jaehrlich fortschreibbar, manuell nachbearbeitbar.
CREATE TABLE IF NOT EXISTS kursplan.feiertag (
    feiertag_id    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    datum          date        NOT NULL UNIQUE,
    bezeichnung    text        NOT NULL,
    bundeslaender  text[]      NOT NULL,                          -- z. B. ARRAY['BY','BW','NW']
    CONSTRAINT feiertag_laender_chk CHECK (cardinality(bundeslaender) >= 1)
);

CREATE INDEX IF NOT EXISTS feiertag_datum_idx ON kursplan.feiertag (datum);

-- 2.12  Sperrtage und Sperrzeitraeume (S-09). Systemweit oder je Trainer.
CREATE TABLE IF NOT EXISTS kursplan.sperrzeit (
    sperrzeit_id   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trainer_id     bigint      REFERENCES kursplan.trainer (trainer_id)
                               ON DELETE CASCADE,                 -- NULL = systemweit
    bezeichnung    text        NOT NULL,
    art            text        NOT NULL,
    von            timestamptz NOT NULL,
    bis            timestamptz NOT NULL,
    ist_aktiv      boolean     NOT NULL DEFAULT true,
    CONSTRAINT sperrzeit_zeitraum_chk CHECK (von < bis)
);

CREATE INDEX IF NOT EXISTS sperrzeit_trainer_idx ON kursplan.sperrzeit (trainer_id);
CREATE INDEX IF NOT EXISTS sperrzeit_zeitraum_idx ON kursplan.sperrzeit (von, bis);

-- 2.13  Betriebsruhe (S-12). Frei definierbare Ruhezeiten des Betriebs.
CREATE TABLE IF NOT EXISTS kursplan.betriebsruhe (
    betriebsruhe_id bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bezeichnung     text        NOT NULL,
    von             date        NOT NULL,
    bis             date        NOT NULL,
    CONSTRAINT betriebsruhe_zeitraum_chk CHECK (von <= bis)
);

CREATE INDEX IF NOT EXISTS betriebsruhe_zeitraum_idx ON kursplan.betriebsruhe (von, bis);

-- 2.14  Trainerurlaub (S-11, V-07). Verbindlich nicht verfuegbar.
CREATE TABLE IF NOT EXISTS kursplan.trainer_urlaub (
    urlaub_id      bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trainer_id     bigint      NOT NULL
                               REFERENCES kursplan.trainer (trainer_id)
                               ON DELETE CASCADE,
    von            date        NOT NULL,
    bis            date        NOT NULL,
    erfasser_id    bigint      REFERENCES kursplan.benutzer (benutzer_id),  -- V-11 Herkunft
    erfassungsquelle text       NOT NULL DEFAULT 'trainer',
    angelegt_am    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT urlaub_zeitraum_chk CHECK (von <= bis),
    CONSTRAINT urlaub_quelle_chk CHECK (erfassungsquelle IN ('trainer', 'organisator'))
);

CREATE INDEX IF NOT EXISTS urlaub_trainer_idx ON kursplan.trainer_urlaub (trainer_id, von, bis);

-- 2.15  Dokumentarten (D-01). Erweiterbar.
CREATE TABLE IF NOT EXISTS kursplan.dokumentart (
    dokumentart_id bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bezeichnung    text        NOT NULL UNIQUE,
    ist_aktiv      boolean     NOT NULL DEFAULT true
);

-- 2.16  Notwendige Dokumente je Kurs (D-01, D-02, D-03).
CREATE TABLE IF NOT EXISTS kursplan.kurs_dokument (
    dokument_id      bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kurs_id          bigint      NOT NULL
                                 REFERENCES kursplan.kurs (kurs_id)
                                 ON DELETE CASCADE,
    dokumentart_id   bigint      NOT NULL
                                 REFERENCES kursplan.dokumentart (dokumentart_id),
    bezeichnung      text        NOT NULL,
    dateiname        text        NOT NULL,
    mime_type        text,
    datei            bytea,                                        -- Dateiinhalt
    version          text,                                         -- Versionsbezeichnung/Stand
    stand_datum      date        NOT NULL DEFAULT CURRENT_DATE,
    anmerkung        text,
    aktualisiert     boolean     NOT NULL DEFAULT false,           -- D-03
    angelegt_am      timestamptz NOT NULL DEFAULT now(),
    geaendert_am     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kurs_dokument_kurs_idx ON kursplan.kurs_dokument (kurs_id);

-- 2.17  Kenntnisnahme aktualisierter Dokumente (D-04, D-05).
CREATE TABLE IF NOT EXISTS kursplan.dokument_kenntnisnahme (
    dokument_id  bigint      NOT NULL
                             REFERENCES kursplan.kurs_dokument (dokument_id)
                             ON DELETE CASCADE,
    trainer_id   bigint      NOT NULL
                             REFERENCES kursplan.trainer (trainer_id)
                             ON DELETE CASCADE,
    bestaetigt_am timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dokument_id, trainer_id)
);

-- ----------------------------------------------------------------------------
-- 3  Verfuegbarkeitsverwaltung (Kapitel 6)
-- ----------------------------------------------------------------------------

-- 3.1  Freigegebene Slots je Trainer und Tag (V-01 bis V-05, V-09, V-11).
--      "Ganzer Tag" / Tagesabschnitt wird anwendungsseitig in Einzelslots
--      aufgeloest (V-02, V-03). Status je Slot: frei / reserviert /
--      bestaetigt / gesperrt (V-09).
CREATE TABLE IF NOT EXISTS kursplan.trainer_verfuegbarkeit (
    trainer_id     bigint      NOT NULL
                               REFERENCES kursplan.trainer (trainer_id)
                               ON DELETE CASCADE,
    datum          date        NOT NULL,
    slot_code      text        NOT NULL
                               REFERENCES kursplan.slot (slot_code),
    status         text        NOT NULL DEFAULT 'frei',
    quelle         text        NOT NULL DEFAULT 'trainer',         -- V-11 Herkunft
    angelegt_am    timestamptz NOT NULL DEFAULT now(),
    geaendert_am   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT verfuegbarkeit_pk PRIMARY KEY (trainer_id, datum, slot_code),
    CONSTRAINT verfuegbarkeit_status_chk
        CHECK (status IN ('frei', 'reserviert', 'bestaetigt', 'gesperrt')),
    CONSTRAINT verfuegbarkeit_quelle_chk
        CHECK (quelle IN ('trainer', 'organisator'))
);

CREATE INDEX IF NOT EXISTS verfuegbarkeit_datum_idx
    ON kursplan.trainer_verfuegbarkeit (datum);

COMMENT ON TABLE kursplan.trainer_verfuegbarkeit IS
    'Ein Slot je Trainer und Tag. Primaberschluessel inkl. slot_code ermoeglicht '
    'ON CONFLICT (trainer_id, datum, slot_code) in der /api/verfuegbarkeit-Route.';

-- ----------------------------------------------------------------------------
-- 4  Termine, Status und Zuordnung (Kapitel 8)
-- ----------------------------------------------------------------------------

-- 4.1  Terminverbund fuer mehrteilige Kurse (T-12, L-13). Verknuepft die Teile,
--      ohne die Eigenstaendigkeit der Einzeltermine aufzuheben (T-01a).
CREATE TABLE IF NOT EXISTS kursplan.termin_verbund (
    verbund_id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bezeichnung        text        NOT NULL,
    edoobox_offer_id   text,                                       -- E-05 / E-05a
    angelegt_am        timestamptz NOT NULL DEFAULT now()
);

-- 4.2  Termin (T-01, T-02, T-09, E-01). Jeder Termin ist eigenstaendig.
CREATE TABLE IF NOT EXISTS kursplan.termin (
    termin_id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kurs_id           bigint      NOT NULL
                                  REFERENCES kursplan.kurs (kurs_id),
    verbund_id        bigint      REFERENCES kursplan.termin_verbund (verbund_id),
    datum             date        NOT NULL,
    slot_code         text        NOT NULL
                                  REFERENCES kursplan.slot (slot_code),
    status            text        NOT NULL DEFAULT 'GEPLANT',
    teil_nr           integer     NOT NULL DEFAULT 1,              -- Teil x von n (T-12)
    teil_von          integer     NOT NULL DEFAULT 1,
    entscheidungs_frist date,                                      -- T-06
    nachfolger_termin_id bigint   REFERENCES kursplan.termin (termin_id),  -- T-09
    edoobox_offer_id  text,                                        -- E-01
    angelegt_von      bigint      REFERENCES kursplan.benutzer (benutzer_id),
    angelegt_am       timestamptz NOT NULL DEFAULT now(),
    geaendert_am      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT termin_status_chk CHECK (status IN (
        'GEPLANT', 'RESERVIERT', 'BESTAETIGT', 'ABGESAGT',
        'VERSCHOBEN', 'DURCHGEFUEHRT')),
    CONSTRAINT termin_teil_chk CHECK (teil_nr >= 1 AND teil_von >= teil_nr)
);

CREATE INDEX IF NOT EXISTS termin_kurs_datum_idx ON kursplan.termin (kurs_id, datum);
CREATE INDEX IF NOT EXISTS termin_datum_slot_idx  ON kursplan.termin (datum, slot_code);
CREATE INDEX IF NOT EXISTS termin_status_idx      ON kursplan.termin (status);
CREATE INDEX IF NOT EXISTS termin_verbund_idx     ON kursplan.termin (verbund_id);

COMMENT ON TABLE kursplan.termin IS
    'Termin = Kurs + Datum + Slot. Ohne Trainerzuordnung moeglich (L-05b).';

-- 4.3  Trainerzuordnung zum Termin (T-01, T-11, L-05a, T-08). Ein Termin kann
--      mehrere Zuordnungen tragen (Mehrfachbelegungsaufloesung). Kosten sind
--      je Zuordnung erfasst (T-11, T-11a).
CREATE TABLE IF NOT EXISTS kursplan.termin_zuordnung (
    zuordnung_id      bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    termin_id         bigint      NOT NULL
                                  REFERENCES kursplan.termin (termin_id)
                                  ON DELETE CASCADE,
    trainer_id        bigint      NOT NULL
                                  REFERENCES kursplan.trainer (trainer_id),
    ist_alternativ    boolean     NOT NULL DEFAULT false,          -- L-05a
    kostenkategorie_id bigint     REFERENCES kursplan.trainer_kostenkategorie (kategorie_id),
    betrag_netto      numeric(12,2),                               -- T-11 frei festlegbar
    waehrung          char(3)     NOT NULL DEFAULT 'EUR',
    begruendung       text,                                        -- T-11 Abweichung
    erfasst_von       bigint      REFERENCES kursplan.benutzer (benutzer_id),
    erfasst_am        timestamptz NOT NULL DEFAULT now(),
    geaendert_am      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT termin_zuordnung_uq UNIQUE (termin_id, trainer_id),
    CONSTRAINT termin_zuordnung_betrag_chk CHECK (betrag_netto IS NULL OR betrag_netto >= 0)
);

CREATE INDEX IF NOT EXISTS termin_zuordnung_trainer_idx
    ON kursplan.termin_zuordnung (trainer_id);

-- 4.4  Statushistorie (T-04). Jeder Statuswechsel wird protokolliert.
CREATE TABLE IF NOT EXISTS kursplan.termin_status_historie (
    historie_id    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    termin_id      bigint      NOT NULL
                               REFERENCES kursplan.termin (termin_id)
                               ON DELETE CASCADE,
    status_alt     text        NOT NULL,
    status_neu     text        NOT NULL,
    geaendert_von  bigint      REFERENCES kursplan.benutzer (benutzer_id),
    kommentar      text,
    zeitpunkt      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS termin_status_historie_idx
    ON kursplan.termin_status_historie (termin_id, zeitpunkt DESC);

-- 4.5  Interne Notizen je Termin, nur fuer den Organisator (T-10).
CREATE TABLE IF NOT EXISTS kursplan.termin_notiz (
    notiz_id    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    termin_id   bigint      NOT NULL
                            REFERENCES kursplan.termin (termin_id)
                            ON DELETE CASCADE,
    inhalt      text        NOT NULL,
    erfasst_von bigint      REFERENCES kursplan.benutzer (benutzer_id),
    erfasst_am  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS termin_notiz_termin_idx ON kursplan.termin_notiz (termin_id);

-- ----------------------------------------------------------------------------
-- 5  Kommunikation (Kapitel 11)
-- ----------------------------------------------------------------------------

-- 5.1  Strukturierte Vorgaenge (C-03, C-04).
CREATE TABLE IF NOT EXISTS kursplan.vorgang (
    vorgang_id    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    typ           text        NOT NULL,
    status        text        NOT NULL DEFAULT 'offen',
    termin_id     bigint      REFERENCES kursplan.termin (termin_id)
                              ON DELETE SET NULL,
    trainer_id    bigint      REFERENCES kursplan.trainer (trainer_id)
                              ON DELETE SET NULL,
    betreff       text        NOT NULL,
    beschreibung  text,
    erstellt_von  bigint      REFERENCES kursplan.benutzer (benutzer_id),
    erstellt_am   timestamptz NOT NULL DEFAULT now(),
    erledigt_am   timestamptz,
    CONSTRAINT vorgang_typ_chk CHECK (typ IN (
        'ruecknahme', 'ausfall', 'terminwunsch', 'terminaenderung', 'allgemein')),
    CONSTRAINT vorgang_status_chk CHECK (status IN (
        'offen', 'in_bearbeitung', 'erledigt', 'abgelehnt'))
);

CREATE INDEX IF NOT EXISTS vorgang_offen_idx
    ON kursplan.vorgang (status) WHERE status IN ('offen', 'in_bearbeitung');
CREATE INDEX IF NOT EXISTS vorgang_termin_idx ON kursplan.vorgang (termin_id);
CREATE INDEX IF NOT EXISTS vorgang_trainer_idx ON kursplan.vorgang (trainer_id);

-- 5.2  Nachrichten (C-01, C-02, C-03, C-08). Terminbezogener Verlauf,
--      direkter 1:1-Verlauf oder Verlauf innerhalb eines Vorgangs.
CREATE TABLE IF NOT EXISTS kursplan.nachricht (
    nachricht_id     bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    termin_id        bigint      REFERENCES kursplan.termin (termin_id)
                                 ON DELETE SET NULL,
    trainer_id       bigint      REFERENCES kursplan.trainer (trainer_id)
                                 ON DELETE SET NULL,
    vorgang_id       bigint      REFERENCES kursplan.vorgang (vorgang_id)
                                 ON DELETE SET NULL,
    absender_id      bigint      REFERENCES kursplan.benutzer (benutzer_id),
    inhalt           text        NOT NULL,
    ist_nachtrag     boolean     NOT NULL DEFAULT false,           -- C-08 Korrektur
    bezug_nachricht_id bigint    REFERENCES kursplan.nachricht (nachricht_id),
    erstellt_am      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nachricht_termin_idx  ON kursplan.nachricht (termin_id);
CREATE INDEX IF NOT EXISTS nachricht_trainer_idx ON kursplan.nachricht (trainer_id);
CREATE INDEX IF NOT EXISTS nachricht_vorgang_idx ON kursplan.nachricht (vorgang_id);

-- Volltextsuche ueber Nachrichten (H-05).
CREATE INDEX IF NOT EXISTS nachricht_inhalt_fts_idx
    ON kursplan.nachricht USING GIN (to_tsvector('german', inhalt));

-- 5.3  Dateianhaenge an Nachrichten (C-07).
CREATE TABLE IF NOT EXISTS kursplan.nachricht_anhang (
    anhang_id      bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nachricht_id   bigint      NOT NULL
                               REFERENCES kursplan.nachricht (nachricht_id)
                               ON DELETE CASCADE,
    dateiname      text        NOT NULL,
    mime_type      text,
    datei          bytea,
    angelegt_am    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nachricht_anhang_nachricht_idx
    ON kursplan.nachricht_anhang (nachricht_id);

-- ----------------------------------------------------------------------------
-- 6  Historie und Protokoll (Kapitel 12)
-- ----------------------------------------------------------------------------

-- 6.1  Trainerakte (H-01, H-02) und Terminhistorie (H-03, H-04). Einheitlicher
--      Ereignisverlauf. Historieneintraege sind nicht veraenderbar (H-07).
CREATE TABLE IF NOT EXISTS kursplan.historie_eintrag (
    eintrag_id    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trainer_id    bigint      REFERENCES kursplan.trainer (trainer_id)
                              ON DELETE CASCADE,
    termin_id     bigint      REFERENCES kursplan.termin (termin_id)
                              ON DELETE SET NULL,
    ereignistyp   text        NOT NULL,
    beschreibung  text        NOT NULL,
    erfasst_von   bigint      REFERENCES kursplan.benutzer (benutzer_id),
    erstellt_am   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS historie_trainer_idx
    ON kursplan.historie_eintrag (trainer_id, erstellt_am DESC);
CREATE INDEX IF NOT EXISTS historie_termin_idx
    ON kursplan.historie_eintrag (termin_id, erstellt_am DESC);
CREATE INDEX IF NOT EXISTS historie_typ_idx
    ON kursplan.historie_eintrag (ereignistyp);

-- 6.2  Systemweites Aenderungsprotokoll (H-08, SOLL).
CREATE TABLE IF NOT EXISTS kursplan.audit_log (
    audit_id      bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    benutzer_id   bigint      REFERENCES kursplan.benutzer (benutzer_id),
    aktion        text        NOT NULL,
    entitaet      text        NOT NULL,
    entitaet_id   text,
    details       jsonb,
    zeitpunkt     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_zeit_idx ON kursplan.audit_log (zeitpunkt DESC);
CREATE INDEX IF NOT EXISTS audit_log_entitaet_idx ON kursplan.audit_log (entitaet);

-- ----------------------------------------------------------------------------
-- 7  Benachrichtigungen (Kapitel 14)
-- ----------------------------------------------------------------------------

-- 7.1  Versand-Queue (N-01 bis N-05).
CREATE TABLE IF NOT EXISTS kursplan.benachrichtigung (
    benachrichtigung_id bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empfaenger_benutzer_id bigint   REFERENCES kursplan.benutzer (benutzer_id)
                                    ON DELETE CASCADE,
    art                 text        NOT NULL,
    betreff             text,
    inhalt              text,
    status              text        NOT NULL DEFAULT 'ausstehend',
    gesendet_am         timestamptz,
    fehler_text         text,
    erstellt_am         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT benachrichtigung_status_chk
        CHECK (status IN ('ausstehend', 'gesendet', 'fehlgeschlagen'))
);

CREATE INDEX IF NOT EXISTS benachrichtigung_offen_idx
    ON kursplan.benachrichtigung (status) WHERE status = 'ausstehend';

-- 7.2  Einstellungen je Benutzer (N-06). Verbindliche Aenderungen ausgenommen.
CREATE TABLE IF NOT EXISTS kursplan.benachrichtigung_einstellung (
    benutzer_id   bigint      NOT NULL
                              REFERENCES kursplan.benutzer (benutzer_id)
                              ON DELETE CASCADE,
    art           text        NOT NULL,
    aktiv         boolean     NOT NULL DEFAULT true,
    PRIMARY KEY (benutzer_id, art)
);

-- ----------------------------------------------------------------------------
-- 8  Trigger: Historie unveraenderlich (H-07)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kursplan.historie_unveraenderlich()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Historieneintraege duerfen nicht geaendert oder geloescht werden (H-07).';
END;
$$;

DROP TRIGGER IF EXISTS trg_historie_kein_update ON kursplan.historie_eintrag;
CREATE TRIGGER trg_historie_kein_update
    BEFORE UPDATE OR DELETE ON kursplan.historie_eintrag
    FOR EACH ROW EXECUTE FUNCTION kursplan.historie_unveraenderlich();

DROP TRIGGER IF EXISTS trg_status_historie_kein_update ON kursplan.termin_status_historie;
CREATE TRIGGER trg_status_historie_kein_update
    BEFORE UPDATE OR DELETE ON kursplan.termin_status_historie
    FOR EACH ROW EXECUTE FUNCTION kursplan.historie_unveraenderlich();

-- ----------------------------------------------------------------------------
-- 9  Ausgangsbestand (Seeds)
-- ----------------------------------------------------------------------------

-- 9.1  Rollen (R-01, R-02, R-04). Co-Organisator entfaellt, erweiterbar (R-03).
INSERT INTO kursplan.rolle (kuerzel, bezeichnung) VALUES
    ('organisator', 'Organisator'),
    ('trainer',     'Trainer'),
    ('leseansicht', 'Leseansicht')
ON CONFLICT (kuerzel) DO NOTHING;

-- 9.2  Slots gemaess S-01.
INSERT INTO kursplan.slot
    (slot_code, bezeichnung, anfang, ende, tagesabschnitt, sortierung)
VALUES
    ('HT', 'Halbtagskurs',        '09:00', '13:00', 'Vormittag', 10),
    ('K1', 'Kurzschulung 1',      '09:00', '10:30', 'Vormittag', 20),
    ('K2', 'Kurzschulung 2',      '11:00', '12:30', 'Vormittag', 30),
    ('K3', 'Kurzschulung 3',      '13:30', '15:00', 'Nachmittag', 40),
    ('K4', 'Kurzschulung 4',      '15:30', '17:00', 'Nachmittag', 50),
    ('AB', 'Abendkurs',           '18:00', '20:00', 'Abend', 60)
ON CONFLICT (slot_code) DO NOTHING;

-- 9.3  Kursarten gemaess S-04a / S-04b (Mindestteilnehmer als Vorgabewert,
--      konkrete Zahlen sind Lastenheft-seitig noch offen und hier bewusst NULL).
INSERT INTO kursplan.kursart
    (bezeichnung, dauer_minuten, mindestteilnehmer, hoechstteilnehmer,
     ignoriert_mindestteilnehmer)
VALUES
    ('Halbtagskurs',            240, NULL, NULL, false),
    ('Kurzschulung 90 Minuten',  90, NULL, NULL, false),
    ('Abendkurs',               120, NULL, NULL, false),
    ('Firmenkurs',              NULL, NULL, NULL, true)
ON CONFLICT (bezeichnung) DO NOTHING;

-- 9.4  Dokumentarten gemaess D-01 (weitere ergaenzbar).
INSERT INTO kursplan.dokumentart (bezeichnung) VALUES
    ('Schulungsunterlage'),
    ('Praesentationsdatei')
ON CONFLICT (bezeichnung) DO NOTHING;

-- 9.5  Systemeinstellungen (S-02, T-06 / Annahme A-1).
INSERT INTO kursplan.systemeinstellung (schluessel, wert, beschreibung) VALUES
    ('mindestpause_minuten',   '30', 'Mindestpause zwischen Slots (S-02).'),
    ('entscheidungsfrist_tage','21', 'Entscheidungsfrist vor Kursbeginn (T-06 / A-1).')
ON CONFLICT (schluessel) DO NOTHING;

-- 9.6  Beispiel-Trainer. In einer frischen Datenbank erhaelt dieser Datensatz
--      automatisch trainer_id = 1 und macht die bereits vorhandene Route
--      /api/verfuegbarkeit (dort trainerId='1' hinterlegt) sofort lauffaehig.
--      Das passende Benutzerkonto (R-06) wird separat ueber die Anmeldung
--      angelegt bzw. ueber benutzer_id verknuepft.
INSERT INTO kursplan.trainer (name, initialen, email, farbe)
VALUES ('Muster Trainer', 'FW', 'trainer@example.de', '#3B82F6')
ON CONFLICT (initialen) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 10  Rechte fuer die Anwendungsrolle
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA kursplan TO kursplan_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA kursplan TO kursplan_user;

-- ----------------------------------------------------------------------------
-- 11  Kontrolle
-- ----------------------------------------------------------------------------
SELECT 'kursplan_app_schema' AS schritt,
       (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'kursplan'
           AND table_type = 'BASE TABLE') AS tabellen_gesamt;