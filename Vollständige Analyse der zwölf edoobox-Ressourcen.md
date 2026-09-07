# Vollständige Analyse der zwölf edoobox-Ressourcen

Stand: 5. September 2026

## Ergebnis

Alle zwölf im Schaubild „DB-Struktur edoobox v2“ genannten Ressourcen wurden vollständig und seitenweise gelesen. Für jede Ressource wurden Endpunkt, Datensatzanzahl, Feldbestand, Datentypen und technische Beziehungen geprüft. Personenbezogene Feldwerte wurden nicht ausgegeben oder gespeichert.

| Ressource | Endpunkt | Datensätze | Feldpfade | Ergebnis |
|---|---|---:|---:|---|
| `edo_admins` | `/admin/list` | 15 | 21 | vollständig |
| `Vat` | `/vat/list` | 13 | 9 | vollständig |
| `Countries` | `/country/list` | 245 | 5 | vollständig |
| `edo_categories` | `/category/list` | 823 | 17 | vollständig |
| `edo_offers` | `/offer/list` | 2.621 | 47 | vollständig |
| `edo_users` | `/user/list` | 3.578 | 46 | vollständig |
| `edo_dates` | `/date/list` | 2.905 | 10 | vollständig |
| `edo_bookings` | `/booking/list` | 4.038 | 20 | vollständig |
| `edo_pricecategories` | `/pricecategory/list` | 10.498 | 12 | vollständig |
| `edo_attendances` | `/attendance/list` | 5.459 | 6 | vollständig |
| `edo_invoices` | `/invoice/list` | 2.127 | 13 | vollständig |
| `edo_transactions` | `/transaction/list` | 5.137 | 18 | vollständig |

## Trainer- und Terminbeziehung

Die Trainerzuordnung ist nicht im Angebot oder in der Buchung gespeichert. Sie liegt in:

`edo_dates.leader[] → edo_admins.id`

Ergebnis:

- 2.905 Datums- beziehungsweise Moduleinträge
- 2.820 Einträge mit mindestens einem Trainer
- 85 Einträge ohne Trainer
- 9 Einträge mit mehreren Trainern
- 2.829 Trainerzuweisungen insgesamt
- 17 verschiedene historische Trainerkennungen
- 2.813 Zuordnungen passen zu einem der 15 aktuellen Administratoren
- 16 Zuordnungen verweisen auf zwei nicht mehr in `edo_admins` vorhandene Kennungen

Die realen Trainerkosten sind nicht in edoobox enthalten. edoobox liefert nur die technische Zuordnung. Kostenprofile, Kurstarife und Ausnahmen werden im Schema `kursplan` geführt.

## Wesentliche Beziehungen

| Beziehung | Passend | Fehlend | Bewertung |
|---|---:|---:|---|
| `dates.offer → offers.id` | 2.905 | 0 | vollständig |
| `dates.leader[] → admins.id` | 2.813 | 16 | zwei historische Trainer fehlen |
| `bookings.offer → offers.id` | 3.951 | 87 | historische oder gelöschte Angebote |
| `bookings.users[].user → users.id` | 5.742 | 1 | nahezu vollständig |
| `bookings.users[].pricecategory → pricecategories.id` | 5.718 | 25 | historische Preiskategorien fehlen |
| `pricecategories.offer → offers.id` | 9.733 | 765 | historische oder gelöschte Angebote |
| `attendances.date → dates.id` | 5.455 | 4 | vier historische Termine fehlen |
| `attendances.user → users.id` | 5.459 | 0 | vollständig |
| `invoices.user → users.id` | 2.092 | 35 | historische Benutzer fehlen |
| `transactions.booking → bookings.id` | 4.038 | 0 | vollständig, 1.099 Transaktionen ohne Buchungsbezug |
| `transactions.offer → offers.id` | 3.951 | 87 | entspricht den fehlenden Buchungsangeboten |
| `transactions.userdata.id → users.id` | 5.038 | 0 | vollständig |

## Auffälligkeiten

- **Mehrere Datumszeilen je Angebot:** 2.905 Datumszeilen beziehen sich auf 2.605 verschiedene Angebote. Ein Angebot kann daher mehrere Module oder Unterrichtstermine enthalten.
- **Aktuelle Administratorliste ist keine vollständige Historie:** Die Datumstabelle enthält 17 Trainerkennungen, die aktuelle Administratorliste nur 15. Die beiden fehlenden Kennungen müssen als historische Trainerprofile erhalten werden.
- **`invoice.paytrans` ist keine Transaktions-ID:** Keine der 2.127 Angaben passt zu `transactions.id`. Dieses Feld darf nicht mit der normalen Transaktionstabelle verknüpft werden.
- **Eigenständige Transaktionsressource ist umfangreicher:** 1.099 von 5.137 Transaktionen haben keinen Buchungs- oder Angebotsbezug. Die bisher aus Buchungen abgeleiteten Transaktionen bilden die Gesamtressource deshalb nicht vollständig ab.
- **Historische Referenzlücken:** Fehlende Kategorien, Umsatzsteuerregeln, Angebote, Benutzer und Preiskategorien sind überwiegend mit gelöschten oder nicht mehr ausgelieferten Stammdaten vereinbar. Sie dürfen nicht durch erfundene aktuelle Datensätze ersetzt werden.

## Konsequenzen für die Spiegelung

### Zusätzlich erforderlich

- `edoobox_raw.date` mit `date_id`, `offer_id`, Beginn, Ende, Beschreibung, Ort und Raum
- `edoobox_raw.date_leader` als eigene Zuordnungstabelle für beliebig viele Trainer je Datumszeile
- `edoobox_raw.admin` mit technischer Kennung und nur den für die Trainerverwaltung benötigten Feldern
- historische Platzhalterprofile für die zwei nicht mehr ausgelieferten Trainerkennungen

### Nicht erforderlich für DB I

- vollständige Teilnehmerdaten aus `edo_users`
- `edo_attendances`
- eingebettete Personendaten aus `transactions.userdata`
- Zahlungsdaten ohne Buchungs- oder Angebotsbezug

Diese Daten werden aus Datenschutz- und Zweckbindungsgründen nicht in die Kursplan-Spiegelung übernommen.

### Anpassung des DB-I-Modells

- Ohne auflösbare Trainerzuordnung bleibt die Kostenkonfiguration offen.
- Es gibt keine automatische Annahme „eigene Durchführung“.
- Die eigene Pauschale von 280 Euro gilt nur bei expliziter Zuordnung zum eigenen Trainerprofil.
- Fremdtrainerkosten werden aus dem eigenen Kostenprofil des Trainers und der Kursart bestimmt.
- Terminbezogene Ausnahmen können den Standardtarif überschreiben.
- Bei Angeboten mit mehreren Datumszeilen muss festgelegt werden, ob die Trainerpauschale je Datumszeile oder je Gesamtangebot gilt.
