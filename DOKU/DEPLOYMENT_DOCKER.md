# Deployment – Kursplan-App mit Docker

Stand: v1.0.0 · Next.js 16 · TypeScript · PostgreSQL · Node 22

Ziel: Containerisiertes Produktions-Image der App aus `app/`. Alle dynamischen
Parameter (DB, n8n-Webhooks, edoobox) kommen per `.env.production` zur
**Laufzeit** – es wird nichts Sensibles in das Image gebacken.

---

## 1. Voraussetzungen

- Docker Engine ≥ 20.10 mit Docker Compose v2 (`docker compose version`)
- PostgreSQL-Datenbank aus dem `edoobox_raw`-/`public`-Schema erreichbar
  (Standard-Port intern `5433`, Port ist über Env frei konfigurierbar)
- Zugriff auf die n8n-Webhook-URLs (falls genutzt)

## 2. Konfiguration erstellen

```bash
cp .env.production.example .env.production
```

In `.env.production` **alle `CHANGE_ME`-Werte ersetzen**:

| Variable | Zweck |
|---|---|
| `DATABASE_URL` | PostgreSQL-Connection-String (bevorzugt) |
| `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` | DB-Zugang in Einzelteilen (Alternativ) |
| `N8N_SYNC_SECRET` | **Secret** für den Header `X-Sync-Token` – Pflichtänderung |
| `N8N_TRAINER_SYNC_WEBHOOK_URL` | P06 Trainer-Ad-hoc-Sync |
| `N8N_WEBHOOK_URL_TRAINER_SYNC` | Rückkanal Trainerzuweisung → edoobox |
| `N8N_P90_WEBHOOK_URL` | P90 Ressourcen-Sync |
| `N8N_EDOOBOX_WEBHOOK_URL` | L-05 Termin-Übertragung |
| `N8N_WEBHOOK_URL` / `N8N_WEBHOOK_URL_CREATE_OFFER` | weitere n8n-Rückkanäle |
| `EDOOBOX_API_BASE`/`EDOOBOX_EDID`/`EDOOBOX_USER`/`EDOOBOX_PASSWORD` | edoobox Cleanup-API |

> **Sicherheit:** `.env.production` ist per `.gitignore` ausgeschlossen und
> landet dank [`app/.dockerignore`](../app/.dockerignore) auch **nicht** im
> Docker-Build-Kontext. Niemals committen oder weiterreichen.

## 3. Image bauen

Mit Docker Compose (empfohlen):

```bash
docker compose build
# oder direkt mit Version-Tag:
docker build -t kursplan-app:v1.0.0 ./app
```

Der Multi-Stage-Build ([`app/Dockerfile`](../app/Dockerfile)) erzeugt aus dem
`.next/standalone`-Output ein minimales Image (Node-Alpine, non-root-User
`nextjs`, ohne node_modules vom Entwicklungssystem).

## 4. Container starten

Mit Docker Compose:

```bash
docker compose up -d
docker compose ps            # Status prüfen
docker compose logs -f       # Logs folgen
```

Ohne Compose (manuell):

```bash
docker run -d --name kursplan-app \
  -p 3000:3000 \
  --env-file .env.production \
  kursplan-app:v1.0.0
```

Danach erreichbar unter: **http://Server-IP:3000**

## 5. Verifizieren

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/   # erwartet: 200
docker inspect --format='{{.State.Health.Status}}' kursplan-app    # healthy
docker exec kursplan-app env | grep -iE 'database|secret'         # Secrets nur zur Laufzeit
```

## 6. Update / neuer Release

```bash
# Im Repo: neuen Stand auschecken
docker compose build
docker compose up -d          # Neustart mit neuem Image
docker image prune -f         # alte Images entfernen
```

---

## Was wurde dafür geändert (v1.0.0 → Docker-Release)

| Datei | Änderung |
|---|---|
| [`app/next.config.ts`](../app/next.config.ts) | `output: "standalone"` aktiviert → minimales Laufzeit-Bundle |
| [`app/src/lib/db.ts`](../app/src/lib/db.ts) | `DATABASE_URL`-Support; hartkodiertes Fallback-Passwort entfernt (Fail-fast) |
| [`app/Dockerfile`](../app/Dockerfile) | Multi-Stage-Build (deps → builder → runner, non-root) |
| [`app/.dockerignore`](../app/.dockerignore) | schließt `.env*`, `node_modules`, `.next` aus dem Build-Kontext aus |
| [`docker-compose.yml`](../docker-compose.yml) | App-Service mit `env_file: .env.production`, Healthcheck, Log-Rotation |
| [`.env.production.example`](../.env.production.example) | Vorlage aller Laufzeit-Parameter |
| [`.gitignore`](../.gitignore) | `.env.production`/`.env.development` für alle Fälle ausgeschlossen |
