-- =============================================================================
--  Einmalige Bestandsbereinigung: Trainer-Zuweisung anhand der korrekten
--  Edoobox-Leiterdaten ausrichten.
--  Stand: September 2026
--
--  URSACHE:
--    * Der tatsaechliche Kursleiter steht in edoobox_raw.date_leader
--      (n:m-Ablage: date_id, admin_id, last_synced_at), wird in P90 aus
--      date.leader[] abgeleitet. Er liegt NICHT in offer_date (kein
--      leader_admin_id, kein payload) und NICHT in offer.payload.
--    * Durch fruehere fehlerhafte Syncs/Manuell-Eingaben wurden einzelne
--      public.trainer_zuweisung-Zeilen auf den Angebotsersteller FW
--      (trainer_id = 1) gesetzt, obwohl der Leiter laut Edoobox ein anderer
--      Admin ist.
--    * Zusaetzlich koennen in date_leader veraltete Leiter-Zeilen liegen
--      bleiben (alter Leiter FW neben dem aktuellen Leiter FK), wenn ein
--      Leiterwechsel nicht aus dem Spiegelstand entfernt wurde.
--
--  WIRKUNG:
--    1. public.trainer_zuweisung wird je Termin auf den Admin mit dem
--       juengsten last_synced_at in date_leader ausgerichtet.
--    2. Veraltete date_leader-Zeilen (aelterer last_synced_at bei
--       identischem date_id) werden entfernt.
--
--  Auszufuehren als: kursplan_user
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.trainer_zuweisung an den korrekt ermittelten Edoobox-Leiter
--    anpassen. Massgeblich ist je Termin der Admin mit dem juengsten
--    last_synced_at (aktueller Spiegelstand).
-- ----------------------------------------------------------------------------
WITH soll AS (
    SELECT DISTINCT ON (dl.date_id)
           dl.date_id,
           pt.id AS soll_trainer_id
    FROM edoobox_raw.date_leader dl
    JOIN public.trainer pt ON pt.edoobox_admin_id = dl.admin_id
    ORDER BY dl.date_id, dl.last_synced_at DESC, pt.id
)
UPDATE public.trainer_zuweisung AS tz
SET trainer_id = soll.soll_trainer_id,
    updated_at = NOW()
FROM soll
WHERE tz.date_id = soll.date_id
  AND tz.trainer_id IS DISTINCT FROM soll.soll_trainer_id;

-- ----------------------------------------------------------------------------
-- 2. Veraltete date_leader-Zeilen entfernen: Wird fuer denselben Termin ein
--    neuerer Spiegelstand gehalten, ist die aeltere Leiter-Zeile obsolet.
-- ----------------------------------------------------------------------------
DELETE FROM edoobox_raw.date_leader AS alt
WHERE EXISTS (
    SELECT 1
    FROM edoobox_raw.date_leader AS neu
    WHERE neu.date_id = alt.date_id
      AND neu.last_synced_at > alt.last_synced_at
);

-- ----------------------------------------------------------------------------
-- 3. Selbstkontrolle
-- ----------------------------------------------------------------------------
SELECT
    tz.date_id,
    t.kuerzel,
    t.edoobox_admin_id,
    o.offer_number
FROM public.trainer_zuweisung tz
JOIN public.trainer t ON t.id = tz.trainer_id
LEFT JOIN edoobox_raw.offer_date od ON od.date_id = tz.date_id
LEFT JOIN edoobox_raw.offer o ON o.offer_id = od.offer_id
ORDER BY o.offer_number NULLS LAST, tz.date_id;

COMMIT;