# Abgleichbericht n8n-Workflows P90 und P03

**Stand:** 19.09.2026
**Auftrag:** „Aktiviere die beiden Workflows und gleiche sie ab“ → auf Wunsch **nur Bericht**, es wurden **keine Änderungen** an der n8n-Instanz vorgenommen und **nichts aktiviert**.

**Gegenstand:** Vergleich des deployten P90 („P90 - Eine edoobox-Ressource spiegeln“, ID `XgBiU2H8GgavCbe1`) und des deployten P03 („P03 Woechentlicher Gesamt- und Loeschabgleich“, ID `Rg3rB0RD8ISL0U6Y`) mit

- der Spezifikation [`Spezifikation produktive n8n-Workflows P90-P05.md`](Spezifikation produktive n8n-Workflows P90-P05.md:24),
- dem lokalen, neueren P90-Stand [`p90_build.ps1`](p90_build.ps1:29) / [`p90_node_konfig.js`](p90_node_konfig.js:34) / [`p90_node_holen.js`](p90_node_holen.js:1),
- dem Datenbankschema [`edoobox_spiegelung_schema.sql`](edoobox_spiegelung_schema.sql:120) und [`edoobox-Spiegelung_P90-Zusatztabellen.sql`](edoobox-Spiegelung_P90-Zusatztabellen.sql:31).

---

## 1. Ausgangslage (Kurzfassung)

| Kennung | Zustand | Aktiv? |
|---|---|---|
| P90 | vorhanden (deployt, 13 Knoten) | nein |
| P03 | vorhanden (deployt, 16 Knoten) | nein |
| P01, P02, P04, P05 | fehlen | — |

Zusätzlich existiert **lokal** ein zweiter, neuerer P90-Stand als fertig erzeugtes [`P90 Ressourcen-Unterworkflow.json`](P90 Ressourcen-Unterworkflow.json:1) (10 Knoten), der aus den [`p90_node_*.js`](p90_node_konfig.js:1)-Dateien gebaut wird und konzeptuell von der deployten Fassung **abweicht** (andere Eingangsparameter, anderes UPSERT-Muster, eigener Fehlerpfad).

---

## 2. P90 – Deployter Stand (13 Knoten) vs. DB-Schema

Die feste Whitelist im deployten P90 liegt im Code-Node „Whitelist pruefen und Token extrahieren“ vor. Abgleich der Zieltabelle/des Primärschlüssels gegen die im Workspace vorhandenen DDL-Dateien:

| Ressource (lokal kanonisch) | Deployter P90: Zieltabelle / PK | DB-DDL-Vorgabe | Bewertung |
|---|---|---|---|
| `edo_admins` | `trainer_admin` / `admin_id` | `trainer_admin` / `admin_id` | ✅ |
| `Vat` (lokal `edo_vat`) | `vat` / `vat_id` | `vat` / `vat_id` | ⚠️ nur Kennungsname |
| `Countries` (lokal `edo_countries`) | `country` / `country_id` | `country` / `country_id` | ⚠️ nur Kennungsname |
| `edo_categories` | `category` / `category_id` | `category` / `category_id` | ✅ |
| `edo_offers` | `offer` / `offer_id` | `offer` / `offer_id` | ✅ |
| `edo_users` | **`edo_user` / `user_id`** | **`user_account` / `user_ref` (md5)** | ❌ siehe 3.2 |
| `edo_dates` | `offer_date` / `date_id` | `offer_date` / `date_id` | ✅ |
| `edo_bookings` | `booking` / `booking_id` | `booking` / `booking_id` | ✅ |
| `edo_pricecategories` | `pricecategory` / `pricecategory_id` | `pricecategory` / `pricecategory_id` | ✅ |
| `edo_attendances` | `attendance` / `attendance_id` | `attendance` / `attendance_id` | ✅ |
| `edo_invoices` | `invoice` / `invoice_id` | `invoice` / `invoice_id` | ✅ |
| `edo_transactions` | **`transaction` / `transaction_id`** | **`transaction_full` / `transaction_id`** | ❌ siehe 3.3 |

Die DDL-Vorgaben stehen in [`edoobox-Spiegelung_P90-Zusatztabellen.sql`](edoobox-Spiegelung_P90-Zusatztabellen.sql:93) (`user_account`) und [`edoobox-Spiegelung_P90-Zusatztabellen.sql`](edoobox-Spiegelung_P90-Zusatztabellen.sql:127) (`transaction_full`). Die vom deployten P90 verwendeten Tabellen **`edo_user`** und **`transaction`** sind in keiner vorliegenden SQL-Datei definiert.

---

## 3. Abweichungen im deployten P90

### 3.1 Zwei unterschiedliche P90-Stände (architektonisch)

- **Deployt (13 Knoten):** generischer Mapper mit Laufzeit-Spaltenintrospektion (`information_schema`), Whitelist validiert `resource_key`/`api_path`/`target_table`/`primary_key` gegen feste Werte, Löschabgleich über Spalte `last_run_id`.
- **Lokal (10 Knoten):** [`p90_node_konfig.js`](p90_node_konfig.js:34) leitet Endpunkt/Tabelle/PK **allein aus `Ressourcenkennung`** ab; Normalisierung + Hash/UPSERT in einem `jsonb_to_recordset`-CTE (vgl. [`p90_node_holen.js`](p90_node_holen.js:166)); Löschabgleich per `pk NOT IN (...)`; eigener `errorTrigger`-Pfad ([`p90_build.ps1`](p90_build.ps1:57)).

Konsequenz: Die beiden Stände sind **nicht durch kleine Parameter-Patches austauschbar**; ein Umstieg auf den lokalen Stand verlangt auch geänderte P03-Eingangsparameter und neu anzuhängende Credentials.

### 3.2 `edo_users`: falsche Zieltabelle + fehlende MD5-Transformation

- Deployter P90 zielt auf `edo_user`/`user_id`. Korrekt ist `user_account`/`user_ref` mit **`user_ref = md5(edoobox-Benutzerkennung)`** (Datensparsamkeit E-27a, [`edoobox-Spiegelung_P90-Zusatztabellen.sql`](edoobox-Spiegelung_P90-Zusatztabellen.sql:93)).
- Der deployte Code speichert bei `pk_value = roh[pkSpalte] ?? roh.id` die **Roh-ID** statt des Hashs. Der lokal kanonische Stand bildet die Umwandlung über `userRef`/`md5(t.quelle)` ab ([`p90_node_konfig.js`](p90_node_konfig.js:247), [`p90_node_holen.js`](p90_node_holen.js:206)).

### 3.3 `edo_transactions`: falsche Zieltabelle

- Deployter P90 zielt auf `transaction`/`transaction_id`. Korrekt ist `transaction_full`/`transaction_id` (Gesamtressource ohne `userdata`).

### 3.4 Kennungs-Diskrepanz `Vat`/`Countries`

- Deployter P90 und P03 verwenden `Vat` und `Countries`; lokal/SQL-Vorgabe ist `edo_vat` und `edo_countries` (vgl. [`P90_Ressourcen_Konfiguration.sql`](P90_Ressourcen_Konfiguration.sql:13)).

### 3.5 Löschabgleich benötigt Spalte `last_run_id`, die nirgends definiert ist

- Der Node „Loeschabgleich SQL bauen“ verlangt je Zieltabelle die Spalten `is_deleted` **und** `last_run_id`. Eine Suche über alle SQL-Dateien findet **kein einziges Vorkommen von `last_run_id`**. Da P03 alle zwölf Ressourcen mit `track_deletions = true` aufruft, würde der deployte P90 bei Vollabgleich **für jede Ressource** bei diesem Node mit Fehler abbrechen (sofern `last_run_id` nicht außerhalb der vorliegenden Dateien manuell ergänzt wurde). Der lokale Stand löst das Löschen korrekt per `pk NOT IN (...)` ohne `last_run_id`.

### 3.6 Kein Fehler-Trigger-Pfad

- Der deployte P90 besitzt keinen `n8n-nodes-base.errorTrigger`; Fehler enden als Node-Fehler. Die Spezifikation verlangt einen Fehlerpfad, der `sync_run.error_text` setzt und den Lauf auf `fehler` stellt ([`Spezifikation produktive n8n-Workflows P90-P05.md`](Spezifikation produktive n8n-Workflows P90-P05.md:400)). Der lokale Stand hat diesen Pfad ([`p90_build.ps1`](p90_build.ps1:57)).

### 3.7 Test-PinData

- Der deployte P90 hat an „Seitenweiser Abruf“ und „Spaltenbestand ermitteln“ **festes PinData** (edo_offers, `run_id 999001`, `page_size 50`). Vor Inbetriebnahme entfernen, damit keine Altwerte Testläufe verfälschen.

---

## 4. Abweichungen im deployten P03

### 4.1 Trigger ist manuell statt wöchentlich

- Aktuell `n8n-nodes-base.manualTrigger`. Spezifikation verlangt wöchentlich nachts (Vorschlag **Sonntag 03:00 Uhr, `Europe/Berlin`**, Cron `0 3 * * 0`).

### 4.2 Finales UPDATE trifft nicht vorhandene `sync_run`-Spalten

Der Node „P03 Lauf abschliessen“ schreibt diese Spalten:

`resources_total`, `resources_failed`, `records_seen`, `records_new`, `records_changed`, `records_deleted`, `api_calls_total`

Das Basis-Schema [`edoobox_spiegelung_schema.sql`](edoobox_spiegelung_schema.sql:120) definiert für `sync_run` jedoch nur `run_id, run_type, started_at, finished_at, status, bookings_seen, bookings_changed, api_calls, error_text`. Die Zusatztabellen-Datei ergänzt lediglich `abgleichsart` und `hinweis` ([`edoobox-Spiegelung_P90-Zusatztabellen.sql`](edoobox-Spiegelung_P90-Zusatztabellen.sql:153)). **Keine** der oben genannten Aggregatspalten ist in irgendeiner vorliegenden SQL-Datei vorhanden. Der abschließende UPDATE von P03 würde daher mit SQL-Fehler scheitern.

### 4.3 Aufrufe verwenden alte Kennungen und falsche Tabellen

- `P03 P90: Vat` / `P03 P90: Countries` verwenden die Kennungen `Vat`/`Countries` statt `edo_vat`/`edo_countries` (durchgängig, aber nicht kanonisch).
- `P03 P90: Nutzer` → `edo_user`/`user_id`, `P03 P90: Transaktionen` → `transaction`/`transaction_id` (falsch, siehe 3.2/3.3).

### 4.4 Kein P04-Aufruf am Laufende

- Ziel laut Spezifikation: nach Abschluss P04 ausführen. Der deployte P03 endet bei „P03 Lauf abschliessen“. P04 existiert derzeit nicht, daher ist dies ein Folge-Baustein, kein Sofort-Fehler.

### 4.5 Parallelitätsschutz ok, Statusaggregation ok

- „P03 Vollabgleich starten“ bricht offene `vollabgleich`-Läufe ab und legt einen neuen `laeuft`-Lauf an – konform.
- „P03 Ergebnisse aggregieren“ liest korrekt `gelesen/neu/geaendert/geloescht/api_calls/vollstaendig` je Ressource und markiert den Lauf bei Abweichung als `fehler` (Vertrag mit dem deployten P90-Ausgang ist konsistent).

---

## 5. Voraussetzungen an der Datenbank (unverifiziert)

Vor einer Aktivierung ist gegen die Live-Datenbank zu prüfen bzw. herzustellen:

- Existenz der DDL aus [`edoobox-Spiegelung_P90-Zusatztabellen.sql`](edoobox-Spiegelung_P90-Zusatztabellen.sql:31): `vat`, `country`, `category`, `pricecategory`, `user_account`, `attendance`, `transaction_full`, `sync_run_resource`.
- `sync_run`-Aggregatspalten (siehe 4.2) oder Umbau des Abschluss-UPDATE.
- `last_run_id`-Frage (3.5) oder Umstieg auf das PK-Vergleich-Löschmuster.

---

## 6. Maßnahmenliste (priorisiert)

| # | Prio | Maßnahme | Betrifft |
|---|---|---|---|
| M1 | 🔴 kritisch | `edo_users` auf `user_account`/`user_ref` korrigieren **und** MD5-Transformation der edoobox-Benutzerkennung ergänzen (keine Roh-ID). | P90 + P03-Aufruf |
| M2 | 🔴 kritisch | `edo_transactions` auf `transaction_full`/`transaction_id` korrigieren. | P90 + P03-Aufruf |
| M3 | 🟠 hoch | Kennungen vereinheitlichen: `Vat`→`edo_vat`, `Countries`→`edo_countries` (P90-Whitelist **und** P03-Aufrufe). | P90 + P03 |
| M4 | 🟠 hoch | `sync_run`-Aggregatspalten (`resources_total`, `resources_failed`, `records_seen`, `records_new`, `records_changed`, `records_deleted`, `api_calls_total`) per `ALTER TABLE` ergänzen **oder** „P03 Lauf abschliessen“ auf `sync_run_resource`-Aggregation umbauen. | DB + P03 |
| M5 | 🟠 hoch | Löschabgleich-Frage klären: entweder `last_run_id` auf allen 12 Zieltabellen ergänzen, oder auf das PK-Vergleich-Muster des lokalen P90 umstellen. | DB + P90 |
| M6 | 🟠 hoch | P03-Trigger auf wöchentlichen Schedule-Trigger umstellen (Cron `0 3 * * 0`, `Europe/Berlin`). | P03 |
| M7 | 🟠 hoch | Zusatztabellen-SQL anwenden und gegen Live-DB verifizieren (sofern noch nicht geschehen). | DB |
| M8 | 🟡 mittel | **P90-Baseline-Entscheidung treffen:** (a) deployten 13-Knoten-P90 behalten und M1–M5 nachziehen, oder (b) lokalen 10-Knoten-P90 deployen, dann P03-Eingangsparameter auf `Ressourcenkennung`/`Laufkennung`/`Löschungen auswerten` umstellen und Credentials `Custom Auth account` + `PostgreSQL Kursplan – n8n_writer` am neuen Workflow anhängen (lokaler Build enthält keine Credentials). | P90 + P03 |
| M9 | 🟡 mittel | Fehlerpfad ergänzen: `sync_run.error_text` + Status `fehler` bei P90-Fehlern absichern (deployter P90 hat keinen `errorTrigger`). | P90 |
| M10 | 🟢 niedrig | P03-Abschluss um P04-Aufruf ergänzen, sobald P04 gebaut ist. | P03 |
| M11 | 🟢 niedrig | Test-PinData im deployten P90 entfernen. | P90 |

**Nicht sinnvoll vor Abschluss von M1–M9:** die Workflows aktivieren. Erst nach Behebung der kritischen/hohen Punkte und erfolgreicher Validierung (`n8n_validate_workflow`) kann P90 (Unterworkflow) und P03 (Zeitplan) aktiviert werden.