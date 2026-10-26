# Änderungsdokumentation — Kursplan-App

**Dokumenttyp:** Laufende Änderungsdokumentation (Change-Log)
**Stand:** 25. Oktober 2026
**Bezug:** [`PROJEKTSTAND.md`](PROJEKTSTAND.md) (Gesamtüberblick, Stand 21.10.2026)

Dieses Dokument erfasst **alle in der Kursplan-App umgesetzten Änderungen** — Datenbank-Migrationen, API-Routen, Seiten/Komponenten, Bibliotheken, Skripte und n8n-Workflows. Ältere, bereits im [`PROJEKTSTAND.md`](PROJEKTSTAND.md) dokumentierte Bestände werden hier nur überblicksartig referenziert; der Fokus liegt auf dem Delta seit dem letzten dokumentierten Stand (21.10.2026).

---

## 1. Änderungsübersicht (Delta seit 21.10.2026)

| Bereich | Änderung | Status |
| --- | --- | --- |
| **Datenbank** | Neues `public.system_logs` (persistentes Logging) | ✅ umgesetzt |
| **Datenbank** | `public.trainer_verfuegbarkeit` um Zeitfenster-Slots erweitert (`start_time`, `end_time`, `is_booked`) | ✅ umgesetzt |
| **Datenbank** | Zuweisungs-Statusmodell erweitert (u. a. „keine Zuordnung“, Honorar manuell) | ✅ umgesetzt |
| **Datenbank** | Reservierungs-Feinschliff: Gruppen-Code, Thema/Kundennummer, Betriebsferien, Status-Verschlankung | ✅ umgesetzt |
| **Datenbank** | Themen-Stamm: eigenes Mapping `kurs_kategorie_mapping`, `is_active` | ✅ umgesetzt |
| **API** | Neu: `/api/logs` (System-Log-Abruf) | ✅ umgesetzt |
| **API** | Neu: `/api/zuweisung/bulk` (Massen-Zuweisung inkl. n8n-Rückkanal für Titel-Kürzel) | ✅ umgesetzt |
| **API** | Neu: `/api/reservations` (+ `/[id]`, `/by-code/[code]`, `/by-code/[code]/item`) | ✅ umgesetzt |
| **API** | Neu: `/api/course-topics`, `/api/kursthemen`, `/api/trainer-topics` | ✅ umgesetzt |
| **Frontend** | Neu: Seite `/system-logs` (Log-Ansicht) | ✅ umgesetzt |
| **Frontend** | Neu: Seite `/trainer/availabilities` + Komponente `TrainerAvailabilityManager` (Zeitfenster-Pflege) | ✅ umgesetzt |
| **Frontend** | Neu: Seite `/kursthemen` (Themen-Verwaltung) | ✅ umgesetzt |
| **Bibliothek** | Neu: `clipboard.ts` (Zwischenablage mit Fallback), `logger.ts` (Logging), `n8n-sync.ts`, `planning-utils.ts`, `reservations.ts` | ✅ umgesetzt |
| **Skripte** | Migrations-/Verifikationsskripte für System-Logs und Zeitfenster-Verfügbarkeit | ✅ umgesetzt |
| **n8n** | Workflows P96 (Offert-Erzeugung), P97/P98 (Trainer-Kommunikation/-Update), P06 (Adhoc-Sync) | ✅ umgesetzt |
| **n8n** | **O-7 abgeschlossen:** P04 E-Mail-Benachrichtigung; `edoobox_raw.sync_run` um `alert_sent`/`alert_sent_at`/`alert_message` erweitert | ✅ umgesetzt |
| **n8n** | **P05-Wiederanlauf:** `edoobox_raw.sync_run` um `retry_count`/`retry_of_run_id`/`retry_status` erweitert; Workflow [`n8n/P05_Wiederanlauf.json`](n8n/P05_Wiederanlauf.json) (Retry-Kette P01→P02→P03, O-7-Eskalation) | ✅ umgesetzt |
| **Skripte** | P05: Migration-Anwender [`scripts/apply_sync_run_retry_migration.cjs`](scripts/apply_sync_run_retry_migration.cjs) und Verifikation [`scripts/verify_p05_retry.ts`](scripts/verify_p05_retry.ts) | ✅ umgesetzt |
| **Datenbank / P04** | **Legacy-Stichtagsregelung gelöst:** verbindliche Definition of Done (Historienlücken 87/10/4 als `is_legacy` klassifiziert, Stichtag 01.09.2026, strikte Null-Toleranz ab Stichtag); Migration [`legacy_data_dod_migration.sql`](legacy_data_dod_migration.sql), Runner [`scripts/apply_legacy_data_dod_migration.cjs`](scripts/apply_legacy_data_dod_migration.cjs), View `kursplan.v_qualitaet_historienluecken`, P04-Abfrage auf `*_aktiv`-Alarme umgestellt, Verifikation [`scripts/verify_legacy_dod.ts`](scripts/verify_legacy_dod.ts), DoD-Doku [`DOKU/DEFINITION_OF_DONE_DATENSTAND.md`](DOKU/DEFINITION_OF_DONE_DATENSTAND.md) | ✅ umgesetzt |

---

## 2. Datenbank-Migrationen

Alle Migrationen liegen als SQL-Dateien im Projektstamm, teils mit zugehörigem CJS-Anwender/Verifizierer unter [`scripts/`](scripts/).

### 2.1 System-Logging (neu)

[`system_logs_migration.sql`](system_logs_migration.sql) — zentrales, persistentes Logging der App als Ergänzung zu `console.error`/`console.log` (Fehler, Warnungen, Sync-Ereignisse aus edoobox/Reservierung/System).

- Neue Tabelle `public.system_logs`:
  - `id` UUID PK (`gen_random_uuid()`), `created_at` TIMESTAMPTZ, `level` VARCHAR(10) mit `CHECK (level IN ('INFO','WARN','ERROR'))`, `source` VARCHAR(100), `message` TEXT, `details` JSONB
- Indexe: `idx_system_logs_created_at` (DESC, schnellster Zugriff auf Neuestes), `idx_system_logs_source` (Filter je Log-Quelle)

### 2.2 Trainer-Verfügbarkeit: Zeitfenster-Slots (neu)

[`trainer_verfuegbarkeit_zeitfenster_migration.sql`](trainer_verfuegbarkeit_zeitfenster_migration.sql) (Kontext L-05 Serienplaner – Verfügbarkeitspflege für externe Trainer) und Rollback [`trainer_verfuegbarkeit_zeitfenster_rollback.sql`](trainer_verfuegbarkeit_zeitfenster_rollback.sql):

- Neue Spalten auf `public.trainer_verfuegbarkeit`:
  - `start_time TIME` — Beginn des Zeitfensters (nur bei `slot_code LIKE 'z\_%'`)
  - `end_time TIME` — Ende des Zeitfensters
  - `is_booked BOOLEAN NOT NULL DEFAULT false` — `true` = fester, gebuchter Slot (über API nicht mehr löschbar)
- Slot-Konvention: `slot_code = 'z_HHMM_HHMM'` (z. B. `z_0900_1100`) → nutzt den bestehenden Constraint `uq_trainer_datum_slot (trainer_id, datum, slot_code)` ohne Schema-Änderung.
- `ON CONFLICT` in [`app/src/lib/verfuegbarkeit.ts`](app/src/lib/verfuegbarkeit.ts) bleibt unangetastet.

### 2.3 Trainer-Zuweisung (Erweiterungen)

| Datei | Inhalt |
| --- | --- |
| `trainer_zuweisung_status_keine_zuordnung_migration.sql` | Status „keine Zuordnung“ als Default/im Statusmodell |
| `trainer_zuweisung_status_neu_migration.sql` | Statusmodell-Erweiterung (u. a. „neu“) |
| `trainer_zuweisung_status_migration.sql` | Einführung/Erweiterung der Statuswerte |
| `trainer_zuweisung_honorar_manuell_migration.sql` | Manuelles Honorar je Zuweisung (`honorar_manuell`) |
| `trainer_zuweisung_bereinigung_edoobox_leiter.sql` | Bereinigung historischer edoobox-Leiter-Zuordnungen |

Das App-Statusmodell umfasst aktuell: `keine Zuordnung` · `ausgeschrieben` · `unter Vorbehalt` · `bestätigt` · `abgesagt` (vgl. [`app/src/app/api/zuweisung/bulk/route.ts`](app/src/app/api/zuweisung/bulk/route.ts:10)).

### 2.4 Reservierungen & Terminoptionen

| Datei | Inhalt |
| --- | --- |
| `reservation_code_und_logs_migration.sql` | Reservierungs-Code sowie Felder fürs Logging |
| `trainer_reservierung_migration.sql` | Trainer-Reservierungen (Status) |
| `trainer_reservierung_gruppe_code_migration.sql` | Gruppen-/Buchungscode je Reservierung |
| `trainer_reservierung_thema_kd_migration.sql` | Themen- und Kundennummernfeld der Reservierung |
| `termin_reservierung_betriebsferien_migration.sql` | Betriebsferien-Handling in Reservierungen |
| `termin_reservierung_status_verschlankung_migration.sql` | Verschlanktes Statusmodell der Reservierung |

### 2.5 Themen-Stamm & Kursplanung

| Datei | Inhalt |
| --- | --- |
| `trainer_topics_migration.sql`, `trainer_topics_priority_migration.sql` | Trainer↔Themen-Zuordnung inkl. Priorität |
| `kursthemen_migration.sql`, `course_topics_is_active_migration.sql` | Kursthemen-Stamm mit Aktiv-Schalter |
| `kurs_kategorie_mapping_migration.sql` | Kategorie-Mapping für den Themen-Stamm |
| `course_events_migration.sql`, `course_events_sync_tracking_migration.sql` | Kurs-Events + Sync-Tracking |
| `series_templates_migration.sql`, `serienplanung_rollback_migration.sql`, `planning_drafts_migration.sql` | Serienplanung (Vorlagen, Drafts, Rollback) |
| `kurstransfer_lock_migration.sql`, `kurstransfer_status_migration.sql` | Lock & Status beim Kurstransfer |

> Die Basis-Migrationen für Themen, Planungstabelle und Seed-Bestand (`kursplan_themen_migration.sql`, `kursplan_planung_migration.sql`, `kursplan_seed_ms_office.sql`) sind Bestand aus dem Stand 21.10.2026 und im [`PROJEKTSTAND.md`](PROJEKTSTAND.md) beschrieben.

### 2.6 Trainer-Kosten & Sätze

`trainer_saetze_migration.sql` · `trainer_kosten_migration.sql` · `trainer_halbtagessatz_reduziert_migration.sql` — Trainersätze/-kosten inkl. reduziertem Halbtagessatz.

### 2.7 O-7 — P04-Benachrichtigung (E-Mail) auf `edoobox_raw.sync_run`

[`sync_run_alert_migration.sql`](sync_run_alert_migration.sql) erweitert `edoobox_raw.sync_run` (PK `run_id` bigint) um Alert-Metadaten für den P04-E-Mail-Kanal:

- `alert_sent BOOLEAN NOT NULL DEFAULT FALSE` — Benachrichtigung für diesen Lauf veranlasst
- `alert_sent_at TIMESTAMPTZ NULL` — Zeitpunkt des Versands
- `alert_message TEXT NULL` — versandter Alarm-/Warnungstext

Umsetzung: Anwender [`scripts/apply_sync_run_alert_migration.cjs`](scripts/apply_sync_run_alert_migration.cjs) und Verifikation [`scripts/verify_o7_alert.ts`](scripts/verify_o7_alert.ts). P04-Workflow wurde um einen E-Mail-Knoten und if-Zweig erweitert; der Abschluss-Node schreibt die Alert-Spalten gezielt über `WHERE run_id = ...`.

### 2.8 P05 — Retry-Tracking (Wiederanlauf-Mechanismus) auf `edoobox_raw.sync_run`

[`sync_run_retry_migration.sql`](sync_run_retry_migration.sql) erweitert `edoobox_raw.sync_run` (PK `run_id` bigint, Port 5433) idempotent um Retry-Metadaten:

- `retry_count INT NOT NULL DEFAULT 0` — bisherige Wiederanlauf-Versuche (Obergrenze 3)
- `retry_of_run_id BIGINT NULL REFERENCES edoobox_raw.sync_run(run_id)` — Verweis auf den Alt-Lauf
- `retry_status TEXT NULL` — `NULL | pending | in_progress | resolved | failed`

Umsetzung: Anwender [`scripts/apply_sync_run_retry_migration.cjs`](scripts/apply_sync_run_retry_migration.cjs), Verifikation [`scripts/verify_p05_retry.ts`](scripts/verify_p05_retry.ts) (Schema + FK + kompletter Status-Wechsel in `BEGIN … ROLLBACK` nachgewiesen). Der Workflow [`n8n/P05_Wiederanlauf.json`](n8n/P05_Wiederanlauf.json) selektiert Läufe der letzten 48 h mit `fehler` bzw. `laeuft` > 2 h und `retry_count < 3` (`retry_status` `NULL`/`pending`), markiert den ältesten Kandidaten als `in_progress` (+ Inkrement), triggert sequenziell **P01 → P02 → P03** und setzt bei Erfolg `resolved` bzw. bei Fehler `failed` plus O-7-Eskalationsmail.

### 2.9 Legacy-Stichtagsregelung (Definition of Done für den Datenstand)

[`legacy_data_dod_migration.sql`](legacy_data_dod_migration.sql) löst die drei P04-Historienlücken (87 Buchungen ohne Angebot, 10 Trainer ohne Profil, 4 Anwesenheiten ohne Termin) durch eine **verbindliche Stichtags-Regelung** (Stichtag **01.09.2026**, Beginn des einheitlichen Regelbetriebs / erster Vollabgleich 05.09.2026):

- **Stichtags-Konfiguration:** `kursplan.datenstand_config` (`schluessel='legacy_stichtag'`, Wert `2026-09-01 00:00:00+02`) plus Zugriffsfunktion [`kursplan.get_legacy_stichtag()`](legacy_data_dod_migration.sql).
- **Qualitäts-View [`kursplan.v_qualitaet_historienluecken`](legacy_data_dod_migration.sql):** klassifiziert jede der drei Historienlücken anhand ihres fachlichen Referenzdatums (`booking_time` / Termin-`date_start` bzw. `payload.last_change` bei fehlendem Termin) als `is_legacy`.
- **P04-Anpassung:** Beide Alarme verwenden jetzt ausschließlich die `*_aktiv`-Zähler (nur Datensätze **ab** Stichtag); `*_legacy`-Zähler erscheinen als INFO. Referenzabfrage [`tmp_p04_kontrollen_query.sql`](tmp_p04_kontrollen_query.sql) und Workflow-Export [`n8n/P04_Qualitaetskontrolle.json`](n8n/P04_Qualitaetskontrolle.json) umgestellt.
- **Verbindliche Doku:** [`DOKU/DEFINITION_OF_DONE_DATENSTAND.md`](DOKU/DEFINITION_OF_DONE_DATENSTAND.md) — Ursache, Stichtag-Begründung, künftige Null-Toleranz, Abnahme-Statement.
- **Nachweis:** Anwender [`scripts/apply_legacy_data_dod_migration.cjs`](scripts/apply_legacy_data_dod_migration.cjs), Verifikation [`scripts/verify_legacy_dod.ts`](scripts/verify_legacy_dod.ts) und Live-Lauf bestätigen `anzahl_aktiv = 0` je Kategorie, `anzahl_legacy = 87 / 10 / 4`. Damit gilt der Datenstand als 100 % fachlich abgenommen / Clean.

---

## 3. API-Routen (`app/src/app/api/`)

| Route | Methode/Verhalten |
| --- | --- |
| [`/api/logs`](app/src/app/api/logs/route.ts) | **Neu:** Abruf von System-Log-Einträgen aus `public.system_logs` (Grundlage der Log-Seite); läuft über [`logger.ts`](app/src/lib/logger.ts) |
| [`/api/zuweisung/bulk`](app/src/app/api/zuweisung/bulk/route.ts) | **Neu:** PATCH für Massen-Zuweisungen (mehrere `date_ids` je Trainer/Status); validiert Status (`keine Zuordnung` … `abgesagt`), normalisiert Trainer-ID/Kürzel; meldet jede Zuweisung **asynchron an n8n** (`N8N_WEBHOOK_URL_TRAINER_SYNC`, Header `X-Sync-Token`), damit das Trainerkürzel in den edoobox-Modultiteln ersetzt wird — der Vorher-Zustand der Kürzel wird vor dem Upsert ermittelt; Webhook-Fehler gefährden die lokale Speicherung nicht |
| [`/api/zuweisung`](app/src/app/api/zuweisung/route.ts) | Zuweisungen (Einzel-Routen, Status „geschlossen“-Logik verifiziert) |
| [`/api/reservations`](app/src/app/api/reservations/route.ts), [`/[id]`](app/src/app/api/reservations/[id]/route.ts), [`/by-code/[code]`](app/src/app/api/reservations/by-code/[code]/route.ts), [`/by-code/[code]/item`](app/src/app/api/reservations/by-code/[code]/item/route.ts) | **Neu:** Reservierungs-API mit Lookup per Buchungscode inkl. Position/Artikel (Umsetzung läuft über [`reservations.ts`](app/src/lib/reservations.ts)) |
| [`/api/course-topics`](app/src/app/api/course-topics/route.ts) | **Neu:** Kurs-Themen (Stammdaten) |
| [`/api/kursthemen`](app/src/app/api/kursthemen/route.ts) | **Neu:** Kursthemen-Verwaltung |
| [`/api/trainer-topics`](app/src/app/api/trainer-topics/route.ts) | **Neu:** Trainer-Themen-Zuordnung |

> Bestehende Routen (Trainer, Verfügbarkeit, Zeitplan, Termine, Kursplan, Kurstransfer, Sync/P90, edoobox-Basis/Vorlagen, Reservierung/Umwandlung) — Stand siehe [`PROJEKTSTAND.md`](PROJEKTSTAND.md) § 5.2.

---

## 4. Frontend — Seiten & Komponenten (`app/src/app/`, `app/src/components/`)

| Seite / Komponente | Beschreibung |
| --- | --- |
| [`/system-logs`](app/src/app/system-logs/page.tsx) | **Neu:** Ansicht der System-Log-Einträge (Filtern/Lesen über `/api/logs`) |
| `/trainer/availabilities` ([`page.tsx`](app/src/app/trainer/availabilities/page.tsx)) + [`TrainerAvailabilityManager.tsx`](app/src/components/TrainerAvailabilityManager.tsx) | **Neu:** Verfügbarkeitsmanager mit **Zeitfenster-Slots** (`z_HHMM_HHMM`, `start_time`/`end_time`/`is_booked`); feste/gebuchte Slots sind gegen Löschung geschützt; Ergänzung zur bestehenden klassischen Sicht [`/trainer/verfuegbarkeit`](app/src/app/trainer/verfuegbarkeit/page.tsx) |
| [`/kursthemen`](app/src/app/kursthemen/page.tsx) | **Neu:** Themen-Verwaltungsseite mit Prioritäten/Aktiv-Status |
| [`Navigation.tsx`](app/src/components/Navigation.tsx), [`AppHeader.tsx`](app/src/components/AppHeader.tsx), [`HeaderLogo.tsx`](app/src/components/HeaderLogo.tsx) | App-Rahmen; Navigation um neue Bereiche (System-Logs, Themen, Verfügbarkeiten) erweitert |

---

## 5. Bibliotheken (`app/src/lib/`)

| Datei | Inhalt |
| --- | --- |
| [`logger.ts`](app/src/lib/logger.ts) | **Neu:** `logEvent(...)` — persistiert Log-Einträge in `public.system_logs` (Level, Quelle, Meldung, Details); wird von API-Routen genutzt |
| [`clipboard.ts`](app/src/lib/clipboard.ts) | **Neu:** `kopiereInZwischenablage(text)` — moderne Clipboard-API mit `execCommand`-Fallback für ältere Browser |
| [`n8n-sync.ts`](app/src/lib/n8n-sync.ts) | **Neu:** n8n-Anbindungshelfer (Webhook-Versand, Secrets) — u. a. für den Trainer-Bulk-Rückkanal |
| [`planning-utils.ts`](app/src/lib/planning-utils.ts) | **Neu:** Planungs-Hilfsfunktionen (Serienplanung/Drafts) |
| [`reservations.ts`](app/src/lib/reservations.ts) | **Neu:** Reservierungs-Logik hinter `/api/reservations` (inkl. by-code-Lookup) |
| `db.ts`, `feiertage.ts`, `honorar.ts`, `umwandlung.ts`, `verfuegbarkeit.ts` | Bestand (siehe [`PROJEKTSTAND.md`](PROJEKTSTAND.md) § 5.3) |

---

## 6. Skripte & Verifikation (`scripts/`, App-Stamm)

| Skript | Zweck |
| --- | --- |
| [`scripts/apply_system_logs_migration.cjs`](scripts/apply_system_logs_migration.cjs) | Wendet [`system_logs_migration.sql`](system_logs_migration.sql) an (idempotent) |
| [`scripts/verify_system_logs.cjs`](scripts/verify_system_logs.cjs) | Verifiziert Tabelle/Indexe und Roundtrip-Schreiben/Lesen |
| [`scripts/apply_trainer_verfuegbarkeit_zeitfenster_migration.cjs`](scripts/apply_trainer_verfuegbarkeit_zeitfenster_migration.cjs) | Wendet die Zeitfenster-Migration an |
| `app/tmp_verify_logs_route.cjs` | Verifikation der `/api/logs`-Route (HTTP-Status 200) |
| `app/tmp_verify_optimistic_bulk.cjs`, `app/tmp_bulk_cleanup.cjs` | Verifikation/Aufräumen des optimistischen Bulk-Zuweisungs-Wegs |
| `app/tmp_verify_zuweisung_status_geschlossen.cjs` | Verifikation des Statuswechsels auf „geschlossen“ in der Zuweisung |
| `app/tmp_verify_trainer_title_sync.cjs` | Verifikation des Kürzel-Syncs in den edoobox-Modultiteln (n8n-Rückkanal) |
| `app/tmp_check_availabilities.cjs`, `app/tmp_verify_verfuegbarkeit_reservierungs_sperre.cjs` | Verfügbarkeits-Prüfungen |
| `app/tmp_run_p95_codenode.cjs` | Testlauf der P95-Code-Node (edoobox-Offert-Erzeugung) |

> Alle API-Änderungen wurden laut Regelwerk per Laufzeit-Request (HTTP 200) verifiziert; die temporären Skripte dienen als Nachweis.

---

## 7. n8n-Workflows (Delta)

| Workflow | Datei | Zweck |
| --- | --- | --- |
| **P96** – Offer aus Reservierung erzeugen | [`n8n/P96_Create_edoobox_Offer_from_Reservation.json`](n8n/P96_Create_edoobox_Offer_from_Reservation.json) | Erzeugt edoobox-Offer aus einer Reservierung; Iterationen incl. URLSearchParams-Fix (Backup `.bak`, `.pre_urlsearchparams`) |
| **P97/P98** – Trainer | `n8n_p97_workflow.json`, [`n8n/P98_Update_Trainer_Single.json`](n8n/P98_Update_Trainer_Single.json) | Trainer-Update/Kommunikation; P97 „Duplicate Offer“-Test (`P97_Test_Duplicate_Offer.json`) |
| **P06** – Trainer-Adhoc-Sync | [`n8n/P06_trainer_adhoc_sync.json`](n8n/P06_trainer_adhoc_sync.json) | Ad-hoc-Abgleich einzelner Trainer |
| **B01** – Kurstransfer | [`n8n/B01_Kurstransfer_edoobox.json`](n8n/B01_Kurstransfer_edoobox.json) | Batch-Kurstransfer (bestehend, aktualisiert) |
| **P05** – Wiederanlauf | [`n8n/P05_Wiederanlauf.json`](n8n/P05_Wiederanlauf.json) | Automatischer Retry fehlgeschlagener/steckengebliebener Sync-Läufe (P01→P02→P03, O-7-Eskalation); `active=true` |

> Die Kernkette P90–P05 ist im [`PROJEKTSTAND.md`](PROJEKTSTAND.md) § 4 dokumentiert. **P05** wurde per Wiederanlauf-Mechanik (Retry-Tracking) neu definiert — siehe § 2.8.

---

## 8. Verknüpfte Berichte & Belege (Projektstamm)

- [`PROJEKTSTAND.md`](PROJEKTSTAND.md) — Gesamtüberblick (Datenbank, n8n-Kette, Seiten, Kennzahlen)
- [`End-to-End-Abgleichbericht.md`](End-to-End-Abgleichbericht.md), [`Abgleichbericht P01-P05.md`](Abgleichbericht P01-P05.md), [`Abgleichbericht P90-P03.md`](Abgleichbericht P90-P03.md) — Abgleich-Ergebnisse
- [`Diagnosebericht Duplicate-Endpunkt edoobox V2.md`](Diagnosebericht Duplicate-Endpunkt edoobox V2.md) — Untersuchung des edoobox-Duplicate-Endpunkts
- [`Abschlussbericht zur DB-I-Auswertung.md`](Abschlussbericht zur DB-I-Auswertung.md) — DB-I-Auswertung
- `edoobox Vollabgleich – Schritt *.json` (1–63) — lückenloses Protokoll der Abgleich-Entwicklung

---

## 9. Leitlinien für künftige Einträge

1. Änderungen hier chronologisch/anliegend ergänzen → Abschnitt „Delta“ oder neuen Abschnitt anlegen.
2. Datei-Links relativ zum Projektstamm pflegen; bei Code-Stellen Zeile angeben.
3. Jede API-/DB-Änderung erst nach erfolgreicher Laufzeit-Verifikation als „✅ umgesetzt“ markieren.
4. Im [`PROJEKTSTAND.md`](PROJEKTSTAND.md) nur den Geamtüberblick pflegen — Detail-Changes gehören in diese Datei.