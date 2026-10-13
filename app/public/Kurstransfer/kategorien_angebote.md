# Kategorien & Angebote – Mapping Jahres-Kursplanung 2027

**Quelle:** `Jahres-Kursplanung_MS_Office.xlsx`, Blatt `Kurs_Definitionen` (Spalten: `Kurs_Code`, `Kursname`, `Kategorie_ID`, `Kategorie_Name`, `Vorlage_Offer_ID`)

**Zweck:** Zuordnung jedes Kurscodes zur edoobox-Kategorie (ID + Bezeichnung) und zur Vorlagen-Offer-ID. Diese Zuordnung wird beim Webhook-Sync als `category`, `sourceOfferId` und `name` an n8n (P96) übertragen.

| Kurs_Code | Kursname | Kategorie_ID | Kategorie_Name | Vorlage_Offer_ID |
|---|---|---|---|---|
| `xls-gl-m1` | Excel Grundlagen Modul 1: Basiswissen & KI | `category_cba26fc247a0_4287075190` | Excel GL M1 | `offer_f7d26c266c1a_10079580340` |
| `xls-gl-m2` | Excel Grundlagen Modul 2: Zeitsparende Techniken, Zahlenformate & KI | `category_b6c69b49d5cb_5661790135` | Excel GL M2 | `offer_47bc0a80c77f_10079671190` |
| `xls-ab-m1` | Excel Aufbau Modul 1: Logikfunktionen, XVERWEIS & KI | `category_d56c2197d695_8247708195` | Excel AB M1 | `offer_9ba610263a0f_10079762040` |
| `xls-pivot-komp` | Excel: Mit Pivot-Tabellen Daten auswerten (inkl. KI) | `category_9db1016f2ef2_4393660410` | Excel - Pivot-Tabellen (kompakt) | `offer_1cc9a9a95915_10154231785` |
| `out-gl` | Outlook Grundlagen (kompakt) | `category_de5473f2a891_4394814205` | Outlook Grundlagen | `offer_17fea7f8061a_10088183835` |
| `out-ab` | Outlook Aufbau (kompakt) | `category_19990b2ab29c_7368525490` | Outlook Aufbau | `offer_1033197d9dc5_10088238345` |
| `ppt-gl-komp` | PowerPoint Grundlagen (kompakt) | `category_86933aca401a_4369230845` | PowerPoint Grundlagen (kompakt) | `offer_2f104b6e01be_10088301940` |
| `ppt-ab-komp` | PowerPoint Aufbau (kompakt) | `category_35669a3eef94_7223801440` | PowerPoint Aufbau (kompakt) | `offer_d2ca859ace53_10088374620` |
| `xls-ab-m2` | Excel Aufbau Modul 2: Bedingungen, Logik-Formeln, Diagramme & KI | `category_d4244a55bc4e_8811704995` | Excel AB M2 | `offer_236366f5548c_10154140935` |
| `xls-pq-gl` | Excel: Daten einlesen mit Power Query (Grundlagen) | `category_fea673d28fee_5661926410` | Excel - Power Query Grundlagen | `offer_1d9142ce8b2e_10155576365` |
| `xls-umfang` | Excel: Große Tabellen im Griff | `category_2e3b48532c31_4393733090` | Excel - Große Tabellen | `offer_96630b1f47b8_10154186360` |
| `xls-gl-m3` | Excel Grundlagen Modul 3: Professionelle Datenaufbereitung & KI | `category_0cb624b43f98_8811714080` | Excel GL M3 | `offer_e6eae691d9a1_10154004660` |
| `xls-gl-m4` | Excel Grundlagen Modul 4: Tabellenverknüpfungen, Zellenschutz & KI | `category_a14bf04a5f66_4989999810` | Excel GL M4 | `offer_28e512e190b5_10154077340` |
| `ppt-ds` | PowerPoint - Designvorlagen | `category_8297cc1dac67_4421387830` | PowerPoint - Designvorlagen erstellen | `offer_575947ff258e_10154295380` |
| `ppt-vb` | PowerPoint - Präsentation vorbereiten | `category_bd10e8707d87_4422759665` | PPoint - Eine Präsentation richtig vorbereiten | `offer_bfc6b19338a3_10154322635` |
| `wrd-ab-komp` | Word Aufbau (kompakt) | `category_ae4fabfd0acd_4287102445` | Word Aufbau (kompakt) | `offer_b5b0ef7b4410_10088501810` |
| `wrd-dokvorl` | Word - Dokumentvorlagen erstellen | `category_15cf432edf8d_5109231350` | Word - Dokumentvorlagen erstellen | `offer_c3eb3432172f_10219916335` |
| `wrd-gl-komp` | Word Grundlagen (kompakt) | `category_3a27e78a1da1_4287084275` | Word Grundlagen kompakt | `offer_bd4938f08741_10088456385` |
| `wrd-serie` | Word - Seriendruck | `category_41b0c0d06429_10460223670` | Vorlagen für offene Kurse | `offer_8d72df08692f_10460260010` |
| `wrd-umfang` | Word - Umfangreiche Dokumente | `category_a520baeacc58_4391407330` | Word - Umfangreiche Dokumente | `offer_879f1b4ccbfd_10154358975` |

## Verwendung im Webhook-Payload (P96)

Pro Termin wird an `WEBHOOK_URL` folgendes JSON-Objekt gesendet:

| Payload-Feld | Quelle |
|---|---|
| `number` | `Kurs_Code` (eindeutige Kursnummer) |
| `date_start` | `Datum` + `Beginn` (z. B. `11.01.2027 09:00`) |
| `category` | `Kategorie_ID` |
| `sourceOfferId` | `Vorlage_Offer_ID` |
| `name` | `Kursname` |