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
--  Stand 07.09.2026: Die offenen Punkte O-1 und O-2 sind entschieden. Alle
--  zwoelf Ressourcen werden gespiegelt (Lastenheft E-31e/AK-36). Die sieben
--  zuvor fehlenden Zieltabellen liegen in
--  "edoobox-Spiegelung_P90-Zusatztabellen.sql" vor. Kennungen wurden
--  vereinheitlicht: 'Vat' -> 'edo_vat', 'Countries' -> 'edo_countries'.
--
--  Abgeleitete Tabellen: date_leader, booking_position und booking_transaction
--  werden jetzt IN P90 aus den Listenressourcen abgeleitet (date.leader[],
--  booking.users[] und booking.transactions[]) - ohne Buchungs-Detailendpunkt (O-8).
--  Die Rechnungs-Kindtabellen (invoice_item, invoice_line, invoice_payment,
--  invoice_receipt) bleiben NICHT Teil von P90; sie stammen weiterhin allein aus
--  dem Rechnungs-Detailendpunkt /invoice/{id}/data (zulaessig laut Entscheidung
--  19.09.2026). Siehe Kommentare unten.
-- ============================================================================

CREATE TABLE IF NOT EXISTS edoobox_raw.p90_ressource (
    ressourcenkennung  text PRIMARY KEY,
    endpunkt           text NOT NULL,
    zieltabelle        text,               -- NULL = keine Zieltabelle im Workspace
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
-- Alle zwoelf Listen-Ressourcen (Zieltabelle eindeutig vorhanden)
-- ----------------------------------------------------------------------------
INSERT INTO edoobox_raw.p90_ressource
    (ressourcenkennung, endpunkt, zieltabelle, primaerschluessel, seitengroesse,
     loesch_auswertung, hash_modus, payload_rohdaten, aktiv, anmerkung)
VALUES
    -- Operative Ressourcen (P01) und Stamm-/Referenzdaten
    ('edo_admins',   '/admin/list',     'trainer_admin', 'admin_id',     2000, true,  false, false, true,
     'Nur id, shortcut, permission, Aktiv-Status (Datensparsamkeit E-27a/6.7).'),
    ('edo_dates',    '/date/list',      'offer_date',    'date_id',      2000, true,  false, false, true,
     'date_leader (n:m) wird in P90 aus dates.leader[] abgeleitet (nicht als eigene Listenressource, O-8).'),
    ('edo_offers',   '/offer/list',     'offer',         'offer_id',     2000, true,  true,  true,  true,
     'Vollstaendige Antwort zusaetzlich als payload (jsonb); keine Personenangaben.'),
    ('edo_bookings', '/booking/list',   'booking',       'booking_id',   2000, true,  true,  false, true,
     'user_ref = md5(owner). booking_position aus bookings.users[], booking_transaction aus bookings.transactions[] (O-8).'),
    ('edo_invoices', '/invoice/list',   'invoice',       'invoice_id',   2000, true,  true,  true,  true,
     'Nur Rechnungskopf via Liste. Kindtabellen stammen aus /invoice/{id}/data (Detailabruf bleibt zulaessig, 19.09.2026; O-8) und sind nicht Teil von P90.'),
    -- Referenzdaten (O-2, neu angelegt)
    ('edo_vat',            '/vat/list',           'vat',            'vat_id',            2000, true, false, true,  true,
     'Umsatzsteuer. Referenzdaten ohne Personenbezug; payload als Verlustfreiheits-Sicherung.'),
    ('edo_countries',      '/country/list',       'country',        'country_id',        2000, true, false, true,  true,
     'Laender. Referenzdaten ohne Personenbezug; payload als Verlustfreiheits-Sicherung.'),
    ('edo_categories',     '/category/list',      'category',       'category_id',       2000, true, false, true,  true,
     'Kategorien. Referenzdaten ohne Personenbezug; payload als Verlustfreiheits-Sicherung.'),
    ('edo_users',          '/user/list',          'user_account',   'user_ref',          2000, true, false, false, true,
     'Nur md5(user.id) als user_ref; kein Personenbezug (E-27a). Transformation id -> md5 im P90-Code.'),
    ('edo_pricecategories', '/pricecategory/list', 'pricecategory',  'pricecategory_id',  2000, true, true,  true,  true,
     'Preiskategorien (K-09/K-10). Referenzdaten ohne Personenbezug; Hash-Modus + payload.'),
    ('edo_attendances',    '/attendance/list',    'attendance',     'attendance_id',     2000, true, false, false, true,
     'Anwesenheiten. Nur Termin-/Benutzerbezug (md5) und Status; kein payload (Personenbezug).'),
    ('edo_transactions',   '/transaction/list',   'transaction_full','transaction_id',   2000, true, false, false, true,
      'Gesamtressource ohne userdata-Personendaten (E-27a). Keine P90-Ableitung.'),
    ('edo_tags',           '/tag/list',           'tag',            'tag_id',           2000, true, false, true,  true,
      'Tags/Etiketten. Referenzdaten ohne Personenbezug; payload als Sicherung. Verifiziert 26.09.2026.')
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
-- Abgeleitete Tabellen:
--   IN P90 abgeleitet (aus Listenressourcen, ohne Buchungs-Detailendpunkt; O-8):
--     date_leader          aus edo_dates.leader[]       (Schritt 54)
--     booking_position     aus edo_bookings.users[]     (Gruppierung je Preiskategorie + JOIN pricecategory)
--     booking_transaction  aus edo_bookings.transactions[] (eingebettete Vorgaenge; transaction_time bleibt NULL)
--   WEITERHIN NICHT in P90 (nur Rechnungs-Detailendpunkt /invoice/{id}/data):
--     invoice_item         items.contained
--     invoice_line         invoice_data.items
--     invoice_payment      pay
--     invoice_receipt      receipt
-- ----------------------------------------------------------------------------

GRANT SELECT ON edoobox_raw.p90_ressource TO n8n_writer;

SELECT
    'P90_Ressourcen_Konfiguration' AS schritt,
    (SELECT count(*) FROM edoobox_raw.p90_ressource WHERE aktiv)     AS aktiv_spiegelbar,
    (SELECT count(*) FROM edoobox_raw.p90_ressource WHERE NOT aktiv) AS offene_platzhalter;
