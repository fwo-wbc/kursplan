-- ============================================================================
--  edoobox-Spiegelung  |  S63  |  Version 1.0  |  20.09.2026
--
--  Zweck:
--    1) Schliesst die letzte offene Kostenkonfiguration
--       (WW x sql-gl, Angebot offer_8970c87a9bf7_10381774695).
--    2) Setzt O-10 in dem geforderten Teilumfang um: neue Trainer und neue
--       Trainer-Kurs-Kombinationen werden vollstaendig angelegt, sodass kein
--       neuer Rueckstand aufgebaut wird. Historische Platzhalterprofile
--       (Admin-Kennungen, die nur noch in date_leader vorkommen, nicht aber in
--       der aktuellen Admin-Liste) werden NICHT erfunden und bleiben als
--       P04-Warnung bestehen.
--
--  Idempotent und wiederholbar: kann nach jedem P01/P03-Lauf als
--  Pflegeschritt ausgefuehrt werden. ON CONFLICT verhindert Doppelungen.
--
--  Kontext (Live-Befund 20.09.2026):
--     - offene Kostenkonfigurationen: 1  ->  WW (admin_b0cee0fbd81a_419145525)
--       x kurscode 'sql-gl', Prognose-Termin 2026-10-05, Netto 674,00 EUR,
--       Profil tarif_1 = 300,00 EUR ohne Trainer-Kurs-Regel.
--     - neuer Trainer ohne Profil: SK (admin_de48c044978d_310370820).
--     - historische Admin-Kennungen (unveraendert offen, O-10): 3 Kennungen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1  Neue Trainerprofile vollstaendig anlegen (nur aktuelle Admin-Liste).
--    Fremdtrainer-Vorbelegung wie in S59a: tarif_1 = 270, tarif_2 = 370,
--    mit Pruefhinweis. Historische Kennungen (nur in date_leader) sind hier
--    nicht enthalten, da ausschliesslich edoobox_raw.trainer_admin gelesen wird.
-- ----------------------------------------------------------------------------
INSERT INTO kursplan.trainer_kostenprofil_admin
    (admin_id, trainer_code, kostenrolle, tarif_1, tarif_2, standard_tarif,
     ist_aktiv, bemerkung, geaendert_am)
SELECT
    ta.admin_id,
    coalesce(nullif(btrim(ta.shortcut), ''), ta.admin_id),
    'fremd',
    270.00,
    370.00,
    NULL,
    true,
    'S63: neu angelegt; Kostenrolle und Tarife vor Verwendung pruefen',
    now()
FROM edoobox_raw.trainer_admin ta
WHERE ta.is_deleted = false
  AND NOT EXISTS (
      SELECT 1
      FROM kursplan.trainer_kostenprofil_admin p
      WHERE p.admin_id = ta.admin_id
  )
ON CONFLICT (admin_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2  Offene Fremdtrainer-Kurs-Kombinationen vollstaendig regeln.
--    Jede kostenaktive, kostenrelevante Fremdtrainer-Zuordnung ohne Regel,
--    ohne Standardtarif und ohne Einzelausnahme erhaelt eine Regel auf tarif_1.
--    Dies schliesst die offene Konfiguration WW x sql-gl und verhindert, dass
--    kuenftige neue Kurscodes offen bleiben.
-- ----------------------------------------------------------------------------
INSERT INTO kursplan.trainer_kurs_tarifregel
    (admin_id, kurscode, tarif, trainerkosten_override,
     ist_aktiv, bemerkung, geaendert_am)
SELECT
    k.admin_id,
    k.kurscode,
    'tarif_1',
    NULL,
    true,
    'S63: neu angelegte Regel; Tarif pruefen (Standard tarif_1)',
    now()
FROM kursplan.v_angebot_trainerkosten k
WHERE k.date_start >= timestamp '2023-01-01'
  AND k.kostenkonfiguration_fehlt
  AND k.kostenrolle = 'fremd'
  AND k.standard_tarif IS NULL
  AND k.verwendeter_tarif IS NULL
  AND k.verwendeter_override IS NULL
GROUP BY k.admin_id, k.kurscode
ON CONFLICT (admin_id, kurscode) DO UPDATE
SET tarif = 'tarif_1',
    trainerkosten_override = NULL,
    ist_aktiv = true,
    bemerkung = EXCLUDED.bemerkung,
    geaendert_am = now();

-- ----------------------------------------------------------------------------
-- 3  Kontrolle
-- ----------------------------------------------------------------------------
WITH offen AS (
    SELECT
        count(*) AS anzahl,
        round(coalesce(sum(netto_gebucht), 0), 2) AS netto
    FROM kursplan.v_termin_db1
    WHERE date_start >= timestamp '2023-01-01'
      AND kosten_aktiv
      AND kostenkonfiguration_fehlt
),
neue_profile AS (
    SELECT count(*) AS anzahl
    FROM kursplan.trainer_kostenprofil_admin
    WHERE bemerkung LIKE '%S63%'
),
neue_regeln AS (
    SELECT count(*) AS anzahl
    FROM kursplan.trainer_kurs_tarifregel
    WHERE bemerkung LIKE '%S63%'
),
db AS (
    SELECT
        count(*) FILTER (WHERE kosten_aktiv)                        AS kostenaktive_angebote,
        round(sum(netto_gebucht), 2)                                AS netto,
        round(sum(trainerkosten), 2)                                AS trainerkosten,
        round(sum(plattformkosten), 2)                              AS plattformkosten,
        round(sum(direkte_kosten), 2)                               AS direkte_kosten,
        round(sum(db1), 2)                                          AS db1
    FROM kursplan.v_termin_db1
    WHERE date_start >= timestamp '2023-01-01'
)
SELECT
    'S63'::text AS schritt,
    'A Kontrolle'::text AS bereich,
    'offene Kostenkonfigurationen'::text AS kennzahl,
    o.anzahl::numeric AS wert,
    concat('Netto ', o.netto) AS hinweis
FROM offen o

UNION ALL SELECT 'S63', 'B Neue Profile', 'neu angelegte Trainerprofile', p.anzahl, 'idempotent' FROM neue_profile p

UNION ALL SELECT 'S63', 'C Neue Regeln', 'neu angelegte Trainer-Kurs-Regeln', r.anzahl, 'tarif_1 als Standard' FROM neue_regeln r

UNION ALL SELECT 'S63', 'D DB I', 'vollstaendig berechenbar',
       d.kostenaktive_angebote::numeric,
       concat('Netto ', d.netto,
              ' / Trainer ', d.trainerkosten,
              ' / Plattform ', d.plattformkosten,
              ' / direkte Kosten ', d.direkte_kosten,
              ' / DB I ', d.db1)
FROM db d

ORDER BY bereich;
