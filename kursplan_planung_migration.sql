-- ===========================================================================
-- kursplan_planung_migration.sql
-- Gemeinsame Planungstabelle mit planungsbereich-Attribut + Sichten.
--
-- Zweck:
--   Abloesung der Excel-Planungstabellen (Kurstransfer-MS-Office, -MS365,
--   -SQL, -werner-sql-lo-office) durch eine gemeinsame Datentabelle.
--   Jede Zeile ist ein geplanter Kurstermin. Der planungsbereich ordnet die
--   Zeile einer der bisherigen Excel-Dateien zu; eine Sicht je Bereich
--   bildet die bisherige Datei ab. Neue Bereiche sind ohne Migration
--   ergaenzbar (nur planungsbereich-Wert + Sicht).
--
-- Belegungsregel (Excel-Logik):
--   Pro Tag und Bereich max. 3 Kurse, einer je Prioritaet (1, 2, 3).
--   Erzwungen durch UNIQUE (planungsbereich, datum, prio).
--
-- Schema-Trennung: public = lokale App-Daten. Kein Bezug zu edoobox_raw.
-- Idempotent ausfuehrbar.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Planungstabelle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kursplan_termin (
    id               bigserial PRIMARY KEY,
    planungsbereich  text        NOT NULL,
    datum            date        NOT NULL,
    beginn           time        NOT NULL,
    topic_id         integer     NOT NULL REFERENCES public.course_topics (id),
    prio             smallint    NOT NULL,
    hinweis          text,
    freigabe         boolean     NOT NULL DEFAULT false,
    sync_status      text        NOT NULL DEFAULT 'offen',
    edoobox_offer_id text,
    kurs_key         text,
    created_at       timestamptz NOT NULL DEFAULT NOW(),
    updated_at       timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT kursplan_termin_prio_chk  CHECK (prio BETWEEN 1 AND 3),
    CONSTRAINT kursplan_termin_sync_chk
        CHECK (sync_status IN ('offen', 'uebertragen', 'fehler')),
    CONSTRAINT kursplan_termin_uq
        UNIQUE (planungsbereich, datum, prio)
);

-- Schnelle Abfragen je Bereich und Zeitraum (Planungsansicht).
CREATE INDEX IF NOT EXISTS kursplan_termin_bereich_datum_idx
    ON public.kursplan_termin (planungsbereich, datum);

CREATE INDEX IF NOT EXISTS kursplan_termin_topic_idx
    ON public.kursplan_termin (topic_id);

CREATE INDEX IF NOT EXISTS kursplan_termin_sync_idx
    ON public.kursplan_termin (sync_status)
    WHERE sync_status <> 'uebertragen';

-- ---------------------------------------------------------------------------
-- 2. Generische Sicht (alle Bereiche, mit Themen-Stammdaten)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_kursplan_termin AS
SELECT
    kt.id,
    kt.planungsbereich,
    kt.datum,
    kt.beginn,
    kt.prio,
    kt.topic_id,
    ct.name            AS thema,
    ct.kurs_code,
    ct.kategorie_id,
    ct.kategorie_name,
    ct.vorlage_offer_id,
    ct.prioritaet      AS thema_prioritaet,
    ct.rhythmus_wochen,
    kt.hinweis,
    kt.freigabe,
    kt.sync_status,
    kt.edoobox_offer_id,
    kt.kurs_key,
    kt.created_at,
    kt.updated_at
FROM public.kursplan_termin kt
JOIN public.course_topics ct ON ct.id = kt.topic_id;

-- ---------------------------------------------------------------------------
-- 3. Sicht je Planungsbereich (bisherige Excel-Dateien)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_kursplan_ms_office AS
SELECT * FROM public.v_kursplan_termin
WHERE planungsbereich = 'MS-Office';

CREATE OR REPLACE VIEW public.v_kursplan_ms365 AS
SELECT * FROM public.v_kursplan_termin
WHERE planungsbereich = 'MS365';

CREATE OR REPLACE VIEW public.v_kursplan_sql AS
SELECT * FROM public.v_kursplan_termin
WHERE planungsbereich = 'SQL';

CREATE OR REPLACE VIEW public.v_kursplan_werner AS
SELECT * FROM public.v_kursplan_termin
WHERE planungsbereich = 'werner-sql-lo-office';

COMMENT ON TABLE public.kursplan_termin IS
    'Gemeinsame Planungstabelle (Abloesung der Excel-Planungstabellen). '
    'Eine Zeile je geplantem Kurstermin; planungsbereich ordnet der '
    'bisherigen Excel-Datei zu. Max. 3 Kurse je Tag und Bereich '
    '(einer je Prioritaet).';