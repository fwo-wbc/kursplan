-- ============================================================================
--  P90 Ressourcen-Konfiguration
--  Begleitende Referenz zur festen Konfigurationstabelle des Unterworkflows P90.
--
--  WICHTIG: P90 fuehrt diese Zuordnung zur Laufzeit in einem Code-Node
--  (statische Mapping-Tabelle), damit keine dynamischen SQL-/Tabellennamen aus
--  Nutzereingaben entstehen (E-31c, E-31j). Diese Datei dokumentiert dieselbe
--  Zuordnung nachvollziehbar und versionierbar. Beide Quellen muessen bei
--  Aenderungen gemeinsam gepflegt werden.
--
--  Abgeleitete Tabellen (date_leader, booking_position, booking_transaction,
--  invoice_item, invoice_line, invoice_payment, invoice_receipt) werden NICHT
--  ueber P90 als eigenstaendige Listen-Ressource verarbeitet, weil sie aus
--  eingebetteten Arrays bzw. Detailendpunkten (/invoice/{id}/data) stammen
--  (offene Punkte O-8/O-9 der Spezifikation). Siehe Kommentare unten.
-- ============================================================================

CREATE TABLE IF NOT EXISTS edoobox_raw.p90_ressource (
    ressourcenkennung  text PRIMARY KEY,
    endpunkt           text NOT NULL,
    zieltabelle        text,               -- NULL = keine Zieltabelle im Workspace (O-2)
    primaerschluessel  text,
    seitengroesse      integer     NOT NULL DEFAULT 2000,
    loesch_auswertung  boolean     NOT NULL DEFAULT true,
    hash_modus         boolean     NOT NULL DEFAULT false,  -- true = Tabelle hat payload_hash/last_changed_at
    payload_rohdaten   boolean     NOT NULL DEFAULT false,
    aktiv              boolean     NOT NULL DEFAULT false,  -- true = ueber P90 als Listenressource spiegelbar
    anmerkung          text
);

COMMENT ON TABLE edoobox_raw.p90_ressource IS
    'Feste Konfigurationstabelle fuer P90 (Referenz). Keine Nutzereingaben in SQL/Tabellennamen.';

-- ----------------------------------------------------------------------------
-- Aktiv ueber P90 spiegelbare Listen-Ressourcen (Zieltabelle eindeutig vorhanden)
-- ----------------------------------------------------------------------------
INSERT INTO edoobox_raw.p90_ressource
    (ressourcenkennung, endpunkt, zieltabelle, primaerschluessel, seitengroesse,
     loesch_auswertung, hash_modus, payload_rohdaten, aktiv, anmerkung)
VALUES
    ('edo_admins',   '/admin/list',     'trainer_admin', 'admin_id',     2000, true,  false, false, true,
     'Nur id, shortcut, permission, Aktiv-Status (Datensparsamkeit E-27a/6.7).'),
    ('edo_dates',    '/date/list',      'offer_date',    'date_id',      2000, true,  false, false, true,
     'date_leader (n:m) wird aus dates.leader[] abgeleitet, nicht als eigene P90-Listenressource (O-8).'),
    ('edo_offers',   '/offer/list',     'offer',         'offer_id',     2000, true,  true,  true,  true,
     'Vollstaendige Antwort zusaetzlich als payload (jsonb); keine Personenangaben.'),
    ('edo_bookings', '/booking/list',   'booking',       'booking_id',   2000, true,  true,  false, true,
     'user_ref = md5(owner). booking_position/booking_transaction werden aus Buchungsdetails abgeleitet (O-8).'),
    ('edo_invoices', '/invoice/list',   'invoice',       'invoice_id',   2000, true,  true,  true,  true,
     'Nur Rechnungskopf via Liste. Kindtabellen stammen aus /invoice/{id}/data (Detailabruf, O-8) und sind nicht Teil von P90.')
ON CONFLICT (ressourcenkennung) DO UPDATE SET
    endpunkt          = EXCLUDED.endpunkt,
    zieltabelle       = EXCLUDED.zieltabelle,
    primaerschluessel = EXCLUDED.primaerschluessel,
    seitengroesse     = EXCLUDED.seitengroesse,
    loesch_auswertung = EXCLUDED.loesch_auswertung,
    hash_modus        = EXCLUDED.hash_modus,
    payload_rohdaten  = EXCLUDED.payload_rohdaten,
    aktiv             = EXCLUDED.aktiv,
    anmerkung         = EXCLUDED.anmerkung;

-- ----------------------------------------------------------------------------
-- Ressourcen der zwoelf edoobox-Ressourcen OHNE Zieltabelle im Workspace (O-2).
-- Diese Eintraege sind Platzhalter: P90 weist den Aufruf mit klarer Fehlermeldung
-- zurueck, solange keine Zieltabellen festgelegt sind. Es werden KEINE Datensaetze
-- erfunden und keine Tabellen implizit erwartet.
-- ----------------------------------------------------------------------------
INSERT INTO edoobox_raw.p90_ressource
    (ressourcenkennung, endpunkt, zieltabelle, primaerschluessel, seitengroesse,
     loesch_auswertung, hash_modus, payload_rohdaten, aktiv, anmerkung)
VALUES
    ('Vat',                '/vat/list',           NULL, NULL, 2000, true, false, false, false,
     'Keine Zieltabelle im Workspace (O-2).'),
    ('Countries',          '/country/list',       NULL, NULL, 2000, true, false, false, false,
     'Keine Zieltabelle im Workspace (O-2).'),
    ('edo_categories',     '/category/list',      NULL, NULL, 2000, true, false, false, false,
     'Keine Zieltabelle im Workspace (O-2).'),
    ('edo_users',          '/user/list',          NULL, NULL, 2000, true, false, false, false,
     'Keine Zieltabelle; nur md5(user_ref) in booking/invoice (O-2, Datensparsamkeit).'),
    ('edo_pricecategories', '/pricecategory/list', NULL, NULL, 2000, true, false, false, false,
     'Keine eigenstaendige Zieltabelle; nur booking_position/preiskategorie_ausnahme (O-2).'),
    ('edo_attendances',    '/attendance/list',    NULL, NULL, 2000, true, false, false, false,
     'Keine Zieltabelle; laut Analyse nicht erforderlich fuer DB I (O-2).'),
    ('edo_transactions',   '/transaction/list',   NULL, NULL, 2000, true, false, false, false,
     'Nur Buchungsbezug in booking_transaction; Gesamtressource ohne Zieltabelle (O-2/O-9).')
ON CONFLICT (ressourcenkennung) DO UPDATE SET
    endpunkt          = EXCLUDED.endpunkt,
    zieltabelle       = EXCLUDED.zieltabelle,
    primaerschluessel = EXCLUDED.primaerschluessel,
    seitengroesse     = EXCLUDED.seitengroesse,
    loesch_auswertung = EXCLUDED.loesch_auswertung,
    hash_modus        = EXCLUDED.hash_modus,
    payload_rohdaten  = EXCLUDED.payload_rohdaten,
    aktiv             = EXCLUDED.aktiv,
    anmerkung         = EXCLUDED.anmerkung;

-- ----------------------------------------------------------------------------
-- Abgeleitete Tabellen (keine eigenen Listen-Endpunkte, daher keine P90-Zeile):
--   date_leader          aus dates.leader[]            (Schritt 54)
--   booking_position     aus bookings.users[]          (Schritt 12)
--   booking_transaction  aus Buchung bzw. /transaction/list (Schritt 11)
--   invoice_item         aus /invoice/{id}/data items.contained
--   invoice_line         aus /invoice/{id}/data invoice_data.items
--   invoice_payment      aus /invoice/{id}/data pay
--   invoice_receipt      aus /invoice/{id}/data receipt
-- ----------------------------------------------------------------------------

GRANT SELECT ON edoobox_raw.p90_ressource TO n8n_writer;

SELECT
    'P90_Ressourcen_Konfiguration' AS schritt,
    (SELECT count(*) FROM edoobox_raw.p90_ressource WHERE aktiv)     AS aktiv_spiegelbar,
    (SELECT count(*) FROM edoobox_raw.p90_ressource WHERE NOT aktiv) AS offene_platzhalter;
