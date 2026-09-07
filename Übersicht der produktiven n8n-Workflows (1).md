# Übersicht der produktiven n8n-Workflows

**Stand:** 5. September 2026  
**Ziel:** Dauerhafte, nachvollziehbare Aktualisierung der edoobox-Spiegelung und der darauf aufbauenden DB-I-Auswertung

## Empfehlung

Die produktive Lösung sollte aus fünf ausführbaren Workflows und einem wiederverwendbaren Unterworkflow bestehen. Die bisher erstellten Schritte S01 bis S62 bleiben Prüf-, Aufbau- und Migrationswerkzeuge. Sie werden nicht einzeln zeitgesteuert aktiviert.

Die ursprüngliche Planung aus Lastenheft Version 1.5 sah Webhook-Empfang, Ereignisverarbeitung, inkrementellen Abruf und wöchentlichen Vollabgleich vor. Die vollständige Prüfung der edoobox-API hat inzwischen gezeigt, dass alle zwölf Ressourcen mit großen Seiten abgerufen werden können. Der aktuelle Gesamtbestand benötigt nur 27 Listenaufrufe:

| Ressource | Datensätze | Seiten bei geprüfter Seitengröße |
|---|---:|---:|
| Admins | 15 | 1 |
| Umsatzsteuer | 13 | 1 |
| Länder | 245 | 1 |
| Kategorien | 823 | 1 |
| Angebote | 2.621 | 2 |
| Benutzer | 3.578 | 2 |
| Datumszeilen | 2.905 | 2 |
| Buchungen | 4.038 | 3 |
| Preiskategorien | 10.498 | 6 |
| Anwesenheiten | 5.459 | 3 |
| Rechnungen | 2.127 | 2 |
| Transaktionen | 5.137 | 3 |
| **Gesamt** | **37.459** | **27** |

Damit ist ein regelmäßiger vollständiger Listenabgleich technisch einfach und belastbarer als eine komplexe Webhook-Architektur. Hashvergleiche verhindern unnötige Aktualisierungen unveränderter Datensätze.

## Zielstruktur

| Kennung | Workflow | Auslöser | Aufgabe |
|---|---|---|---|
| P01 | Operative Ressourcen synchronisieren | alle 15 Minuten, werktags 08:00 bis 23:45 Uhr | Angebote, Datumszeilen, Buchungen, Preiskategorien, Anwesenheiten, Rechnungen und Transaktionen abgleichen |
| P02 | Stamm- und Referenzdaten synchronisieren | täglich nachts | Admins, Umsatzsteuer, Länder, Kategorien und Benutzer abgleichen |
| P03 | Wöchentlicher Gesamt- und Löschabgleich | wöchentlich nachts | alle zwölf Ressourcen vollständig prüfen und fehlende Datensätze als gelöscht kennzeichnen |
| P04 | Qualitätskontrolle und Benachrichtigung | nach P01 bis P03 sowie täglich | Beziehungen, Vollständigkeit, DB I und ausgebliebene Läufe kontrollieren |
| P05 | Manueller Wiederanlauf | manuell | einzelne Ressource oder vollständigen Abgleich kontrolliert erneut ausführen |
| P90 | Eine edoobox-Ressource spiegeln | nur durch P01 bis P05 | gemeinsamer technischer Unterworkflow für Authentifizierung, Seitenabruf, Hashvergleich, UPSERT und Protokollierung |

## P01 Operative Ressourcen synchronisieren

### Aufgabe

P01 hält alle für Kursbelegung, Erlös, Trainerzuordnung und DB I relevanten Bewegungsdaten aktuell.

### Zeitplan

- Alle 15 Minuten von Montag bis Freitag zwischen 08:00 und 23:45 Uhr.
- n8n-Cron: `*/15 8-23 * * 1-5`.
- Zeitzone `Europe/Berlin`.
- Zwischen 00:00 und 08:00 Uhr sowie am Wochenende findet kein regulärer P01-Lauf statt.
- Änderungen aus der Pause werden mit dem ersten Lauf um 08:00 Uhr vollständig nachgezogen.
- Keine parallelen Ausführungen desselben Workflows.

### Ressourcen

1. `edo_offers`
2. `edo_dates`
3. `edo_bookings`
4. `edo_pricecategories`
5. `edo_attendances`
6. `edo_invoices`
7. `edo_transactions`

Der aktuelle Umfang entspricht 21 Listenaufrufen je Lauf. Bei 64 Läufen an einem Werktag entstehen ungefähr 1.344 Listenaufrufe. Dieser Umfang ist für den geprüften Bestand unkritisch.

### Ablauf

1. Lauf in `edoobox_raw.sync_run` mit Status `laeuft` anlegen.
2. Kurzlebigen edoobox-Zugriffstoken beziehen.
3. Die sieben Ressourcen nacheinander über P90 abrufen.
4. Neue und geänderte Datensätze per UPSERT übernehmen.
5. Beziehungen wie Datumszeile zu Angebot und Trainerzuordnung aktualisieren.
6. Lauf mit Zählwerten und Status `erfolgreich` abschließen.
7. P04 ausführen.

Eine fehlerhafte Ressource darf nicht unbemerkt zu einem insgesamt erfolgreichen Lauf führen. Der Lauf erhält in diesem Fall den Status `fehler`.

## P02 Stamm- und Referenzdaten synchronisieren

### Aufgabe

P02 aktualisiert Ressourcen, die sich selten ändern, aber für Beziehungen und Bezeichnungen benötigt werden.

### Zeitplan

- Täglich nachts, beispielsweise um 02:00 Uhr.
- Nicht gleichzeitig mit P03.

### Ressourcen

1. `edo_admins`
2. `Vat`
3. `Countries`
4. `edo_categories`
5. `edo_users`

Der aktuelle Umfang entspricht sechs Listenaufrufen je Lauf.

### Datenschutz

Bei Benutzer- und Adminressourcen sollen nur tatsächlich benötigte Felder in normalisierte Auswertungstabellen übernommen werden. Rohdaten dürfen nur im erforderlichen Umfang und mit beschränkten Datenbankrechten gespeichert werden. Trainerkosten werden weiterhin nicht aus edoobox bezogen, sondern im Schema `kursplan` gepflegt.

## P03 Wöchentlicher Gesamt- und Löschabgleich

### Aufgabe

P03 ist der verbindliche Referenzlauf für den vollständigen Bestand. Er gleicht alle zwölf Ressourcen ab und erkennt Datensätze, die in der aktuellen edoobox-Antwort nicht mehr enthalten sind.

### Zeitplan

- Einmal wöchentlich nachts, beispielsweise Sonntag um 03:00 Uhr.
- Während dieses Laufs starten P01 und P02 nicht.

### Besonderheiten

- Für jede Ressource wird eine neue Laufkennung verwendet.
- Gesehene Datensätze werden der aktuellen Laufkennung zugeordnet.
- Lokal vorhandene, im vollständigen Lauf aber nicht gesehene Datensätze erhalten `is_deleted = true`.
- Datensätze werden nicht physisch gelöscht.
- Die Trainerzuordnung aus `dates.leader[]` wird vollständig neu aufgebaut.
- Mehrfachzuweisungen von Trainern bleiben zulässig.
- Die Anzahl gemeldeter und gespeicherter Datensätze muss je Ressource übereinstimmen.
- Nach Abschluss wird P04 ausgeführt.

## P04 Qualitätskontrolle und Benachrichtigung

### Aufgabe

P04 verändert keine edoobox-Nutzdaten. Der Workflow prüft den Zustand der Spiegelung und meldet nur Abweichungen.

### Prüfungen

- Während des Betriebszeitfensters liegt der letzte erfolgreiche P01-Lauf höchstens 30 Minuten zurück.
- Außerhalb des Betriebszeitfensters wird ein ausbleibender P01-Lauf nicht als Fehler gewertet.
- Letzter erfolgreicher P02-Lauf liegt höchstens 26 Stunden zurück.
- Letzter erfolgreicher P03-Lauf liegt höchstens acht Tage zurück.
- Alle zwölf Ressourcen wurden vollständig gelesen.
- `dates.offer` verweist auf ein vorhandenes Angebot.
- Trainerkennungen aus `dates.leader[]` sind auflösbar oder als historisch dokumentiert.
- Buchungs-, Preis-, Anwesenheits-, Rechnungs- und Transaktionsbeziehungen werden geprüft.
- Produktives Netto ab 2023 wird ausgewiesen.
- Kostenkonfigurationen ohne auflösbaren Trainertarif werden gemeldet.
- Angebote ohne Trainerzuordnung werden gemeldet.
- Mehrfachtrainer werden nicht als Fehler behandelt, sondern als zulässige Kontrollinformation ausgewiesen.
- Test-, Feiertags-, Kontingent- und Gebührenangebote bleiben ausgeschlossen.
- DB I, direkte Kosten und Anzahl der Ist- und Prognoseangebote werden protokolliert.

### Aktueller Referenzstand

| Kontrolle | Referenzwert |
|---|---:|
| Produktive Angebote über die vollständige Historie | 2.586 |
| Vollständig berechenbare Angebote ab 2023 | 1.696 |
| Produktiver Nettoerlös ab 2023 | 430.049,62 € |
| Trainerkosten | 227.452,00 € |
| Plattformkosten | 11.715,00 € |
| Direkte Kosten | 239.167,00 € |
| DB I | 190.882,62 € |
| DB-I-Marge | 44,39 % |
| Offene Kostenkonfigurationen | 0 |

Die Werte sind Kontrollmarken und keine dauerhaft festgeschriebenen Sollwerte. Nach neuen Buchungen oder Änderungen müssen sie sich verändern dürfen. Entscheidend sind rechnerische Beziehungen und das Ausbleiben ungeklärter Datensätze.

## P05 Manueller Wiederanlauf

### Aufgabe

P05 dient der kontrollierten Fehlerbehebung und Wartung. Er wird nicht zeitgesteuert aktiviert.

### Eingaben

- Ressource oder `alle`
- Abgleichsart `normal` oder `voll`
- optionaler Hinweis zum Anlass

### Schutzmaßnahmen

- Verwendung ausschließlich durch Administratoren.
- Keine Eingabe freier Tabellennamen oder SQL-Ausdrücke.
- Zulässige Ressourcen werden aus einer festen Liste gewählt.
- Jeder Lauf wird in `sync_run` protokolliert.
- Bei bereits laufendem Abgleich erfolgt kein paralleler Start.
- Der Workflow verwendet die normale n8n-Schreibverbindung, nicht die administrative PostgreSQL-Verbindung.

## P90 Eine edoobox-Ressource spiegeln

P90 ist ein technischer Unterworkflow ohne eigenen Zeitplan. Dadurch müssen Authentifizierung, Seitennavigation und Datenbanklogik nicht in mehreren Workflows kopiert werden.

### Eingaben

- Ressourcenkennung
- API-Pfad
- Zieltabelle
- Primärschlüssel
- Seitengröße
- Laufkennung
- Kennzeichen, ob Löschungen ausgewertet werden

### Verarbeitung

1. API seitenweise bis zur gemeldeten Gesamtzahl abrufen.
2. Antwortstruktur und Pflichtfelder prüfen.
3. Nutzdaten normalisieren.
4. Datenschutzrelevante Felder begrenzen.
5. Datensatz-Hash bilden.
6. Nur neue oder geänderte Datensätze schreiben.
7. `last_seen_at`, `last_synced_at` und Laufkennung aktualisieren.
8. Bei einem Vollabgleich nicht gesehene Datensätze als gelöscht markieren.
9. Anzahl API-Aufrufe, gelesene, neue, geänderte und gelöschte Datensätze zurückgeben.

P90 darf nur Ressourcen aus einer fest hinterlegten Konfiguration verarbeiten. Dynamisch zusammengesetzte SQL-Tabellennamen aus Benutzereingaben sind ausgeschlossen.

## Kein eigener DB-I-Berechnungsworkflow

Die DB-I-Auswertung benötigt keinen zeitgesteuerten Berechnungsworkflow. Die PostgreSQL-Sichten lesen den jeweils aktuellen Spiegelbestand und die Kostentabellen unmittelbar:

- `kursplan.v_angebot_trainerkosten`
- `kursplan.v_termin_db1`
- `kursplan.v_kursart_db1`

Nach einem erfolgreichen Datenabgleich stehen die aktualisierten Werte automatisch bereit. P04 prüft lediglich, ob die Sichten vollständig berechenbar sind.

## Nicht zeitgesteuerte Verwaltungswerkzeuge

Folgende Tätigkeiten bleiben bewusste administrative Eingriffe und gehören nicht in einen automatisch laufenden Workflow:

- neue Trainerkostenprofile anlegen
- Trainer-Kurs-Tarifregeln ändern
- individuelle Coaching- oder Fremdtrainerkosten eintragen
- dauerhafte Ausschlussregeln ändern
- historische Datenkorrekturen durchführen
- Datenbankschema oder Sichten ändern

Für diese Tätigkeiten ist die administrative PostgreSQL-Verbindung erforderlich. Die produktiven Synchronisationsworkflows verwenden ausschließlich `n8n_writer`.

## Webhooks

Webhooks sind für die erste produktive Fassung nicht erforderlich. Der vollständige Abgleich der operativen Ressourcen im 15-Minuten-Takt ist bei dem geprüften Bestand klein, verständlich und fehlertolerant.

Ein Webhook kann später ergänzt werden, wenn Änderungen nahezu in Echtzeit benötigt werden. Dann sind zwei zusätzliche Workflows erforderlich:

1. Webhook nur prüfen, unverändert speichern und sofort bestätigen.
2. Gespeicherte Ereignisse entkoppelt verarbeiten.

Der 15-minütige operative und der wöchentliche vollständige Abgleich bleiben auch mit Webhooks bestehen. Das Lastenheft sollte vor der Umsetzung in Version 1.6 an diese vereinfachte Zielarchitektur angepasst werden.

## Empfohlene Umsetzungsreihenfolge

1. P90 als wiederverwendbaren Ressourcen-Unterworkflow erstellen.
2. P03 als vollständigen Referenzlauf erstellen und gegen S51/S52 prüfen.
3. P01 aus P03 ableiten und werktags im 15-Minuten-Takt aktivieren.
4. P02 für die fünf Stammressourcen aktivieren.
5. P04 mit Protokoll- und DB-I-Kontrollen ergänzen.
6. Fehlerbenachrichtigung testen.
7. P05 für manuelle Wiederanläufe bereitstellen.
8. Die alten Prüfworkflows archivieren und deaktiviert lassen.
9. Lastenheft auf Version 1.6 aktualisieren.
