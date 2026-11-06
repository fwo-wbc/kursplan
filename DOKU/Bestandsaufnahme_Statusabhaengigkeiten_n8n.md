# Bestandsaufnahme: Abhängigkeiten der Statusänderung Trainerverfügbarkeit

**Stand:** 2026-11-06
**Anlass:** Anpassung der Schwellenwert-Logik für den Zuweisungsstatus
- `1 … minTeilnehmer` Anmeldungen → `unter Vorbehalt`
- ab `minTeilnehmer + 1` Anmeldungen → `bestätigt`
- `minTeilnehmer = GREATEST(COALESCE(user_minimal, 1), 1)`

**Ergebnis vorab:** Es sind **keine Anpassungen** an n8n-Workflows oder Mail-Services erforderlich. Die Schwellenwert-Logik ist im Backend bereits konsistent umgesetzt; kein n8n-Workflow fragt den Status ab, berechnet eigene Schwellen oder versendet E-Mails.

---

## 1. Backend (Next.js) – Schwellenwert-Logik

Die Statusberechnung ist an allen vier Stellen identisch auf `user_minimal` umgestellt und wurde per Testskript verifiziert (25/25 Prüfungen bestanden).

| Datei | Funktion / Stelle | Regel |
|---|---|---|
| [`app/src/app/api/trainer/zeitplan/route.ts`](../app/src/app/api/trainer/zeitplan/route.ts:183) | `kursStatus()` | `teilnehmer >= minTeilnehmer + 1` → `bestätigt`; `teilnehmer >= 1` → `unter Vorbehalt` |
| [`app/src/app/api/termine/route.ts`](../app/src/app/api/termine/route.ts:590) | `effektiverZuweisungsstatus()` | identisch, inkl. `Math.max(Number(row.min_teilnehmer ?? 1), 1)` |
| [`app/src/app/api/verfuegbarkeit/route.ts`](../app/src/app/api/verfuegbarkeit/route.ts:149) | SQL-`CASE` | `GREATEST(COALESCE(o.user_minimal, 1), 1) + 1` → `bestätigt` |
| [`app/src/app/portal/api/verfuegbarkeit/route.ts`](../app/src/app/portal/api/verfuegbarkeit/route.ts:149) | SQL-`CASE` | identisch |

**Verifikation:** [`scripts/verify_status_schwellen.cjs`](../scripts/verify_status_schwellen.cjs:1) – alle 25 Prüfungen bestanden (u. a. `user_minimal = 1/6/NULL/0`, manuelle Status-Schutzbedingung, `offerStatus`-Sonderfälle).

---

## 2. Mail-Services (Microsoft Graph API)

- Der einzige Mail-Versand läuft über [`app/src/lib/mailer.ts`](../app/src/lib/mailer.ts:79) (`sendMail`, Microsoft Graph `sendMail`).
- `sendMail` wird **ausschließlich** im Passwort-Reset verwendet: [`app/src/app/portal/api/auth/forgot-password/route.ts`](../app/src/app/portal/api/auth/forgot-password/route.ts:71).
- Es existiert **kein** kurs-/statusbezogener Mail-Versand im Backend. Trainer- oder Teilnehmer-Benachrichtigungen zur Kursbestätigung werden nicht aus dem Backend heraus getriggert.

---

## 3. n8n-Workflows

Grundlage: lokale Workflow-Dateien unter [`n8n/`](../n8n) sowie der Instanz-Snapshot [`n8n_workflows_list.json`](../n8n_workflows_list.json:1).

### 3.1 Status-Abfragen / hartkodierte Schwellen
- In **keinem** Workflow kommen die Literale `bestätigt` oder `unter Vorbehalt` vor.
- Es existieren **keine** hartkodierten Teilnehmer-Schwellen (z. B. `teilnehmer >= 2`).
- `user_minimal` wird ausschließlich als **Rohdatenfeld** gespiegelt/ausgewertet (Spiegelung `edoobox_raw.offer`, Sichten `kursplan.v_termin_erloes`), nicht zur Statusberechnung.

### 3.2 Mail-Nodes
- **Kein** n8n-Workflow enthält einen Mail-Node (`emailSend`, `microsoftOutlook`, `gmail`, `smtp`).
- Die vorhandenen Webhook-Workflows dienen ausschließlich der Synchronisation/Angebotserstellung:

| Workflow | Webhook-Pfad | Zweck |
|---|---|---|
| P06 Trainer Ad-hoc Sync | `sync-trainer` | Trainer-Spiegelung anstoßen |
| P90 – App Sync Webhook | `p90-sync` | edoobox-Sync anstoßen |
| P95 – Sync Trainer App to edoobox | `sync-trainer-to-edoobox` | Trainerzuweisung nach edoobox |
| P96 – Create edoobox Offer | `create-edoobox-offer` | Angebot aus Reservierung anlegen |
| ZOO Token holen (temporär) | `zoo-token` | Hilfsworkflow |

### 3.3 Sync-Workflows (P90, P01–P05, P98, P96, B01)
Diese Workflows spiegeln edoobox-Rohdaten bzw. schreiben Zuweisungen. Sie **konsumieren** den Status nicht und berechnen ihn nicht:
- **P90 / P01 / P02 / P03**: reine Listen-Spiegelung inkl. `user_minimal` als Rohfeld.
- **P04**: Qualitätskontrolle der Spiegelung; Alerts nur bei Sync-Fehlern, nicht bei Statuswechsel.
- **P05**: Wiederanlauf fehlgeschlagener Sync-Läufe.
- **P98**: Einzelfall-Trainerzuweisung (Titel-/Kürzel-Update in edoobox).
- **P96**: Angebot aus Reservierung anlegen.
- **B01**: Kurstransfer.

---

## 4. Status-Event-Kanal (Backend → n8n)

- [`app/src/lib/notifications.ts`](../app/src/lib/notifications.ts:75) sendet bei Terminänderungen (`TERMIN_STATUS_GEAENDERT`, `TRAINER_ZUGEWIESEN`, `TERMIN_ZEIT_GEAENDERT`) ein Fire-and-Forget-Event an `N8N_NOTIFICATION_WEBHOOK_URL`.
- Dieser Webhook-Pfad ist **keinem** der vorhandenen n8n-Workflows zugeordnet (kein passender Webhook-Pfad, kein Mail-Node). Es gibt folglich keinen n8n-Workflow, der auf Statuswechsel mit E-Mails reagiert.
- Der Status wird im Event-Payload als `vorher`/`nachher` mitgeführt, aber nicht serverseitig in n8n ausgewertet.

---

## 5. Fazit

| Prüfpunkt | Befund |
|---|---|
| n8n fragt `bestätigt`/`unter Vorbehalt` ab | **Nein** |
| n8n berechnet eigene Teilnehmer-Schwellen | **Nein** |
| n8n versendet E-Mails | **Nein** (kein Mail-Node) |
| Backend-Schwellen konsistent auf `user_minimal` | **Ja** (4/4 Stellen, 25/25 Tests) |
| Kursbestätigungs-Mails im Backend | **Nein** (nur Passwort-Reset) |

**Es sind keine Code- oder Workflow-Anpassungen erforderlich.** Die Statuslogik ist an der einzigen Stelle (Backend) korrekt und konsistent umgesetzt; alle n8n-Workflows sind statusneutral.
