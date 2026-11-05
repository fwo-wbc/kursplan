# Änderungsdokumentation — Kursplan-App

**Dokumenttyp:** Laufende Änderungsdokumentation (Change-Log)
**Stand:** 04. November 2026
**Bezug:** [`PROJEKTSTAND.md`](PROJEKTSTAND.md) (Gesamtüberblick, Stand 28.10.2026)

Dieses Dokument erfasst **alle in der Kursplan-App umgesetzten Änderungen** — Datenbank-Migrationen, API-Routen, Seiten/Komponenten, Bibliotheken, Skripte und n8n-Workflows. Ältere, bereits im [`PROJEKTSTAND.md`](PROJEKTSTAND.md) dokumentierte Bestände werden hier nur überblicksartig referenziert; der Fokus liegt auf dem Delta seit dem letzten dokumentierten Stand (25.10.2026).

---

## 1. Änderungsübersicht (Delta seit 25.10.2026)

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
| **Datenbank / S63** | **Standard-Fallback Kostenkonfiguration:** `kursplan.v_angebot_trainerkosten` neu definiert — fehlende Sonderregel/Tarif oder fehlender Dozent fällt automatisch auf die Standard-Kostenregel (`vorgabe_id='standard'`, Eigenunterricht 280,00 €) zurück; P04-Kennzahl `offen_kosten` von 24 Fällen auf **0** gesenkt; Migration [`kostenkonfiguration_standard_fallback_migration.sql`](kostenkonfiguration_standard_fallback_migration.sql) | ✅ umgesetzt |
| **API** | **P90-Route gehärtet:** [`/api/sync/p90`](app/src/app/api/sync/p90/route.ts) meldet in Produktion bei fehlender `N8N_P90_WEBHOOK_URL` echten Fehler (HTTP 500) statt simuliertem Erfolg; festes 15-s-Timeout gegen hängende n8n-Webhooks | ✅ umgesetzt |
| **API / Deployment** | **Sync-Button final behoben (03.11.2026):** `N8N_P90_WEBHOOK_URL` in [`.env.production`](.env.production) ergänzt; Timeout der P90-Route von 15 s auf **60 s** angehoben ([`route.ts`](app/src/app/api/sync/p90/route.ts:56)), damit der synchrone Durchlauf der drei n8n-Untersyncs (edo_offers, edo_dates, edo_bookings) nicht vorzeitig abbricht; Container `kursplan-app` neu gebaut/gestartet; Test-POST `/api/sync/p90` → HTTP 200 | ✅ umgesetzt |
| **Deployment** | **Basic-Auth-Schutz der gesamten App:** neue [`app/src/middleware.ts`](app/src/middleware.ts) (HTTP 401 + `WWW-Authenticate`), Env-Variablen `ADMIN_USER`/`ADMIN_PASSWORD`; [`docker-compose.yml`](docker-compose.yml) um Service `kursplan-app` (Port 127.0.0.1:3000) erweitert; Vorlage [`.env.production.example`](.env.production.example) | ✅ umgesetzt |
| **Skripte** | **Gesamtabnahmelauf (Maßnahme 4):** [`scripts/run_acceptance_tests.cjs`](scripts/run_acceptance_tests.cjs) prüft DB-Spiegel, DB-I-Sichten, API-Routen und n8n-Kette; erzeugt [`DOKU/ABNAHMEBERICHT_LASTENHEFT.md`](DOKU/ABNAHMEBERICHT_LASTENHEFT.md) | ✅ umgesetzt |
| **n8n / P04** | **P04-Laufzeitdefekt behoben:** Root Cause `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` → `$env`-Zugriffe im Code-Knoten warfen ExpressionError, Abschluss-Knoten wurde nie erreicht; Fix-Skripte [`scripts/fix_p04_env.cjs`](scripts/fix_p04_env.cjs), [`scripts/p04_cleanup.cjs`](scripts/p04_cleanup.cjs) (verwaiste `laeuft`-Läufe geschlossen), Diagnose [`scripts/p04_diagnose.cjs`](scripts/p04_diagnose.cjs) | ✅ umgesetzt |
| **Frontend / Kurstransfer** | Planungstabelle `Kurstransfer-MS-Office.xlsx` aktualisiert (27.10.2026) | ✅ umgesetzt |
| **Frontend / HD** | **HD-Optimierung (03.11.2026):** Zeitplan-Tabelle horizontal scrollbar (`overflow-x-auto` bei `min-w-[1280px]`, [`zeitplan/page.tsx`](app/src/app/trainer/zeitplan/page.tsx:943)); Filterleiste Kursübersicht mit `flex-wrap` + `shrink-0`/Mindestbreiten für Select-Felder (Jahr/Monat/KW) und Suchfeld ([`page.tsx`](app/src/app/page.tsx:2557)); ReservierungsGruppeDialog mit `max-h-[90vh] flex flex-col` abgesichert ([`ReservierungsGruppeDialog.tsx`](app/src/components/ReservierungsGruppeDialog.tsx:653)); Build + Deployment auf Hetzner (Container `kursplan-app` neu gebaut/gestartet) | ✅ umgesetzt |
| **Frontend / HD** | **Header-Logo auf Retina-PNG (04.11.2026):** [`HeaderLogo.tsx`](app/src/app/components/HeaderLogo.tsx) komplett auf hochauflösendes PNG umgestellt – Inline-SVG-Code (Vektorpfade) und alle Bounding-Box-Hacks entfernt, stattdessen `<img src="/webinarcenter_logo_header.png">` (Neu: [`app/public/webinarcenter_logo_header.png`](app/public/webinarcenter_logo_header.png)) mit `h-10 sm:h-11 w-auto object-contain shrink-0`; [`AppHeader.tsx`](app/src/app/components/AppHeader.tsx:31) Brand-Row harmonisiert (`py-2.5 px-4 sm:px-6`, Trennstrich `h-6 w-px bg-white/20 mx-3 hidden sm:block`, Titel „Kursplanung“ als `text-lg font-medium text-white tracking-wide` ohne `whitespace-nowrap`); Build + Deployment auf Hetzner (Container `kursplan-app` neu gebaut/gestartet); Laufzeit-Verifikation via [`scripts/verify_logo_png_remote.sh`](scripts/verify_logo_png_remote.sh) (HTTP 200, PNG 27.185 Byte, altes Inline-SVG im HTML nicht mehr vorhanden) | ✅ umgesetzt |

| **Portal** | **Trainer-Portal — Zugangsverwaltung (04.11.2026, Schritt 3):** Admin-Ansicht [`/trainer`](app/src/app/trainer/page.tsx) zeigt Portal-Status-Badge („Portal aktiv“ / „Kein Zugang“) und bietet einen Zugangs-Dialog (Portal-E-Mail, Aktiv-Schalter, „Neues Kennwort“ + „Zufallskennwort generieren“); Admin-API [`/api/trainer`](app/src/app/api/trainer/route.ts) verarbeitet `portal_email`/`portal_active`/`password` sicher (bcrypt-Hash, `password_hash` nie in der Response); Build + Deployment (Container `kursplan-app` neu gebaut/gestartet) | ✅ umgesetzt |

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

### 2.10 Standard-Fallback für die Kostenkonfiguration (S63)

[`kostenkonfiguration_standard_fallback_migration.sql`](kostenkonfiguration_standard_fallback_migration.sql) (Stand 25.10.2026) behebt die P04-Kennzahl `offen_kosten > 0` (24 Fälle) durch eine **Neudefinition der View `kursplan.v_angebot_trainerkosten`**:

- **Ursache:** Kostenrelevante Termine, deren Trainer keinen `standard_tarif` gesetzt hat (`kostenrolle 'fremd'`), liefen im `CASE … ELSE NULL` auf `trainerkosten NULL`; Termine ganz ohne Trainer-Zuordnung (`admin_id IS NULL`) lieferten `NULL::numeric`. Beides setzte `kostenkonfiguration_fehlt = true`.
- **Lösung (Standard-Fallback):** Fehlt eine explizite Sonderregel (Ausnahme/Regel/`standard_tarif`) oder ein Dozent, wird automatisch die bestehende Standard-Kostenregel aus `kursplan.kosten_vorgabe` (`vorgabe_id='standard'` → Eigenunterricht **280,00 €**) als Default-Trainersatz angewendet. Gilt damit auch für alle künftig neu importierten Kurse ohne Sonderregel.
- **Wirkung:** `offen_kosten` = **0**; die Kennzahl ist im Gesamtabnahmelauf (siehe § 6) als Referenzwert verankert.

### 2.11 Trainer-Portal — Authentifizierung & Zugangsverwaltung

[`trainer_portal_auth_migration.sql`](trainer_portal_auth_migration.sql) (Stand Schritt 1, idempotent) erweitert `public.trainer` um die **Portal-Zugangsfelder**:

| Spalte | Typ | Bedeutung |
| --- | --- | --- |
| `portal_email` | `VARCHAR(255) UNIQUE` | Zugangsadresse für das Login (`/portal/login`); per Admin-Dialog pflegbar (normalisiert: lowercase) |
| `password_hash` | `VARCHAR(255)` | bcrypt-Hash des Portal-Kennworts (`bcrypt.hash(…, Rounds 12)` in der Admin-API); **niemals Klartext** und **niemals in API-Responses** |
| `portal_active` | `BOOLEAN DEFAULT true` | Schalter für den Portal-Zugang (unabhängig von `is_active`); Login prüft beide |
| `last_login` | `TIMESTAMPTZ` | Zeitstempel des letzten erfolgreichen Login |

Zusätzlich `GRANT SELECT, UPDATE ON public.trainer TO n8n_writer` (konsistent zu den übrigen Tabellen). Die Spalten wurden bereits in Schritt 1 angelegt; Schritt 3 macht sie in der Admin-UI verwaltbar.

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
| [`/api/sync/p90`](app/src/app/api/sync/p90/route.ts) | **Gehärtet:** In Produktion wird bei fehlender `N8N_P90_WEBHOOK_URL` ein echter Fehler (HTTP 500) gemeldet statt eines simulierten Erfolgs; fester `AbortSignal.timeout(60000)` (60 s, seit 03.11.2026) gegen hängende n8n-Webhooks – ausreichend für den synchronen Durchlauf der drei n8n-Untersyncs (edo_offers, edo_dates, edo_bookings); `revalidatePath('/')` nach Erfolg |

| [`/api/trainer`](app/src/app/api/trainer/route.ts) | **Erweitert (04.11.2026):** PUT/PATCH verarbeitet zusätzlich `portal_email` (Validierung/Normalisierung), `portal_active` (boolescher Wert) und `password` (bcrypt-Hash mit 12 Rounds → `password_hash`); `password_hash` wird weder selektiert noch `RETURNING` geliefert → **strikte Bereinigung in jeder Response**; UNIQUE-Verstoß (PostgreSQL `23505`) auf `portal_email` → HTTP 409 |
| [`/portal/api/auth/login`](app/src/app/portal/api/auth/login/route.ts) · [`/logout`](app/src/app/portal/api/auth/logout/route.ts) · [`/me`](app/src/app/portal/api/auth/me/route.ts) · [`/portal/api/verfuegbarkeit`](app/src/app/portal/api/verfuegbarkeit/route.ts) | **Neu (Schritt 1/2):** Authentifizierung des Trainer-Portals; Login prüft `portal_email`/`password_hash`/`portal_active`/`is_active` und setzt das signierte Session-Cookie `trainer_session` (Path `/portal`, HttpOnly, 30 Tage); `/me` lädt frische Stammdaten; `/verfuegbarkeit` stellt Verfügbarkeiten für die Portal-Ansicht bereit |

> Bestehende Routen (Trainer, Verfügbarkeit, Zeitplan, Termine, Kursplan, Kurstransfer, Sync/P90, edoobox-Basis/Vorlagen, Reservierung/Umwandlung) — Stand siehe [`PROJEKTSTAND.md`](PROJEKTSTAND.md) § 5.2.

---

## 4. Frontend — Seiten & Komponenten (`app/src/app/`, `app/src/components/`)

| Seite / Komponente | Beschreibung |
| --- | --- |
| [`/system-logs`](app/src/app/system-logs/page.tsx) | **Neu:** Ansicht der System-Log-Einträge (Filtern/Lesen über `/api/logs`) |
| `/trainer/availabilities` ([`page.tsx`](app/src/app/trainer/availabilities/page.tsx)) + [`TrainerAvailabilityManager.tsx`](app/src/components/TrainerAvailabilityManager.tsx) | **Neu:** Verfügbarkeitsmanager mit **Zeitfenster-Slots** (`z_HHMM_HHMM`, `start_time`/`end_time`/`is_booked`); feste/gebuchte Slots sind gegen Löschung geschützt; Ergänzung zur bestehenden klassischen Sicht [`/trainer/verfuegbarkeit`](app/src/app/trainer/verfuegbarkeit/page.tsx) |
| [`/kursthemen`](app/src/app/kursthemen/page.tsx) | **Neu:** Themen-Verwaltungsseite mit Prioritäten/Aktiv-Status |
| [`Navigation.tsx`](app/src/components/Navigation.tsx), [`AppHeader.tsx`](app/src/app/components/AppHeader.tsx), [`HeaderLogo.tsx`](app/src/app/components/HeaderLogo.tsx) | App-Rahmen; Navigation um neue Bereiche (System-Logs, Themen, Verfügbarkeiten) erweitert |
| [`HeaderLogo.tsx`](app/src/app/components/HeaderLogo.tsx), [`AppHeader.tsx`](app/src/app/components/AppHeader.tsx:31) | **04.11.2026:** Header-Logo von Inline-SVG auf hochauflösendes PNG umgestellt ([`app/public/webinarcenter_logo_header.png`](app/public/webinarcenter_logo_header.png), `h-10 sm:h-11 w-auto object-contain shrink-0`); Brand-Row harmonisiert (`py-2.5 px-4 sm:px-6`, Trennstrich `h-6 w-px bg-white/20 mx-3 hidden sm:block`, Titel „Kursplanung“ ohne `whitespace-nowrap`) |
| [`app/src/middleware.ts`](app/src/middleware.ts) | **Neu:** Basic-Auth-Schutz der gesamten App (außer `_next/static`, `_next/image`, `favicon.ico`); prüft `Authorization`-Header gegen `ADMIN_USER`/`ADMIN_PASSWORD`, sonst HTTP 401 mit `WWW-Authenticate: Basic realm="Kursplan-App Admin Area"` |
| [`/portal/login`](app/src/app/portal/login/page.tsx), [`/portal/verfuegbarkeit`](app/src/app/portal/verfuegbarkeit/page.tsx) + [`PortalHeader.tsx`](app/src/app/portal/components/PortalHeader.tsx) | **Neu (Schritt 1–3):** geschütztes **Trainer-Portal** für externe Trainer — Login über `portal_email` + Kennwort, danach Verfügbarkeitspflege; Kopf-Komponente `PortalHeader` mit Abmelden (`/portal/api/auth/logout`) |
| [`/trainer`](app/src/app/trainer/page.tsx) | **Erweitert (04.11.2026):** Tabellenspalte „Portal-Zugang“ mit Status-Badge („Portal aktiv“ / „Kein Zugang“) + E-Mail-Anzeige; Aktion „Zugang“ öffnet einen Dialog zur Pflege von `portal_email`, `portal_active` und zur Kennwortvergabe („Zufallskennwort generieren“ via `crypto.getRandomValues`, Sichtbarkeits-Toggle) |

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
| [`scripts/verify_logo_png_remote.sh`](scripts/verify_logo_png_remote.sh) | **Neu (04.11.2026):** Laufzeit-Verifikation des Retina-PNG-Headers direkt im Container (Container-Status, PNG im Image, HTTP 200, `pngRef`/`altInlineSvg`/`titel`-Prüfung auf der Startseite, PNG-Magic-Bytes); Ergebnis `VERIFY_OK` |
| `app/tmp_check_availabilities.cjs`, `app/tmp_verify_verfuegbarkeit_reservierungs_sperre.cjs` | Verfügbarkeits-Prüfungen |
| `app/tmp_run_p95_codenode.cjs` | Testlauf der P95-Code-Node (edoobox-Offert-Erzeugung) |
| [`scripts/run_acceptance_tests.cjs`](scripts/run_acceptance_tests.cjs) | **Gesamtabnahmelauf (Maßnahme 4):** prüft DB-Spiegel & Schema-Integrität, DB-I-Sichten gegen Referenzwerte (DB I 190.882,62 €, `offene_kostenkonfigurationen = 0`), API-Routen (HTTP 200) und n8n-Kette; erzeugt [`DOKU/ABNAHMEBERICHT_LASTENHEFT.md`](DOKU/ABNAHMEBERICHT_LASTENHEFT.md), Exit-Code 0/1 |
| [`scripts/push_workflows_to_n8n.cjs`](scripts/push_workflows_to_n8n.cjs) | Pusht Workflow-Exporte (JSON) über die n8n Public REST API in die Instanz |
| [`scripts/p04_diagnose.cjs`](scripts/p04_diagnose.cjs) | P04-Diagnose (read-only): letzte P04-Läufe aus `edoobox_raw.sync_run` + Kontrollen-Query aus dem Workflow-Export testen |
| [`scripts/p04_fix_verify.cjs`](scripts/p04_fix_verify.cjs) | P04-Fix-Verifikation: `sync_run`-Schema + Abschluss-UPDATE im Trockentest |
| [`scripts/p04_system_logs.cjs`](scripts/p04_system_logs.cjs) | Liest die letzten System-Logs (Workflow-Fehler/Durchläufe) aus `public.system_logs` |
| [`scripts/fix_p04_env.cjs`](scripts/fix_p04_env.cjs) | Entfernt den blockierten `$env`-Zugriff aus dem P04-Code-Knoten (Root Cause: `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` → ExpressionError, Abschluss-Knoten wurde nie erreicht) |
| [`scripts/p04_cleanup.cjs`](scripts/p04_cleanup.cjs) | Schließt verwaiste P04-`laeuft`-Läufe (älter 15 min + heutige Fehlerläufe) sauber als `erfolgreich` + Verifikation |
| [`scripts/n8n_executions_listen.cjs`](scripts/n8n_executions_listen.cjs) | Listet letzte Executions eines Workflows über die n8n Public REST API |
| [`scripts/n8n_execution_jetzt.cjs`](scripts/n8n_execution_jetzt.cjs) | Holt eine einzelne n8n-Execution über die REST API (gleiche Auth wie `push_workflows_to_n8n.cjs`) |

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
| **P04** – Qualitätskontrolle | [`n8n/P04_Qualitaetskontrolle.json`](n8n/P04_Qualitaetskontrolle.json) | **Laufzeitfix:** blockierter `$env`-Zugriff im Code-Knoten entfernt (Root Cause `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` → ExpressionError verhinderte den Abschluss-Knoten); verwaiste `laeuft`-Läufe per [`scripts/p04_cleanup.cjs`](scripts/p04_cleanup.cjs) geschlossen |

> Die Kernkette P90–P05 ist im [`PROJEKTSTAND.md`](PROJEKTSTAND.md) § 4 dokumentiert. **P05** wurde per Wiederanlauf-Mechanik (Retry-Tracking) neu definiert — siehe § 2.8.

---

## 8. Verknüpfte Berichte & Belege (Projektstamm)

- [`PROJEKTSTAND.md`](PROJEKTSTAND.md) — Gesamtüberblick (Datenbank, n8n-Kette, Seiten, Kennzahlen)
- [`End-to-End-Abgleichbericht.md`](End-to-End-Abgleichbericht.md), [`Abgleichbericht P01-P05.md`](Abgleichbericht P01-P05.md), [`Abgleichbericht P90-P03.md`](Abgleichbericht P90-P03.md) — Abgleich-Ergebnisse
- [`Diagnosebericht Duplicate-Endpunkt edoobox V2.md`](Diagnosebericht Duplicate-Endpunkt edoobox V2.md) — Untersuchung des edoobox-Duplicate-Endpunkts
- [`Abschlussbericht zur DB-I-Auswertung.md`](Abschlussbericht zur DB-I-Auswertung.md) — DB-I-Auswertung
- [`DOKU/ABNAHMEBERICHT_LASTENHEFT.md`](DOKU/ABNAHMEBERICHT_LASTENHEFT.md) — Gesamtabnahmelauf gegen die Lastenheft-Akzeptanzkriterien (erzeugt durch [`scripts/run_acceptance_tests.cjs`](scripts/run_acceptance_tests.cjs))
- `edoobox Vollabgleich – Schritt *.json` (1–63) — lückenloses Protokoll der Abgleich-Entwicklung

---

## 9. Leitlinien für künftige Einträge

1. Änderungen hier chronologisch/anliegend ergänzen → Abschnitt „Delta“ oder neuen Abschnitt anlegen.
2. Datei-Links relativ zum Projektstamm pflegen; bei Code-Stellen Zeile angeben.
3. Jede API-/DB-Änderung erst nach erfolgreicher Laufzeit-Verifikation als „✅ umgesetzt“ markieren.
4. Im [`PROJEKTSTAND.md`](PROJEKTSTAND.md) nur den Geamtüberblick pflegen — Detail-Changes gehören in diese Datei.

---

## 10. Trainer-Portal — Session-Konzept (Schritt 1–3)

Das Trainer-Portal (`/portal/login`, `/portal/verfuegbarkeit`) wird über ein **stateless signiertes Session-Cookie** geschützt — implementiert in [`app/src/lib/portal-session.ts`](app/src/lib/portal-session.ts):

- **Token-Format:** `base64url({ tid, exp }).hmac_sha256_signatur` — der Payload enthält nur `trainerId` und ein 30-Tage-Ablaufdatum (`exp`).
- **Signatur:** `HMAC-SHA256` über den Base64url-Body mit `SESSION_SECRET` aus der Umgebung (siehe [`.env.production`](.env.production)); Verifikation mit `timingSafeEqual` gegen Timing-Angriffe.
- **Cookie:** `trainer_session`, **HttpOnly**, `SameSite=Lax`, **`Path=/portal`** (der Browser sendet das Cookie nur an Seiten/APIs unterhalb von `/portal`, z. B. `/portal/api/auth/me`), Laufzeit **30 Tage** (`maxAge`); Löschen über `maxAge: 0` beim Logout.
- **Secure-Flag:** nur aktiv, wenn `COOKIE_SECURE=true` gesetzt ist (HTTPS); im HTTP-Betrieb (z. B. `http://SERVER-IP:3000`) würde ein Secure-Cookie verworfen.
- **Stateless:** Zur Session-Verifikation ist kein DB-Zugriff nötig; ausschließlich `/portal/api/auth/me` lädt frische Trainer-Stammdaten (inkl. `portal_active`/`is_active`-Prüfung).
- **Login-Logik** ([`login/route.ts`](app/src/app/portal/api/auth/login/route.ts)): Prüfung von `portal_email` + `password_hash` (bcrypt `compare`) plus `portal_active = true` und `is_active = true`; bewusst unspezifische Fehlermeldung gegen Account-Enumeration; nach Erfolg `last_login = NOW()` und Cookie-Set.