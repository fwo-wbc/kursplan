# Lastenheft: Planungs- und Kommunikationsanwendung „Kursplan"

| | |
| --- | --- |
| **Dokumenttyp** | Lastenheft (Anforderungen des Auftraggebers) |
| **Version** | 1.6 |
| **Datum** | 05.09.2026 |
| **Auftraggeber** | Hauptorganisator (Trainings- und Kursanbieter) |
| **Gegenstand** | Eigenständige Web-App zur ganzjährigen Terminplanung von Live-Online-Kursen inkl. Trainerverfügbarkeit, Kommunikation, Historie und Anbindung an das Buchungssystem edoobox |

**Zweck des Dokuments:** Dieses Lastenheft beschreibt, **was** das System leisten muss, nicht wie es umgesetzt wird. Es dient als Grundlage für ein Pflichtenheft, für Angebotseinholung bei Dienstleistern oder für die Eigenentwicklung.

### Änderungsverzeichnis

| Version | Änderung |
| --- | --- |
| 1.0 | Erstfassung |
| 1.1 | Zeitraster erweitert: `K3` auf 13:30–15:00 geändert, `K4` (15:30–17:00) und Abendkurs `AB` (18:00–20:00) neu; Kollisionsprüfung auf tatsächliche Uhrzeiten umgestellt (S-02, S-02a). Neuer Abschnitt „Notwendige Dokumente" (D-01 bis D-08). Feiertagsregelung verbindlich und auf Deutschland eingegrenzt; Trainerurlaub und Betriebsruhe neu (S-11 bis S-15). Mehrfachbelegung auch je Trainer, Planung ohne Trainerzuweisung neu (L-05a, L-05b, L-13). Eigenständigkeit jedes Termins ausdrücklich festgeschrieben (T-01a). Trainerkosten je Zuordnung neu (T-11). Mehrteilige Kurse als Terminverbund neu (T-12, E-05a). Kostendeckungsbewertung mit Preiskategorien und Nachholern neu (K-09 bis K-14, E-23 bis E-26). n8n und SQL-Zugang als Integrationsweg neu (E-27 bis E-30). Neue Abnahmefälle AK-14 bis AK-22. Kostenkategorien je Trainer neu, mindestens fünf und in der Anzahl nicht begrenzt (S-07a). Priorität geändert auf MUSS: S-03, S-10, V-03, L-11, T-10. Kapitel 15 von `R-` auf `AU-` umbenannt, um die Kollision mit den Rollenkennungen aufzulösen. Rolle Co-Organisator und Terminabruf durch die Website entfallen. Phasenplan neu zugeordnet. Annahmen A-1 bis A-7 bestätigt; A-2, A-3 und A-5 präzisiert. |
| 1.2 | Der bestehende n8n-Ablauf wurde ausgewertet und im Lastenheft dokumentiert (E-24), einschließlich acht bekannter Einschränkungen, die die Richtigkeit des Deckungsbeitrags betreffen (E-24a bis E-24c). Der Integrationsweg ist entschieden: lesender Zugriff der Anwendung auf eine aggregierte PostgreSQL-Sicht statt eines Eingangsendpunkts (E-27, E-27a, E-29, E-31). Klassifizierung der Preiskategorien auf Musterregeln, Betragsregel und manuelle Festlegung umgestellt, da die Bezeichnungen je Termin frei definierbar sind; Ausgangsbestand der Kategorien aufgenommen (K-10, K-10a bis K-10c). Kursarten mit eigener Mindestteilnehmerzahl neu, Firmenkurs ergänzt (S-04a, S-04b). Datenschutzanforderungen zur bestehenden Buchungsdatenbank und zu Zugangsdaten neu (DS-10 bis DS-12). Neue Abnahmefälle AK-23 bis AK-25. |
| 1.3 | Der vollständige Ist-Bestand der Preiskategorien wurde ausgewertet (978 Einträge, 75 Schreibweisen) und das Regelwerk nach K-10 gegen ihn geprüft; Ergebnis und Musterliste in K-10a aufgenommen. Normalisierung und Regelreihenfolge als eigene Anforderungen ergänzt (K-10a1, K-10a2). Trennung von erlöswirksam und teilnehmerwirksam neu, da Stornogebühren Erlös ohne Teilnehmer darstellen (K-10d). Der Auftraggeber hat entschieden, die bestehenden n8n-Abläufe nicht weiterzuverwenden und eine neue Datenbank aufzusetzen; Kapitel 13.5 entsprechend als Neubau statt als Weiternutzung gefasst. Neue Abnahmefälle AK-26 bis AK-28. |
| 1.4 | Kapitel 13.5 vollständig neu gefasst und in fünf Unterabschnitte gegliedert: Datenmodell, Zugriff der Anwendung, Abläufe in n8n, Zugangsdaten, Reihenfolge der Inbetriebnahme. Die getrennte Führung von Buchung, Position und Zahlung ist als Anforderung festgeschrieben, weil nur sie die Einschränkungen 1, 3 und 4 aus E-24a konstruktiv ausschließt (E-27 bis E-27d). Personenbezogene Felder werden im Neubau nicht mehr gespiegelt (E-27a, DS-10, DS-11 neu gefasst). Zugriff der Anwendung auf drei Sichten mit getrennten Datenbankrollen erweitert; Einstufung der Preiskategorien in der Datenbank verankert (E-28 bis E-28b). Betriebsanforderungen an die verwaltete Datenbank in der EU neu (E-29, E-29a). Vier getrennte n8n-Abläufe mit Webhook-Empfang, entkoppelter Verarbeitung, stündlichem inkrementellem Abruf und wöchentlichem Vollabgleich neu; der Vollabgleich ist von SOLL auf MUSS gehoben, da die Buchungsressource keinen Filter auf ein Änderungsdatum kennt (E-31 bis E-31h). Kurzlebige Zugriffstoken und Widerruf des Alttokens neu (E-32 bis E-32c). Reihenfolge der Inbetriebnahme mit Prüfpunkt neu (E-33, E-34). Ausbaustufe 0 als vorgezogene Stufe für Datenbeschaffung und Datenhaltung neu; Ausbaustufen 4 und 5 entsprechend bereinigt. Neue Abnahmefälle AK-29 bis AK-37. Offene Punkte 2 bis 4 ersetzt, da Betriebsort, Takt und Herkunft der Buchungen geklärt sind; neu offen sind der Aufbau der Detailantwort, der Aufbau der Webhook-Nachricht und der Umfang des Bestands. |
| 1.5 | Betriebsform der Datenbank festgelegt: eigener PostgreSQL-Container auf dem vorhandenen Hetzner-Server des Auftraggebers, verwaltet über Portainer, statt eines verwalteten Dienstes. Kapitel 13.5 um den Abschnitt Betrieb der Datenbank erweitert; die Unterabschnitte sind entsprechend neu numeriert. Die Datenbank veröffentlicht keinen Port und ist nur über das interne Containernetz sowie über einen SSH-Tunnel erreichbar; die Verschlüsselung der Verbindung ist deshalb nur bei späterer Öffnung nach außen zwingend (E-29). Sicherung, erprobte Wiederherstellung und Versionswechsel sind als eigene Anforderungen in die Verantwortung des Auftraggebers überführt (E-29a bis E-29c); der Auftragsverarbeitungsvertrag für die Datenbank entfällt, der Serververtrag tritt an seine Stelle. Klargestellt, dass Datenbankbenutzer ausschließlich technische Konten sind und kein Anwendungsnutzer, insbesondere kein Trainer, einen eigenen Datenbankzugang erhält (E-28c); R-05 entsprechend präzisiert. Reihenfolge der Inbetriebnahme um Netz, Volume und Sicherung erweitert (E-33, nun neun Schritte). Neue Abnahmefälle AK-38 und AK-39, AK-37 erweitert. |
| 1.6 | Produktive n8n-Zielarchitektur nach vollständiger Prüfung aller zwölf edoobox-Ressourcen neu festgelegt. Webhooks und Buchungs-Detailabrufe sind für die erste produktive Fassung nicht mehr erforderlich. Operative Ressourcen einschließlich Angebote, Datumszeilen, Buchungen und Transaktionen werden werktags von 08:00 bis 23:45 Uhr alle 15 Minuten vollständig und hashbasiert abgeglichen; Stamm- und Referenzdaten täglich, alle zwölf Ressourcen wöchentlich. Fünf ausführbare Workflows plus gemeinsamer Ressourcen-Unterworkflow definiert (E-31 bis E-31k). Abrufmenge mit derzeit rund 1.344 Listenaufrufen je Werktag gegen das Limit von 100.000 geprüft. Abnahmefälle AK-31, AK-32, AK-35 und AK-36 angepasst, AK-40 ergänzt. Inbetriebnahmereihenfolge, Phasenplan und offene Punkte aktualisiert. |
| 1.7 | Automatisierter Excel-Export für Trainer & Termine nach Microsoft OneDrive neu (AU-07, Abschnitt 15.1): täglicher Export um 03:00 Uhr über einen rollierenden Zeitraum von heute bis heute + 6 Monate, feste Dateinamenskonvention `[yyyy-mm-dd] Backup Trainerzeitpläne.xlsx`, Ablage in einem definierten OneDrive-Zielverzeichnis. Umsetzung in einer nachgelagerten Phase nach Abschluss der Kernfunktionen; als Ausbaustufe 6 in den Phasenplan aufgenommen. |

> **Klarstellung:** Die Anweisung „V-04 ist MUSS" bezog sich nach Rücksprache auf **V-03** (Freigabe einzelner Slots statt nur ganzer Tagesabschnitte). V-03 ist entsprechend als MUSS eingestuft. V-04 war bereits in Version 1.0 MUSS und bleibt unverändert; V-08 (Vorschlag wiederkehrender Verfügbarkeiten) bleibt SOLL.

**Priorisierung der Anforderungen:**

- **MUSS** — zwingend, ohne diese Anforderung ist das System nicht abnahmefähig
- **SOLL** — wichtig, aber verhandelbar bzw. in späterer Phase lieferbar
- **KANN** — wünschenswert, optional

---

## 1 Ausgangslage

Die Terminplanung für Live-Online-Kurse erfolgt derzeit über mehrere getrennte Excel-Tabellen. Jeder Trainer pflegt eine eigene Verfügbarkeitstabelle, die Kursplanung liegt in weiteren Dateien beim Organisator.

Daraus ergeben sich folgende Probleme:

1. Kein gemeinsamer, aktueller Datenstand; Abgleich erfolgt manuell
2. Trainer erfahren den Status ihrer freigegebenen Zeiten nicht systematisch
3. Absprachen, Terminänderungen und Anfragen laufen über E-Mail und sind nicht rekonstruierbar
4. Doppel- und Dreifachbelegungen sind in Excel nicht sauber abbildbar
5. Drei Kursformate mit unterschiedlichen Zeitrastern (Halbtag, Kurzschulung, Abendkurs) erhöhen die Fehleranfälligkeit
6. Die Rhythmusplanung (4- bzw. 5-Wochen-Takt) wird von Hand gezählt
7. Anmeldezahlen liegen ausschließlich im Buchungssystem edoobox und sind bei der Entscheidung über Durchführung oder Absage nicht neben der Planung sichtbar

### Mengengerüst

| Kennzahl | Wert |
| --- | --- |
| Trainer inkl. Organisator | 5–10 |
| Kurstitel im Katalog | über 80 |
| Kurstermine pro Jahr inkl. Mehrfachbelegung | über 1.500 |
| Planungshorizont | 12 Monate rollierend |
| Gleichzeitige Nutzer | max. 10 |

---

## 2 Zielsetzung

Das System bildet **zwei Planungsphasen** ab, die den fachlichen Kern der Anwendung bilden.

### Phase A — Langfristige Planung (Jahresraster)

Ziel: Termine werden weitgehend automatisch sinnvoll über Wochen und Monate verteilt. Ergebnis ist ein belastbares Jahresraster, das anschließend die Grundlage für die Veröffentlichung der Kurse in edoobox bildet.

Leitfragen: Welcher Kurs wann? Ist der Prio-Rhythmus eingehalten? Welcher Trainer ist verfügbar? Wo sind Lücken, wo Überlast?

### Phase B — Kurzfristige Steuerung (2–3 Wochen vor Kursbeginn)

Ziel: Entscheidung über Durchführung, Absage oder Verschiebung auf Basis der tatsächlichen Anmeldezahlen aus edoobox, sowie Auflösung von Mehrfachbelegungen durch Zuordnung weiterer Trainer.

Leitfragen: Wie viele Anmeldungen liegen vor? Ist die Mindestteilnehmerzahl erreicht? Wer führt durch? Wer muss informiert werden?

### Übergeordnete Ziele

- Eine einzige Quelle der Wahrheit für Verfügbarkeit, Termine, Zuordnungen und Status
- Vollständige Ablösung der Excel-Verfügbarkeitstabellen
- Nachvollziehbare, dauerhaft auffindbare Kommunikation zwischen Organisator und Trainern
- Reduktion des manuellen Aufwands bei der Übertragung von Terminen nach edoobox

---

## 3 Systemabgrenzung

**Nicht Gegenstand des Systems:**

- Teilnehmerverwaltung, Buchungsabwicklung, Zahlungsverkehr und Rechnungsstellung — verbleiben vollständig in edoobox
- Speicherung personenbezogener Teilnehmerdaten (Namen, Adressen, Kontaktdaten) — ausdrücklich ausgeschlossen; das System verarbeitet ausschließlich aggregierte Kennzahlen
- Honorarabrechnung und Buchhaltung — verbleiben im bestehenden System (e-conomic). Im Planungssystem werden lediglich Kostenwerte je Termin zur Deckungsrechnung erfasst (siehe T-11); eine Abrechnung findet nicht statt.
- Durchführung der Kurse selbst (Videokonferenz, Lernplattform)
- Öffentliche Kursanzeige — erfolgt über edoobox. Die Terminanzeige auf der bestehenden WordPress-Website bleibt unverändert und wird weiterhin direkt aus edoobox versorgt.

**Schnittstellen zu Drittsystemen:**

- edoobox REST API (lesend und schreibend)
- n8n als vorhandenes Ablaufwerkzeug, einschließlich des davon genutzten SQL-Systems (siehe Abschnitt 13.5)
- Kalendersysteme der Trainer (iCal)
- E-Mail-Versand

---

## 4 Rollen und Berechtigungen

| ID | Rolle | Beschreibung | Prio |
| --- | --- | --- | --- |
| R-01 | **Organisator** | Vollzugriff auf alle Funktionen, Daten und Einstellungen; einzige Rolle mit Zugriff auf Anmeldezahlen und Umsatzdaten | MUSS |
| R-02 | **Trainer** | Zugriff ausschließlich auf eigene Verfügbarkeit, eigene Termine, eigene Kommunikation und eigene Historie | MUSS |
| R-03 | **Co-Organisator** | Wie Organisator, jedoch ohne Nutzerverwaltung, ohne Löschrechte und ohne Zugriff auf Umsatzdaten | **entfällt** — derzeit keine Vertretungsregelung erforderlich; die Rollenverwaltung ist jedoch so anzulegen, dass eine weitere Rolle später ohne Umbau ergänzbar bleibt |
| R-04 | **Leseansicht** | Nur lesender Kalenderzugriff, z. B. für Büro oder Vertretung | KANN |

**R-05 (MUSS)** Trainer dürfen weder Verfügbarkeiten noch Termine oder Kommunikation anderer Trainer sehen. Die Trennung muss in der Zugriffslogik der Anwendung erfolgen, nicht ausschließlich in der Benutzeroberfläche — also serverseitig bei jeder Abfrage, nicht durch Ausblenden im Browser. Gemeint ist ausdrücklich **nicht** eine Umsetzung über eigene Datenbankkonten je Trainer; solche bestehen nicht (E-28c).

**R-06 (MUSS)** Die Anmeldung erfolgt personenbezogen mit E-Mail und Passwort. Für Trainer ist zusätzlich eine Anmeldung per Einmal-Link („Magic Link") vorzusehen, um die Einstiegshürde niedrig zu halten.

**R-07 (SOLL)** Für die Rolle Organisator ist eine Zwei-Faktor-Authentisierung vorzusehen.

**R-08 (MUSS)** Nutzer können deaktiviert, aber nicht gelöscht werden, damit die Historie belastbar bleibt.

---

## 5 Stammdaten

### 5.1 Zeitraster und Kursformate

**S-01 (MUSS)** Das System verwaltet Zeitfenster („Slots") als konfigurierbare Stammdaten:

| Slot-Code | Zeit | Format | Tagesabschnitt |
| --- | --- | --- | --- |
| `HT` | 09:00–13:00 | Halbtagskurs, 4 Stunden | Vormittag |
| `K1` | 09:00–10:30 | Kurzschulung, 90 Minuten | Vormittag |
| `K2` | 11:00–12:30 | Kurzschulung, 90 Minuten | Vormittag |
| `K3` | 13:30–15:00 | Kurzschulung, 90 Minuten | Nachmittag |
| `K4` | 15:30–17:00 | Kurzschulung, 90 Minuten | Nachmittag |
| `AB` | 18:00–20:00 | Abendkurs, 2 Stunden | Abend |

**S-02 (MUSS)** Ausschlussregeln zwischen Slots dürfen nicht fest im Programm hinterlegt sein, sondern müssen aus den tatsächlichen Anfangs- und Endzeiten sowie einer konfigurierbaren Mindestpause berechnet werden. Die Mindestpause beträgt standardmäßig 30 Minuten. Daraus ergibt sich:

| Kombination am selben Tag, selber Trainer | Zulässig |
| --- | --- |
| `HT` mit `K1` oder `K2` | nein, Zeitüberlappung |
| `HT` mit `K3`, `K4` oder `AB` | ja |
| `K1` mit `K2`, `K3`, `K4`, `AB` | ja |
| `K3` mit `K4` | ja |
| beliebiger Slot mit `AB` | ja |

**S-02a (MUSS)** Je Trainer ist eine konfigurierbare Obergrenze für Unterrichtsstunden pro Tag und pro Woche hinterlegbar. Überschreitungen werden bei der Zuordnung als Warnung angezeigt, jedoch nicht blockiert.

**S-03 (MUSS)** Weitere Slots (z. B. Ganztag, weiterer Abendtermin, abweichende Zeiten) müssen ohne Programmieraufwand als Stammdatum mit Bezeichnung, Anfangszeit, Endzeit und Tagesabschnitt ergänzbar sein. Bestehende Slots müssen zeitlich änderbar sein, ohne dass bereits geplante Termine ihre Zuordnung verlieren.

### 5.2 Kurskatalog

**S-04 (MUSS)** Verwaltung von über 80 Kurstiteln mit mindestens folgenden Merkmalen: Titel, Kurzbezeichnung, Kategorie, Kursart (siehe S-04a), Anzahl der Teile bei mehrteiligen Kursen, Priorität (1, 2, 3), Rhythmus in Wochen, bevorzugte Slots, Mindestteilnehmerzahl, Status aktiv/inaktiv.

**S-04a (MUSS)** **Kursarten und Mindestteilnehmerzahlen.** Die Mindestteilnehmerzahl unterscheidet sich je Kursart. Sie ist daher je Kursart als Vorgabewert zu pflegen und je Kurstitel überschreibbar. Vorzusehen sind mindestens die Kursarten Halbtagskurs, Kurzschulung 90 Minuten, Abendkurs und Firmenkurs. Weitere Kursarten müssen ohne Programmierung ergänzbar sein.

Je Kursart sind hinterlegbar: Bezeichnung, zulässige Slots, Dauer, **Mindestteilnehmerzahl** und Höchstteilnehmerzahl.

**S-04b (MUSS)** Für die Kursart Firmenkurs entfällt die Mindestteilnehmerzahl als Entscheidungskriterium. Maßgeblich ist hier allein die Kostendeckung nach K-10c. Die Kursart muss dieses Verhalten über ein Kennzeichen steuern können, statt es fest zu verdrahten.

**S-05 (MUSS)** Standardrhythmus: Priorität 1 und 2 im 4-Wochen-Takt, Priorität 3 im 5-Wochen-Takt. Der Wert muss je Kurs überschreibbar sein.

**S-06 (MUSS)** **Qualifikationsmatrix Kurs × Trainer:** Für jeden Kurs ist hinterlegt, welche Trainer ihn durchführen können, mit Abstufung „kann" und „in Einarbeitung". Bei über 80 Titeln ist dies Voraussetzung für sinnvolle Zuordnungs- und Ersatzvorschläge.

**S-07 (MUSS)** Trainerstammdaten: Name, Initialen (eindeutig, z. B. „FW"), E-Mail, Rolle, Farbe für die Kalenderdarstellung, Obergrenzen für Unterrichtsstunden pro Tag und Woche (siehe S-02a), Kostenkategorien (siehe S-07a), zugeordnete Kursqualifikationen (siehe S-06).

**S-07a (MUSS)** **Kostenkategorien je Trainer.** Je Trainer sind **mindestens fünf Kostenkategorien** hinterlegbar; die Anzahl ist technisch nicht zu begrenzen. Jede Kategorie besteht aus:

| Feld | Beschreibung |
| --- | --- |
| Kategoriename | Frei wählbar, z. B. „halber Tag", „pro Stunde", „verminderter Satz", „Abendkurs" |
| Betrag | Preis in Netto |
| Kennzeichen Standard | Genau eine Kategorie je Trainer kann als Vorschlagswert markiert werden |

Weitere Anforderungen:

- Die Kategorienamen sind je Trainer frei definierbar und nicht systemweit vorgegeben, da die Trainer unterschiedliche Abrechnungsmodelle haben können
- Fünf Kategorien sind der erwartete Regelfall. Die Anzahl darf jedoch nicht fest verdrahtet werden, sondern ist als eigenständige Untertabelle abzubilden, damit weitere Kategorien ohne Programmieränderung ergänzt werden können
- Nicht mehr verwendete Kategorien können deaktiviert werden, bleiben aber in bereits erfassten Terminen unverändert erhalten
- Änderungen eines Betrags wirken nur auf künftige Zuordnungen; bereits erfasste Termine behalten den zum Zeitpunkt der Erfassung gültigen Wert
- Kostenkategorien und Beträge sind ausschließlich für den Organisator sichtbar
- Die Historie der Satzänderungen bleibt nachvollziehbar

> Hinweis: Die Kategorien dienen ausschließlich als Vorschlagswerte für die Kostenerfassung. Sie ersetzen nicht die manuelle Festlegung je Termin nach T-11.

**S-08 (MUSS)** Die Initialen des Trainers müssen in allen Kalender- und Listenansichten als kompakte Kennung dargestellt werden.

### 5.3 Sperrzeiten, Feiertage, Urlaub und Betriebsruhe

**S-09 (MUSS)** Verwaltung von Sperrtagen und Sperrzeiträumen mit Bezeichnung, Zeitraum, Art und Geltungsbereich (systemweit oder einzelner Trainer).

**S-10 (MUSS)** **Feiertage.** An gesetzlichen Feiertagen dürfen keine Kurstermine geplant werden. Berücksichtigt werden ausschließlich **deutsche** gesetzliche Feiertage, und zwar nur solche, die in **mindestens drei Bundesländern** gelten. Dänische Feiertage sind ohne Bedeutung und dürfen nicht berücksichtigt werden.

**S-10a (MUSS)** Der Feiertagskalender ist für mindestens die kommenden drei Jahre im Voraus vorhanden und jährlich fortschreibbar. Er muss manuell nachbearbeitbar sein, da sich die Zuordnung zu Bundesländern ändern kann.

**S-10b (MUSS)** Der Serienplaner belegt Feiertage nicht. Feiertage werden im Kalender deutlich gekennzeichnet.

**S-11 (MUSS)** **Trainerurlaub.** Jeder Trainer kann Urlaubszeiträume eintragen. Ein als Urlaub gekennzeichneter Zeitraum gilt als verbindlich nicht verfügbar: Die betreffenden Tage werden dem Organisator zu keinem Zeitpunkt als freie Kapazität angezeigt und können nicht versehentlich belegt werden. Damit entsteht die gewünschte Planungssicherheit.

**S-11a (MUSS)** Urlaubszeiträume sind vom Trainer selbst und vom Organisator stellvertretend erfassbar. Eine Zuordnung von Terminen in einen Urlaubszeitraum ist nur nach ausdrücklicher Bestätigung durch den Organisator und mit Benachrichtigung des Trainers möglich.

**S-12 (MUSS)** **Betriebsruhe.** Der Organisator kann frei definierbare betriebliche Ruhezeiten anlegen, in denen regulär keine Kurse angeboten werden — typischerweise ein Sommerzeitraum sowie die Zeit um Weihnachten und Silvester. Anzahl, Bezeichnung und Zeitraum sind frei wählbar und jährlich anpassbar.

**S-13 (MUSS)** Der Serienplaner berücksichtigt Betriebsruhezeiten bei der Grobplanung und legt dort keine Termine ab.

**S-14 (MUSS)** **Manuelle Übersteuerung.** Der Organisator muss dennoch in der Lage sein, in Betriebsruhezeiten Termine manuell einzutragen. Das System weist beim Eintragen auf die Ruhezeit hin, blockiert die Eingabe aber nicht. Solche Termine werden im Kalender als Ausnahme gekennzeichnet.

**S-15 (MUSS)** In der Kalenderdarstellung sind Feiertage, Betriebsruhe und Trainerurlaub optisch klar voneinander unterscheidbar.

### 5.4 Notwendige Dokumente

Ziel: Trainer müssen jederzeit erkennen können, welche Unterlagen sie für einen Kurs benötigen und ob diese zwischenzeitlich aktualisiert wurden.

**D-01 (MUSS)** Zu jedem Kurs im Katalog existiert ein Bereich **„Notwendige Dokumente"**, in dem der Organisator Dateien hinterlegt. Vorgesehen sind mindestens die Dokumentarten **Schulungsunterlage** und **Präsentationsdatei**; weitere Arten (z. B. Übungsdateien, Ablaufplan, Checkliste) müssen ergänzbar sein.

**D-02 (MUSS)** Je Dokument werden erfasst: Bezeichnung, Dokumentart, Datei, Versionsbezeichnung oder Stand, Datum der letzten Änderung und optionale Anmerkung.

**D-03 (MUSS)** **Aktualisierungskennzeichen.** Der Organisator kann je Dokument ein Kennzeichen setzen, das signalisiert, dass das Dokument aktualisiert wurde. Trainer, die für den betreffenden Kurs qualifiziert sind oder einen Termin dieses Kurses zugeordnet haben, sehen dieses Kennzeichen deutlich hervorgehoben.

**D-04 (MUSS)** Der Trainer kann die Kenntnisnahme eines aktualisierten Dokuments bestätigen. Danach entfällt die Hervorhebung für diesen Trainer, bleibt für noch nicht bestätigende Trainer jedoch bestehen.

**D-05 (MUSS)** Der Organisator sieht je Dokument, welche Trainer die Aktualisierung zur Kenntnis genommen haben und welche nicht.

**D-06 (MUSS)** Trainer haben Zugriff auf die Dokumente aller Kurse, für die sie qualifiziert sind oder einen Termin zugeordnet haben. Ein Zugriff auf Dokumente anderer Kurse ist nicht erforderlich.

**D-07 (MUSS)** Bei Zuordnung eines Termins wird dem Trainer in der Terminansicht direkt angezeigt, welche Dokumente er benötigt und ob deren Stand aktuell ist.

**D-08 (SOLL)** Beim Setzen des Aktualisierungskennzeichens wird eine Benachrichtigung an die betroffenen Trainer ausgelöst. Vorherige Versionen bleiben abrufbar, damit ein bereits vorbereiteter Termin nachvollziehbar bleibt.

---

## 6 Verfügbarkeitsverwaltung (Trainer)

**V-01 (MUSS)** Jeder Trainer pflegt seine freien Kapazitäten selbst in einem Zeitraster mit Tages- und Slot-Bezug. Die Excel-Tabellen werden dadurch vollständig ersetzt.

**V-02 (MUSS)** Freigabe erfolgt vereinfacht als **Vormittag**, **Nachmittag**, **Abend** oder **ganzer Tag**. Das System löst diese Angabe intern in die betroffenen Slots auf. Ein „ganzer Tag" umfasst dabei standardmäßig Vormittag und Nachmittag; ob der Abend eingeschlossen ist, muss je Trainer voreinstellbar sein.

**V-03 (MUSS)** Ergänzend muss eine feinere Freigabe einzelner Slots möglich sein. Bei sechs Slots pro Tag ist die Einteilung in Tagesabschnitte allein zu grob — ein Trainer muss beispielsweise `K3` freigeben können, ohne `K4` freizugeben.

**V-04 (MUSS)** Eine Freigabe kann zurückgenommen werden, solange ihr kein Termin zugeordnet ist.

**V-05 (MUSS)** Ist einer Freigabe ein Termin zugeordnet, ist die eigenständige Rücknahme gesperrt. Der Trainer kann stattdessen eine **Rücknahme-Anfrage** mit Begründung stellen, über die der Organisator entscheidet.

**V-06 (MUSS)** Bei bereits bestätigten Terminen kann der Trainer ausschließlich einen **Ausfall melden**. Dies erzeugt eine hochpriorisierte Aufgabe beim Organisator.

**V-07 (MUSS)** Eingabe von Urlaub und Sperrzeiten als Zeitraum mit einer Eingabe, mit der verbindlichen Wirkung nach S-11.

**V-08 (SOLL)** Wiederholungsmuster für Freigaben, z. B. „jeden Dienstag Vormittag frei bis 31.12.". Ohne diese Funktion ist die Pflege eines Jahres unzumutbar aufwendig.

**V-09 (MUSS)** Farbliche Unterscheidung der Zustände: frei, reserviert, bestätigt, gesperrt.

**V-10 (MUSS)** Die Verfügbarkeitsansicht muss auf Mobilgeräten bedienbar sein.

**V-11 (SOLL)** Der Organisator kann Verfügbarkeiten stellvertretend eintragen; die Herkunft der Eintragung wird protokolliert.

---

## 7 Phase A — Langfristige Planung

**L-01 (MUSS)** Planungsansicht über einen frei wählbaren Zeitraum (Woche, Monat, Quartal, Jahr) mit Slots als Zeilenstruktur.

**L-02 (MUSS)** Manuelle Zuordnung eines Kurses zu einem Datum und Slot, vorzugsweise per Ziehen und Ablegen.

**L-03 (MUSS)** Bei der Zuordnung zeigt das System je Slot die Trainer an, die zugleich qualifiziert und verfügbar sind, dargestellt über ihre Initialen.

**L-04 (MUSS)** **Mehrfachbelegung ist ausdrücklich zulässig.** Mehrere Kurse dürfen dasselbe Datum und denselben Slot belegen. Das System zählt den Belegungsgrad und stellt ihn dar (z. B. „2×", „3×"), verhindert die Eingabe jedoch nicht.

**L-05 (MUSS)** **Automatischer Serienplaner.** Das System erzeugt auf Anforderung einen Terminvorschlag für einen gewählten Zeitraum und eine Auswahl von Kursen. Der Vorschlag berücksichtigt:

- den Prio-Rhythmus (28 bzw. 35 Tage) mit konfigurierbarem Toleranzfenster von ± 5 Tagen
- deutsche Feiertage nach S-10 (zwingender Ausschluss)
- Betriebsruhezeiten nach S-12 (zwingender Ausschluss in der Grobplanung)
- Trainerurlaub nach S-11 (zwingender Ausschluss)
- weitere Sperrtage und Sperrzeiträume
- bevorzugte Slots je Kurs
- bereits bestehende Belegungen
- einen wählbaren Mehrfachbelegungsfaktor (1×, 2×, 3×), siehe L-05a
- Obergrenzen für Tages- und Wochenlast je Trainer nach S-02a
- gleichmäßige Verteilung über Wochentage, um Häufungen zu vermeiden

**L-05a (MUSS)** **Mehrfachbelegung auf zwei Ebenen.** Der Mehrfachbelegungsfaktor muss sich sowohl auf ein Datum und einen Slot beziehen als auch **auf einen einzelnen Trainer**. Das heißt: Einem Trainer können für denselben Slot mehrere **Alternativkurse** zugeordnet werden, von denen später genau einer stattfindet. Das System muss diesen Fall als beabsichtigte Alternative kennzeichnen und deutlich von einer echten Doppelbuchung des Trainers unterscheiden.

**L-05b (MUSS)** **Planung ohne Trainerzuweisung.** Ein Kurs muss auf einem Datum und Slot geplant werden können, ohne dass ein Trainer zugeordnet ist. Der Termin erhält in diesem Fall den Status GEPLANT und erscheint in der Liste der ungedeckten Termine. Der Serienplaner muss Termine auch dann erzeugen können, wenn zum Planungszeitpunkt noch keine Verfügbarkeiten vorliegen.

**L-06 (MUSS)** Der Vorschlag wird als **Vorschau** dargestellt und ist zeilenweise prüfbar, änderbar und abwählbar. Erst nach ausdrücklicher Übernahme entstehen Termine. Ein automatisches Schreiben ohne Freigabe ist nicht zulässig.

**L-07 (SOLL)** Der Serienplaner weist auf Konflikte und Kapazitätslücken hin, bevor übernommen wird, z. B. „Kalenderwoche 14: 12 geplante Termine, aber nur 8 freie Trainerslots".

**L-08 (MUSS)** **Rhythmus-Überwachung:** Übersicht aller Kurse mit letztem und nächstem Termin sowie Warnung, wenn der Prio-Rhythmus überschritten wird.

**L-09 (MUSS)** Filter über Kurs, Kategorie, Priorität, Format, Trainer und Status.

**L-10 (MUSS)** **Mehrfachbearbeitung:** Auswahl mehrerer Termine und gemeinsame Ausführung von Aktionen (Trainer zuweisen oder tauschen, verschieben, absagen, Status ändern). Bei über 1.500 Terminen pro Jahr zwingend erforderlich.

**L-11 (MUSS)** Kapazitätsübersicht je Kalenderwoche mit Ampeldarstellung: verfügbare gegen geplante Slots, getrennt nach Tagesabschnitt (Vormittag, Nachmittag, Abend).

**L-12 (KANN)** Vergleich des laufenden Planungsjahres mit dem Vorjahr.

**L-13 (MUSS)** **Mehrteilige Kurse in der Langfristplanung.** Kurse, die mehrere halbe Tage umfassen (ein Modul je halbem Tag), müssen als zusammengehörige Terminfolge geplant werden können. Der Serienplaner erzeugt dabei alle Teile in einem Vorgang mit konfigurierbarem Abstand (z. B. an aufeinanderfolgenden Tagen oder im Wochenabstand). Die Einzeltermine bleiben eigenständige Objekte, werden jedoch über einen Terminverbund nach T-12 verknüpft.

---

## 8 Termine, Status und Zuordnung

**T-01 (MUSS)** Ein Termin ist definiert durch Kurs, Datum und Slot. Ihm kann ein Trainer zugeordnet werden, muss aber nicht (siehe L-05b).

**T-01a (MUSS)** **Jeder Termin ist ein eigenständiges Objekt.** Eine Modellierung als Serie mit gemeinsamer Bearbeitung ist ausdrücklich nicht gewünscht. Änderungen an einem Termin wirken sich niemals automatisch auf andere Termine aus. Der Terminverbund nach T-12 ist davon unberührt: Er verknüpft lediglich die Teile eines mehrteiligen Kurses, ohne die Eigenständigkeit der Einzeltermine aufzuheben.

**T-02 (MUSS)** Folgende Statuswerte sind vorzusehen:

| Status | Bedeutung |
| --- | --- |
| **GEPLANT** | Termin im Raster, kein Trainer zugeordnet, für Trainer nicht sichtbar |
| **RESERVIERT** | Trainer vorgemerkt, Durchführung noch offen |
| **BESTÄTIGT** | Kurs findet statt, Zuordnung verbindlich |
| **ABGESAGT** | Kurs entfällt |
| **VERSCHOBEN** | Ersetzt durch einen Nachfolgetermin, auf den verwiesen wird |
| **DURCHGEFÜHRT** | Abgeschlossen, Grundlage für Auswertungen |

**T-03 (MUSS)** Der Organisator kann jeden Status jederzeit in jeden anderen ändern, auch rückwärts. Es gibt keine gesperrten Übergänge.

**T-04 (MUSS)** Jeder Statuswechsel wird mit Zeitpunkt, auslösender Person, altem und neuem Status sowie optionalem Kommentar dauerhaft protokolliert.

**T-05 (MUSS)** Bei Wechsel auf ABGESAGT wird die zugehörige Trainerverfügbarkeit automatisch wieder freigegeben.

**T-06 (MUSS)** Bei Zuordnung eines Trainers wird automatisch eine Entscheidungsfrist gesetzt. **Annahme A-1:** Standard 21 Tage vor Kursbeginn, systemweit konfigurierbar und je Kurs überschreibbar. Diese Annahme ist beim Review zu bestätigen.

**T-07 (MUSS)** **Kollisionsprüfung:** Das System erkennt, wenn ein Trainer zwei sich zeitlich ausschließenden Terminen zugeordnet werden soll, und weist darauf hin.

**T-08 (MUSS)** **Auflösung von Mehrfachbelegungen:** Werden zwei oder mehr Kurse im selben Datum und Slot bestätigt, erkennt das System den Konflikt und schlägt Trainer vor, die für den betreffenden Kurs qualifiziert und im betreffenden Slot verfügbar sind. Die Zuordnung eines weiteren Trainers muss ohne Verlassen der Ansicht möglich sein.

**T-09 (MUSS)** Bei Verschiebung wird ein neuer Termin erzeugt und mit dem ursprünglichen Termin verknüpft; die Verknüpfung bleibt in beide Richtungen sichtbar.

**T-10 (MUSS)** Interne Notizen je Termin, nur für den Organisator sichtbar und nicht für Trainer.

**T-11 (MUSS)** **Kostenerfassung je Trainerzuordnung.** Zu jeder Zuordnung eines Trainers zu einem Termin muss ein Kostenbetrag frei erfassbar sein. Anforderungen im Einzelnen:

- Bei der Zuordnung wird eine der beim Trainer hinterlegten Kostenkategorien ausgewählt (siehe S-07a); die als Standard markierte Kategorie ist vorbelegt
- **Der Betrag muss unabhängig davon je Termin manuell festlegbar sein.** Die Kategorie ist ein Vorschlag, keine Bindung — insbesondere bei verminderter Teilnehmerzahl und dadurch reduziertem Trainersatz
- Eine Erfassung ganz ohne Kategorie, also nur mit freiem Betrag, muss ebenfalls möglich sein
- Erfassbar sind Kategorie, Betrag, Währung und eine optionale Begründung für die Abweichung
- Weicht der Betrag von der gewählten Kategorie ab, wird dies sichtbar gekennzeichnet
- Der Betrag ist ausschließlich für den Organisator sichtbar, nicht für Trainer
- Änderungen des Betrags werden in der Terminhistorie protokolliert
- Die Kostenwerte fließen in die Kostendeckungsbewertung nach K-11 ein

**T-11a (SOLL)** Bei mehreren zugeordneten Trainern (z. B. nach Auflösung einer Doppelbelegung) ist je Zuordnung ein eigener Kostenbetrag erfassbar.

**T-12 (MUSS)** **Terminverbund für mehrteilige Kurse.** Termine können zu einem Verbund zusammengefasst werden, um mehrteilige Kurse abzubilden, bei denen je Modul ein halber Tag anfällt. Anforderungen:

- Der Verbund trägt eine Bezeichnung und eine Teilnummerierung (Teil 1 von 3 usw.)
- Bei der Trainerzuordnung prüft das System, ob **derselbe Trainer für alle Teile des Verbundes verfügbar** ist, und weist auf Lücken hin
- Eine Zuordnung unterschiedlicher Trainer zu verschiedenen Teilen ist zulässig, muss aber als Hinweis ausgewiesen werden
- Bei Absage eines Teils wird gefragt, ob der gesamte Verbund abgesagt werden soll; die Entscheidung liegt beim Organisator
- Alle Teile des Verbundes verweisen auf dieselbe edoobox-Angebotskennung (siehe E-05)

---

## 9 Phase B — Kurzfristige Steuerung

**K-01 (MUSS)** **Entscheidungsliste:** Zentrale Arbeitsliste aller Termine, deren Entscheidungsfrist erreicht oder überschritten ist, sortiert nach Dringlichkeit.

**K-02 (MUSS)** Je Eintrag der Entscheidungsliste werden angezeigt: Kurstitel, Datum, Slot, zugeordneter Trainer, Status, Belegungsgrad des Slots, Anzahl Anmeldungen, davon zahlende Anmeldungen, Mindestteilnehmerzahl, Erlös, Trainerkosten, Deckungsbeitrag und daraus abgeleitete Empfehlung.

**K-03 (MUSS)** **Entscheidungsampel.** Die Ampel darf sich **nicht allein auf die Kopfzahl der Anmeldungen** stützen. Sie ist zweistufig aufgebaut:

1. **Teilnehmerkriterium:** Vergleich der Anmeldezahl mit der Mindestteilnehmerzahl
2. **Kostendeckungskriterium:** Vergleich des erwarteten Erlöses aus zahlenden Anmeldungen mit den Trainerkosten nach T-11

Die Gesamtampel ergibt sich aus der jeweils schlechteren der beiden Bewertungen. Beide Einzelbewertungen müssen getrennt sichtbar bleiben, damit der Grund einer Warnung erkennbar ist.

**K-04 (MUSS)** Bestätigen und Absagen muss aus der Entscheidungsliste heraus mit einem Arbeitsschritt möglich sein, einschließlich Mehrfachauswahl.

**K-05 (MUSS)** Bei Absage wird automatisch eine Benachrichtigung an den betroffenen Trainer erzeugt und die Verfügbarkeit freigegeben.

**K-06 (SOLL)** Bei Absage wird geprüft, ob am gleichen Datum ein alternativer Kurs desselben Trainers verfügbar wäre, und ein Vorschlag angezeigt.

**K-07 (MUSS)** **Ausfallbearbeitung:** Meldet ein Trainer Ausfall bei einem bestätigten Termin, zeigt das System sofort alle qualifizierten und verfügbaren Ersatztrainer mit einem Klick zur Umbuchung.

**K-08 (SOLL)** Übersicht „Nächste 3 Wochen" als Tagesansicht mit allen bestätigten Terminen, Trainern und Anmeldezahlen.

### 9.1 Kostendeckung und Preiskategorien

Hintergrund: Teilnehmer, die einen Termin zu spät abgesagt haben, müssen den ursprünglichen Termin bezahlen und dürfen sich anschließend für einen Ersatztermin anmelden, wobei die bereits bezahlten Kosten verrechnet werden. Diese **Nachholer** erscheinen in der Anmeldezahl, tragen jedoch **nicht zur Kostendeckung** des neuen Termins bei. Die Mindestteilnehmerzahl allein ist daher keine ausreichende Entscheidungsgrundlage.

**K-09 (MUSS)** **Preiskategorien je Termin.** Zu jedem Termin muss sichtbar sein, welche Preiskategorien aus edoobox den Anmeldungen zugeordnet sind, jeweils mit Anzahl der Anmeldungen je Kategorie.

**K-10 (MUSS)** **Klassifizierung der Preiskategorien.** Jede Preiskategorie ist als **erlöswirksam** oder **nicht erlöswirksam** einzustufen. Erschwerend kommt hinzu, dass Preiskategorien in edoobox **je Kurstermin frei definiert** werden und ihre Bezeichnung sich ändern kann — der Standardpreis wird beispielsweise umbenannt, sobald der Last-Minute-Rabatt greift. Eine Einstufung anhand einer festen Kennung je Kategorie ist deshalb nicht tragfähig. Vorzusehen ist stattdessen ein dreistufiges Verfahren:

1. **Regelwerk auf Bezeichnungsmustern.** Der Organisator pflegt eine Liste von Textmustern mit zugeordneter Einstufung, z. B. enthält „Nachhol" oder „Storno" → nicht erlöswirksam. Die Muster sind ohne Programmierung pflegbar, die Prüfung erfolgt ohne Beachtung von Groß- und Kleinschreibung.
2. **Betragsregel als Absicherung.** Eine Kategorie mit einem Nettobetrag von null wird unabhängig von der Bezeichnung als nicht erlöswirksam behandelt. Damit werden ein Rabatt von 100 Prozent und Freiplätze auch dann richtig bewertet, wenn die Bezeichnung abweicht.
3. **Manuelle Festlegung je Termin.** Der Organisator kann die automatische Einstufung für einen einzelnen Termin überschreiben. Die Abweichung wird gekennzeichnet und protokolliert.

Greift weder Regel 1 noch Regel 2, gilt die Kategorie als **ungeklärt**: Sie wird sichtbar ausgewiesen, dem Organisator zur Einstufung vorgelegt und **nicht** stillschweigend als erlöswirksam behandelt.

**K-10a (MUSS)** **Ausgangsbestand der Preiskategorien.** Grundlage ist eine vollständige Auswertung des Ist-Bestands mit 978 Einträgen. Darin kommen **75 unterschiedliche Schreibweisen** vor, die sich auf etwa zwölf fachliche Sachverhalte zurückführen lassen. Der Bestand belegt, dass eine Einstufung über feste Bezeichnungen ausgeschlossen ist: Neben abweichenden Schreibweisen („Standard Preis" gegenüber „Standardpreis", „Last-Minute-Preis (-10%)" gegenüber „Last Minute") treten Tippfehler auf („Last Miunte", „Last MInute", „Last--Minute-Preis", „Kombibuchung(-5%)") sowie Platzhalter („---", „-", „xxx").

Das Regelwerk nach K-10 wurde gegen diesen Bestand geprüft. Alle 978 Einträge werden von einer Regel erfasst; 4,7 Prozent verbleiben planmäßig im Zustand „ungeklärt", weil die Bezeichnung keinen fachlichen Gehalt hat.

| Muster (normalisiert, ohne Groß-/Kleinschreibung) | Einstufung | Anteil |
| --- | --- | --- |
| `stornogebuehr`, `diff nach verrechnung` | **erlöswirksam, zählt nicht als Teilnehmer** (siehe K-10d) | 0,8 % |
| `nachholtermin`, `ersatztermin` | nicht erlöswirksam | — |
| `inklusive` | nicht erlöswirksam, zählt als Teilnehmer | — |
| `organisator` | nicht erlöswirksam, zählt als Teilnehmer | — |
| (Summe der drei vorstehenden) | | 14,8 % |
| `nicht anwesend`, `verrechnung`, reine Platzhalter | ungeklärt, Vorlage an den Organisator | 4,7 % |
| `kombibuchung`, `kombirabatt` | erlöswirksam | — |
| `last minute` einschließlich Schreibvarianten | erlöswirksam | — |
| `standard preis`, `standardpreis` | erlöswirksam | — |
| `partner` | erlöswirksam | — |
| `privatbucher`, `behoerdenrabatt`, `kundenrabatt`, `vereinsrabatt`, `schulen`, `anschluss`, `paket`, `gruppenrabatt` | erlöswirksam | — |
| `weitere person`, `pro person`, `personen`, `pro angefangene`, `workshop`, `webinarpreis` | erlöswirksam | — |
| (Summe der erlöswirksamen Muster) | | 79,7 % |

Häufigste Einzelbezeichnungen: Standard Preis (174), Kombibuchung (-10%) (109), Kombibuchung (-5%) (102), Last-Minute-Preis (-10%) (101), Kombirabatt (-10%) (62), Nachholtermin nach Storno (-100%) (49), Kombirabatt (-5%) (48), Nachholtermin nach Storno (48), Partnerrabatt (-25%) (45), Inklusive (36).

**K-10a1 (MUSS)** **Normalisierung vor der Musterprüfung.** Vor dem Abgleich wird die Bezeichnung vereinheitlicht: Kleinschreibung, Umlaute aufgelöst, alle Zeichen außer Buchstaben und Ziffern zu einfachen Leerzeichen zusammengefasst. Erst dadurch treffen dieselben Muster auf „Kombibuchung (-5%)" und „Kombibuchung(-5%)" sowie auf „Last-Minute-Preis (-10%)", „Last Minute" und „Last--Minute-Preis (-10%)".

**K-10a2 (MUSS)** **Reihenfolge der Regeln.** Die Regeln werden in fester Reihenfolge geprüft, die erste zutreffende gewinnt. Ausnahmeregeln stehen vor den allgemeinen Regeln. Zwingend erforderlich ist dies bei „Diff. nach Verrechnung der Stornogebühr" und „Stornogebühr (100%)": Beide enthalten „Storno", sind aber erlöswirksam und dürfen nicht von der Nachholer-Regel erfasst werden. Die Reihenfolge muss vom Organisator veränderbar sein.

Für Firmenkurse gilt zusätzlich:

| Preiskategorie (Beispiele aus dem Ist-Bestand) | Einstufung | Anmerkung |
| --- | --- | --- |
| Kurspreis für max. 4 Personen, Preis für bis zu 4 Personen, Webinarpreis für 5 Personen, Workshop für 2 Stunden für max. 3 Personen | erlöswirksam | Der Betrag gilt für die Gruppe, nicht je Person. Bei der Umrechnung auf Teilnehmer nicht zu vervielfachen |
| Inklusive | **nicht erlöswirksam** | Zählt als Teilnehmer, trägt aber keinen eigenen Erlös, da im Gruppenpreis enthalten |
| Preis für jede weitere Person, auch mit Rabattzusatz | erlöswirksam | Je Person zu zählen |
| Pro angefangene 15 Minuten | erlöswirksam | Zeitbezogene Abrechnung, keine Teilnehmerbezugsgröße |

**K-10d (MUSS)** **Erlös ohne Teilnehmer.** Die Bezeichnungen „Stornogebühr" und „Diff. nach Verrechnung der Stornogebühr" stehen für Beträge, die dem Termin zufließen, ohne dass eine Person teilnimmt. Das System führt daher je Preiskategorie **zwei getrennte Kennzeichen**: erlöswirksam ja/nein und teilnehmerwirksam ja/nein. Damit lassen sich alle vier Kombinationen abbilden:

| Fall | Erlös | Teilnehmer | Beispiel |
| --- | --- | --- | --- |
| Regelfall | ja | ja | Standard Preis, Kombibuchung |
| Nachholer | nein | ja | Nachholtermin nach Storno |
| Freiplatz im Gruppenpreis | nein | ja | Inklusive, Organisatorin |
| Ausgleichsbetrag | ja | nein | Stornogebühr, Diff. nach Verrechnung |

**K-10b (MUSS)** Die Kategorie „Inklusive" zeigt, dass „nicht erlöswirksam" nicht mit „nicht zu berücksichtigen" gleichzusetzen ist. Solche Anmeldungen zählen für die Teilnehmerzahl und für die Kapazitätsgrenze, nicht jedoch für den Erlös. Die Darstellung nach K-11 muss beide Sichtweisen getrennt führen.

**K-10c (SOLL)** Bei Firmenkursen ist der Deckungsbeitrag auf den **gesamten Kurs** zu beziehen, nicht auf die Teilnehmerzahl. Eine Mindestteilnehmerzahl ist hier ohne Bedeutung; maßgeblich ist allein, ob der vereinbarte Gruppenpreis die Trainerkosten deckt.

**K-11 (MUSS)** **Deckungsbeitrag je Termin.** Das System stellt je Termin gegenüber:

| Größe | Herkunft |
| --- | --- |
| Anmeldungen gesamt | edoobox |
| davon erlöswirksam (zahlende Teilnehmer) | edoobox, gefiltert nach Einstufung K-10 |
| davon nicht erlöswirksam (Nachholer) | edoobox, gefiltert nach Einstufung K-10 |
| Erlös netto | edoobox, siehe E-09 und E-24 |
| Trainerkosten | manuelle Erfassung nach T-11 |
| **Deckungsbeitrag** | Erlös netto abzüglich Trainerkosten |

**K-12 (MUSS)** In der Entscheidungsliste muss die Anzahl der Nachholer eigenständig erkennbar sein, damit der Fall „Mindestteilnehmerzahl formal erreicht, Kostendeckung dennoch nicht gegeben" sofort auffällt.

**K-13 (SOLL)** Schwellenwert für die Kostendeckung frei einstellbar, z. B. Deckungsbeitrag größer null oder ein Mindestdeckungsbeitrag je Termin. Der Schwellenwert muss je Kurs überschreibbar sein, da bei Kursen mit vermindertem Trainersatz andere Maßstäbe gelten.

**K-14 (KANN)** Auswertung, wie häufig Nachholer auftreten, je Kurs und Zeitraum — als Hinweis darauf, wo Absageregeln nachgeschärft werden sollten.

---

## 10 Terminbewerbung durch Trainer (optionales Modul)

**B-01 (SOLL)** Der Organisator kann einzelne Termine als **offen zur Bewerbung** kennzeichnen.

**B-02 (SOLL)** Trainer sehen eine Liste ausschließlich jener offenen Termine, für die sie qualifiziert sind und zu denen sie verfügbar sind oder verfügbar werden können.

**B-03 (SOLL)** Trainer können sich auf einen offenen Termin bewerben, optional mit Kommentar. Die Bewerbung erzeugt keine Zuordnung, sondern eine Aufgabe beim Organisator.

**B-04 (SOLL)** Der Organisator sieht alle Bewerbungen je Termin und wählt einen Trainer aus. Nicht berücksichtigte Bewerber werden automatisch informiert.

**B-05 (KANN)** Trainer können freie Termine für einen Kurs vorschlagen, den sie gern zusätzlich anbieten würden („Terminwunsch"). Der Vorschlag durchläuft denselben Genehmigungsweg.

**B-06 (MUSS, sofern Modul umgesetzt)** Bewerbungen und deren Ergebnis werden in der Historie des Trainers festgehalten.

**B-07 (SOLL)** Das Modul muss vollständig deaktivierbar sein, ohne dass die übrige Funktionalität eingeschränkt wird.

---

## 11 Kommunikation

Ziel: Absprachen, Terminänderungen und Anfragen laufen nicht mehr über verstreute E-Mails, sondern sind im System gebündelt und rekonstruierbar.

**C-01 (MUSS)** **Terminbezogene Kommentare:** Zu jedem Termin existiert ein Nachrichtenverlauf zwischen Organisator und zugeordnetem Trainer. Der fachliche Bezug ist damit immer eindeutig.

**C-02 (MUSS)** **Direkter Nachrichtenverlauf:** Zwischen Organisator und jedem einzelnen Trainer existiert ein dauerhafter Verlauf für Themen ohne konkreten Terminbezug.

**C-03 (MUSS)** **Strukturierte Vorgänge:** Anfragen werden als Vorgang mit Typ und Status geführt, nicht als freie Nachricht:

| Vorgangstyp | Auslöser |
| --- | --- |
| Rücknahme einer Freigabe | Trainer |
| Ausfallmeldung | Trainer |
| Terminwunsch / Bewerbung | Trainer |
| Terminänderung | Organisator |
| Allgemeine Anfrage | beide |

Statuswerte je Vorgang mindestens: offen, in Bearbeitung, erledigt, abgelehnt.

**C-04 (MUSS)** Offene Vorgänge erscheinen für den Organisator in einer zentralen Aufgabenliste und für den Trainer in seiner Übersicht. Kein Vorgang darf unbemerkt liegen bleiben.

**C-05 (MUSS)** Bei neuer Nachricht oder Statusänderung eines Vorgangs erfolgt eine Benachrichtigung per E-Mail mit direktem Link auf den Verlauf im System.

**C-06 (SOLL)** **Antwort per E-Mail:** Eine Antwort auf die Benachrichtigungs-E-Mail wird automatisch in den zugehörigen Verlauf im System eingeordnet. Damit müssen Trainer sich nicht anmelden, um zu antworten — erfahrungsgemäß entscheidend für die tatsächliche Nutzung.

**C-07 (SOLL)** Dateianhänge an Nachrichten (z. B. Unterlagen, Screenshots) mit Größenbegrenzung.

**C-08 (MUSS)** Nachrichten können nicht gelöscht werden. Eine Korrektur erfolgt durch eine erkennbar als Nachtrag markierte weitere Nachricht.

**C-09 (SOLL)** Rundnachrichten des Organisators an alle oder ausgewählte Trainer, mit Ablage im jeweiligen Einzelverlauf.

**C-10 (SOLL)** Vorlagen für wiederkehrende Nachrichten (Absage, Bestätigung, Anfrage zu Zusatzterminen) mit automatischem Einsetzen von Kurs, Datum und Slot.

**C-11 (KANN)** Lesebestätigung, ob eine Nachricht im System geöffnet wurde.

---

## 12 Historie und Nachvollziehbarkeit

**H-01 (MUSS)** **Trainerakte:** Für jeden Trainer existiert eine chronologische Gesamtansicht, die folgende Ereignisse in einem einheitlichen Verlauf zusammenführt:

- eingetragene und zurückgenommene Verfügbarkeiten
- Zuordnungen zu Terminen
- alle Statuswechsel seiner Termine
- Nachrichten und Vorgänge
- Bewerbungen und deren Ergebnis

**H-02 (MUSS)** Jeder Trainer hat Zugriff auf seine eigene Akte. Der Organisator hat Zugriff auf alle Akten.

**H-03 (MUSS)** **Terminhistorie:** Für jeden Termin ist der vollständige Verlauf einsehbar — wer wann welchen Status gesetzt hat, welcher Trainer wann zugeordnet oder getauscht wurde, welche Nachrichten dazu gewechselt wurden.

**H-04 (MUSS)** Filterung der Historie nach Zeitraum, Ereignistyp, Kurs und Status.

**H-05 (MUSS)** **Volltextsuche** über Nachrichten, Vorgänge und Notizen.

**H-06 (SOLL)** Export einer Akte oder Terminhistorie als PDF, um einen Sachverhalt außerhalb des Systems belegen zu können.

**H-07 (MUSS)** Historieneinträge sind nicht veränderbar und nicht löschbar.

**H-08 (SOLL)** Systemweites Änderungsprotokoll über alle Anmeldungen, Stammdatenänderungen und Datenexporte.

---

## 13 Schnittstelle edoobox

Grundlage: edoobox REST API V2 mit Authentisierung über Schlüssel und Geheimnis ([Dokumentation](https://v2.docs.edoobox.com/docs/edoobox-api)). Die Ressourcen Angebote, Buchungen, Termine/Module, Preiskategorien und Rechnungen stehen lesend sowie in V2 auch schreibend zur Verfügung ([REST-API-Übersicht](https://docs.edoobox.com/knowledge-base/rest-api-basic/)).

### 13.1 Zuordnung Termin ↔ edoobox-Angebot

**E-01 (MUSS)** Jeder Termin im System kann eine edoobox-Angebots-Kennung tragen. Ohne diese Zuordnung ist keine Übernahme von Kennzahlen möglich.

**E-02 (MUSS)** Das System schlägt Zuordnungen automatisch anhand von Startdatum und Kurstitel vor; die Bestätigung erfolgt durch den Organisator mit einem Arbeitsschritt.

**E-03 (SOLL)** Unterstützung einer Namens- oder Schlagwortkonvention (Angebotsnummer bzw. Tag), sodass die Zuordnung vollautomatisch erfolgt.

**E-04 (MUSS)** Nicht zuordenbare Termine und nicht zugeordnete edoobox-Angebote werden in einer Abweichungsliste ausgewiesen.

**E-05 (MUSS)** Das System muss beide Modellierungen in edoobox verarbeiten können: ein Angebot je Termin sowie ein Angebot mit mehreren Modulen. Beide Varianten kommen tatsächlich vor.

**E-05a (MUSS)** **Mehrteilige Kurse.** Es gibt Kurse, die mehrere halbe Tage umfassen, wobei jedes Modul einem halben Tag entspricht. In edoobox ist dies ein Angebot mit mehreren Modulen. Das System muss:

- die Module eines Angebots einzeln auslesen und je Modul einen eigenen Termin führen
- diese Termine über einen Terminverbund nach T-12 verknüpfen
- sicherstellen, dass ein Trainer **für alle Teile buchbar** ist, und bei lückenhafter Verfügbarkeit warnen
- Anmeldezahlen und Erlöse dem Verbund als Ganzem zuordnen, nicht jedem Teil einzeln, um Doppelzählung zu vermeiden

### 13.2 Lesender Abruf (Phase B)

**E-06 (MUSS)** Übernahme der Anzahl Anmeldungen je Termin aus dem Feld `usercount` sowie der Mindest- und Höchstteilnehmerzahl aus `user_minimal` und `user_maximum` ([Angebote-Ressourcen](https://docs.edoobox.com/knowledge-base/angeboteressourcen-rest-api/)).

**E-07 (SOLL)** Getrennte Ausweisung von festen Anmeldungen und Wartelistenplätzen anhand des Buchungsstatus `default` bzw. `waitinglist` ([Buchung-Ressourcen](https://docs.edoobox.com/knowledge-base/buchung-ressourcen-rest-api/)).

**E-08 (SOLL)** Übernahme des Anmeldeschlusses aus dem Feld `deadline` und Abgleich mit der systeminternen Entscheidungsfrist.

**E-09 (MUSS)** **Erlös je Termin.** Maßgeblich ist der **tatsächliche Nettopreis je Anmeldung**. Als Quellen sind in dieser Reihenfolge vorzusehen:

1. **Nettopreis je Anmeldung** über den bereits erprobten Weg (siehe E-24). Dieser Wert ist die Grundlage der Kostendeckungsbewertung, weil nur er den je Anmeldung tatsächlich erzielten Preis abbildet.
2. Ergänzend die Rechnungssummen `total_amount`, gefiltert nach Angebot, mit Unterscheidung nach Rechnungsstatus offen, bezahlt und annulliert ([Rechnung-Ressourcen](https://docs.edoobox.com/knowledge-base/rechnung-ressourcen/)) — zur Kontrolle des Zahlungsstands.
3. Ersatzweise ein Näherungswert aus Preiskategorie und Anmeldezahl, wenn die Quellen 1 und 2 nicht verfügbar sind.

Die verwendete Quelle muss je Wert erkennbar sein. Ein Näherungswert darf nicht wie ein Istwert dargestellt werden.

**E-10 (MUSS)** Umsatzdaten sind ausschließlich der Rolle Organisator zugänglich.

**E-11 (MUSS)** **Datenminimierung:** Es werden ausschließlich aggregierte Kennzahlen gespeichert. Namen, Anschriften und Kontaktdaten von Teilnehmern dürfen nicht in das System übernommen werden.

**E-12 (MUSS)** Abruf mindestens einmal täglich automatisiert für ein rollierendes Zeitfenster (Vorschlag: kommende 8 Wochen) sowie jederzeit manuell auslösbar für einen einzelnen Termin.

**E-13 (KANN)** edoobox-Webhooks können später ergänzt werden, wenn Änderungen nahezu in Echtzeit benötigt werden. Der vollständige operative Abgleich nach E-31a bleibt auch dann als Sicherheitsnetz bestehen.

**E-14 (MUSS)** Zeitpunkt und Ergebnis des letzten Abrufs sind in der Oberfläche sichtbar. Veraltete Werte müssen als solche erkennbar sein und dürfen nicht als aktuell dargestellt werden.

### 13.3 Schreibender Zugriff (Phase A, spätere Ausbaustufe)

**E-15 (SOLL)** **Veröffentlichung geplanter Termine nach edoobox.** Nach Abschluss der Langfristplanung erzeugt das System die zugehörigen Angebote in edoobox auf Grundlage eines je Kurstitel gepflegten Vorlagen-Angebots. Übertragen werden Datum, Uhrzeit, Anmeldeschluss und Teilnehmergrenzen; Beschreibung, Bild und Preiskategorien stammen aus der Vorlage.

**E-16 (MUSS, sofern E-15 umgesetzt)** Auch mehrfach belegte Termine werden veröffentlicht, da die Anmeldezahlen konkurrierender Kurse die Entscheidungsgrundlage bilden.

**E-17 (MUSS, sofern E-15 umgesetzt)** Die Veröffentlichung erfolgt ausschließlich nach ausdrücklicher Freigabe durch den Organisator, mit vorheriger Vorschau der zu erzeugenden Angebote. Kein automatisches Schreiben ohne Freigabe.

**E-18 (MUSS, sofern E-15 umgesetzt)** Bei Absage eines Termins wird das zugehörige edoobox-Angebot nicht gelöscht, sondern per Statusänderung aus der öffentlichen Anzeige entfernt. Die Unterrichtung der Teilnehmer erfolgt weiterhin über edoobox.

**E-19 (MUSS, sofern E-15 umgesetzt)** Alle schreibenden Vorgänge werden protokolliert und müssen einen Testlauf ohne tatsächliche Übertragung erlauben.

**E-20 (MUSS)** Das Schreiblimit von 1.000 Anfragen je 24 Stunden ist einzuhalten ([REST-API-Übersicht](https://docs.edoobox.com/knowledge-base/rest-api-basic/)). Größere Veröffentlichungsläufe sind in Teilmengen abzuarbeiten und im Fehlerfall wiederaufsetzbar zu gestalten.

**E-21 (MUSS)** Fällt die Schnittstelle aus, muss das System vollständig weiterarbeiten. Anmeldezahlen müssen ersatzweise manuell erfasst werden können.

**E-22 (MUSS)** Zugangsdaten zur Schnittstelle sind verschlüsselt zu speichern und dürfen in der Oberfläche nicht im Klartext erscheinen.

### 13.4 Preiskategorien, Nettopreise und Nachholer

**E-23 (MUSS)** Übernahme der Preiskategorien je Angebot aus der Ressource Preiskategorien beziehungsweise aus dem Zusatzfeld `pricecategories` der Angebote-Ressource ([Angebote-Ressourcen](https://docs.edoobox.com/knowledge-base/angeboteressourcen-rest-api/)), einschließlich der Anzahl der Anmeldungen je Kategorie. Grundlage für K-09.

**E-24 (MUSS)** **Nettopreis je Anmeldung und Angebot, Ermittlungsweg.** Die vollständige Prüfung der edoobox-Ressourcen hat den früher vorgesehenen Einzelabruf `GET /v2/booking/{id}/data` ersetzt. Der Neubau bezieht die erforderlichen Daten aus den seitenweise vollständig gelesenen Listenressourcen:

1. `booking/list` liefert Buchungskennung, Angebot, Status, Teilnehmerzuordnungen, gebuchte Preiskategorien und Transaktionsbezüge.
2. `pricecategory/list` liefert Preiskategorie, Angebotszuordnung, Bezeichnung und Betrag.
3. `transaction/list` liefert Buchungs- und Angebotsbezug sowie den tatsächlichen Zahlungsvorgang für den Abgleich.
4. Buchung, Buchungsposition und Transaktion werden getrennt gespeichert und über ihre Kennungen verbunden.

Maßgeblich für den Erlös ist der Nettobetrag der gebuchten Preiskategorie. Transaktionsbeträge dienen ausschließlich dem Zahlungsabgleich und dürfen den Erlös nicht vervielfachen. Ein Einzelabruf sämtlicher Buchungsdetails ist im produktiven Regelbetrieb ausgeschlossen.

**E-24a (MUSS)** **Einschränkungen des Altbestands als Vorgabe für den Neubau.** Die Auswertung des bisherigen Ablaufs hat acht Konstruktionsfehler ergeben. Da der Ablauf nicht weitergenutzt wird, sind sie keine Fehlerliste, sondern **Ausschlusskriterien für die Neuentwicklung**: Jeder einzelne Punkt ist im Neubau konstruktiv unmöglich zu machen, nicht nachträglich zu beheben. Die Punkte 1, 3 und 4 lassen sich ausschließlich über die Tabellenstruktur ausschließen, nicht über die Ablauflogik.

| Nr. | Einschränkung | Auswirkung |
| --- | --- | --- |
| 1 | Je Buchung wird nur die **erste** Preiskategorie übernommen (Zugriff auf das erste Element der Kategorienliste) | Bei Buchungen mit mehreren Kategorien — insbesondere Firmenkursen mit „Preis für bis max. 4 Personen", „Inklusive" und „Preis für jede weitere Person" — fehlen Erlösanteile. Der Deckungsbeitrag würde systematisch zu niedrig ausgewiesen |
| 2 | Ebenso wird nur der **erste** Teilnehmer einer Buchung erfasst | Sammelbuchungen mehrerer Personen werden untererfasst |
| 3 | Buchungen **ohne Transaktion werden übersprungen** | Noch nicht bezahlte, aber verbindliche Anmeldungen fehlen vollständig. Da die Durchführungsentscheidung rund drei Wochen vor Kursbeginn fällt, sind offene Zahlungen der Regelfall, nicht die Ausnahme |
| 4 | Je Transaktion entsteht eine Zeile, die Kategoriefelder werden dabei **wiederholt** | Eine Summenbildung über `pricecategory_amount` zählt bei Teilzahlungen doppelt |
| 5 | Der Zielsatz wird per Zeichenkettenverkettung in eine `INSERT`-Anweisung eingesetzt; nur einzelne Felder werden maskiert | Ein Apostroph in einem Kategorienamen oder Aktionscode führt zum Abbruch oder zu verfälschten Daten. Zu ersetzen durch parametrisierte Anweisungen |
| 6 | Bei jedem Lauf werden **alle Buchungen einzeln über den Detailendpunkt** abgerufen | Unnötige Last. Im Neubau werden die geprüften Listenressourcen seitenweise vollständig gelesen; einzelne Detailabrufe sind im Regelbetrieb ausgeschlossen. Hashvergleiche begrenzen die Datenbankschreibvorgänge auf neue und geänderte Datensätze |
| 7 | `created_at` wird beim Upsert auf die aktuelle Zeit gesetzt | Der ursprüngliche Anlagezeitpunkt geht verloren. Erforderlich sind getrennte Felder für Anlage und letzte Änderung |
| 8 | Der Zugang zur edoobox-API ist im Ablauf selbst hinterlegt, nicht in der Anmeldedatenverwaltung | Zugangsdaten erscheinen bei jedem Export im Klartext. Zu überführen in die Anmeldedatenverwaltung, siehe E-22 |

**E-24b (MUSS)** Die Einschränkungen 1 bis 4 aus E-24a betreffen unmittelbar die Richtigkeit des Deckungsbeitrags. Der Nachweis ihres Ausschlusses ist Voraussetzung für die Freigabe der Ausbaustufe 4. Bis dahin darf das System keinen Deckungsbeitrag als Istwert darstellen.

**E-24c (MUSS)** Da die Erlösermittlung mehrere Listenressourcen miteinander verbindet, sind vorzusehen: eine Plausibilitätsprüfung je Termin (Summe der Kategoriebeträge gegen Anzahl Anmeldungen und gegen Rechnungssummen), eine Warnung bei Abweichung sowie eine Warnung, sobald die Ermittlung ausfällt oder unveränderte Werte über mehr als einen konfigurierbaren Zeitraum liefert.

**E-25 (MUSS)** **Erkennung von Nachholern.** Anmeldungen von Teilnehmern, die einen früheren Termin zu spät abgesagt und bereits bezahlt haben, müssen anhand der zugeordneten Preiskategorie als nicht erlöswirksam erkannt werden (siehe K-10). Eine Erkennung anhand personenbezogener Merkmale ist ausgeschlossen; maßgeblich ist ausschließlich die Preiskategorie.

**E-26 (SOLL)** Ändert sich in edoobox der Bestand der Preiskategorien, meldet das System dies dem Organisator, damit die Einstufung nach K-10 nachgezogen werden kann.

### 13.5 Neubau von Datenbeschaffung und Datenhaltung

Der Auftraggeber hat entschieden, die bestehenden n8n-Abläufe **nicht weiterzuverwenden**. Datenbeschaffung und Datenhaltung werden vollständig neu aufgebaut: neue Abläufe in n8n, neue PostgreSQL-Datenbank, neuer Zugriffstoken mit begrenzter Laufzeit.

**Festgelegte Rahmenbedingungen:**

| Punkt | Festlegung |
| --- | --- |
| Datenbank | PostgreSQL als eigener Container auf dem Hetzner-Server des Auftraggebers, betrieben über Portainer. Betriebsstandort EU |
| n8n | selbst gehostet auf demselben Server |
| Verbindung n8n zur Datenbank | ausschließlich über das interne Containernetz, kein veröffentlichter Port |
| Umfang der ersten Stufe | Spiegelung aller zwölf geprüften edoobox-Ressourcen; die Planungsdaten der Anwendung folgen später |
| edoobox-Webhooks | im Tarif verfügbar, für die erste produktive Fassung jedoch nicht erforderlich |

**Aufgabenteilung:** n8n ist allein zuständig für die Beschaffung der edoobox-Daten und einziger Schreiber der Rohdatentabellen. Die Anwendung liest ausschließlich und schreibt niemals zurück. Damit gibt es je Datenbestand genau einen Verantwortlichen.

#### 13.5.1 Datenmodell

**E-27 (MUSS)** **Trennung von Buchung, Position und Zahlung.** Das Datenmodell führt drei getrennte Tabellen. Diese Trennung ist die einzige Maßnahme, mit der sich die Einschränkungen 1, 3 und 4 aus E-24a konstruktiv ausschließen lassen:

| Tabelle | Inhalt | Schlüssel | Schließt aus |
| --- | --- | --- | --- |
| Buchung | Angebotskennung, Status, Buchungszeit, B2B-Kennzeichen | Buchungskennung | Nr. 3: die Buchung existiert **ohne** Zahlung, verbindliche unbezahlte Anmeldungen bleiben sichtbar |
| Buchungsposition | **eine Zeile je Preiskategorie** mit Nettobetrag und Anzahl | Buchung + Kategoriekennung | Nr. 1: mehrere Kategorien je Buchung sind abbildbar |
| Transaktion | Zahlungsvorgänge, ausschließlich für den Abgleich | Transaktionskennung | Nr. 4: Teilzahlungen können den Erlös nicht vervielfachen |

**E-27a (MUSS)** **Kein Personenbezug im Datenmodell.** Name, Rechnungsanschrift, E-Mail-Adresse und IP-Adresse werden **gar nicht erst gespeichert**. Die Zusage aus E-11 ist damit im Datenmodell verankert und nicht erst in der Anwendung. Zulässig ist ausschließlich ein nicht umkehrbarer Streuwert der edoobox-Benutzerkennung, damit Mehrfachbuchungen derselben Person erkennbar bleiben, ohne die Person zu kennen.

**E-27b (MUSS)** **Nachvollziehbarkeit je Datensatz.** Je Buchung sind getrennt zu führen: Zeitpunkt des ersten Auftretens, Zeitpunkt des letzten Abgleichs und Zeitpunkt der letzten **inhaltlichen** Änderung. Der letzte Wert darf nur fortgeschrieben werden, wenn sich die Nutzdaten tatsächlich geändert haben; maßgeblich ist ein Vergleich über einen Streuwert der Antwort. Damit ist Einschränkung 7 aus E-24a ausgeschlossen.

**E-27c (MUSS)** **Kein Löschen.** In edoobox entfallene Buchungen werden im Bestand als entfallen gekennzeichnet, nicht gelöscht. Nur so bleibt nachvollziehbar, warum sich eine Teilnehmerzahl rückwirkend geändert hat.

**E-27d (MUSS)** **Parametrisierte Anweisungen.** Sämtliche Schreibvorgänge erfolgen über parametrisierte Datenbankanweisungen. Das Zusammensetzen von Anweisungen aus Zeichenketten ist ausgeschlossen (Einschränkung 5 aus E-24a).

#### 13.5.2 Zugriff der Anwendung

**E-28 (MUSS)** **Lesender Zugriff ausschließlich über Sichten.** Die Anwendung greift lesend und ausschließlich über dafür angelegte **Datenbanksichten** zu, nicht auf die Rohtabellen. Vorzusehen sind mindestens drei Sichten:

| Sicht | Inhalt | Bezug |
| --- | --- | --- |
| Kennzahlen je Termin | Teilnehmerzahl, Teilnehmer ohne Erlöswirkung, Nettoerlös, Anzahl ungeklärter Positionen, Stand | K-11, K-12 |
| Preiskategorien je Termin | Anzahl und Betrag je Kategoriebezeichnung samt Einstufung und deren Herkunft | K-09, K-10 |
| Zahlungsabgleich je Termin | Summe der tatsächlichen Zahlungseingänge gegen erwarteten Erlös | E-24c |

Die Sichten sind die vereinbarte Schnittstelle. Ändert sich das Schema der Rohtabellen, ist nur die Sicht anzupassen; die Anwendung bleibt unverändert.

> Begründung der Entscheidung gegen einen Eingangsendpunkt der Anwendung: Ein von n8n befüllter Endpunkt würde die Kennzahlen ein zweites Mal speichern und damit zwei Bestände entstehen lassen, die auseinanderlaufen können. Der lesende Zugriff auf eine Sicht hält die Datenhaltung an einer Stelle, verlagert die Aggregationslogik nach SQL, wo sie unabhängig von der Anwendung prüfbar ist, und erfordert keine zusätzliche Berechtigungsverwaltung.

**E-28a (MUSS)** **Einstufung der Preiskategorien in der Datenbank.** Das Regelwerk nach K-10 einschließlich Normalisierung, Regelreihenfolge und manueller Übersteuerung wird in der Datenbank abgebildet und von den Sichten angewendet. Begründung: Die Einstufung entscheidet über den Deckungsbeitrag und muss unabhängig von der Anwendung prüfbar sein. Die Regeln liegen als Datensätze vor und sind ohne Programmierung änderbar; die Anwendung liefert die Oberfläche zur Pflege.

**E-28b (MUSS)** **Getrennte Datenbankbenutzer.** Es bestehen mindestens zwei Rollen: eine Schreibrolle für n8n mit Rechten ausschließlich auf die Rohdatentabellen und eine Leserolle für die Anwendung mit `SELECT`-Recht ausschließlich auf die Sichten sowie Schreibrecht ausschließlich auf die Tabelle der manuellen Übersteuerungen. Ein direkter Zugriff der Anwendung auf die Rohdaten muss fehlschlagen.

**E-28c (MUSS)** **Datenbankbenutzer sind ausschließlich technische Konten.** Personenbezogene Anmeldungen bestehen allein auf Anwendungsebene (R-06). Kein Anwendungsnutzer — insbesondere kein Trainer — erhält einen eigenen Datenbankzugang oder Kenntnis der Zugangsdaten. Die Durchsetzung der Rollenrechte nach R-01 bis R-05 erfolgt in der Anwendung; die Datenbank kennt die Rollen des Fachkonzepts nicht. Zugriffsberechtigt sind ausschließlich der n8n-Container, später der Anwendungsserver sowie der Auftraggeber zu Verwaltungszwecken.

**E-30 (MUSS)** **Umgang mit veralteten Werten.** Jede Sicht liefert einen Zeitstempel des Standes mit. Ist die Datenbank nicht erreichbar oder der Stand älter als eine konfigurierbare Grenze, bleibt das System vollständig nutzbar; die betroffenen Werte werden als veraltet beziehungsweise fehlend gekennzeichnet und können manuell erfasst werden. Ein veralteter Wert darf nicht wie ein aktueller dargestellt werden.

**E-30a (MUSS)** Liefert eine Sicht für einen Termin ungeklärte Positionen nach K-10, weist das System den Deckungsbeitrag dieses Termins als **unvollständig** aus und benennt die betroffenen Kategoriebezeichnungen.

#### 13.5.3 Betrieb der Datenbank

**E-29 (MUSS)** **Betriebsform.** Die Datenbank läuft als eigener Container auf dem vorhandenen Hetzner-Server des Auftraggebers, verwaltet über Portainer. Ein verwalteter Datenbankdienst eines Dritten wird nicht genutzt. Daraus folgt:

| Punkt | Anforderung |
| --- | --- |
| Netz | Datenbank und n8n liegen in einem gemeinsamen internen Containernetz. Die Datenbank veröffentlicht **keinen** Port nach außen und ist aus dem Internet nicht erreichbar |
| Auflösung | n8n erreicht die Datenbank über den Containernamen, nicht über eine IP-Adresse |
| Verwaltungszugang | Zugriff des Auftraggebers ausschließlich über einen SSH-Tunnel zum Server, nicht über einen offenen Datenbankport |
| Verschlüsselung der Verbindung | innerhalb des Containernetzes nicht erforderlich, da die Verbindung den Server nicht verlässt. Wird die Datenbank später für einen Zugriff von außerhalb des Servers geöffnet, ist die Verschlüsselung zwingend und verpflichtend zu erzwingen |
| Datenhaltung | Das Datenverzeichnis liegt in einem benannten Volume, nicht im Container. Ein Neuaufbau des Containers darf den Bestand nicht verändern |
| Auftragsverarbeitung | Ein gesonderter Vertrag für die Datenbank entfällt, da kein weiterer Dritter Daten verarbeitet. Der bestehende Vertrag zum Server ist in das Verzeichnis nach DS-08 aufzunehmen |

**E-29a (MUSS)** **Sicherung in eigener Verantwortung.** Da kein Anbieter die Sicherung übernimmt, ist sie selbst einzurichten: täglicher Auszug des vollständigen Datenbestands, Vorhaltung von mindestens 14 Tagen und Ablage auf einem **anderen** Speicherort als dem Server selbst. Eine Sicherung, die ausschließlich auf demselben Server liegt, gilt als nicht vorhanden. Der Sicherungslauf ist zu überwachen; bleibt er aus oder scheitert er, wird der Auftraggeber benachrichtigt.

**E-29b (MUSS)** **Wiederherstellung erproben.** Vor der Inbetriebnahme ist eine Sicherung einmal tatsächlich in eine getrennte Instanz zurückzuspielen und die Kennzahlensicht dort gegen die Ausgangsinstanz zu vergleichen (siehe AK-37).

**E-29c (SOLL)** **Aktualisierungen.** Der Wechsel auf eine neue Hauptversion von PostgreSQL liegt beim Auftraggeber. Die verwendete Hauptversion ist zu dokumentieren; ein Wechsel erfolgt nur mit vorheriger Sicherung und in der Testumgebung nach NF-08 erprobt.

**E-29d (SOLL)** Die späteren Tabellen der Planungsanwendung können in derselben Instanz liegen, jedoch in einem eigenen Schema mit eigenem Benutzer. Eine gemeinsame Nutzung derselben Tabellen ist ausgeschlossen. Läuft die Anwendung auf demselben Server, bleibt es bei null veröffentlichten Ports; läuft sie auf einem anderen Server, ist der Zugang gezielt und verschlüsselt zu öffnen und auf dessen Adresse zu beschränken.

#### 13.5.4 Abläufe in n8n

**E-31 (MUSS)** **Fünf ausführbare Abläufe und ein gemeinsamer Unterworkflow.** Die Datenbeschaffung wird in fachlich getrennten und einzeln abschaltbaren Abläufen umgesetzt. Gemeinsame technische Logik wird nicht kopiert, sondern in einem Unterworkflow gekapselt.

| Kennung | Ablauf | Auslöser | Aufgabe |
| --- | --- | --- | --- |
| P01 | Operative Ressourcen | alle 15 Minuten, werktags 08:00 bis 23:45 Uhr | Angebote, Datumszeilen, Buchungen, Preiskategorien, Anwesenheiten, Rechnungen und Transaktionen vollständig abgleichen |
| P02 | Stamm- und Referenzdaten | täglich nachts | Admins, Umsatzsteuer, Länder, Kategorien und Benutzer vollständig abgleichen |
| P03 | Gesamt- und Löschabgleich | wöchentlich nachts | alle zwölf Ressourcen prüfen und nicht mehr gelieferte Datensätze als gelöscht kennzeichnen |
| P04 | Qualitätskontrolle | nach P01 bis P03 sowie täglich | Beziehungen, Vollständigkeit, Laufalter und DB-I-Berechenbarkeit prüfen; Abweichungen melden |
| P05 | Manueller Wiederanlauf | manuell | einzelne Ressourcen oder den vollständigen Abgleich kontrolliert wiederholen |
| P90 | Ressourcen-Unterworkflow | durch P01 bis P05 sowie manuell per Webhook (Sync-Button) | Authentifizierung, Seitenabruf, Normalisierung, Hashvergleich, UPSERT und Laufprotokoll vereinheitlichen |

**E-31a (MUSS)** **Operativer 15-Minuten-Abgleich.** P01 läuft in der Zeitzone `Europe/Berlin` mit dem Zeitplan `*/15 8-23 * * 1-5`. Zwischen 00:00 und 08:00 Uhr sowie am Wochenende findet kein regulärer P01-Lauf statt. Änderungen aus der Pause werden mit dem ersten vollständigen Lauf um 08:00 Uhr nachgezogen. Buchungen und Transaktionen gehören ausdrücklich zum selben 15-Minuten-Intervall wie Angebote und Datumszeilen.

**E-31b (MUSS)** **Täglicher Stammabgleich.** P02 liest einmal täglich die fünf Stamm- und Referenzressourcen. Er läuft nicht gleichzeitig mit P03. Bei Benutzer- und Adminressourcen werden nur die für Beziehungen und Auswertungen erforderlichen Felder normalisiert gespeichert.

**E-31c (MUSS)** **Idempotenter Ressourcen-Unterworkflow.** P90 verarbeitet ausschließlich Ressourcen aus einer fest hinterlegten Konfiguration. Er liest seitenweise bis zur gemeldeten Gesamtzahl, normalisiert die Nutzdaten und schreibt per UPSERT. Ein Hashvergleich sorgt dafür, dass unveränderte Datensätze nicht als inhaltlich geändert gelten. Eine Wiederholung desselben Laufs darf keine Dubletten erzeugen.

**E-31d (MUSS)** **Fehler- und Parallelitätsschutz.** Gleichzeitig laufende Abgleiche derselben Ressource sind ausgeschlossen. Schlägt eine Ressource fehl oder weicht die gespeicherte Zahl von der gemeldeten Gesamtzahl ab, darf der übergeordnete Lauf nicht als erfolgreich gelten. Der Fehler wird protokolliert und gemeldet; erfolgreich verarbeitete andere Ressourcen bleiben nachvollziehbar.

**E-31e (MUSS)** **Wöchentlicher Voll- und Löschabgleich.** P03 liest alle zwölf Ressourcen vollständig. Datensätze, die während dieses vollständigen Laufs nicht mehr geliefert werden, werden mit `is_deleted = true` gekennzeichnet und nicht physisch gelöscht. Die Trainerzuordnungen aus `dates.leader[]` werden vollständig neu aufgebaut. Mehrfachzuweisungen bleiben zulässig und werden nicht als Fehler behandelt.

**E-31f (MUSS)** **Seitenweiser Abruf mit Vollständigkeitsnachweis.** Jeder Listenabruf läuft seitenweise bis zur von edoobox gemeldeten Gesamtzahl. Für den geprüften Bestand von 37.459 Datensätzen über zwölf Ressourcen sind derzeit 27 Seiten erforderlich. Abweichungen zwischen gemeldeter und eingesammelter Anzahl führen zum Fehlerstatus.

**E-31g (MUSS)** **Protokoll der Abrufe.** Jeder Lauf wird mit Art, Beginn, Ende, Ergebnis, Ressource, gemeldeter und gelesener Anzahl, Anzahl neuer, geänderter und als gelöscht markierter Datensätze sowie Anzahl der API-Aufrufe protokolliert. Bleibt ein geplanter Lauf aus oder scheitert er, wird der Organisator benachrichtigt.

**E-31h (MUSS)** **Einhaltung des Abruflimits.** P01 benötigt beim geprüften Bestand 21 Listenaufrufe je Lauf. Bei 64 Läufen an einem Werktag sind dies rund 1.344 Listenaufrufe. Zusammen mit P02, P03 und der Authentifizierung bleibt der Regelbetrieb deutlich unter dem Limit von 100.000 Leseanfragen je 24 Stunden. P04 überwacht die tatsächliche tägliche Anzahl, da sie mit dem Bestand wachsen kann.

**E-31i (MUSS)** **Qualitätskontrolle.** P04 prüft insbesondere veraltete oder fehlgeschlagene Läufe, nicht auflösbare Beziehungen, Angebote ohne Trainer, offene Trainerkostenkonfigurationen, ausgeschlossene Nicht-Kurstermine sowie die rechnerische Übereinstimmung von Nettoerlös, direkten Kosten und DB I. Während des Betriebszeitfensters darf der letzte erfolgreiche P01-Lauf höchstens 30 Minuten zurückliegen.

**E-31j (MUSS)** **Manueller Wiederanlauf.** P05 darf nur eine Ressource aus einer festen Auswahlliste oder den vollständigen Abgleich starten. Freie Tabellen- oder SQL-Eingaben sind ausgeschlossen. Jeder manuelle Lauf wird wie ein geplanter Lauf protokolliert.

**E-31k (KANN)** **Spätere Webhook-Erweiterung.** Wenn eine Aktualisierung nahezu in Echtzeit benötigt wird, kann ein abgesicherter Webhook ergänzt werden. Empfang und Verarbeitung sind dann zu trennen. P01 und P03 bleiben unabhängig davon aktiv, damit ausgefallene oder unvollständige Webhook-Zustellungen den Bestand nicht verfälschen.

**E-31l (MUSS)** **Auslöse- und Taktungsregeln für P90.** Der Ressourcen-Unterworkflow wird über zwei Auslösepfade gestartet:

- **Automatischer Sync:** Alle 15 Minuten, strikt begrenzt auf Montag bis Freitag im Zeitfenster von 08:00 bis 22:00 Uhr (Cron: `*/15 8-22 * * 1-5`, Zeitzone: `Europe/Berlin`). Außerhalb dieses Fensters und am Wochenende ruht der automatische Sync.
- **Manueller Sync:** Jederzeit per Webhook-Aufruf durch den Sync-Button im Header der Weboberfläche (`POST /api/sync/p90` → n8n-Webhook, Quelle `manual_ui`).

**E-31m (MUSS)** **Status-Logik des Syncs.** Der Sync überführt Termine automatisch von `ausgeschrieben` auf `unter Vorbehalt`, sobald die Teilnehmerzahl >= 1 beträgt. Feste Status (`bestätigt`, `abgesagt`) sind manuell geschützt und werden durch den Sync nicht überschrieben. Bei einem Teilnehmerrückgang von > 0 auf 0 bei disponierten Kursen erfolgt eine sofortige E-Mail-Benachrichtigung.

#### 13.5.5 Zugangsdaten

**E-32 (MUSS)** **Kurzlebige Zugriffstoken.** Jeder API-Lauf bezieht zu Beginn einen frischen Zugriffstoken mit kurzer, zum Lauf passender Gültigkeit. Schlüssel und Geheimnis verbleiben in der n8n-Anmeldedatenverwaltung. Ein eigener dauerhaft laufender Erneuerungsworkflow ist nicht erforderlich. Dauerhaft gültige Token sind unzulässig.

**E-32a (MUSS)** Schlüssel und Geheimnis liegen ausschließlich in der Anmeldedatenverwaltung von n8n. Ein Export eines Ablaufs darf keine verwertbaren Zugangsdaten enthalten (Einschränkung 8 aus E-24a, siehe auch DS-12).

**E-32b (SOLL)** Der für die Spiegelung genutzte Zugang wird auf Leserechte beschränkt. Der schreibende Zugriff nach Abschnitt 13.3 erhält einen getrennten Zugang. Ob edoobox Rechte je Zugang steuern kann, ist beim Anbieter zu erfragen.

**E-32c (MUSS)** Der bisher verwendete Token ist zu widerrufen. Er war bis 2030 gültig, im Ablauf im Klartext hinterlegt und trug Schreibrechte auf nahezu alle Ressourcen.

#### 13.5.6 Reihenfolge der Inbetriebnahme

**E-33 (MUSS)** Die Inbetriebnahme erfolgt in dieser Reihenfolge, weil jeder Schritt die Voraussetzung des folgenden prüft:

1. Containernetz anlegen, Datenbankcontainer mit benanntem Volume und ohne veröffentlichten Port starten, n8n in dasselbe Netz aufnehmen und die Erreichbarkeit über den Containernamen prüfen
2. Schema einspielen, beide Rollen mit eigenen Kennwörtern einrichten, Verwaltungszugang über SSH-Tunnel prüfen
3. Tägliche Sicherung mit Ablage außerhalb des Servers einrichten und einmal zurückspielen (E-29a, E-29b)
4. Neuen edoobox-Zugang einrichten, kurzlebigen Tokenabruf prüfen und alten Token widerrufen
5. P90 und danach P03 umsetzen; vollständigen Abgleich aller zwölf Ressourcen einmalig ausführen
6. **Prüfpunkt:** Die Kennzahlensicht wird für mindestens drei Termine geprüft, deren Teilnehmerzahl und Erlös dem Organisator bekannt sind. Erst wenn diese übereinstimmen, gilt das Datenmodell als tragfähig
7. P01 werktags im 15-Minuten-Takt aktivieren
8. P02, P04 und P05 einrichten und die Fehlerbenachrichtigung testen
9. P03 auf den wöchentlichen Takt stellen

**E-34 (SOLL)** Die Anwendung wird erst an die Datenbank angebunden, wenn der Prüfpunkt nach E-33 Nummer 6 bestanden ist.

> **Umsetzungsstand:** Die zwölf edoobox-Ressourcen, ihre Felder und Beziehungen wurden vollständig geprüft und in PostgreSQL gespiegelt. Das Regelwerk für Preiskategorien, produktive Ausschlüsse, Trainerkosten und DB I ist eingerichtet. Die Abschlusskontrolle weist bei 430.049,62 € produktivem Nettoerlös ab 2023 einen DB I von 190.882,62 € und keine offene Kostenkonfiguration aus. Die produktiven n8n-Abläufe P01 bis P05 und P90 sind als Nächstes umzusetzen.

---

## 14 Benachrichtigungen

**N-01 (MUSS)** E-Mail-Benachrichtigung an Trainer bei: Reservierung, Bestätigung, Absage, Verschiebung, Trainerwechsel, Antwort auf einen Vorgang.

**N-02 (MUSS)** Benachrichtigung an den Organisator bei: neuer Rücknahme-Anfrage, Ausfallmeldung, neuer Bewerbung, fehlgeschlagener Datenübernahme.

**N-03 (MUSS)** Tägliche Zusammenfassung an den Organisator mit fälligen Entscheidungen und offenen Vorgängen.

**N-04 (SOLL)** Wöchentliche Zusammenfassung an jeden Trainer mit den Terminen der kommenden vier Wochen und dem Hinweis auf fehlende Freigaben.

**N-05 (SOLL)** Jeder Trainer erhält einen persönlichen Kalender-Abonnementlink (iCal), über den bestätigte Termine automatisch in Outlook oder Google Kalender erscheinen.

**N-06 (SOLL)** Benachrichtigungsarten sind je Nutzer einzeln abschaltbar; Benachrichtigungen zu verbindlichen Terminänderungen bleiben davon ausgenommen.

---

## 15 Auswertung, Export und Website

> Hinweis: Die Kennungen dieses Kapitels wurden gegenüber Version 1.0 von `R-` auf `AU-` geändert, um eine Verwechslung mit den Rollen in Kapitel 4 auszuschließen.

**AU-01 (MUSS)** Export von Terminen, Status, Zuordnungen und Kennzahlen als XLSX und CSV, mit Filtermöglichkeiten.

**AU-02 (SOLL)** Speicherbare Berichtsvorlagen für wiederkehrende Auswertungen.

**AU-03 (MUSS)** Kennzahlen im System: Termine je Kurs und Jahr, Durchführungsquote (bestätigt zu geplant), Absagequote je Kurs, Auslastung je Trainer, Einhaltung des Prio-Rhythmus.

**AU-04 (SOLL)** Auswertung Anmeldungen, Erlös, Trainerkosten und Deckungsbeitrag je Kurs, Kategorie und Zeitraum, sofern die edoobox-Anbindung aktiv ist.

**AU-05 (SOLL)** Auswertung der Trainerkosten je Zeitraum und Trainer als Grundlage für die externe Abrechnung — ohne eigene Abrechnungsfunktion.

**AU-06** *(entfällt)* Ein Terminabruf durch die WordPress-Website ist nicht erforderlich; die öffentliche Terminanzeige bleibt unverändert direkt an edoobox angebunden.

**AU-07 (SOLL)** **Automatisierter Excel-Export für Trainer & Termine (OneDrive).** Täglicher, zeitgesteuerter Export aller Verfügbarkeiten und Kursdaten nach Microsoft OneDrive inklusive fester Dateinamenskonvention. Umsetzung in einer nachgelagerten Phase nach Abschluss der Kernfunktionen (siehe Ausbaustufe 6).

### 15.1 Automatisierter Excel-Export für Trainer & Termine (OneDrive)

- **Turnus & Trigger**: Täglich morgens um 03:00 Uhr automatisiert (z. B. via n8n Scheduled Trigger oder Backend-Cronjob).
- **Zeitraum**: Rollierender Betrachtungszeitraum ab Tagesdatum (`heute`) bis exakt 6 Monate in die Zukunft (`heute + 6 Monate`).
- **Inhalt & Datenumfang**:
  - Alle aktiven Trainer.
  - Erfasste Trainer-Verfügbarkeiten je Tag/Slot.
  - Zugeordnete Kurse/Termine inklusive Kursname, Uhrzeit und aktuellem Status (`ausgeschrieben`, `unter Vorbehalt`, `bestätigt`, `abgesagt`).
- **Format**: Formatierte Microsoft Excel-Arbeitsmappe (`.xlsx`) mit lesbarer Tabellenstruktur.
- **Dateiname**: `[yyyy-mm-dd] Backup Trainerzeitpläne.xlsx`
  - Präfix: Dynamisches Tagesdatum im ISO-Format `YYYY-MM-DD`
  - Beispiel: `2026-10-03 Backup Trainerzeitpläne.xlsx`
- **Ablageort**: Automatische Speicherung in einem definierten Zielverzeichnis auf Microsoft OneDrive (z. B. via Microsoft Graph API / n8n OneDrive-Knoten).
- **Priorität / Umsetzungszeitpunkt**: Nachgelagerte Phase (Abschluss der Kernfunktionen).

> Hinweis: Die im Export genannten Statuswerte entsprechen den systeminternen Statuswerten nach T-02; die Bezeichnungen im Export sind an die dortige Terminologie anzugleichen.

---

## 16 Nicht-funktionale Anforderungen

**NF-01 (MUSS)** Nutzung über den Browser ohne lokale Installation; unterstützte Browser in aktueller Version.

**NF-02 (MUSS)** Verfügbarkeitsraster und Terminübersicht müssen auf Smartphone und Tablet bedienbar sein.

**NF-03 (MUSS)** Ladezeit einer Monatsansicht mit rund 150 Terminen unter 2 Sekunden; Jahresansicht unter 5 Sekunden.

**NF-04 (MUSS)** Das System muss mindestens 5 Planungsjahre mit je über 1.500 Terminen ohne Leistungseinbußen verwalten.

**NF-05 (MUSS)** Vollständig deutschsprachige Oberfläche einschließlich aller Benachrichtigungen.

**NF-06 (MUSS)** Übertragung ausschließlich verschlüsselt (HTTPS).

**NF-07 (MUSS)** Täglich automatisierte Sicherung der Datenbank mit einer Aufbewahrung von mindestens 30 Tagen; die Wiederherstellung ist mindestens einmal zu erproben.

**NF-08 (MUSS)** Getrennte Testumgebung, in der Änderungen vor der Übernahme in den Betrieb geprüft werden können — insbesondere für die edoobox-Schnittstelle.

**NF-09 (SOLL)** Bedienbarkeit ohne Schulung: Ein Trainer muss seine Verfügbarkeit ohne Anleitung eintragen können. Kurze Bedienhinweise sind vorzusehen.

**NF-10 (MUSS)** Der Quellcode und alle Daten müssen jederzeit vollständig exportierbar sein. Eine Abhängigkeit, die einen Wechsel des Dienstleisters verhindert, ist unzulässig.

---

## 17 Datenschutz und Sicherheit

**DS-01 (MUSS)** Verarbeitet werden ausschließlich Beschäftigtendaten in geringem Umfang: Name, Initialen, E-Mail-Adresse, Verfügbarkeiten, Zuordnungen, Kommunikation.

**DS-02 (MUSS)** Betrieb und Datenspeicherung innerhalb der EU. Für den Betreiber der Infrastruktur ist ein Vertrag zur Auftragsverarbeitung zu schließen.

**DS-03 (MUSS)** Keine Speicherung personenbezogener Teilnehmerdaten (siehe E-11).

**DS-04 (MUSS)** Trennung der Trainerdaten auf Datenzugriffsebene.

**DS-05 (MUSS)** Aufbewahrung: Termindaten 5 Jahre für Auswertung und Nachweis; Verfügbarkeits-Rohdaten nach 24 Monaten anonymisieren; Kommunikationsverläufe 3 Jahre. Die Fristen müssen konfigurierbar sein.

**DS-06 (MUSS)** Auskunft und Datenexport zu einer einzelnen Person müssen ohne Datenbankzugriff möglich sein.

**DS-07 (MUSS)** Passwörter werden ausschließlich als Hashwert gespeichert; Zugangsdaten Dritter verschlüsselt.

**DS-08 (MUSS)** Verzeichnis der Verarbeitungstätigkeiten und ein kurzes Informationsblatt für die Trainer sind Bestandteil der Lieferung.

**DS-09 (SOLL)** Protokollierung fehlgeschlagener Anmeldeversuche mit Sperre nach mehrfachem Fehlversuch.

**DS-10 (MUSS)** **Datenvermeidung in der neuen Buchungsdatenbank.** Der Altbestand `edo_booking_data` enthält personenbezogene Daten, unter anderem Rechnungsanschriften, Teilnehmerkennungen und IP-Adressen. Im Neubau nach Abschnitt 13.5 werden diese Felder **nicht übernommen** (E-27a). Der Zugriff der Anwendung erfolgt ausschließlich über die Sichten nach E-28. Damit bleibt die Zusage aus E-11 gewahrt, dass im Planungssystem keine personenbezogenen Teilnehmerdaten verarbeitet werden.

**DS-11 (SOLL)** Der Altbestand `edo_booking_data` ist nach erfolgreicher Abnahme des Neubaus zu löschen. Solange er bestehen bleibt, ist er in das Verzeichnis der Verarbeitungstätigkeiten aufzunehmen und eine Löschfrist für die dort gespeicherten Rechnungsanschriften und IP-Adressen festzulegen. Eine Übernahme dieser Felder in den Neubau ist ausgeschlossen.

**DS-12 (MUSS)** Zugangsdaten zu Drittsystemen sind ausschließlich in der Anmeldedatenverwaltung des jeweiligen Werkzeugs zu hinterlegen, nicht in Ablaufdefinitionen, Quelltexten oder Konfigurationsdateien. Ein Export eines Ablaufs darf keine verwertbaren Zugangsdaten enthalten. Zugriffstoken sind mit der kleinstmöglichen Rechtestufe und einer begrenzten Laufzeit auszustellen und regelmäßig zu erneuern.

---

## 18 Abnahmekriterien

Das System gilt als abnahmefähig, wenn folgende Abläufe fehlerfrei und ohne Umwege durchlaufen werden können:

| Nr. | Abnahmefall |
| --- | --- |
| AK-01 | Ein Trainer trägt einen ganzen Tag als frei ein; der Organisator sieht diese Freigabe unmittelbar. |
| AK-02 | Der Organisator ordnet dem Vormittag einen Halbtagskurs zu; der Trainer sieht den Status „reserviert" mit Entscheidungsfrist. |
| AK-03 | Der Versuch, demselben Trainer am selben Tag zusätzlich einen 90-Minuten-Kurs um 9:00 zuzuordnen, wird als Konflikt erkannt. |
| AK-04 | Zwei Kurse werden auf demselben Datum und Slot geplant; das System weist die Doppelbelegung aus, ohne die Eingabe zu blockieren. |
| AK-05 | Der Serienplaner erzeugt für einen Prio-1-Kurs über 12 Monate Termine im 4-Wochen-Takt, ohne Feiertage zu belegen; der Vorschlag ist vor der Übernahme änderbar. |
| AK-06 | 21 Tage vor einem Termin erscheint dieser in der Entscheidungsliste, mit Anmeldezahl aus edoobox und Ampeldarstellung. |
| AK-07 | Der Organisator bestätigt beide Kurse einer Doppelbelegung; das System erkennt die Trainerkollision und schlägt einen zweiten qualifizierten, verfügbaren Trainer vor. |
| AK-08 | Ein Termin wird abgesagt; der Trainer wird benachrichtigt und die Verfügbarkeit ist wieder frei. |
| AK-09 | Ein Trainer meldet Ausfall bei einem bestätigten Termin; der Organisator ersetzt ihn in einem Arbeitsschritt. |
| AK-10 | Eine Absprache zu einer Terminverschiebung ist drei Monate später über die Historie des Trainers und über die Terminhistorie vollständig nachvollziehbar. |
| AK-11 | Alle Termine eines Quartals werden als XLSX exportiert. |
| AK-12 | Eine Mehrfachauswahl von 50 Terminen wird in einem Arbeitsschritt bestätigt. |
| AK-13 | Bei ausgefallener edoobox-Schnittstelle bleibt das System vollständig nutzbar; Anmeldezahlen sind manuell erfassbar. |
| AK-14 | Einem Trainer werden an einem Tag ein Halbtagskurs (HT) sowie die Kurzschulungen K3 und K4 zugeordnet — zulässig ohne Warnung. Der zusätzliche Versuch, K1 zuzuordnen, wird als Kollision erkannt. |
| AK-15 | Ein deutscher Feiertag, der mindestens drei Bundesländer betrifft, wird vom Serienplaner übersprungen. Ein dänischer Feiertag hat keine Wirkung. In einem als Betriebsruhe definierten Zeitraum lässt sich dennoch ein Termin manuell anlegen; er wird als Ausnahme gekennzeichnet. |
| AK-16 | Ein Termin erreicht die Mindestteilnehmerzahl, jedoch sind zwei der Anmeldungen Nachholer. Die Ampel bleibt wegen fehlender Kostendeckung auf Rot; Teilnehmer- und Kostenkriterium sind getrennt erkennbar. |
| AK-17 | Bei einem Trainer sind drei Kostenkategorien hinterlegt, eine davon als Standard. Bei der Zuordnung ist diese vorbelegt; der Organisator wählt eine andere Kategorie und überschreibt den Betrag zusätzlich manuell mit Begründung. Die Abweichung wird gekennzeichnet, der Deckungsbeitrag neu berechnet und die Änderung ist in der Terminhistorie sichtbar. |
| AK-18 | Die Schulungsunterlage eines Kurses wird in neuer Fassung hinterlegt und als aktualisiert gekennzeichnet. Die zugeordneten Trainer werden benachrichtigt, bestätigen die Kenntnisnahme, und der Organisator sieht, wer noch nicht bestätigt hat. |
| AK-19 | Ein dreiteiliger Kurs (je Modul ein halber Tag) wird geplant. Ein Trainer, der nur für Teil 1 verfügbar ist, löst bei der Zuordnung eine Warnung aus. |
| AK-20 | Ein Kurs wird ohne Trainerzuweisung geplant und erscheint in der Liste der ungedeckten Termine. Einem Trainer werden im selben Slot zwei Alternativkurse zugeordnet; das System stellt dies als beabsichtigte Alternative dar, nicht als Fehler. |
| AK-21 | Ein Abendkurs von 18:00 bis 20:00 wird geplant. Ein Trainer, der den ganzen Tag freigegeben hat, ohne den Abend einzuschließen, wird nicht als verfügbar vorgeschlagen. |
| AK-22 | Die Anwendung liest Nettopreise und Anmeldungen je Preiskategorie aus der PostgreSQL-Sicht nach E-28 und ordnet sie je Termin korrekt zu. Ist die Datenbank nicht erreichbar oder der Zeitstempel veraltet, werden die Werte als veraltet beziehungsweise fehlend gekennzeichnet und sind manuell erfassbar. |
| AK-23 | Der Datenbankbenutzer der Anwendung kann ausschließlich die vorgesehenen Sichten lesen. Ein Zugriff auf die Rohdatentabellen schlägt fehl. Ein Feld mit Name, Anschrift, E-Mail-Adresse oder IP-Adresse ist im gesamten Datenbestand nicht vorhanden. |
| AK-24 | Ein Firmenkurs mit einer Anmeldung „Preis für bis max. 4 Personen", zwei Anmeldungen „Inklusive" und einer Anmeldung „Preis für jede weitere Person" wird richtig ausgewertet: vier Teilnehmer, Erlös aus zwei Kategorien, keine Mindestteilnehmerprüfung. |
| AK-25 | Eine in edoobox neu angelegte Preiskategorie mit unbekannter Bezeichnung und einem Betrag größer null wird als „ungeklärt" ausgewiesen und nicht als Erlös gezählt, bis der Organisator sie einstuft. |
| AK-26 | Die Bezeichnungen „Kombibuchung (-5%)", „Kombibuchung(-5%)" und „Kombirabatt (-5%)" werden durch dieselbe Regel als erlöswirksam eingestuft. Die Tippfehlervarianten „Last Miunte", „Last MInute" und „Last--Minute-Preis (-10%)" werden ebenfalls richtig zugeordnet. |
| AK-27 | „Diff. nach Verrechnung der Stornogebühr" wird als erlöswirksam und nicht teilnehmerwirksam eingestuft, obwohl die Bezeichnung „Storno" enthält. „Nachholtermin nach Storno" wird als nicht erlöswirksam und teilnehmerwirksam eingestuft. |
| AK-28 | Die Bezeichnungen „---", „-" und „xxx" führen zum Zustand „ungeklärt" und erscheinen in der Vorlageliste des Organisators, ohne den Deckungsbeitrag zu verändern. |
| AK-29 | Eine Buchung mit **zwei** Preiskategorien und **ohne** Zahlungseingang wird vollständig gespiegelt: beide Positionen mit Betrag und Anzahl sind vorhanden, die Buchung erscheint in der Teilnehmerzahl, der Zahlungsabgleich weist sie als offen aus. |
| AK-30 | Eine Buchung mit drei Teilzahlungen erscheint in der Kennzahlensicht mit dem **einfachen** Nettoerlös. Die Summe der Zahlungen ist im Zahlungsabgleich getrennt erkennbar. |
| AK-31 | Derselbe vollständige Ressourcenabruf wird zweimal verarbeitet. Es entstehen keine Dubletten; beim zweiten Lauf werden unveränderte Datensätze nicht als inhaltlich geändert protokolliert. |
| AK-32 | Werktags wird in edoobox während des Betriebszeitfensters ein Angebot angelegt, geändert oder geschlossen und eine Buchung mit Transaktion ergänzt. Sämtliche Änderungen sind spätestens nach 30 Minuten im Spiegelbestand sichtbar. Eine Änderung aus der Nacht- oder Wochenendpause wird mit dem ersten Lauf um 08:00 Uhr nachgezogen. |
| AK-33 | Eine Buchung wird in edoobox entfernt. Der Vollabgleich kennzeichnet sie als entfallen; die Teilnehmerzahl des Termins verringert sich, der Datensatz bleibt mit Zeitpunkt der Feststellung erhalten. |
| AK-34 | Eine Preiskategorie mit einem Apostroph in der Bezeichnung wird ohne Fehler und ohne Veränderung des Zeichens gespeichert. |
| AK-35 | Ein API-Lauf beschafft zu Beginn einen kurzlebigen Zugriffstoken und beendet den Abgleich innerhalb seiner Gültigkeit. Der folgende Lauf verwendet einen neuen Token. Ein Export eines Ablaufs enthält weder Schlüssel noch Geheimnis noch Token. |
| AK-36 | P03 liest alle zwölf Ressourcen vollständig und protokolliert Beginn, Ende, gemeldete und gelesene Anzahl, neue, geänderte und als gelöscht markierte Datensätze sowie die API-Aufrufe je Ressource. Bleibt ein geplanter Lauf aus, wird der Organisator benachrichtigt. |
| AK-37 | Eine Sicherung der Datenbank wird in eine getrennte Instanz zurückgespielt; die Kennzahlensicht liefert dort dieselben Werte. Die Sicherung liegt nachweislich auf einem anderen Speicherort als dem Server selbst. |
| AK-38 | Ein Verbindungsversuch zur Datenbank von außerhalb des Servers schlägt fehl, weil kein Port veröffentlicht ist. Der Zugriff über den SSH-Tunnel gelingt. |
| AK-39 | Der Datenbankcontainer wird gelöscht und aus demselben Volume neu erstellt; der Datenbestand ist unverändert vorhanden. |
| AK-40 | P01 läuft an einem Werktag 64-mal im 15-Minuten-Takt und bleibt einschließlich Authentifizierung und ergänzender Abläufe deutlich unter 100.000 Leseanfragen je 24 Stunden. P04 weist die tatsächliche Anzahl aus. |

---

## 19 Lieferumfang und Phasenplan

### Ausbaustufe 0 — Datenbeschaffung und Datenhaltung (vorgezogen)

Neuer PostgreSQL-Container auf dem eigenen Hetzner-Server ohne veröffentlichten Port, eigene Sicherung mit Ablage außerhalb des Servers, Datenmodell mit getrennter Führung von Buchung, Position und Zahlung, Regelwerk zur Einstufung der Preiskategorien, Auswertungssichten, getrennte Datenbankrollen, fünf produktive n8n-Abläufe plus gemeinsamer Ressourcen-Unterworkflow, kurzlebige Zugriffstoken.
Umfasst: E-27 bis E-34, DS-10 bis DS-12, K-10 bis K-10d
Abnahme: AK-29 bis AK-40

> Diese Stufe ist unabhängig von den übrigen Stufen und **vor** Ausbaustufe 4 fertigzustellen. Sie ist auch dann von Wert, wenn die Planungsanwendung später beginnt, weil sie die Zahlen für die Durchführungsentscheidung bereits als abfragbare Sicht bereitstellt.

### Ausbaustufe 1 — Ablösung der Excel-Tabellen

Rollen und Anmeldung, Stammdaten, Slot-System mit allen sechs Slots, Kollisionsprüfung, Verfügbarkeitsverwaltung mit Zeitfenstern, manuelle Zuordnung auch ohne Trainer, Statusmodell mit Protokollierung, Feiertage, Urlaub und Betriebsruhe, Trainersicht auf eigene Termine, Export.
Umfasst: R-01 bis R-02, R-04 bis R-08, S-01 bis S-09 einschließlich S-04a, S-04b und S-07a, S-10 bis S-15, V-01 bis V-07, V-09 bis V-10, L-01 bis L-04, L-05b, L-09, T-01 bis T-05, T-07, AU-01, NF-01 bis NF-08, DS-01 bis DS-08, DS-12

### Ausbaustufe 2 — Kommunikation, Dokumente und Kosten

Kommunikationsmodul, Vorgänge, Trainerakte und Terminhistorie, Benachrichtigungen, Entscheidungsliste mit Frist, Ausfall- und Rücknahmeverfahren, Auflösung von Mehrfachbelegungen, Bereich notwendige Dokumente, Kostenerfassung je Trainerzuordnung, Kalenderabonnement.
Umfasst: C-01 bis C-10, H-01 bis H-08, N-01 bis N-05, D-01 bis D-08, T-06, T-08 bis T-11a, K-01, K-04, K-05, K-07, V-08

### Ausbaustufe 3 — Automatisierung der Langfristplanung

Serienplaner mit Prio-Rhythmus einschließlich Feiertags-, Urlaubs- und Betriebsruhelogik, Mehrfachbelegung auf Kurs- und Trainerebene, mehrteilige Kurse und Terminverbund, Mehrfachbearbeitung, Rhythmusüberwachung, Kapazitätsübersicht, Auswertungen.
Umfasst: L-05, L-05a, L-06 bis L-08, L-10 bis L-13, S-02a, T-12, AU-02, AU-03

### Ausbaustufe 4 — edoobox lesend, Preiskategorien und Deckungsbeitrag

Zuordnung Termin zu Angebot, Übernahme von Anmeldezahlen und Teilnehmergrenzen, Preiskategorien und Nachholererkennung, Nettopreise, Deckungsbeitrag, zweistufige Entscheidungsampel, Anbindung an die Sichten aus Ausbaustufe 0.
Umfasst: E-01 bis E-14, E-21 bis E-26, K-02, K-03, K-06, K-08 bis K-13, AU-04, AU-05

> Voraussetzung für diese Stufe: Ausbaustufe 0 ist abgenommen und der Prüfpunkt nach E-33 Nummer 6 ist bestanden. Ohne belastbare Datengrundlage ist ein Deckungsbeitrag nicht darstellbar.

### Ausbaustufe 5 — edoobox schreibend und weitere Automatisierung

Veröffentlichung geplanter Termine nach edoobox, Statusrücknahme bei Absage, ausgehende Schnittstelle für n8n, Terminbewerbung durch Trainer.
Umfasst: E-15 bis E-20, B-01 bis B-07, K-14

### Ausbaustufe 6 — Automatisierter Excel-Export (nachgelagerte Phase)

Täglicher, zeitgesteuerter Export aller aktiven Trainer, ihrer Verfügbarkeiten je Tag/Slot sowie der zugeordneten Kurse/Termine mit Kursname, Uhrzeit und Status als formatierte Excel-Arbeitsmappe nach Microsoft OneDrive. Rollierender Zeitraum von heute bis heute + 6 Monate, fester Dateiname `[yyyy-mm-dd] Backup Trainerzeitpläne.xlsx`, Ablage in einem definierten OneDrive-Zielverzeichnis.
Umfasst: AU-07, Abschnitt 15.1

> Diese Stufe wird erst nach Abschluss der Kernfunktionen (Ausbaustufen 1 bis 5) umgesetzt.

**Empfehlung zur Einführung:** Ausbaustufe 0 kann parallel zu Ausbaustufe 1 laufen, da sie keine Berührungspunkte mit der Oberfläche hat. Ausbaustufe 1 zunächst für ein Quartal parallel zu Excel betreiben, danach die Excel-Tabellen abschalten. Die schreibende edoobox-Anbindung erst umsetzen, wenn die lesende Zuordnung über mindestens ein halbes Jahr fehlerfrei gelaufen ist.

> Hinweis zur Verschiebung gegenüber Version 1.0: Feiertage, Urlaub und Betriebsruhe sind von Stufe 3 nach Stufe 1 vorgezogen, weil sie als MUSS eingestuft und für jede Planung Voraussetzung sind. Der Terminabruf durch die Website und die Rolle Co-Organisator sind entfallen.

---

## 20 Annahmen und offene Punkte

Die Annahmen A-1 bis A-7 wurden vom Auftraggeber **bestätigt**. A-2, A-3 und A-5 sind aufgrund der Ergänzungen in Version 1.1 präzisiert worden.

| Nr. | Annahme | Betrifft | Stand |
| --- | --- | --- | --- |
| **A-1** | Entscheidungsfrist einheitlich 21 Tage vor Kursbeginn, systemweit konfigurierbar und je Kurs überschreibbar | T-06, K-01 | bestätigt |
| **A-2** | Maßgeblich ist der Nettopreis je Anmeldung aus dem Kategoriebetrag der Buchungsposition. Buchungs-, Preiskategorie- und Transaktionslisten werden getrennt gespiegelt und verbunden. Rechnungssummen dienen der Kontrolle, ein Näherungswert nur als Ersatz | E-09, E-24, E-27 | bestätigt; Ermittlungsweg in Version 1.6 nach vollständiger Ressourcenprüfung aktualisiert |
| **A-3** | Berücksichtigt werden ausschließlich deutsche Feiertage, die mindestens drei Bundesländer betreffen. Dänische Feiertage sind ohne Bedeutung | S-10 | bestätigt, korrigiert |
| **A-4** | In edoobox kommen beide Strukturen vor: ein Angebot je Termin sowie ein Angebot mit mehreren Modulen (je Modul ein halber Tag) | E-05, E-05a | bestätigt, präzisiert |
| **A-5** | Honorarabrechnung und Buchhaltung bleiben außerhalb des Systems (e-conomic). Kostenwerte je Termin werden jedoch im System erfasst, weil sie für die Deckungsrechnung benötigt werden | Systemabgrenzung, T-11 | bestätigt, präzisiert |
| **A-6** | Anmeldezahlen, Erlöse und Kosten sind ausschließlich für den Organisator sichtbar, nicht für Trainer | E-10, T-11 | bestätigt |
| **A-7** | Das genutzte edoobox-Abonnement erlaubt API-Zugriff im erforderlichen Umfang; dies ist beim Anbieter zu bestätigen | Kapitel 13 | bestätigt |

### Geklärte Punkte aus Version 1.0

| Frage | Antwort |
| --- | --- |
| Serienmodellierung von Terminen | Nein. Jeder Termin ist eigenständig (T-01a). Mehrteilige Kurse werden lediglich über einen Terminverbund verknüpft (T-12). |
| Vertretungsregelung für den Organisator | Derzeit nicht erforderlich. Die Rolle Co-Organisator entfällt (R-03). |
| Sprache der Oberfläche | Ausschließlich Deutsch. Eine Mehrsprachigkeit ist nicht vorzusehen. |
| Terminanzeige auf der WordPress-Website | Bleibt unverändert bestehen und wird weiterhin direkt aus edoobox versorgt. Ein Terminabruf aus dem neuen System entfällt (AU-06). |
| Gemeinte Kennung bei „V-04 ist MUSS" | V-03, Freigabe einzelner Slots. Entsprechend umgesetzt. |
| Standard-Trainersätze | Mindestens fünf frei benannte Kostenkategorien je Trainer mit jeweiligem Nettobetrag, Anzahl nicht begrenzt (S-07a). Der Betrag bleibt je Kurs beziehungsweise Termin manuell festlegbar (T-11). |
| Ermittlung des Nettopreises | Über die verbundenen Listenressourcen Buchungen, Preiskategorien und Transaktionen. Maßgeblich ist der Kategoriebetrag je Buchungsposition, Zuordnungsschlüssel zum Termin ist die Angebotskennung (E-24, E-27). |
| Art des Datenbanksystems | PostgreSQL. |
| Zugriffsweg der Anwendung | Lesender Zugriff auf Sichten mit eigenem Datenbankbenutzer, kein Eingangsendpunkt, keine Schreibrechte auf die Rohdatentabellen (E-28, E-28b). |
| Betriebsort der Datenbank | Eigener Container auf dem vorhandenen Hetzner-Server des Auftraggebers, verwaltet über Portainer. Kein verwalteter Dienst eines Dritten. Sicherung, Wiederherstellung und Versionswechsel liegen damit beim Auftraggeber (E-29 bis E-29c). |
| Betrieb von n8n | Selbst gehostet auf demselben Server. Verbindung zur Datenbank ausschließlich über das interne Containernetz. |
| Zugriffsberechtigte | Der n8n-Container, später der Anwendungsserver, sowie der Auftraggeber über SSH-Tunnel. Keine Datenbankkonten für Trainer oder andere Anwendungsnutzer (E-28c). |
| Umfang der ersten Umsetzungsstufe | Spiegelung aller zwölf geprüften edoobox-Ressourcen und Bereitstellung der Kennzahlen- und DB-I-Sichten (Ausbaustufe 0). |
| Verfügbarkeit von Webhooks | Im Tarif vorhanden, für die erste produktive Fassung jedoch nicht erforderlich. Spätere Ergänzung möglich (E-13, E-31k). |
| Takt des Abrufs | Operative Ressourcen einschließlich Buchungen und Transaktionen werktags von 08:00 bis 23:45 Uhr alle 15 Minuten, Stamm- und Referenzdaten täglich, vollständiger Löschabgleich wöchentlich (E-31). |
| Herkunft von `edo_bookings` | Entfällt. Der Neubau führt seinen Buchungsbestand selbst über vollständige, hashbasierte Listenabgleiche (E-31). |
| Bestand der Preiskategorien | Aufgenommen in K-10a, einschließlich der Firmenkurskategorien. |
| Mindestteilnehmerzahl | Unterschiedlich je Kursart, daher als Vorgabewert je Kursart gepflegt und je Kurstitel überschreibbar (S-04a). |
| Variabilität der Rabattbezeichnungen | Bestätigt: Preiskategorien werden je Kurstermin neu erstellt und frei benannt. Der Ist-Bestand mit 75 Schreibweisen für etwa zwölf Sachverhalte belegt dies. Das musterbasierte Verfahren nach K-10 ist damit nicht nur zweckmäßig, sondern notwendig. |
| Weiterverwendung der n8n-Abläufe | Entfällt. Die bestehenden Abläufe werden nicht weitergenutzt, sondern neu erstellt. Ebenso wird eine neue Datenbank aufgesetzt. Die in E-24a beschriebenen Einschränkungen sind damit Vorgaben für den Neubau, nicht Fehler an einem zu reparierenden Bestand. |

### Neue zu klärende Fragen

1. **Mindestteilnehmerzahlen:** Welche konkreten Werte gelten je Kursart (Halbtagskurs, Kurzschulung, Abendkurs)? Die Struktur steht mit S-04a, es fehlen nur die Zahlen.
2. **Firmenkurse:** Werden diese ebenfalls über edoobox gebucht, oder entstehen sie außerhalb? Falls außerhalb, sind Erlös und Teilnehmerzahl für diese Kursart manuell zu erfassen.
3. **Benachrichtigungskanal:** Über welchen Kanal soll P04 Qualitäts- und Fehlermeldungen zustellen?
4. **Wöchentlicher Vollabgleich:** An welchem Wochentag und zu welcher Uhrzeit soll P03 ausgeführt werden?

---

## Quellen zur edoobox-Schnittstelle

- edoobox API V2, Authentisierung und Grundlagen: <https://v2.docs.edoobox.com/docs/edoobox-api>
- edoobox API, erste Schritte: <https://v2.docs.edoobox.com/docs/edoobox-api-erste-schritte>
- REST-API-Übersicht, Ressourcen und Limits: <https://docs.edoobox.com/knowledge-base/rest-api-basic/>
- Angebote-Ressourcen (Teilnehmerzahlen, Teilnehmergrenzen, Anmeldeschluss): <https://docs.edoobox.com/knowledge-base/angeboteressourcen-rest-api/>
- Buchung-Ressourcen (Buchungsstatus, Warteliste): <https://docs.edoobox.com/knowledge-base/buchung-ressourcen-rest-api/>
- Rechnung-Ressourcen (Beträge, Rechnungsstatus): <https://docs.edoobox.com/knowledge-base/rechnung-ressourcen/>
- edoobox Webhooks: <https://www.edoobox.com/de/produkte/webhooks/>
