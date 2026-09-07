-- Rechnungsspiegelung fuer edoobox. Version 1.0
-- Auszufuehren mit dem Verwaltungskonto kursplan_user.
-- Quelle: /v2/invoice/list und /v2/invoice/{id}/data

-- ---------------------------------------------------------------
-- Rechnungskopf
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edoobox_raw.invoice (
    invoice_id            text PRIMARY KEY,
    invoice_number        text,
    user_ref              text,                 -- md5 der rohen Teilnehmerkennung
    status                integer,              -- 1 offen, 2 bezahlt, 3 storniert
    status_text           text,
    currency              char(3)     NOT NULL DEFAULT 'EUR',

    amount                numeric(12,2),        -- Betrag aus der Liste
    amount_pay            numeric(12,2),        -- tatsaechlich gezahlt
    line_total            numeric(12,2),        -- lineTotalAmount
    tax_basis_total       numeric(12,2),        -- taxBasisTotalAmount
    tax_total             numeric(12,2),        -- taxTotalAmount
    grand_total           numeric(12,2),        -- grandTotalAmount
    due_payable           numeric(12,2),        -- duePayableAmount
    prepaid_total         numeric(12,2),        -- totalPrepaidAmount
    allowance_total       numeric(12,2),        -- allowanceTotalAmount
    charge_total          numeric(12,2),        -- chargeTotalAmount

    date_create           timestamptz,
    date_pay              timestamptz,
    date_payuntil         timestamptz,
    date_cancelled        timestamptz,
    offer_start_date      timestamptz,

    address_country       text,
    address_postcode      text,
    buyer_reference       text,
    language              text,

    payload               jsonb,
    first_seen_at         timestamptz NOT NULL DEFAULT now(),
    last_synced_at        timestamptz NOT NULL DEFAULT now(),
    last_changed_at       timestamptz NOT NULL DEFAULT now(),
    payload_hash          text,
    is_deleted            boolean     NOT NULL DEFAULT false
);

COMMENT ON TABLE  edoobox_raw.invoice IS 'Rechnungskoepfe aus edoobox, Abbild ohne eigene Logik';
COMMENT ON COLUMN edoobox_raw.invoice.user_ref IS 'md5 der Kennung aus invoice.user, passt zu booking.user_ref';
COMMENT ON COLUMN edoobox_raw.invoice.tax_basis_total IS 'Bemessungsgrundlage, Netto';

CREATE INDEX IF NOT EXISTS invoice_user_idx        ON edoobox_raw.invoice (user_ref);
CREATE INDEX IF NOT EXISTS invoice_create_idx      ON edoobox_raw.invoice (date_create);
CREATE INDEX IF NOT EXISTS invoice_status_idx      ON edoobox_raw.invoice (status);
CREATE INDEX IF NOT EXISTS invoice_number_idx      ON edoobox_raw.invoice (invoice_number);

-- ---------------------------------------------------------------
-- Rechnungsposten aus items.contained
-- Enthaelt den harten Verweis auf den Zahlungsvorgang.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edoobox_raw.invoice_item (
    invoice_id            text        NOT NULL
                          REFERENCES edoobox_raw.invoice (invoice_id) ON DELETE CASCADE,
    item_key              text        NOT NULL,     -- Schluessel aus items.contained
    item_type             text,                     -- t_booking, t_manualtrans
    transaction_id        text,                     -- transaction_… , Bruecke zur Buchung
    transaction_number    text,
    description           text,
    amount                numeric(12,2),
    vat_percent           numeric(5,2),             -- 0, 16, 19, 25
    vat_ref               text,
    promotion_name        text,
    promotion_amount      numeric(12,2),
    promotion_vat_percent numeric(5,2),
    pricecategory_count   integer,
    last_synced_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (invoice_id, item_key)
);

COMMENT ON COLUMN edoobox_raw.invoice_item.transaction_id IS 'Verweis auf edoobox_raw.booking_transaction, ohne Fremdschluessel weil Rechnungen aelter sein koennen';

CREATE INDEX IF NOT EXISTS invoice_item_trans_idx  ON edoobox_raw.invoice_item (transaction_id);
CREATE INDEX IF NOT EXISTS invoice_item_type_idx   ON edoobox_raw.invoice_item (item_type);
CREATE INDEX IF NOT EXISTS invoice_item_vat_idx    ON edoobox_raw.invoice_item (vat_percent);

-- ---------------------------------------------------------------
-- Gedruckte Rechnungszeilen aus invoice_data.items
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edoobox_raw.invoice_line (
    invoice_id            text        NOT NULL
                          REFERENCES edoobox_raw.invoice (invoice_id) ON DELETE CASCADE,
    position              integer     NOT NULL,
    quantity              numeric(10,2),
    price_net             numeric(12,2),
    price_net_summation   numeric(12,2),
    vat_type              text,
    vat_percent           numeric(5,2),
    transaction_number    text,
    details               text,
    last_synced_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (invoice_id, position)
);

CREATE INDEX IF NOT EXISTS invoice_line_transnr_idx ON edoobox_raw.invoice_line (transaction_number);

-- ---------------------------------------------------------------
-- Zahlungen
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edoobox_raw.invoice_payment (
    pay_id                text PRIMARY KEY,
    invoice_id            text        NOT NULL
                          REFERENCES edoobox_raw.invoice (invoice_id) ON DELETE CASCADE,
    amount                numeric(12,2),
    currency              char(3),
    status                integer,
    date_pay              timestamptz,
    system                text,
    system_id             text,
    last_synced_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_payment_inv_idx ON edoobox_raw.invoice_payment (invoice_id);
CREATE INDEX IF NOT EXISTS invoice_payment_sys_idx ON edoobox_raw.invoice_payment (system_id);

-- ---------------------------------------------------------------
-- Belege und Gutschriften
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edoobox_raw.invoice_receipt (
    receipt_id            text PRIMARY KEY,
    invoice_id            text        NOT NULL
                          REFERENCES edoobox_raw.invoice (invoice_id) ON DELETE CASCADE,
    receipt_number        text,
    amount                numeric(12,2),
    currency              char(3),
    date_create           timestamptz,
    last_synced_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_receipt_inv_idx ON edoobox_raw.invoice_receipt (invoice_id);

-- ---------------------------------------------------------------
-- Rechte fuer das Schreibkonto
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
    edoobox_raw.invoice,
    edoobox_raw.invoice_item,
    edoobox_raw.invoice_line,
    edoobox_raw.invoice_payment,
    edoobox_raw.invoice_receipt
TO n8n_writer;

SELECT
    (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'edoobox_raw'
        AND table_name IN ('invoice','invoice_item','invoice_line','invoice_payment','invoice_receipt')
    ) AS tabellen_vorhanden,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'edoobox_raw' AND table_name = 'invoice') AS spalten_invoice;
