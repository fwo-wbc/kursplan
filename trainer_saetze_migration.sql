-- ============================================================================
--  Kursplan  |  Migrationsdatei  |  Trainer-Tages- und Stundensaetze  |  26.09.2026
-- ----------------------------------------------------------------------------
--  Zweck:
--    Erweitert die bestehende Tabelle public.trainer um die lokale Pflege der
--    Trainer-Verguetungssaetze:
--
--      * tagessatz    numerischer Tageshonorarsatz in EUR (netto), DECIMAL(10,2)
--      * stundensatz  numerischer Stundenhonorarsatz in EUR (netto), DECIMAL(10,2)
--
--  Fachlicher Kontext (Lastenheft Kursplan v1.6):
--    S-07a sieht je Trainer mindestens fuenf frei benannte Kostenkategorien mit
--    Nettobetrag und Standard-Kennzeichen vor (z. B. "halber Tag", "pro Stunde",
--    "verminderter Satz", "Abendkurs"). Die hier ergaenzten Spalten bilden die
--    beiden haeufigsten Faelle (Tages- und Stundensatz) als einfache, direkt am
--    Trainer gepflegte Felder ab. Erweiterte, frei benannte Kategorien sind im
--    App-Schema ueber kursplan.trainer_kostenkategorie abgebildet (kursplan_app_schema.sql).
--
--  Ausfuehrung:
--    Als Verwaltungskonto mit DDL-Rechten (z. B. kursplan_user) ausfuehren.
--    Die Datei ist idempotent und kann mehrfach ausgefuehrt werden.
-- ============================================================================

ALTER TABLE public.trainer
    ADD COLUMN IF NOT EXISTS tagessatz   numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS stundensatz numeric(10,2) NOT NULL DEFAULT 0;

-- Nichts negative Saetze. Idempotent ueber eine DO-Anweisung, da
-- ADD CONSTRAINT kein IF NOT EXISTS kennt.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'trainer_tagessatz_chk'
          AND conrelid = 'public.trainer'::regclass
    ) THEN
        ALTER TABLE public.trainer
            ADD CONSTRAINT trainer_tagessatz_chk CHECK (tagessatz >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'trainer_stundensatz_chk'
          AND conrelid = 'public.trainer'::regclass
    ) THEN
        ALTER TABLE public.trainer
            ADD CONSTRAINT trainer_stundensatz_chk CHECK (stundensatz >= 0);
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
--  Kontrolle
-- ----------------------------------------------------------------------------
SELECT column_name, data_type, numeric_precision, numeric_scale, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'trainer'
  AND column_name IN ('tagessatz', 'stundensatz')
ORDER BY ordinal_position;