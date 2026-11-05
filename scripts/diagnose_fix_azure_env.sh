#!/usr/bin/env bash
# =============================================================================
# diagnose_fix_azure_env.sh
# -----------------------------------------------------------------------------
# Diagnose & Hotfix für den Microsoft Graph Mailversand (Trainerportal).
#
# Problem: Microsoft meldet "Application with identifier '<Secret>'
# was not found" – d. h. der OAuth2-Request sendet den CLIENT_SECRET als
# client_id. Der Quellcode (app/src/lib/mailer.ts) setzt die Parameter
# nachweislich korrekt, also liegen im laufenden Container vertauschte
# Werte vor (Server-Env in /opt/kursplan oder eine zusätzliche .env).
#
# Das Skript:
#   1. Zeigt docker-compose.yml und prüft, ob eine .env die Werte überschreibt
#   2. Liest den Ist-Zustand aus dem laufenden Container (docker exec env)
#   3. Erkennt eine Vertauschung anhand des Formats:
#        AZURE_CLIENT_ID   -> Azure App-ID = GUID (8-4-4-4-12 Hex)
#        AZURE_CLIENT_SECRET -> Secret beginnt NIE im reinen GUID-Format
#   4. Führt bei Vertauschung einen Swap der Werte in .env.production durch
#      (mit Sicherungskopie .env.production.bak.<YYYYmmdd-HHMMSS>)
#   5. Führt docker compose up -d --force-recreate aus und zeigt die Logs
#
# Aufruf (auf dem Produktionsserver ausführen):
#   bash diagnose_fix_azure_env.sh [Pfad-zum-Compose-Verzeichnis]
#
# Default-Compose-Verzeichnis: /opt/kursplan
# =============================================================================
set -euo pipefail

APP_DIR="${1:-/opt/kursplan}"
ENV_FILE="$APP_DIR/.env.production"
CONTAINER="kursplan-app"
GUID_RE='^[0-9a-fA-F]\{8\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{12\}$'

echo "=== [1/5] Compose-Verzeichnis prüfen: $APP_DIR ==="
[ -d "$APP_DIR" ] || { echo "FEHLER: $APP_DIR existiert nicht."; exit 1; }
[ -f "$APP_DIR/docker-compose.yml" ] || { echo "FEHLER: docker-compose.yml fehlt."; exit 1; }

echo "--- docker-compose.yml: env_file / environment (AZURE-relevant) ---"
grep -nE 'env_file|environment|\.env|AZURE' "$APP_DIR/docker-compose.yml" || echo "(keine AZURE-/env_file-Zeilen)"


echo
echo "=== [2/5] .env-Überschreibung prüfen ==="
if [ -f "$APP_DIR/.env" ]; then
  echo "HINWEIS: $APP_DIR/.env existiert. Docker Compose liest .env automatisch für"
  echo "         Interpolation und kann Container-Env-Werte überschreiben."
  if grep -qE '^AZURE_' "$APP_DIR/.env"; then
    echo "-> AZURE-Werte in .env gefunden (potenzielle Fehlerquelle!):"
    grep -nE '^AZURE_' "$APP_DIR/.env" | cut -c1-60
  else
    echo "-> Keine AZURE_*-Einträge in .env – kein Überschreiben."
  fi
else
  echo "Keine $APP_DIR/.env vorhanden – env_file: .env.production ist maßgeblich."
fi


echo
echo "=== [3/5] Ist-Zustand im Container ($CONTAINER) ==="
if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  docker exec "$CONTAINER" env | grep '^AZURE_' | sed -E 's/(AZURE_[A-Z_]+=)(.*)/\1 [WERT vorhanden, len=\2]/' || echo "(keine AZURE_*-Env im Container)"
else
  echo "Container '$CONTAINER' läuft nicht / ist hier nicht sichtbar."
  docker ps --format '{{.Names}}\t{{.Status}}' | grep kursplan || echo "(kein kursplan-Container via docker ps)"
fi


echo
echo "=== [4/5] .env.production prüfen & ggf. korrigieren ==="
[ -f "$ENV_FILE" ] || { echo "FEHLER: $ENV_FILE fehlt."; exit 1; }

CID_LINE=$(grep -E '^AZURE_CLIENT_ID=' "$ENV_FILE" || true)
SEC_LINE=$(grep -E '^AZURE_CLIENT_SECRET=' "$ENV_FILE" || true)
CID_VAL="${CID_LINE#AZURE_CLIENT_ID=}"
SEC_VAL="${SEC_LINE#AZURE_CLIENT_SECRET=}"

echo "AZURE_CLIENT_ID     -> $(echo "$CID_VAL" | cut -c1-12)... (GUID-Format: $(echo "$CID_VAL" | grep -q "$GUID_RE" && echo JA || echo NEIN))"
echo "AZURE_CLIENT_SECRET -> $(echo "$SEC_VAL" | cut -c1-12)... (GUID-Format: $(echo "$SEC_VAL" | grep -q "$GUID_RE" && echo JA || echo NEIN))"

# Korrekt = client_id ist GUID & secret ist KEIN GUID.
CID_IS_GUID=$(echo "$CID_VAL" | grep -q "$GUID_RE" && echo 1 || echo 0)
SEC_IS_GUID=$(echo "$SEC_VAL" | grep -q "$GUID_RE" && echo 1 || echo 0)

if [ "$CID_IS_GUID" -eq 1 ] && [ "$SEC_IS_GUID" -eq 0 ]; then
  echo "OK: AZURE_CLIENT_ID ist eine GUID, AZURE_CLIENT_SECRET ist kein GUID -> Zuordnung korrekt, kein Eingriff."
elif [ "$CID_IS_GUID" -eq 0 ] && [ "$SEC_IS_GUID" -eq 1 ]; then
  echo "VERTAUSCHT: AZURE_CLIENT_ID enthält das Secret, AZURE_CLIENT_SECRET die App-ID."
  cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)"
  echo "Sicherung: $ENV_FILE.bak.$(date +%Y%m%d-%H%M%S) (siehe cp oben)"
  # Swap: Werte gegeneinander tauschen (Zuordnung korrigieren, Werte selbst unangetastet).
  sed -i "s|^AZURE_CLIENT_ID=.*|AZURE_CLIENT_ID=${SEC_VAL}|" "$ENV_FILE"
  sed -i "s|^AZURE_CLIENT_SECRET=.*|AZURE_CLIENT_SECRET=${CID_VAL}|" "$ENV_FILE"
  echo "Korrigiert:"
  grep -E '^AZURE_CLIENT_(ID|SECRET)=' "$ENV_FILE" | sed -E 's/(=.*)/=[OK]/'
  # Beachten: Falls beide Zeilen fehlen, wird nichts getauscht – dann Fehler ausgeben.
  NEW_CID=$(grep -E '^AZURE_CLIENT_ID=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  NEW_SEC=$(grep -E '^AZURE_CLIENT_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  [ -n "$NEW_CID" ] && [ -n "$NEW_SEC" ] || { echo "FEHLER: Korrektur fehlgeschlagen (Zeilen nicht gefunden)."; exit 1; }
  NEEDS_RECREATE=1
else
  echo "UNKLARES FORMAT (beide GUID oder beide Nicht-GUID): Kein automatischer Eingriff."
  echo "Bitte Werte in $ENV_FILE manuell gegen die App-Registrierung prüfen."
  NEEDS_RECREATE=0
fi


echo
echo "=== [5/5] Container neu starten & Logs verifizieren ==="
if [ "${NEEDS_RECREATE:-0}" -eq 1 ]; then
  ( cd "$APP_DIR" && docker compose up -d --force-recreate "$CONTAINER" )
fi

echo "--- docker logs kursplan-app --tail 20 ---"
docker logs "$CONTAINER" --tail 20 || echo "(Logs nicht abrufbar)"

echo
echo "Hinweis: Den Mailversand-Endpunkt danach einmal auslösen und in den Logs"
echo "auf '[mailer]' achten. Statt 'Application not found' muss ein Token bzw."
echo "HTTP 202 erscheinen."
