-- ===========================================================================
-- kursplan_seed_ms_office.sql
-- Startbestand: 20 MS-Office-Kursdefinitionen in public.course_topics.
--
-- Quelle: app/public/Kurstransfer/Jahres-Kursplanung_MS_Office.py
--         (KURS_DEFINITIONEN) und kategorien_angebote.md.
-- Prioritaeten abgeleitet aus der Wochenstruktur des Python-Skripts:
--   Prio 1 (8): xls-gl-m1, ppt-gl-komp, xls-gl-m2, ppt-ab-komp, out-gl,
--               xls-ab-m1, xls-pivot-komp, out-ab
--   Prio 2 (6): wrd-gl-komp, wrd-ab-komp, xls-gl-m3, xls-umfang,
--               xls-ab-m2, xls-gl-m4
--   Prio 3 (6): wrd-serie, ppt-vb, wrd-dokvorl, wrd-umfang, xls-pq-gl,
--               ppt-ds
-- Rhythmus (Lastenheft S-05): Prio 1+2 = 4 Wochen, Prio 3 = 5 Wochen.
--
-- Idempotent: ON CONFLICT (name) DO UPDATE aktualisiert die Planungsdaten,
-- falls der edoobox-Name bereits vorhanden ist (z. B. durch die
-- automatische Themen-Ableitung).
-- ===========================================================================

INSERT INTO public.course_topics
    (name, kurs_code, kategorie_id, kategorie_name, vorlage_offer_id,
     prioritaet, rhythmus_wochen, planungsbereich, is_active)
VALUES
    -- Prio 1
    ('Excel Grundlagen Modul 1: Basiswissen & KI',
     'xls-gl-m1', 'category_cba26fc247a0_4287075190', 'Excel GL M1',
     'offer_f7d26c266c1a_10079580340', 1, 4, 'MS-Office', true),
    ('PowerPoint Grundlagen (kompakt)',
     'ppt-gl-komp', 'category_86933aca401a_4369230845', 'PowerPoint Grundlagen (kompakt)',
     'offer_2f104b6e01be_10088301940', 1, 4, 'MS-Office', true),
    ('Excel Grundlagen Modul 2: Zeitsparende Techniken, Zahlenformate & KI',
     'xls-gl-m2', 'category_b6c69b49d5cb_5661790135', 'Excel GL M2',
     'offer_47bc0a80c77f_10079671190', 1, 4, 'MS-Office', true),
    ('PowerPoint Aufbau (kompakt)',
     'ppt-ab-komp', 'category_35669a3eef94_7223801440', 'PowerPoint Aufbau (kompakt)',
     'offer_d2ca859ace53_10088374620', 1, 4, 'MS-Office', true),
    ('Outlook Grundlagen (kompakt)',
     'out-gl', 'category_de5473f2a891_4394814205', 'Outlook Grundlagen',
     'offer_17fea7f8061a_10088183835', 1, 4, 'MS-Office', true),
    ('Excel Aufbau Modul 1: Logikfunktionen, XVERWEIS & KI',
     'xls-ab-m1', 'category_d56c2197d695_8247708195', 'Excel AB M1',
     'offer_9ba610263a0f_10079762040', 1, 4, 'MS-Office', true),
    ('Excel: Mit Pivot-Tabellen Daten auswerten (inkl. KI)',
     'xls-pivot-komp', 'category_9db1016f2ef2_4393660410', 'Excel - Pivot-Tabellen (kompakt)',
     'offer_1cc9a9a95915_10154231785', 1, 4, 'MS-Office', true),
    ('Outlook Aufbau (kompakt)',
     'out-ab', 'category_19990b2ab29c_7368525490', 'Outlook Aufbau',
     'offer_1033197d9dc5_10088238345', 1, 4, 'MS-Office', true),

    -- Prio 2
    ('Word Grundlagen (kompakt)',
     'wrd-gl-komp', 'category_3a27e78a1da1_4287084275', 'Word Grundlagen kompakt',
     'offer_bd4938f08741_10088456385', 2, 4, 'MS-Office', true),
    ('Word Aufbau (kompakt)',
     'wrd-ab-komp', 'category_ae4fabfd0acd_4287102445', 'Word Aufbau (kompakt)',
     'offer_b5b0ef7b4410_10088501810', 2, 4, 'MS-Office', true),
    ('Excel Grundlagen Modul 3: Professionelle Datenaufbereitung & KI',
     'xls-gl-m3', 'category_0cb624b43f98_8811714080', 'Excel GL M3',
     'offer_e6eae691d9a1_10154004660', 2, 4, 'MS-Office', true),
    ('Excel: Große Tabellen im Griff',
     'xls-umfang', 'category_2e3b48532c31_4393733090', 'Excel - Große Tabellen',
     'offer_96630b1f47b8_10154186360', 2, 4, 'MS-Office', true),
    ('Excel Aufbau Modul 2: Bedingungen, Logik-Formeln, Diagramme & KI',
     'xls-ab-m2', 'category_d4244a55bc4e_8811704995', 'Excel AB M2',
     'offer_236366f5548c_10154140935', 2, 4, 'MS-Office', true),
    ('Excel Grundlagen Modul 4: Tabellenverknüpfungen, Zellenschutz & KI',
     'xls-gl-m4', 'category_a14bf04a5f66_4989999810', 'Excel GL M4',
     'offer_28e512e190b5_10154077340', 2, 4, 'MS-Office', true),

    -- Prio 3
    ('Word - Seriendruck',
     'wrd-serie', 'category_41b0c0d06429_10460223670', 'Vorlagen für offene Kurse',
     'offer_8d72df08692f_10460260010', 3, 5, 'MS-Office', true),
    ('PowerPoint - Präsentation vorbereiten',
     'ppt-vb', 'category_bd10e8707d87_4422759665', 'PPoint - Eine Präsentation richtig vorbereiten',
     'offer_bfc6b19338a3_10154322635', 3, 5, 'MS-Office', true),
    ('Word - Dokumentvorlagen erstellen',
     'wrd-dokvorl', 'category_15cf432edf8d_5109231350', 'Word - Dokumentvorlagen erstellen',
     'offer_c3eb3432172f_10219916335', 3, 5, 'MS-Office', true),
    ('Word - Umfangreiche Dokumente',
     'wrd-umfang', 'category_a520baeacc58_4391407330', 'Word - Umfangreiche Dokumente',
     'offer_879f1b4ccbfd_10154358975', 3, 5, 'MS-Office', true),
    ('Excel: Daten einlesen mit Power Query (Grundlagen)',
     'xls-pq-gl', 'category_fea673d28fee_5661926410', 'Excel - Power Query Grundlagen',
     'offer_1d9142ce8b2e_10155576365', 3, 5, 'MS-Office', true),
    ('PowerPoint - Designvorlagen',
     'ppt-ds', 'category_8297cc1dac67_4421387830', 'PowerPoint - Designvorlagen erstellen',
     'offer_575947ff258e_10154295380', 3, 5, 'MS-Office', true)
ON CONFLICT (name) DO UPDATE SET
    kurs_code        = EXCLUDED.kurs_code,
    kategorie_id     = EXCLUDED.kategorie_id,
    kategorie_name   = EXCLUDED.kategorie_name,
    vorlage_offer_id = EXCLUDED.vorlage_offer_id,
    prioritaet       = EXCLUDED.prioritaet,
    rhythmus_wochen  = EXCLUDED.rhythmus_wochen,
    planungsbereich  = EXCLUDED.planungsbereich,
    is_active        = true;