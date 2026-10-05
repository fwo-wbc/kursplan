# Statusbericht Datenbank und Trainer-Zuweisung

**Stand:** September 2026  
**Host / Server:** Hetzner (`46.62.206.211`)  
**Datenbank:** PostgreSQL (`kursplan-db` im Docker-Netzwerk `kursplan_net`)

---

## 1. Systemarchitektur & Netzwerk

* **Container `kursplan-db`:** PostgreSQL-Instanz (Datenbank `kursplan`).
* **Container `n8n-frank`:** Automatisierungs-Workflows für edoobox-Abgleich.
* **Docker-Netzwerk `kursplan_net`:** Beide Container sind im selben virtuellen Bridge-Netzwerk verbunden. Die DNS-Auflösung von `kursplan-db` innerhalb von n8n funktioniert einwandfrei.
* **Benutzer & Rollen:**
  * `kursplan_user` (Admin/Owner): Verwendet für DDL-Operationen (`CREATE TABLE`, `ALTER TABLE`).
  * `n8n_writer` (Applikation & n8n): Verfügt über DML-Rechte (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) auf dem Schema `public` inklusive Sequenz-Berechtigungen sowie Leserechte auf `edoobox_raw`.

---

## 2. Datenstruktur & Tabellenverknüpfungen

### Schema `edoobox_raw` (Spiegelung)
* **`offer`:** Seminare (`offer_id`, `name`, `status`).
* **`offer_date`:** Kurstermine (`date_id` als `text`, `offer_id`, `date_start`, `date_end`, `is_deleted`).
* **`trainer_admin`:** Edoobox-Trainerliste (`admin_id`, `shortcut`, `is_active`).

### Schema `public` (Applikation)
* **`trainer`:** Stammdatentabelle für Trainer (Owner: `kursplan_user`).
  * Spalten: `id` (SERIAL PRIMARY KEY), `vorname`, `nachname`, `kuerzel` (UNIQUE), `edoobox_admin_id` (UNIQUE), `farbe`, `is_active`, Zeitstempel.
  * Initialer Datensatz: `ID 1` -> Frank Woltmann (`FW`).
* **`trainer_verfuegbarkeit`:** Kalender- und Slot-Verfügbarkeiten.
  * Fremdschlüssel: `trainer_id` referenziert `public.trainer(id)` ON DELETE CASCADE.
* **`trainer_zuweisung`:** Zuweisung von Trainern zu Terminen.
  * Spalten: `id`, `trainer_id` (FK auf `public.trainer`), `date_id` (Typ `text`, korrespondierend zu `edoobox_raw.offer_date.date_id`), `status`, `notiz`, Zeitstempel.
  * Constraints: `UNIQUE (date_id, trainer_id)`.

---

## 3. Letzte durchgeführte Aktionen

1. **n8n Netzwerk- und Authentifizierungs-Fix:**
   * Container `n8n-frank` mit Netzwerk `kursplan_net` verknüpft (`docker network connect kursplan_net n8n-frank`).
   * Verbindung über Port 5432 getestet und n8n-Credentials für `n8n_writer` erfolgreich aktiviert.
2. **Schema-Anpassung `trainer_zuweisung`:**
   * Spaltentyp von `date_id` von `integer` auf `text` geändert, passend zum Format der edoobox-IDs (`date_...`).
3. **Stammdatentabelle `trainer` aufgebaut:**
   * Tabelle `public.trainer` angelegt und Rechte an `n8n_writer` erteilt.
   * Fremdschlüssel von `trainer_verfuegbarkeit` und `trainer_zuweisung` auf `public.trainer(id)` verknüpft.
   * Trainer Frank Woltmann (`FW`, `admin_4c155f660347_225880320`) mit ID 1 angelegt.

---

## 4. Nächste Schritte

* [ ] Verknüpfungs-Query testen (`offer_date` + `offer` + `trainer_zuweisung` + `trainer`).
* [ ] API-Routen in Next.js erstellen (`GET` für Terminübersicht, `POST`/`PUT` für Zuweisungs-Updates).
* [ ] Frontend-Komponente zur Trainerauswahl anbinden.