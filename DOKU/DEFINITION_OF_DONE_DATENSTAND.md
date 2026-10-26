# Definition of Done — Datenstand (verbindlich)

**Dokumenttyp:** Verbindliche Fachvorgabe (Definition of Done) für die Akzeptanz des Datenstands in der Kursplan-App
**Stand:** 25. Oktober 2026
**Geltungsbereich:** PostgreSQL-Datenbank `kursplan` (Schemas `edoobox_raw` und `kursplan`), n8n-Qualitätskontrolle P04, Datenbestände ab dem Legacy-Stichtag

---

## 1. Ausgangslage

P04 meldete drei Historienlücken als Anomalien, die aus der Zeit **vor dem einheitlichen Regelbetrieb** stammen und nicht durch manuelle Nachbearbeitung „repariert“ werden dürfen (Strikte Soft-Delete-Regel, Schutz historischer Bestände):

| Anomalie | Anzahl | Zeitbezug (Analyse 25.10.2026) |
| --- | ---: | --- |
| Buchungen ohne Angebot (`edoobox_raw.booking` ohne `edoobox_raw.offer`) | 87 | `booking_time` von 2020-05-09 bis **2025-09-11**; Alle 37 Offers nie gespiegelt (auch nicht soft-gelöscht), Datensätze erstmals am 05.09.2026 gespiegelt (`first_seen_at`) |
| Trainer-/Leads ohne Trainerprofil (`edoobox_raw.date_leader` ohne `edoobox_raw.trainer_admin`) | 10 | Zugehörige Termine ausschließlich 2020–2021 (`date_start` bis **2021-09-23**) — historische Admin-Kennungen (O-10) |
| Anwesenheiten ohne Termin (`edoobox_raw.attendance` ohne `edoobox_raw.offer_date`) | 4 | Referenzierter Termin `date_2d9b8b70c915_29795574790` existiert im Spiegel nicht; fachliche letzte Änderung (`payload.last_change`) am **2026-01-15** |

**Beginn des einheitlichen Regelbetriebs:** Erster erfolgreicher Sync-Lauf (`vollabgleich`) am **05.09.2026**; der reguläre P01/P02-Betrieb lief ab 19.09.2026. Die Altbestände wurden beim Erst-Vollabgleich im September 2026 in den Spiegel übernommen.

---

## 2. Verbindlicher Stichtag

> **Stichtag: 2026-09-01 (01.09.2026), 00:00 Uhr Europe/Berlin**

**Begründung:**

1. Der **einheitliche Regelbetrieb** (P90-Sync-Kette) startete mit dem ersten erfolgreichen Vollabgleich am **05.09.2026**. Der Monatserste (01.09.2026) bildet den sauberen, kalenderbasierten Beginn des Regelbetriebs-Zeitraums.
2. Alle drei dokumentierten Historienlücken liegen mit ihren **fachlichen Referenzdaten** vor diesem Stichtag:
   - Buchungen ohne Angebot: jüngste `booking_time` = 11.09.2025
   - Trainer ohne Profil: jüngste Terminzeit = 23.09.2021
   - Anwesenheiten ohne Termin: jüngste fachliche Änderung (`last_change`) = 15.01.2026
3. Ein früherer Stichtag (z. B. 01.01.2024 oder 01.01.2025) würde Nachzügler der Altdaten (Buchungen 2025, Anwesenheiten 01/2026) fälschlich als aktive Lücken bewerten und den Datenstand nicht „Clean“ machen. Der Stichtag 01.09.2026 erfasst **alle** Altbestände vollständig.

**Technische Umsetzung:** `kursplan.datenstand_config` (`schluessel='legacy_stichtag'`, Wert `2026-09-01 00:00:00+02`), Lesezugriff über [`kursplan.get_legacy_stichtag()`](../legacy_data_dod_migration.sql). Die Migration liegt unter [`legacy_data_dod_migration.sql`](../legacy_data_dod_migration.sql), der Anwender unter [`scripts/apply_legacy_data_dod_migration.cjs`](../scripts/apply_legacy_data_dod_migration.cjs).

---

## 3. Ursache der Lücken

- **Unvollständige Altdatenimporte / Altsysteme vor dem Stichtag:** Kurse, Termine und Buchungen kamen aus unterschiedlichen Systemständen (Vor-Regelbetriebs-Datenbestände), die beim Erst-Vollabgleich im September 2026 gespiegelt wurden.
- **37 nie gespiegelte Offers** (Buchungen ohne Angebot): Die referenzierten `offer_id` existieren in `edoobox_raw.offer` weder aktiv noch soft-gelöscht — ein Altsystem-Bezug ohne korrespondierendes Kursangebot.
- **10 historische Admin-Kennungen** (O-10): Platzhalterprofile wurden bewusst nicht erfunden; die betroffenen Termine liegen ausschließlich in 2020–2021.
- **4 Anwesenheiten ohne Termin:** Die referenzierte `date_id` wurde nie in `edoobox_raw.offer_date` gespiegelt (Altdatenbestand der Anwesenheitsliste).

Diese Bestände **werden nicht nachbearbeitet oder gelöscht** (Strikte Soft-Delete-Regel / Schutz historischer Bestände). Sie werden ausschließlich klassifiziert.

---

## 4. Regelung für künftige Daten (verbindlich ab Stichtag)

Für **jeden Datensatz ab dem 01.09.2026** gilt **strikte Null-Toleranz**:

1. **100 % relationale Integrität:** Jede Buchung muss zu einem existierenden Angebot gehören (`edoobox_raw.booking.offer_id` → `edoobox_raw.offer`).
2. **Jeder Trainer-/Lead muss ein Profil haben:** `edoobox_raw.date_leader.admin_id` → `edoobox_raw.trainer_admin`.
3. **Jede Anwesenheit muss zu einem Termin gehören:** `edoobox_raw.attendance.date_id` → `edoobox_raw.offer_date`.
4. Jede Verletzung einer dieser Pflichtrelationen **ab dem Stichtag** wird von P04 als **aktive Anomalie** (Fehler/Warnung) gemeldet und erfordert eine Korrektur bzw. einen dokumentierten Ausschlussgrund.
5. Neue Datensätze werden durch die Sync-Kette (P90/P01/P02/P03) vollständig und konsistent angelegt; fehlende Relationen gelten als Sync-Defekt und sind zu beheben.

**Technische Umsetzung:** Qualitäts-View [`kursplan.v_qualitaet_historienluecken`](../legacy_data_dod_migration.sql) klassifiziert jede Lücke mit `is_legacy`:

- `anzahl_legacy` = altbestand vor dem Stichtag (nur informativ, **kein** P04-Alarm),
- `anzahl_aktiv` = Lücken ab Stichtag (strikte Pflicht, **P04-Alarm**).

Die P04-Kontrollabfrage (Referenz: [`tmp_p04_kontrollen_query.sql`](../tmp_p04_kontrollen_query.sql), Workflow-Export [`n8n/P04_Qualitaetskontrolle.json`](../n8n/P04_Qualitaetskontrolle.json)) verwendet ausschließlich die `*_aktiv`-Werte für Alarmprüfungen.

---

## 5. Warum der Datenstand damit als 100 % fachlich abgenommen und „Clean“ gilt

1. **Alle dokumentierten Historienlücken sind abschließend klassifiziert:** 87 Buchungen ohne Angebot, 10 Trainer ohne Profil, 4 Anwesenheiten ohne Termin — jeweils als `is_legacy = TRUE` (Bestand vor dem Stichtag). Es bestehen **keine unklassifizierten Altbestände** mehr.
2. **Strikte Null-Toleranz ab Stichtag ist technisch verankert:** P04 alarmiert nur noch bei Lücken mit Referenzdatum ≥ 01.09.2026. Mit Stand 25.10.2026 beträgt `anzahl_aktiv = 0` für **alle drei** Kategorien (verifiziert per Live-Abfrage).
3. **Weder Altdaten verfälscht noch gelöscht:** Die Klassifizierung ist rein auswertungsseitig (View/Filterung); der unveränderte Spiegel `edoobox_raw` bleibt Single Source of Truth.
4. **Nachvollziehbarkeit & Governance:** Stichtag, Ursachen, Regelung und Abnahmekriterien sind in diesem Dokument verbindlich festgeschrieben; SQL-Migration, Runner, Qualitäts-View und Verifikationsskript sind versioniert und wiederholbar ausführbar.

> **Abnahme-Statement (verbindlich):** Mit dem verbindlichen Stichtag **01.09.2026** und der strikten Null-Toleranz für alle Datensätze ab diesem Datum gilt der Datenstand der Kursplan-App als **100 % fachlich abgenommen** und **„Clean“ — ohne offene Historienanomalien ab Stichtag.**

---

## 6. Verifikation

```bash
# 1) Migration anwenden (idempotent)
node scripts/apply_legacy_data_dod_migration.cjs

# 2) Legacy-DoD-Verifikation (Automatikprüfung)
node --experimental-strip-types scripts/verify_legacy_dod.ts

# Erwartung:
#   - legacy_stichtag vorhanden (= 2026-09-01)
#   - View kursplan.v_qualitaet_historienluecken existiert
#   - anzahl_aktiv = 0 je Kategorie (buchung_ohne_offer, leader_ohne_trainer, attendance_ohne_termin)
#   - anzahl_legacy = 87 / 10 / 4
```

---

## 7. Änderungshistorie

| Datum | Änderung |
| --- | --- |
| 25.10.2026 | Erstellung der verbindlichen Stichtags-Regelung; Stichtag = 01.09.2026; Migration [`legacy_data_dod_migration.sql`](../legacy_data_dod_migration.sql); Qualitäts-View `kursplan.v_qualitaet_historienluecken`; P04-Abfrage auf `*_aktiv`-Alarme umgestellt |