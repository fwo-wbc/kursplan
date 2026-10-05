-- ============================================================================
--  Einmalige Migration: Zuweisungsstatus von public.trainer_zuweisung
--  Stand: September 2026
--
--  Bestandteil 1a + Regelbetrieb 1b:
--    1. Künftige Neuanlagen werden IMMER mit status = 'offen' initialisiert
--       (auch bei Kursstatus '2'). Dafür wird der Spalten-Default umgestellt.
--    2. Einmalige Bestandsbereinigung: status = 'bestaetigt' ausschliesslich
--       dann, wenn das zugehörige Angebot offer.status = '2'
--       ("Durchführung garantiert") ist; in allen übrigen Fällen 'offen'.
--
--  Auszuführen als: kursplan_user
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Default für künftige Neuanlagen: IMMER 'offen'.
--    Hinweis: schema_app.sql legte ursprünglich DEFAULT 'angefragt' fest.
--    Die Neuanlage erfolgt ausschliesslich über POST /api/zuweisung; dieser
--    DDL-Default ist die DB-seitige Absicherung für den Regelbetrieb.
-- ----------------------------------------------------------------------------
ALTER TABLE public.trainer_zuweisung
    ALTER COLUMN status SET DEFAULT 'offen';

-- ----------------------------------------------------------------------------
-- 2. Einmalige Daten-Migration (Bestandsbereinigung).
--    Übriggebliebene NULL-Werte werden nach dem Update nicht erwartet; für
--    künftige Inserts greift der Default aus Schritt 1.
-- ----------------------------------------------------------------------------

-- 2a) Zuweisungen mit Angebotsbezug:
--     bestaetigt nur bei offer.status = '2', sonst 'offen'.
UPDATE public.trainer_zuweisung AS tz
SET status = CASE WHEN o.status = '2' THEN 'bestaetigt' ELSE 'offen' END
FROM edoobox_raw.offer_date AS od
JOIN edoobox_raw.offer AS o ON o.offer_id = od.offer_id
WHERE tz.date_id = od.date_id;

-- 2b) Fallback: Zuweisungen ohne zuordenbaren Termin/Angebot -> 'offen'.
UPDATE public.trainer_zuweisung AS tz
SET status = 'offen'
WHERE NOT EXISTS (
    SELECT 1
    FROM edoobox_raw.offer_date AS od
    WHERE od.date_id = tz.date_id
);

-- ----------------------------------------------------------------------------
-- 3. Selbstkontrolle
-- ----------------------------------------------------------------------------
SELECT
    status,
    count(*) AS anzahl
FROM public.trainer_zuweisung
GROUP BY status
ORDER BY status;