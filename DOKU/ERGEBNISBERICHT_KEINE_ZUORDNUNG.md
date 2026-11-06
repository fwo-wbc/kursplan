# Ergebnisbericht: Kurse mit Status „Keine Zuordnung"

**Stand:** 2026-11-06  
**Anlass:** Nach dem Datenabgleich mit edoobox weisen mehrere Kurse den Zuordnungsstatus „Keine Zuordnung" auf, obwohl sie regulär zugeordnet sein sollten.

---

## 1. Zusammenfassung

Der Status „Keine Zuordnung" ist **kein vom Sync (n8n) gesetzter Fallback**, sondern entsteht in der App, wenn für einen Kurs **kein Trainer über das `edoobox_admin_id`-Mapping gefunden wird**:

- Die API-Route [`GET /api/termine`](app/src/app/api/termine/route.ts:786) matcht den edoobox-Leiter ausschließlich über den **exakten** Abgleich `public.trainer.edoobox_admin_id = date_leader.admin_id` (`LEFT JOIN public.trainer edoo_t ON dl.admin_id = edoo_t.edoobox_admin_id`).
- Liefert dieser Join **NULL** (Trainer fehlt in `public.trainer` oder `edoobox_admin_id` ist leer/abweichend), bleibt `edoo_trainer_id` NULL → der Kurs erhält keine Zuweisung.
- Das Frontend [`app/src/app/page.tsx:2933`](app/src/app/page.tsx:2933) wendet dann den Fallback `? zuweisung.status : 'keine Zuordnung'` an → Anzeige „Keine Zuordnung".

Zusätzlich wird „keine Zuordnung" **bewusst manuell** als Aufhebung („n. v.") über [`POST /api/zuweisung`](app/src/app/api/zuweisung/route.ts:314) bzw. [`PATCH /api/zuweisung/bulk`](app/src/app/api/zuweisung/bulk/route.ts:248) gesetzt – diese Fälle sind korrekt und kein Fehler.

---

## 2. Welche konkreten Kurse sind betroffen?

Eine Live-Abfrage (`SELECT … FROM public.trainer_zuweisung WHERE status = 'keine Zuordnung'`) war in dieser lokalen Arbeitsumgebung **nicht möglich**:

- Die Produktions-DB läuft Docker-intern als Container `kursplan-db` (Port **5432**, Netzwerk `kursplan_net`) und ist über die sechs geprüften Wege (`.env.production`-Werte, Port 5432/5433, `127.0.0.1`) **nicht erreichbar** (durchgängig `ECONNREFUSED`).
- `docker` ist in dieser Umgebung nicht verfügbar, `kursplan-app`/`kursplan-db` sind hier nicht gemappt (`netstat`: kein Listener auf 5432/5433/3000).
- Die Aufgabe ist deshalb um einen **server-seitig ausführbaren Diagnose-Läufer** ergänzt:
  [`scripts/diagnose_keine_zuordnung.cjs`](scripts/diagnose_keine_zuordnung.cjs) – auf dem Produktions-Host (`/opt/kursplan`) mit `node scripts/diagnose_keine_zuordnung.cjs` ausgeführt, liefert er genau die geforderten Tabellen:

  1. **Statusverteilung** über alle Zeilen in `public.trainer_zuweisung`
  2. **Letzte 10 betroffene Kurse** (Status „keine Zuordnung" / NULL) mit `date_id`, `offer_id`, Kurs-Code (`offer_number`), Titel, `edoobox_status`, Trainer-ID, Trainer-Kürzel, `edoobox_admin_id`, Soft-Delete-Flags, `updated_at`
  3. **Trainer-Mapping-Check** der letzten 10 Termine mit edoobox-Leiter: `date_leader.admin_id` vs. `public.trainer.edoobox_admin_id` inkl. Markierung `MATCH` / `KEIN LOCAL MATCH` – damit ist die Gegenprüfung (Aufgabe 3) direkt enthalten.

### Bereits dokumentierte Hinweise auf betroffene Bestände

Aus der vorhandenen Bestandsaufnahme der zwölf edoobox-Ressourcen:

> „Die bereinigte Administratorliste enthält 16 eingesetzte Trainerkennungen. … **Drei historische Kennungen mit insgesamt zehn Zuordnungen** werden nicht mehr über `edo_admins` ausgeliefert und müssen … als historische Profile behandelt werden."

Diese drei historischen Kennungen sind **erste Verdachts-Kandidaten**: Ihre `admin_id` liegt in `date_leader` bzw. `offer.payload` vor, aber nicht in der aktuellen `trainer_admin`-Spiegelung bzw. nicht in `public.trainer.edoobox_admin_id` → `edoo_trainer_id` bleibt NULL → „Keine Zuordnung".

Weitere bekannte Diskrepanzen aus [`scripts/diagnose_trainer_diskrepanz.cjs`](scripts/diagnose_trainer_diskrepanz.cjs): Kurse, bei denen das Kürzel in der App (z. B. `DH`, `FK`) vom Edoobox-Leiter (`FW`, `MS`) abweicht – Zeichen für ein **veraltetes Kürzel-/Leiter-Mapping** in `date_leader` (Altbestand nach Trainerwechsel).

---

## 3. Welcher Code-Zweig / welches fehlende Feld hat den Status ausgelöst?

### 3.1 Fehlendes Feld: `public.trainer.edoobox_admin_id` (bzw. fehlende Trainerzeile)

| Stelle | Datei / Funktion | Wirkung |
|---|---|---|
| Trainer-Match | [`app/src/app/api/termine/route.ts:786`](app/src/app/api/termine/route.ts:786) – `LEFT JOIN public.trainer edoo_t ON dl.admin_id = edoo_t.edoobox_admin_id` | **Exaktes** Mapping über `edoobox_admin_id`. Kein Treffer → `edoo_trainer_id` NULL |
| Fragmentierung | [`app/src/app/api/termine/route.ts:903`](app/src/app/api/termine/route.ts:903) – `passtZuLeiter` | Lokale Zuweisung wird **nur** übernommen, wenn `lokale_edoobox_admin_id === edoo_admin_id` (und beide nicht NULL). Weicht `public.trainer.edoobox_admin_id` ab (leer, anderer Wert, Whitespace), verfällt selbst eine vorhandene lokale Zuweisung |
| Kein Leiter | [`app/src/app/api/termine/route.ts:997`](app/src/app/api/termine/route.ts:997) | Existiert kein `date_leader` (Admin in edoobox entzogen), wird **bewusst kein** veralteter Trainer übernommen → Kurs bleibt „n. v." |
| Frontend-Fallback | [`app/src/app/page.tsx:2933`](app/src/app/page.tsx:2933) – `? zuweisung.status : 'keine Zuordnung'` | Leeres `zuweisungen`-Array → Anzeige „Keine Zuordnung" |
| Manuelle Aufhebung (korrekt) | [`app/src/app/api/zuweisung/bulk/route.ts:299`](app/src/app/api/zuweisung/bulk/route.ts:299) | `n. v.` → Status „keine Zuordnung" (Disponent wählt bewusst keinen Trainer) |

### 3.2 Was hat konkret gefehlt / nicht gematcht?

Für die betroffenen Kurse kommen drei Ursachen in Betracht (nach Wahrscheinlichkeit geordnet):

1. **Trainer-ID-Mapping ohne Treffer:** Die im sync gespiegelte `date_leader.admin_id` existiert nicht (mehr) als `public.trainer.edoobox_admin_id`. Mögliche Teilursachen:
   - Historischer edoobox-Admin, der aus `trainer_admin` nicht mehr ausgeliefert wird;
   - `public.trainer.edoobox_admin_id` ist `NULL` (app-seitig angelegter Trainer ohne edoobox-Verknüpfung);
   - Schreib-/Leerzeichen- oder Kasus-Differenz (`admin_…` vs. `ADMIN_…`, führende/trailing Spaces) – der Abgleich ist **case-sensitiv und ohne `TRIM`**.
2. **Unvollständiger `date_leader`-Spiegel:** Nach einem Leiterwechsel bleibt in `date_leader` nur der **Altbestand** mit altem `last_synced_at` stehen, während der neue Leiter noch nicht gespiegelt ist → der einzige abgefragte Leiter (jüngster `last_synced_at`) matcht nicht.
3. **Bewusste Aufhebung:** Der Status wurde manuell über „n. v." gesetzt (kein Fehler, gewolltes Verhalten).

---

## 4. Gegenprüfung mit der Trainer-/Dozenten-Tabelle

Die Korrespondenz läuft ausschließlich über **`edoobox_admin_id`** (nicht über E-Mail; E-Mails sind im gesamten Matching nicht beteiligt):

```sql
-- Für jeden betroffenen Kurs (siehe Diagnose-Skript Abschnitt 2/3):
SELECT od.date_id, dl.admin_id AS edoo_leiter_admin_id,
       ta.shortcut, ta.email,            -- edoobox-Stammdaten
       t.id AS lokaler_trainer_id,
       t.kuerzel, t.edoobox_admin_id     -- lokale Stammdaten
FROM edoobox_raw.date_leader dl
JOIN edoobox_raw.offer_date od  ON od.date_id = dl.date_id
LEFT JOIN edoobox_raw.trainer_admin ta ON ta.admin_id = dl.admin_id
LEFT JOIN public.trainer t  ON t.edoobox_admin_id = dl.admin_id
WHERE od.date_id IN (<betroffene-date-ids>);
```

**Exakter Abgleich bedeutet:** Nur wenn `t.edoobox_admin_id` **zeichengenau (case-sensitiv, ohne TRIM)** gleich `dl.admin_id` ist, erscheint der Trainer. `NULL` oder abweichende Werte an **einer** der beiden Seiten → pro Kurs **keine Zuordnung**.

---

## 5. Erforderlicher Patch / Abgleich

### 5.1 Sofort-Abgleich (betroffene Bestände, je 1× anwendbar)

Führe auf dem Produktions-Host `/opt/kursplan` im Container `kursplan-db` aus (zuerst als **Rollback-sicheres SELECT**, dann gezielt):

```sql
-- a) Fehlende Trainer aus der edoobox-Spiegelung nachführen (upsert je shortcut):
--    Voraussetzung: genaue DDL von public.trainer (id serial, kuerzel unique, edoobox_admin_id unique)
INSERT INTO public.trainer (vorname, nachname, kuerzel, edoobox_admin_id, is_active)
SELECT ta.first_name, ta.last_name, ta.shortcut, ta.admin_id, true
FROM edoobox_raw.trainer_admin ta
WHERE ta.is_deleted IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.trainer t WHERE t.edoobox_admin_id = ta.admin_id
  )
ON CONFLICT (edoobox_admin_id) DO NOTHING;

-- b) Historische Trainer, die nicht mehr in trainer_admin stehen, dennoch aus den
--    bestehenden date_leader/admin-Zuordnungen nachführen (Manuelle Prüfung nötig!):
--    Erst SELECT: welche admin_ids haben Zuordnungen, aber KEIN public.trainer-Pendant?
SELECT DISTINCT dl.admin_id,
       COUNT(*) AS zuordnungen
FROM edoobox_raw.date_leader dl
WHERE dl.is_deleted IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.trainer t WHERE t.edoobox_admin_id = dl.admin_id
  )
GROUP BY dl.admin_id
ORDER BY zuordnungen DESC;
```

Nur nach **manueller Freigabe** der gefundenen `admin_id` (Name aus dem edoobox-Payload/Dokumentation verifizieren) diese als Trainer anlegen bzw. die bestehende Trainerzeile um `edoobox_admin_id` ergänzen.

### 5.2 Dauerhafte Ursachenbehebung (damit künftige Kurse automatisch korrekt mappen)

1. **Trainer-Nachführung in den Sync integrieren (empfohlen):** Der Vollabgleich (P90/P03) spiegelt seit [„P90 Ressourcen-Unterworkflow"](P90 Ressourcen-Unterworkflow.json) `trainer_admin` nach `edoobox_raw.trainer_admin`. Ergänze danach einen Schritt, der `public.trainer` **aus der Spiegeltabelle nachführt** (Upsert auf `edoobox_admin_id`, siehe 5.1a). Damit existiert für jeden aktiven edoobox-Trainer immer ein lokales Pendant → `edoo_trainer_id` ist nie mehr NULL.
2. **Tolerantes Matching (Robustheits-Patch in [`termine/route.ts:786`](app/src/app/api/termine/route.ts:786)):** Den Abgleich auf `TRIM(lower(edoo_t.edoobox_admin_id)) = TRIM(lower(dl.admin_id))` umstellen, um Whitespace-/Kasus-Diskrepanzen zu heilen. **Achtung:** Unter 5.2 P1 ist das unnötig – nur wählen, wenn Bestandsfehler nicht durch 5.2 P1 bereinigt werden können.
3. **Historische Kennungen aktiv behandeln**: Den in der Bestandsaufnahme identifizierten „historischen Profilen" einen aktiven lokalen Trainer zuordnen (oder die `date_leader`-Altbestände pro Termin per P90-Löschabgleich bereinigen – nur innerhalb des Sync-Zeitfensters, gemäß Soft-Delete-Regel).
4. **Manuell gesetzte „n. v."-Fälle kennzeichnen:** Die Aufhebungs-Zeilen in `public.trainer_zuweisung` tragen bereits `status = 'keine Zuordnung'` + Notiz. Für die Auswertung betroffener Fälle im Bericht sollten nur die **unfreiwilligen** Fälle gezählt werden (kein manuelles Setzen in `system_logs`/Routendaten).

---

## 6. Verifikation nach dem Patch

Auf dem Produktions-Host, nach Durchführung der Abgleich-Schritte:

1. **DB-Check:** [`scripts/diagnose_keine_zuordnung.cjs`](scripts/diagnose_keine_zuordnung.cjs) erneut ausführen.
2. **Zu erwarten:** Zeile „Termine mit edoobox-Leiter + Trainermapping-Check" zeigt für alle zuvor betroffenen `date_id` ein `LOKAL: id=<nr> … => MATCH`.
3. **API-Check:** `GET http://localhost:3000/api/termine` liefert für die Kurse `zuweisung_status != 'keine Zuordnung'` (bzw. `'n. v.'` nur noch bei bewusster Aufhebung).

---

## 7. Erkenntnisse zur Sync-/Statuslogik (Einordnung)

- **n8n ist NICHT die Ursache:** P01/P02/P03/P90 spiegeln ausschließlich Rohdaten nach `edoobox_raw`; keine der Routen oder Workflows setzt den Status „keine Zuordnung" als Fallback ([Bestandsaufnahme Statusabhängigkeiten n8n](DOKU/Bestandsaufnahme_Statusabhaengigkeiten_n8n.md:40)).
- **Schwellenwert-Logik betroffen? Nein:** „keine Zuordnung" ist bewusst außerhalb der Automatik-Stufen (`reserviert` / `unter Vorbehalt` / `bestätigt`); die Schutz-Bedingung [`effektiverZuweisungsstatus`](app/src/app/api/termine/route.ts:581) reißt den Status allerdings **nicht** hoch, weil dieser Kurs gar keine Zuweisungszeile besitzt.
- Der Status wird also **immer vom App-Layer** abgeleitet – die Behebung muss daher (a) lokal `public.trainer` vollständig spiegeln und (b) das Matching stabilisieren.
