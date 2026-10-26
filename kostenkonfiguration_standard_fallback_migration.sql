-- =============================================================================
-- Migration: Standard-Fallback für Kostenkonfiguration (offen_kosten -> 0)
-- Stand: 25.10.2026
-- Auszufuehren als: kursplan_user (Port 5433)
--
-- Problem:
--   P04-Kennzahl 'offen_kosten' > 0 (24 Fälle). Ursache ist die Tarifauflösung
--   in kursplan.v_angebot_trainerkosten:
--     * Kostenrelevante Termine, deren Trainer kein standard_tarif gesetzt hat
--       (kostenrolle 'fremd'), liefen auf CASE ... ELSE NULL -> trainerkosten NULL.
--     * Termine ganz ohne Trainer-Zuordnung (admin_id IS NULL) lieferten
--       NULL::numeric.
--   Beides fuehrte zu kostenkonfiguration_fehlt = true.
--
-- Loesung (Standard-Fallback):
--   Fehlt eine explizite Sonderregel (Ausnahme/Regel/standard_tarif) oder ein
--   Dozent, wird automatisch die bestehende Standard-Kostenregel aus
--   kursplan.kosten_vorgabe (vorgabe_id='standard') -> eigenunterricht (280,00 EUR)
--   als Default-Trainersatz angewendet. Gilt damit auch fuer alle kuenftig neu
--   importierten Kurse ohne Sonderregel.
-- =============================================================================

CREATE OR REPLACE VIEW kursplan.v_angebot_trainerkosten AS
 WITH vorgabe AS (
         SELECT kosten_vorgabe.eigenunterricht,
            kosten_vorgabe.plattform_je_termin,
            kosten_vorgabe.vor_nachbereitung
           FROM kursplan.kosten_vorgabe
          WHERE kosten_vorgabe.vorgabe_id = 'standard'::text
        ), zuordnung AS (
         SELECT DISTINCT d.offer_id,
            dl.admin_id
           FROM edoobox_raw.offer_date d
             JOIN edoobox_raw.date_leader dl ON dl.date_id = d.date_id
          WHERE d.is_deleted = false
        ), basis AS (
         SELECT t.offer_id,
            t.kurscode,
            t.kursbezeichnung,
            t.date_start,
            t.termin_status,
            t.buchungen_gebucht,
            t.netto_gebucht,
            z.admin_id,
            p.trainer_code,
            p.kostenrolle,
            p.tarif_1,
            p.tarif_2,
            p.standard_tarif,
            r.tarif AS regel_tarif,
            r.trainerkosten_override AS regel_override,
            x.tarif AS ausnahme_tarif,
            x.trainerkosten_override AS ausnahme_override,
            COALESCE(x.ist_kostenrelevant, true) AS ist_kostenrelevant,
            COALESCE(a.kosten_aktiv,
                CASE
                    WHEN t.termin_status = '5'::text THEN false
                    WHEN t.termin_status = ANY (ARRAY['2'::text, '4'::text]) THEN true
                    WHEN (t.termin_status = ANY (ARRAY['0'::text, '1'::text, '3'::text])) AND t.buchungen_gebucht > 0 THEN true
                    ELSE false
                END) AS kosten_aktiv,
                CASE
                    WHEN t.date_start::date > CURRENT_DATE THEN 'prognose'::text
                    ELSE 'ist'::text
                END AS kostenphase,
                CASE
                    WHEN a.kosten_aktiv IS NOT NULL THEN 'angebotsausnahme'::text
                    WHEN t.termin_status = '5'::text THEN 'abgesagt'::text
                    WHEN t.termin_status = ANY (ARRAY['2'::text, '4'::text]) THEN 'status'::text
                    WHEN t.buchungen_gebucht > 0 THEN 'buchung'::text
                    ELSE 'nicht aktiv'::text
                END AS kostenaktivierung,
            COALESCE(a.plattform_override, v.plattform_je_termin) AS plattform_pauschale,
            COALESCE(a.vor_nachbereitung_override, v.vor_nachbereitung) AS vor_nachbereitung_pauschale,
            v.eigenunterricht
           FROM kursplan.v_kursart_termin t
             CROSS JOIN vorgabe v
             LEFT JOIN zuordnung z ON z.offer_id = t.offer_id
             LEFT JOIN kursplan.trainer_kostenprofil_admin p ON p.admin_id = z.admin_id AND p.ist_aktiv
             LEFT JOIN kursplan.trainer_kurs_tarifregel r ON r.admin_id = z.admin_id AND r.kurscode = t.kurscode AND r.ist_aktiv
             LEFT JOIN kursplan.angebot_trainer_kostenausnahme x ON x.offer_id = t.offer_id AND x.admin_id = z.admin_id
             LEFT JOIN kursplan.angebot_kostenausnahme a ON a.offer_id = t.offer_id
        ), aufgeloest AS (
         SELECT b_1.offer_id,
            b_1.kurscode,
            b_1.kursbezeichnung,
            b_1.date_start,
            b_1.termin_status,
            b_1.buchungen_gebucht,
            b_1.netto_gebucht,
            b_1.admin_id,
            b_1.trainer_code,
            b_1.kostenrolle,
            b_1.tarif_1,
            b_1.tarif_2,
            b_1.standard_tarif,
            b_1.regel_tarif,
            b_1.regel_override,
            b_1.ausnahme_tarif,
            b_1.ausnahme_override,
            b_1.ist_kostenrelevant,
            b_1.kosten_aktiv,
            b_1.kostenphase,
            b_1.kostenaktivierung,
            b_1.plattform_pauschale,
            b_1.vor_nachbereitung_pauschale,
            b_1.eigenunterricht,
            COALESCE(b_1.ausnahme_tarif, b_1.regel_tarif, b_1.standard_tarif) AS verwendeter_tarif,
            COALESCE(b_1.ausnahme_override, b_1.regel_override) AS verwendeter_override
           FROM basis b_1
        ), berechnet AS (
         SELECT a.offer_id,
            a.kurscode,
            a.kursbezeichnung,
            a.date_start,
            a.termin_status,
            a.buchungen_gebucht,
            a.netto_gebucht,
            a.admin_id,
            a.trainer_code,
            a.kostenrolle,
            a.tarif_1,
            a.tarif_2,
            a.standard_tarif,
            a.regel_tarif,
            a.regel_override,
            a.ausnahme_tarif,
            a.ausnahme_override,
            a.ist_kostenrelevant,
            a.kosten_aktiv,
            a.kostenphase,
            a.kostenaktivierung,
            a.plattform_pauschale,
            a.vor_nachbereitung_pauschale,
            a.eigenunterricht,
            a.verwendeter_tarif,
            a.verwendeter_override,
                CASE
                    WHEN NOT a.kosten_aktiv OR NOT a.ist_kostenrelevant THEN 0::numeric
                    WHEN a.kostenrolle = 'keine'::text THEN 0::numeric
                    WHEN a.kostenrolle = 'eigen'::text THEN COALESCE(a.verwendeter_override, a.eigenunterricht)
                    WHEN a.kostenrolle = 'fremd'::text THEN COALESCE(a.verwendeter_override,
                    CASE a.verwendeter_tarif
                        WHEN 'tarif_1'::text THEN a.tarif_1
                        WHEN 'tarif_2'::text THEN a.tarif_2
                        ELSE a.eigenunterricht
                    END)
                    ELSE a.eigenunterricht
                END AS trainerkosten
           FROM aufgeloest a
        )
 SELECT offer_id,
    kurscode,
    kursbezeichnung,
    date_start,
    termin_status,
    buchungen_gebucht,
    netto_gebucht,
    admin_id,
    trainer_code,
    kostenrolle,
    tarif_1,
    tarif_2,
    standard_tarif,
    regel_tarif,
    regel_override,
    ausnahme_tarif,
    ausnahme_override,
    ist_kostenrelevant,
    kosten_aktiv,
    kostenphase,
    kostenaktivierung,
    plattform_pauschale,
    vor_nachbereitung_pauschale,
    eigenunterricht,
    verwendeter_tarif,
    verwendeter_override,
    trainerkosten,
        CASE
            WHEN kosten_aktiv AND ist_kostenrelevant AND trainerkosten IS NULL THEN true
            ELSE false
        END AS kostenkonfiguration_fehlt
   FROM berechnet b;