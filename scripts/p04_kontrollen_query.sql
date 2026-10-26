WITH lr AS (
    SELECT
        (SELECT max(finished_at) FROM edoobox_raw.sync_run WHERE run_type = 'P01' AND status = 'erfolgreich') AS last_p01,
        (SELECT max(finished_at) FROM edoobox_raw.sync_run WHERE run_type = 'P02' AND status = 'erfolgreich') AS last_p02,
        (SELECT max(finished_at) FROM edoobox_raw.sync_run WHERE run_type IN ('vollabgleich','P03') AND status = 'erfolgreich') AS last_p03
)
SELECT
    lr.last_p01,
    round(extract(epoch from (now() - lr.last_p01)))::numeric AS p01_alter_sek,
    lr.last_p02,
    round(extract(epoch from (now() - lr.last_p02)))::numeric AS p02_alter_sek,
    lr.last_p03,
    round(extract(epoch from (now() - lr.last_p03)))::numeric AS p03_alter_sek,
    extract(isodow from now() at time zone 'Europe/Berlin')::int AS wochentag,
    extract(hour   from now() at time zone 'Europe/Berlin')::int AS stunde,
    (SELECT count(*) FROM edoobox_raw.offer_date d
       LEFT JOIN edoobox_raw.offer o ON o.offer_id = d.offer_id
      WHERE d.is_deleted IS NOT TRUE AND o.offer_id IS NULL) AS date_ohne_offer,
    (SELECT count(*) FROM edoobox_raw.booking_position p
       LEFT JOIN edoobox_raw.booking b ON b.booking_id = p.booking_id
      WHERE b.booking_id IS NULL) AS position_ohne_buchung,
    (SELECT count(*) FROM edoobox_raw.booking_transaction t
       LEFT JOIN edoobox_raw.booking b ON b.booking_id = t.booking_id
      WHERE b.booking_id IS NULL) AS trans_ohne_buchung,
    -- Historienlücken (Legacy-Stichtagsregelung ab 01.09.2026):
    -- *_aktiv  = Datensätze ab Stichtag ohne Pflichtrelation -> P04-Alarm (strikte Null-Toleranz)
    -- *_legacy = Altdatenbestand vor dem Stichtag            -> kein aktiver Alarm
    (SELECT coalesce(max(anzahl_aktiv), 0)
       FROM kursplan.v_qualitaet_historienluecken
      WHERE kategorie = 'buchung_ohne_offer') AS buchung_ohne_offer_aktiv,
    (SELECT coalesce(max(anzahl_legacy), 0)
       FROM kursplan.v_qualitaet_historienluecken
      WHERE kategorie = 'buchung_ohne_offer') AS buchung_ohne_offer_legacy,
    (SELECT coalesce(max(anzahl_aktiv), 0)
       FROM kursplan.v_qualitaet_historienluecken
      WHERE kategorie = 'leader_ohne_trainer') AS leader_ohne_trainer_aktiv,
    (SELECT coalesce(max(anzahl_legacy), 0)
       FROM kursplan.v_qualitaet_historienluecken
      WHERE kategorie = 'leader_ohne_trainer') AS leader_ohne_trainer_legacy,
    (SELECT coalesce(max(anzahl_aktiv), 0)
       FROM kursplan.v_qualitaet_historienluecken
      WHERE kategorie = 'attendance_ohne_termin') AS attendance_ohne_termin_aktiv,
    (SELECT coalesce(max(anzahl_legacy), 0)
       FROM kursplan.v_qualitaet_historienluecken
      WHERE kategorie = 'attendance_ohne_termin') AS attendance_ohne_termin_legacy,
    (SELECT count(*) FILTER (WHERE kostenkonfiguration_fehlt)
       FROM kursplan.v_termin_db1
      WHERE date_start >= timestamp '2023-01-01') AS offen_kosten,
    (SELECT count(*) FILTER (WHERE NOT kostenkonfiguration_fehlt)
       FROM kursplan.v_termin_db1
      WHERE date_start >= timestamp '2023-01-01') AS berechenbare_angebote,
    (SELECT round(sum(netto_gebucht), 2)
       FROM kursplan.v_termin_db1
      WHERE date_start >= timestamp '2023-01-01' AND NOT kostenkonfiguration_fehlt) AS netto,
    (SELECT round(sum(trainerkosten), 2)
       FROM kursplan.v_termin_db1
      WHERE date_start >= timestamp '2023-01-01' AND NOT kostenkonfiguration_fehlt) AS trainerkosten,
    (SELECT round(sum(plattformkosten), 2)
       FROM kursplan.v_termin_db1
      WHERE date_start >= timestamp '2023-01-01' AND NOT kostenkonfiguration_fehlt) AS plattformkosten,
    (SELECT round(sum(direkte_kosten), 2)
       FROM kursplan.v_termin_db1
      WHERE date_start >= timestamp '2023-01-01' AND NOT kostenkonfiguration_fehlt) AS direkte_kosten,
    (SELECT round(sum(db1), 2)
       FROM kursplan.v_termin_db1
      WHERE date_start >= timestamp '2023-01-01' AND NOT kostenkonfiguration_fehlt) AS db1,
    (SELECT count(*) FROM kursplan.v_termin_db1 t
      WHERE t.date_start >= timestamp '2023-01-01'
        AND t.kosten_aktiv
        AND NOT EXISTS (
            SELECT 1 FROM edoobox_raw.offer_date d
            JOIN edoobox_raw.date_leader dl ON dl.date_id = d.date_id
            WHERE d.offer_id = t.offer_id AND d.is_deleted IS NOT TRUE
        )) AS angebote_ohne_trainer
FROM lr;