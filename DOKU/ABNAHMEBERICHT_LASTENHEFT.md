# Abnahmebericht zum Lastenheft – Kursplan-App

**Maßnahme:** M-04 — Gesamtabnahme (konsolidierter Abnahmelauf aller Akzeptanzkriterien)
**Laufdatum:** 2026-10-25 16:18:36 UTC
**Skript:** [`scripts/run_acceptance_tests.cjs`](../scripts/run_acceptance_tests.cjs)
**Ergebnis:** **ABGENOMMEN**

## Zusammenfassung

| Gesamt | OK | WARN | FAIL |
| ---: | ---: | ---: | ---: |
| 30 | 30 | 0 | 0 |

## Prüfprotokoll

| Bereich | Kennung | Prüfung | Status | Detail |
| --- | --- | --- | --- | --- |
| A | A1 | Kern-Spiegeltabellen in edoobox_raw vorhanden | OK | 16/16 |
| A | A2 | Soft-Delete-Kennzeichen is_deleted auf aktiv gespiegelten Tabellen | OK | 5/5 |
| A | A3 | Aktive Spiegeldatensätze (is_deleted IS NOT TRUE) vorhanden | OK | offer=2952 · offer_date=3270 · trainer_admin=16 · booking=4083 |
| A | A4 | P05-Retry-Tracking auf edoobox_raw.sync_run vorhanden | OK | retry_count, retry_of_run_id, retry_status |
| A | A5 | O-7 Alert-Spalten auf edoobox_raw.sync_run vorhanden | OK | alert_sent, alert_sent_at, alert_message |
| B | B1 | Kern-DB-I-Sichten im Schema kursplan vorhanden | OK | v_termin_db1, v_kursart_db1, v_angebot_trainerkosten, v_qualitaet_historienluecken |
| B | B2 | DoD-Stichtag 01.09.2026 in kursplan.datenstand_config wirksam | OK | legacy_stichtag = 01.09.2026 00:00+02 |
| B | B3 | Historienlücke „attendance_ohne_termin“ — keine aktiven Alarme seit Stichtag | OK | gesamt=4 · legacy=4 · aktiv=0 (Erwartung legacy=4, aktiv=0) |
| B | B3 | Historienlücke „buchung_ohne_offer“ — keine aktiven Alarme seit Stichtag | OK | gesamt=87 · legacy=87 · aktiv=0 (Erwartung legacy=87, aktiv=0) |
| B | B3 | Historienlücke „leader_ohne_trainer“ — keine aktiven Alarme seit Stichtag | OK | gesamt=10 · legacy=10 · aktiv=0 (Erwartung legacy=10, aktiv=0) |
| B | B4 | DB-I-Kennzahl „nettoerloes“ innerhalb ±8% der Referenz | OK | Referenz=430049.62 € · Ist=442130.47 € · Δ=2.81% |
| B | B4 | DB-I-Kennzahl „db1“ innerhalb ±8% der Referenz | OK | Referenz=190882.62 € · Ist=197050.47 € · Δ=3.23% |
| B | B4 | DB-I-Kennzahl „direkte_kosten“ innerhalb ±8% der Referenz | OK | Referenz=239167.00 € · Ist=245080.00 € · Δ=2.47% |
| B | B5 | Offene Kostenkonfigurationen = 0 | OK | offen: 0 |
| B | B6 | DB-I-Auswertung liefert Kennzahlen auf Kursarten-Ebene | OK | Kursarten: 235 |
| C | C1 | Kalender — /api/termine | OK | HTTP 200 |
| C | C2 | Trainer-Zuweisung — /api/zuweisung | OK | HTTP 200 |
| C | C3 | Reservierungen — /api/reservierung | OK | HTTP 200 |
| C | C3b | Reservierungen (Lookup) — /api/reservations | OK | HTTP 200 |
| C | C4 | Kursplanung/Status — /api/kurs-status | OK | HTTP 200 |
| C | C5 | Trainer-Stamm — /api/trainer | OK | HTTP 200 |
| C | C6 | Kursthemen — /api/kursthemen | OK | HTTP 200 |
| C | C7 | Kursthemen (API) — /api/course-topics | OK | HTTP 200 |
| C | C8 | System-Logs — /api/logs | OK | HTTP 200 |
| D | P01 | n8n-Workflow P01 aktiv | OK | P01 Operative Ressourcen synchronisieren (eIyJaeTeqWidRYDu) |
| D | P02 | n8n-Workflow P02 aktiv | OK | P02 Stamm- und Referenzdaten synchronisieren (IrS9JcdrOK1MXUO5) |
| D | P03 | n8n-Workflow P03 aktiv | OK | P03 Woechentlicher Gesamt- und Loeschabgleich (Rg3rB0RD8ISL0U6Y) |
| D | P04 | n8n-Workflow P04 aktiv | OK | P04 Qualitaetskontrolle und Benachrichtigung (dnf6LyuhQawESBX0) |
| D | P05 | n8n-Workflow P05 aktiv | OK | P05 Wiederanlauf Sync-Recovery (AyJQYOLPb5421mFF) |
| D | D7 | DoD-Stichtag 01.09.2026 wirksam (P04/Historienlücken) | OK | v_qualitaet_historienluecken aktiv=0 siehe B3 |

## Referenzwerte DB I (Spezifikation / Abschlussbericht)

| Kennzahl | Referenz | Prüfbasis |
| --- | ---: | --- |
| berechenbare Angebote | 1696 | Spezifikation (S62/S63) |
| produktiver Nettoerlös | 430049.62 € | kursplan.v_kursart_db1 (Summe netto) |
| Trainerkosten | 227452.00 € | Abschlussbericht zur DB-I-Auswertung |
| Plattformkosten | 11715.00 € | Abschlussbericht zur DB-I-Auswertung |
| direkte Kosten | 239167.00 € | kursplan.v_kursart_db1 (Summe direkte_kosten_berechenbar) |
| **DB I** | **190882.62 €** | kursplan.v_kursart_db1 (Summe db1_berechenbar) |
| offene Kostenkonfigurationen | 0 | kursplan.v_kursart_db1 (konfiguration_fehlt) |

> Toleranz für Kennzahlen: ±8 % (Ist-Stand weicht nach S63 geringfügig vom Spezifikationsstand ab).

## Prüfumfang (Bereiche)

- **A – DB-Spiegel & Schema-Integrität:** Spiegel-Tabellen, Soft-Delete-Kennzeichen, aktive Bestände, P05-Retry- und O-7-Alert-Spalten auf `edoobox_raw.sync_run`.
- **B – DB-I-Auswertungssichten:** `kursplan.v_termin_db1`, `v_kursart_db1`, `v_angebot_trainerkosten`, `v_qualitaet_historienluecken`; Legacy-Stichtag 01.09.2026; Kennzahlen gegen Referenz; offene Kostenkonfigurationen = 0.
- **C – API-Routen:** Kalender (`/api/termine`), Trainer-Zuweisung (`/api/zuweisung`), Reservierungen (`/api/reservierung`, `/api/reservations`), Kursplanung (`/api/kurs-status`) sowie Trainer-/Stammdaten- und Log-Routen — jeweils HTTP 200.
- **D – n8n-Kette:** P01 (`eIyJaeTeqWidRYDu`), P02 (`IrS9JcdrOK1MXUO5`), P03 (`Rg3rB0RD8ISL0U6Y`), P04 (`dnf6LyuhQawESBX0`) und P05 (`AyJQYOLPb5421mFF`) aktiv; DoD-Stichtag wirksam.

_Erstellt durch `scripts/run_acceptance_tests.cjs` — Abschluss v1.0 / Gesamtabnahme._
