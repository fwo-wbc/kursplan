-- Sichten fuer Zuordnung und Steuer. Version 1.0
-- Auszufuehren mit dem Verwaltungskonto kursplan_user.
-- Sichten statt Tabellen, damit die Zuordnung nicht veralten kann.

-- ---------------------------------------------------------------
-- 1. Zuordnung Buchung zu Rechnung
-- Grundlage ist invoice_item.transaction_id, also der harte Verweis.
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW kursplan.v_buchung_rechnung AS
WITH paar AS (
    SELECT DISTINCT
        t.booking_id,
        i.invoice_id
    FROM edoobox_raw.invoice_item i
    JOIN edoobox_raw.booking_transaction t
      ON t.transaction_id = i.transaction_id
),
je_rechnung AS (
    SELECT invoice_id, count(*) AS buchungen FROM paar GROUP BY invoice_id
),
je_buchung AS (
    SELECT booking_id, count(*) AS rechnungen FROM paar GROUP BY booking_id
)
SELECT
    p.booking_id,
    p.invoice_id,
    r.buchungen        AS buchungen_der_rechnung,
    b.rechnungen       AS rechnungen_der_buchung,
    CASE
        WHEN r.buchungen = 1 THEN 'eindeutig'
        WHEN r.buchungen BETWEEN 2 AND 5 THEN 'geschlossener_kurs'
        ELSE 'sammelrechnung'
    END::text          AS zuordnungsgrad,
    (b.rechnungen > 1) AS mehrere_rechnungen
FROM paar p
JOIN je_rechnung r ON r.invoice_id = p.invoice_id
JOIN je_buchung  b ON b.booking_id = p.booking_id;

COMMENT ON VIEW kursplan.v_buchung_rechnung IS
'Zuordnung ueber invoice_item.transaction_id. zuordnungsgrad unterscheidet Einzel-, Kurs- und Sammelrechnung.';

-- ---------------------------------------------------------------
-- 2. Steuer und Erloes je Buchung
-- Der gemessene Faktor brutto zu netto ist die Wahrheit,
-- der Nominalsatz aus der Rechnung nur Einordnung.
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW kursplan.v_buchung_steuer AS
WITH netto AS (
    SELECT
        booking_id,
        sum(amount_net * coalesce(quantity, 1)) AS netto,
        sum(coalesce(quantity, 1))              AS plaetze,
        count(*)                                AS positionen
    FROM edoobox_raw.booking_position
    GROUP BY booking_id
),
brutto AS (
    SELECT
        booking_id,
        sum(amount)      AS brutto,
        count(*)         AS vorgaenge,
        min(currency)    AS waehrung
    FROM edoobox_raw.booking_transaction
    GROUP BY booking_id
),
nominal AS (
    SELECT
        t.booking_id,
        max(i.vat_percent) AS nominalsatz,
        bool_or(i.item_type = 't_manualtrans') AS hat_manuellen_posten
    FROM edoobox_raw.booking_transaction t
    JOIN edoobox_raw.invoice_item i ON i.transaction_id = t.transaction_id
    GROUP BY t.booking_id
)
SELECT
    b.booking_id,
    b.offer_id,
    b.status,
    b.booking_time,
    b.is_b2b,
    coalesce(br.waehrung, 'EUR')::char(3) AS waehrung,
    n.netto,
    n.plaetze,
    n.positionen,
    br.brutto,
    br.vorgaenge,
    nm.nominalsatz,
    CASE WHEN n.netto > 0 AND br.brutto IS NOT NULL
         THEN round(br.brutto / n.netto, 3) END AS faktor,
    CASE WHEN n.netto > 0 AND br.brutto IS NOT NULL
         THEN round((br.brutto / n.netto - 1) * 100, 2) END AS satz_gemessen,
    CASE WHEN br.brutto IS NOT NULL AND n.netto IS NOT NULL
         THEN round(br.brutto - n.netto, 2) END AS steuerbetrag,
    -- Einordnung des gemessenen Satzes
    CASE
        WHEN n.netto IS NULL OR n.netto <= 0 OR br.brutto IS NULL THEN 'unbestimmt'
        WHEN abs(br.brutto / n.netto - 1.000) <= 0.002 THEN 'ohne_steuer'
        WHEN abs(br.brutto / n.netto - 1.250) <= 0.002 THEN 'dk_25'
        WHEN abs(br.brutto / n.netto - 1.190) <= 0.002 THEN 'de_19'
        WHEN abs(br.brutto / n.netto - 1.160) <= 0.002 THEN 'de_16'
        WHEN abs(br.brutto / n.netto - 1.200) <= 0.002 THEN 'at_20'
        WHEN abs(br.brutto / n.netto - 1.081) <= 0.002 THEN 'ch_81'
        WHEN abs(br.brutto / n.netto - 1.077) <= 0.002 THEN 'ch_77'
        ELSE 'abweichend'
    END::text AS steuerfall,
    nm.hat_manuellen_posten
FROM edoobox_raw.booking b
LEFT JOIN netto   n  ON n.booking_id  = b.booking_id
LEFT JOIN brutto  br ON br.booking_id = b.booking_id
LEFT JOIN nominal nm ON nm.booking_id = b.booking_id
WHERE b.is_deleted IS NOT TRUE;

COMMENT ON VIEW kursplan.v_buchung_steuer IS
'Netto aus booking_position, brutto aus booking_transaction. satz_gemessen ist die abgerechnete Steuer, nominalsatz nur der hinterlegte Satz der Preiskategorie.';
COMMENT ON COLUMN kursplan.v_buchung_steuer.steuerfall IS
'ohne_steuer entspricht Reverse Charge oder Nullsatz. abweichend deutet auf Teilzahlung oder Gutschrift.';

-- ---------------------------------------------------------------
-- 3. Erloes je Kurstermin
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW kursplan.v_termin_erloes AS
SELECT
    o.offer_id,
    o.offer_number,
    o.name,
    o.offerdef_ref,
    o.date_start,
    o.date_end,
    o.user_minimal,
    o.user_maximum,
    o.status                                                   AS termin_status,
    count(*) FILTER (WHERE s.status = 'gebucht')               AS buchungen_gebucht,
    count(*) FILTER (WHERE s.status = 'storniert')             AS buchungen_storniert,
    count(*) FILTER (WHERE s.status = 'warteliste')            AS buchungen_warteliste,
    coalesce(sum(s.plaetze) FILTER (WHERE s.status = 'gebucht'), 0)      AS plaetze_gebucht,
    round(coalesce(sum(s.netto)  FILTER (WHERE s.status = 'gebucht'), 0), 2) AS netto_gebucht,
    round(coalesce(sum(s.brutto) FILTER (WHERE s.status = 'gebucht'), 0), 2) AS brutto_gebucht,
    CASE WHEN o.user_maximum > 0
         THEN round(100.0 * coalesce(sum(s.plaetze) FILTER (WHERE s.status = 'gebucht'), 0)
                    / o.user_maximum, 1) END                   AS auslastung_prozent,
    (SELECT count(DISTINCT vr.invoice_id)
       FROM kursplan.v_buchung_rechnung vr
       JOIN edoobox_raw.booking bb ON bb.booking_id = vr.booking_id
      WHERE bb.offer_id = o.offer_id)                          AS rechnungen
FROM edoobox_raw.offer o
LEFT JOIN kursplan.v_buchung_steuer s ON s.offer_id = o.offer_id
WHERE o.is_deleted IS NOT TRUE
GROUP BY o.offer_id, o.offer_number, o.name, o.offerdef_ref,
         o.date_start, o.date_end, o.user_minimal, o.user_maximum, o.status;

COMMENT ON VIEW kursplan.v_termin_erloes IS
'Erloes und Auslastung je Kurstermin. Grundlage fuer die Deckungsbeitragsrechnung.';

-- ---------------------------------------------------------------
-- 4. Rechte
-- ---------------------------------------------------------------
GRANT SELECT ON
    kursplan.v_buchung_rechnung,
    kursplan.v_buchung_steuer,
    kursplan.v_termin_erloes
TO n8n_writer;

-- Kontrolle
SELECT
    (SELECT count(*) FROM information_schema.views
      WHERE table_schema = 'kursplan'
        AND table_name IN ('v_buchung_rechnung','v_buchung_steuer','v_termin_erloes')) AS sichten,
    (SELECT count(*) FROM kursplan.v_buchung_rechnung)  AS zuordnungen,
    (SELECT count(*) FROM kursplan.v_buchung_steuer)    AS buchungen,
    (SELECT count(*) FROM kursplan.v_termin_erloes)     AS termine;
