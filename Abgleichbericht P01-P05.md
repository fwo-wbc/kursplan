# Abgleichbericht produktive n8n-Workflows P01–P05

**Stand:** 19.09.2026
**Auftrag:** „Beginne die Erstellung der Workflows P01, P02, P04 und P05. und ergänze P03.“

**Ergebnis auf einen Blick:** P01, P02, P04 und P05 wurden als neue Workflows angelegt und validiert. P03 wurde ergänzt (korrekte Aggregation, P04-Aufruf, korrigierte Ressourcen-Mappings) und zusammen mit dem gemeinsamen Unterworkflow P90 erneut veröffentlicht. Die DB-Spiegelkette P03 → P90 ist damit wieder lauffähig.

---

## 1. Erstellte und bearbeitete Workflows

| Kennung | Name | n8n-ID | Aktiv? | Zustand |
|---|---|---|---|---|
| P90 | P90 Ressourcen-Unterworkflow | `XgBiU2H8GgavCbe1` | ✅ aktiv | Fehler behoben, erneut veröffentlicht |
| P03 | P03 Woechentlicher Gesamt- und Loeschabgleich | `Rg3rB0RD8ISL0U6Y` | ✅ aktiv | ergänzt, erneut veröffentlicht |
| P04 | P04 Qualitaetskontrolle und Benachrichtigung | `dnf6LyuhQawESBX0` | ✅ aktiv | neu angelegt, veröffentlicht (Unterworkflow-Abhängigkeit) |
| P01 | P01 Operative Ressourcen synchronisieren | `eIyJaeTeqWidRYDu` | ⏸ inaktiv | neu angelegt, validiert |
| P02 | P02 Stamm- und Referenzdaten synchronisieren | `IrS9JcdrOK1MXUO5` | ⏸ inaktiv | neu angelegt, validiert |
| P05 | P05 Manueller Wiederanlauf | `DRcCDA7Dp02NYryE` | ⏸ inaktiv | neu angelegt, validiert |

---

## 2. Neu erstellte Workflows (Details)

### 2.1 P01 — Operative Ressourcen synchronisieren (inaktiv)

- **Zeitplan:** Cron `*/15 8-23 * * 1-5`, Zeitzone `Europe/Berlin` (werktags 08:00–23:45, kein Wochenende).
- **Ressourcen (7):** `edo_offers`, `edo_dates`, `edo_bookings`, `edo_pricecategories`, `edo_attendances`, `edo_invoices`, `edo_transactions` — jeweils über P90 mit `track_deletions = false`.
- **Ablauf:** `P01 Lauf anlegen` (bricht offene P01-Läufe ab, neuer Lauf `run_type='P01'`) → 7 × `P01 P90: …` → `P01 Lauf abschliessen` (Aggregation aus `edoobox_raw.sync_run_resource`) → `P01 P04 ausfuehren`.

### 2.2 P02 — Stamm- und Referenzdaten synchronisieren (inaktiv)

- **Zeitplan:** Cron `0 2 * * *`, Zeitzone `Europe/Berlin` (täglich 02:00).
- **Ressourcen (5):** `edo_admins`, `edo_vat`, `edo_countries`, `edo_categories`, `edo_users` — jeweils über P90 mit `track_deletions = false` (Löschabgleich bleibt P03 vorbehalten).
- **Datenschutz:** `edo_users` wird über P90 ausschließlich als `user_ref = md5(edoobox-Benutzerkennung)` in `user_account` gespiegelt.

### 2.3 P04 — Qualitätskontrolle und Benachrichtigung (aktiv)

- **Auslöser:** `P04 Taeglich starten` (Cron `30 4 * * *`) **und** `P04 Aufruf Eingang` (Execute-Workflow-Eingang für P01/P02/P03/P05).
- **Wirkprinzip:** verändert keine edoobox-Nutzdaten; liest nur und schreibt ausschließlich in `edoobox_raw.sync_run` (eigener `run_type='P04'`).
- **Prüfungen:**
  - Laufalter: P01 ≤ 30 Min. im Betriebszeitfenster, P02 ≤ 26 h, P03 ≤ 8 Tage.
  - Offene Kostenkonfigurationen (`kursplan.v_termin_db1.kostenkonfiguration_fehlt`).
  - Beziehungen: Termine ohne Angebot, Buchungspositionen/‑transaktionen ohne Buchung (harte Fehler) sowie Buchungen/Anwesenheiten/Trainerzuordnungen ohne Referenz (Warnungen).
  - Produktive Angebote ohne Trainer (Warnung).
  - DB-I-Kennzahlen ab 2023 (Kontrollmarken, nur Information): Netto, Trainerkosten, Plattformkosten, direkte Kosten, DB I, berechenbare Angebote.
- **Benachrichtigungskanal:** E-Mail ist gemäß offenem Punkt O-7 der [Spezifikation produktive n8n-Workflows P90-P05.md](Spezifikation produktive n8n-Workflows P90-P05.md:523) noch offen; P04 meldet Abweichungen derzeit über `sync_run.status='fehler'` und `sync_run.error_text`.

### 2.4 P05 — Manueller Wiederanlauf (inaktiv)

- **Auslöser:** manuell (`n8n-nodes-base.manualTrigger`).
- **Eingaben** (im Code-Knoten `P05 Eingaben`): `Ressource` (`alle` oder eine von 12 festen Kennungen), `Abgleichsart` (`normal`/`voll`), `Hinweis`.
- **Schutzmaßnahmen:** feste Auswahlliste wird in `P05 Plan aufloesen` erzwungen (unbekannte Kennung → Fehler, E-31c/E-31j); kein freier Tabellen-/SQL-Name.
- **Ablauf:** `P05 Lauf anlegen` (`run_type='P05'`, speichert `abgleichsart`/`hinweis`) → `P05 Plan aufloesen` → `P05 P90 spiegeln` (Modus „Run once for each item“) → `P05 Lauf abschliessen` → `P05 P04 ausfuehren`.

---

## 3. Ergänzung an P03

| # | Maßnahme | Ergebnis |
|---|---|---|
| 1 | Aggregation korrigiert | `P03 Lauf abschliessen` wertet jetzt die von P90 geschriebene Tabelle `edoobox_raw.sync_run_resource` aus (vorher wurden die `{success:true}`-Knotenausgaben gelesen, wodurch immer `fehler` entstand). |
| 2 | P04-Aufruf ergänzt | `P03 P04 ausfuehren` (Execute Workflow → P04) am Laufende. |
| 3 | Ressourcen-Mappings korrigiert | `P03 P90: Nutzer` → `user_account`/`user_ref`; `P03 P90: Transaktionen` → `transaction_full`/`transaction_id`. |
| 4 | Ungenutzter Knoten entfernt | `P03 Ergebnisse aggregieren` (fehlerhafte Knotenausgaben-Aggregation) entfernt. |

---

## 4. Fehlerbehebungen an P90 (notwendig für P02/P03)

| # | Fehler | Behebung |
|---|---|---|
| 1 | `edo_users` erzeugte SQL „column o.owner does not exist“ (Hash-Vergleich gegen nicht gespiegelte Spalte). | `hashFelder` von `['owner']` auf `['user_ref']` korrigiert. |
| 2 | `api_aufrufe` las `holen.abrufe` (existiert nicht) statt `holen.anzahlAbrufe`. | Lesefehler korrigiert; API-Aufrufzähler fließen jetzt korrekt in `sync_run_resource.api_calls`. |

---

## 5. Validierung

Alle sechs Workflows bestehen `n8n_validate_workflow` mit **0 Fehlern**:

| Workflow | Knoten | Trigger | Verbindungen | Ergebnis |
|---|---:|---:|---:|---|
| P01 | 11 | 1 | 10 | ✅ |
| P02 | 9 | 1 | 8 | ✅ |
| P03 | 16 | 1 | 15 | ✅ |
| P04 | 6 | 2 | 5 | ✅ |
| P05 | 9 | 1 | 8 | ✅ |
| P90 | 10 | 2 | 8 | ✅ |

---

## 6. Veröffentlichungszustand und Reihenfolge

- **Bereits veröffentlicht (aktiv):** P90, P03, P04. P04 musste zuerst veröffentlicht werden, weil P01/P02/P03/P05 ihn als Unterworkflow referenzieren.
- **Noch inaktiv (vor Inbetriebnahme zu aktivieren):** P01, P02, P05.
- **Empfohlene Aktivierungsreihenfolge:** P04 → P90 → P03 → P01 → P02 → P05.

Hinweis: P04 läuft bereits täglich um 04:30 und meldet bis zur Aktivierung von P01/P02 erwartungsgemäß „kein erfolgreicher P01/P02-Lauf“.

---

## 7. Offene Punkte (nicht behoben, aus der Spezifikation übernommen)

- **O-7 Benachrichtigungskanal** für P04 (E-Mail) weiterhin offen.
- **O-8 Detailabrufe:** Der Rechnungs-Detailabruf `/v2/invoice/{id}/data` bleibt zulässig (Entscheidung 19.09.2026); die Rechnungs-Kindtabellen (`invoice_item`, `invoice_line`, `invoice_payment`, `invoice_receipt`) werden weiterhin über diesen Endpunkt befüllt, jedoch nicht über P90 (P90 spiegelt nur den Rechnungskopf via `/invoice/list`). Die Ableitung von `booking_position`/`booking_transaction` ohne Buchungs-Detailendpunkt aus `booking/list` bleibt offen.
- **O-9 vollständige Transaktionsressource** ist über `transaction_full` abgedeckt; Buchungsbezug bleibt zusätzlich in `booking_transaction`.
- **O-10 historische Platzhalterprofile** (fehlende Admin-/Trainerkennungen) wurden nicht erfunden; FK-Lücken werden in P04 als Warnung geführt.

Vgl. [Abgleichbericht P90-P03.md](Abgleichbericht P90-P03.md:1) und [Spezifikation produktive n8n-Workflows P90-P05.md](Spezifikation produktive n8n-Workflows P90-P05.md:497).