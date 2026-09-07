# Abschlussbericht zur DB-I-Auswertung

**Stand:** 5. September 2026  
**Datenbasis:** edoobox-Spiegelung in PostgreSQL, Schema `edoobox_raw` und Auswertungsschema `kursplan`

## Zusammenfassung

Die DB-I-Berechnung für die produktiven Kursangebote ab 2023 ist vollständig eingerichtet und abgestimmt. Sämtliche kostenrelevanten Angebote besitzen eine auflösbare Trainerkostenkonfiguration. Die abschließende Kontrolle weist keine offenen Kostenfälle mehr aus.

| Kennzahl | Ergebnis |
|---|---:|
| Produktiver Nettoerlös ab 2023 | 430.049,62 € |
| Trainerkosten | 227.452,00 € |
| Plattformkosten | 11.715,00 € |
| Vor- und Nachbereitung | 0,00 € |
| Direkte Kosten gesamt | 239.167,00 € |
| **Deckungsbeitrag I** | **190.882,62 €** |
| **DB-I-Marge** | **44,39 %** |

Die direkte Kostenquote beträgt 55,61 % des Nettoerlöses. Davon entfallen 52,89 % auf Trainerkosten und 2,72 % auf Plattformkosten.

## Umfang der Auswertung

- **Produktive Gesamtsicht:** 2.586 Angebote über die vollständige Historie.
- **DB-I-Zeitraum:** Angebote mit Termin ab dem 1. Januar 2023.
- **Vollständig berechenbare Angebote ab 2023:** 1.696.
- **Ist-Angebote:** 1.559.
- **Prognose-Angebote:** 137.
- **Kostenaktivierte Angebote:** 781, erkennbar an 11.715,00 € Plattformkosten bei 15,00 € je Angebot.
- **Offene Kostenkonfigurationen:** 0.

Nicht jedes produktive Angebot löst direkte Kosten aus. Die Kostenaktivierung richtet sich nach Angebotsstatus, Buchungen und gegebenenfalls einer manuellen Angebotsausnahme.

## Berechnungslogik

Der Deckungsbeitrag I wird je Gesamtangebot wie folgt berechnet:

\[
\text{DB I} = \text{Nettoerlös} - \text{Trainerkosten} - \text{Plattformkosten} - \text{Vor- und Nachbereitung}
\]

Für den Gesamtbestand ergibt sich:

\[
430.049{,}62 - 227.452{,}00 - 11.715{,}00 - 0{,}00
= 190.882{,}62\ \text{€}
\]

Die Trainerpauschale gilt jeweils für das Gesamtangebot und nicht für jede einzelne Datumszeile. Sind einem Gesamtangebot künftig mehrere Trainer zugewiesen, werden deren Einzelkosten addiert. Die Plattformpauschale wird trotzdem nur einmal je kostenaktiviertem Gesamtangebot berechnet.

## Kostenregeln

### Eigene Durchführung

- **Trainerprofil:** Frank Woltmann, Kürzel FW.
- **Eigenunterricht:** 280,00 € je kostenaktiviertem Gesamtangebot.
- **Leistungsumfang:** ausschließlich Unterricht.
- **Vor- und Nachbereitung:** standardmäßig 0,00 €, bei Bedarf auf Angebotsebene änderbar.

### Fremdtrainer

- **UH und JE:** MS Office grundsätzlich 270,00 €, Project grundsätzlich 370,00 €.
- **MS und FK:** MS Office und OneNote grundsätzlich 270,00 €, Microsoft-365-Themen wie Teams, SharePoint und OneDrive grundsätzlich 370,00 €.
- **JR:** 340,00 € je Gesamtangebot.
- **WW:** 300,00 € je Gesamtangebot.
- **Weitere relevante Trainer:** im Zweifel 270,00 €.
- **DM:** Kosten je Angebot nach Absprache.
- **Coachings:** immer individueller Betrag je Gesamtangebot.

Die 18 individuellen DM- und Coaching-Fälle wurden mit bestätigten Einzelkosten von insgesamt 7.492,00 € hinterlegt. Diese Werte bleiben in `kursplan.angebot_trainer_kostenausnahme` nachträglich änderbar.

### Plattform

- **Standardpauschale:** 15,00 € je kostenaktiviertem Gesamtangebot.
- **Gesamtbetrag:** 11.715,00 €.
- **Angebotsbezogene Abweichungen:** technisch über eine Kostenüberschreibung möglich.

## Produktive Abgrenzung

Aus der produktiven Terminsicht und damit aus der DB-I-Berechnung werden insbesondere ausgeschlossen:

- Testkurse und manuell bestätigte Fehltermine
- Kurscodes mit dem Präfix `ft-`
- Feiertagseinträge
- `kontingent-10`
- Bearbeitungsgebühren
- sonstige als Nicht-Kurstermin bestätigte Kontingent- oder Sonderangebote

Der produktive Nettoerlös nach Anwendung aller Ausschlussregeln beträgt 430.049,62 €.

## Datenmodell und Kontrollen

Die Trainerzuordnung stammt aus `edoobox_raw.date_leader` und verweist auf die Trainerprofile in `edoobox_raw.trainer_admin`. Die Kostenregeln werden außerhalb von edoobox im Schema `kursplan` gepflegt, da edoobox keine tatsächlichen Trainerkosten enthält.

Für die DB-I-Berechnung sind insbesondere folgende Objekte maßgeblich:

- `kursplan.trainer_kostenprofil_admin`
- `kursplan.trainer_kurs_tarifregel`
- `kursplan.angebot_trainer_kostenausnahme`
- `kursplan.angebot_kostenausnahme`
- `kursplan.v_angebot_trainerkosten`
- `kursplan.v_termin_db1`
- `kursplan.v_kursart_db1`

Fehlt bei einem kostenaktivierten Fremdtrainerangebot eine gültige Tarifregel oder Ausnahme, werden die Trainerkosten nicht mit null angesetzt. Das Angebot wird stattdessen als unvollständig markiert. Die Abschlusskontrolle aus S62 bestätigt derzeit null offene Konfigurationen.

## Pflege und Interpretation

- Neue Trainer benötigen zunächst ein Kostenprofil.
- Neue Kurscodes eines Fremdtrainers benötigen eine passende Trainer-Kurs-Regel, sofern kein bewusst gewählter Standardtarif existiert.
- Coachings und individuell vereinbarte Fremdtrainerkosten müssen als Angebotsausnahme eingetragen werden.
- Änderungen an Trainerzuweisungen werden nach der erneuten Spiegelung der edoobox-Datumsressource wirksam.
- Prognosewerte ändern sich durch neue Buchungen, Stornierungen, Statusänderungen, Trainerwechsel und neue Angebote.
- Allgemeine Fixkosten, Verwaltungskosten, Marketingkosten und sonstige Gemeinkosten sind nicht Bestandteil des DB I.
- Der DB I ist daher keine Gewinnkennzahl, sondern zeigt den verbleibenden Nettoerlös nach Abzug der unmittelbar zugeordneten Durchführungskosten.

## Schlussfolgerung

Die DB-I-Auswertung ist technisch und rechnerisch vollständig. Der produktive Nettoerlös von 430.049,62 € ist vollständig einer Kostenkonfiguration zugeordnet. Nach direkten Kosten von 239.167,00 € verbleibt ein Deckungsbeitrag I von 190.882,62 € beziehungsweise 44,39 %.
