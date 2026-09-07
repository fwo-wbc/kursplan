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

Ergebnis der Erstprüfung vor der Bereinigung:

- 2.905 Datums- beziehungsweise Moduleinträge
- 2.820 Einträge mit mindestens einem Trainer
- 85 Einträge ohne Trainer
- 9 Einträge mit mehreren `leader`-Einträgen
- 2.829 Trainerzuweisungen insgesamt
- 17 verschiedene historische Trainerkennungen
- 2.813 Zuordnungen passen zu einem der 15 aktuellen Administratoren
- 16 Zuordnungen verweisen auf zwei nicht mehr in `edo_admins` vorhandene Kennungen

Nach der manuellen Prüfung in edoobox wurden die real vorhandenen Doppelzuordnungen korrigiert. Bei zwei weiteren Angeboten zeigte die API eine Mehrfachzuordnung, obwohl in der Oberfläche nur ein Trainer vorhanden war; nach Löschen und erneuter Zuweisung dieses Trainers verschwand auch diese Inkonsistenz. Die erneuten Prüfungen mit den Schritten 52 und 53 bestätigen den bereinigten Bestand.

Aktueller Stand:

- keine Mehrfachzuordnung mehr vorhanden
- 2.820 Datumszeilen mit genau einer Trainerzuordnung
- 85 Datumszeilen ohne Trainerzuordnung
- 2.820 Trainerzuordnungen insgesamt
- 16 verschiedene eingesetzte historische und aktuelle Trainerkennungen
- 2.810 Zuordnungen passen zu 13 der 15 aktuellen Administratoren
- 10 Zuordnungen verteilen sich auf drei nicht mehr in `edo_admins` vorhandene Kennungen
- zwei aktuelle Administratoren haben bisher keine Trainerzuordnung
- Angebote ohne Trainer bleiben als Ausnahme bestehen

Die realen Trainerkosten sind nicht in edoobox enthalten. edoobox liefert nur die technische Zuordnung. Kostenprofile, Kurstarife und Ausnahmen werden im Schema `kursplan` geführt.

## Wesentliche Beziehungen

| Beziehung | Passend | Fehlend | Bewertung |
|---|---:|---:|---|
| `dates.offer → offers.id` | 2.905 | 0 | vollständig |
| `dates.leader[] → admins.id` | 2.810 | 10 | bereinigter Stand; drei historische Trainerkennungen fehlen |
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
- **Aktuelle Administratorliste ist keine vollständige Historie:** Der bereinigte Bestand enthält 16 eingesetzte Trainerkennungen. Davon gehören 13 zur aktuellen Administratorliste; drei historische Kennungen mit insgesamt zehn Zuordnungen werden nicht mehr über `edo_admins` ausgeliefert und müssen bei der Spiegelung als historische Profile behandelt werden. Zwei aktuelle Administratoren besitzen bislang keine Zuordnung.
- **Bereinigte Mehrfachzuordnungen:** Die neun zunächst gefundenen Datumszeilen mit mehreren `leader`-Einträgen wurden in edoobox korrigiert. Schritt 53 liefert anschließend keine Treffer mehr.
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
