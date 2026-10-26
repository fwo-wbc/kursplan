-- =============================================================================
-- legacy_data_dod_migration.sql
-- Verbindliche Stichtags-Regelung für den Datenstand (Definition of Done).
--
-- Anlass:
--   P04 meldet drei Historienlücken als Anomalien, obwohl es sich um Bestände
--   aus der Zeit VOR dem einheitlichen Regelbetrieb (erster Vollabgleich am
--   05.09.2026) handelt:
--     1. 87 Buchungen ohne Angebot        (booking.booking_time: 2020 .. 2025-09-11)
--     2. 10 Trainer-/Leads ohne Profil    (date_leader; Termine 2020..2021)
--     3.  4 Anwesenheiten ohne Termin     (attendance; Termin existiert nicht)
--
-- Regelung:
--   * Stichtag: 2026-09-01 (Beginn des einheitlichen Regelbetriebs).
--   * Alle Datensätze mit fachlichem Referenzdatum VOR dem Stichtag gelten als
--     `is_legacy = true` und werden in den P04-Alarmprüfungen nicht mehr als
--     aktive Lücke gewertet (Altdatenbestand, nicht manuell verfälschen).
--   * Für Datensätze AB dem Stichtag gilt strikte Null-Toleranz: jede fehlende
--     Pflichtrelation ist eine aktive Anomalie.
--
-- Idempotent: CREATE ... IF NOT EXISTS / CREATE OR REPLACE + UPSERT.
-- =============================================================================

-- ---------------------------------------------------------------
-- 1) Stichtags-Konfiguration (zentral, änderbar)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kursplan.datenstand_config (
    schluessel  text          PRIMARY KEY,
    wert        timestamptz   NOT NULL,
    beschreibung text,
    updated_at  timestamptz   NOT NULL DEFAULT now()
);

INSERT INTO kursplan.datenstand_config (schluessel, wert, beschreibung)
VALUES (
    'legacy_stichtag',
    '2026-09-01 00:00:00+02',
    'Verbindlicher Stichtag der Legacy-Regelung: Beginn des einheitlichen Regelbetriebs (erster Vollabgleich 05.09.2026, Monatserster 01.09.2026). Datensätze mit fachlichem Referenzdatum davor sind is_legacy = true und keine aktive Anomalie; ab dem Stichtag gilt strikte Null-Toleranz.'
)
ON CONFLICT (schluessel) DO UPDATE
    SET wert = EXCLUDED.wert,
        beschreibung = EXCLUDED.beschreibung,
        updated_at = now();

-- ---------------------------------------------------------------
-- 2) Zugriffsfunktion (einheitlicher Lesezugriff in Views/Abfragen)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION kursplan.get_legacy_stichtag()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
    SELECT wert FROM kursplan.datenstand_config WHERE schluessel = 'legacy_stichtag'
$$;

-- ---------------------------------------------------------------
-- 3) Qualitäts-View: Historienlücken klassifiziert nach is_legacy
--
--    Ausgabe je Kategorie:
--      anzahl_gesamt : alle betroffenen Datensätze
--      anzahl_legacy : Altdatenbestand vor dem Stichtag (kein aktiver Alarm)
--      anzahl_aktiv  : Datensätze ab Stichtag mit fehlender Pflichtrelation
--                      (strikte Null-Toleranz -> P04-Alarm)
--
--    Referenzdatum je Kategorie:
--      1. buchung_ohne_offer  -> booking.booking_time  (fachliches Buchungsdatum)
--      2. leader_ohne_trainer -> date_start des verknüpften Termins; fehlt der
--                                Termin, gilt der Datensatz als NICHT legacy.
--      3. attendance_ohne_termin -> payload.last_change (letzte fachliche
--                                Änderung in edoobox) bzw. first_seen_at.
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW kursplan.v_qualitaet_historienluecken AS
WITH stichtag AS (
    SELECT kursplan.get_legacy_stichtag() AS ds
),
luecken AS (
    SELECT 'buchung_ohne_offer' AS kategorie,
           b.booking_time AS referenzdatum,
           (b.booking_time < (SELECT ds FROM stichtag)) AS is_legacy
      FROM edoobox_raw.booking b
      LEFT JOIN edoobox_raw.offer o ON o.offer_id = b.offer_id
     WHERE b.is_deleted IS NOT TRUE AND b.offer_id IS NOT NULL AND o.offer_id IS NULL

    UNION ALL

    SELECT 'leader_ohne_trainer' AS kategorie,
           d.date_start AS referenzdatum,
           (d.date_id IS NOT NULL AND d.date_start < (SELECT ds FROM stichtag)) AS is_legacy
      FROM edoobox_raw.date_leader dl
      LEFT JOIN edoobox_raw.trainer_admin a ON a.admin_id = dl.admin_id
      LEFT JOIN edoobox_raw.offer_date d ON d.date_id = dl.date_id
     WHERE a.admin_id IS NULL

    UNION ALL

    SELECT 'attendance_ohne_termin' AS kategorie,
           COALESCE((a.payload->>'last_change')::timestamptz, a.first_seen_at) AS referenzdatum,
           (COALESCE((a.payload->>'last_change')::timestamptz, a.first_seen_at) < (SELECT ds FROM stichtag)) AS is_legacy
      FROM edoobox_raw.attendance a
      LEFT JOIN edoobox_raw.offer_date d ON d.date_id = a.date_id
     WHERE a.is_deleted IS NOT TRUE AND a.date_id IS NOT NULL AND d.date_id IS NULL
)
SELECT kategorie,
       count(*)                                       AS anzahl_gesamt,
       count(*) FILTER (WHERE is_legacy)              AS anzahl_legacy,
       count(*) FILTER (WHERE NOT is_legacy)          AS anzahl_aktiv
  FROM luecken
 GROUP BY kategorie;

-- ---------------------------------------------------------------
-- 4) Rechte für den n8n_writer (Nutzer der P04-Abfrage)
-- ---------------------------------------------------------------
GRANT SELECT ON kursplan.datenstand_config TO n8n_writer;
GRANT EXECUTE ON FUNCTION kursplan.get_legacy_stichtag() TO n8n_writer;
GRANT SELECT ON kursplan.v_qualitaet_historienluecken TO n8n_writer;