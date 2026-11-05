#!/usr/bin/env bash
# =============================================================================
# Remote-Setup Passwort-Reset Trainerportal – auf dem Produktionsserver:
#   1. Token-Spalten auf public.trainer ergänzen (idempotent)
#   2. SMTP_* + BASE_URL in /opt/kursplan/.env.production ergänzen (falls fehlt)
# =============================================================================
set -e

DB="kursplan-db"
ENV_FILE="/opt/kursplan/.env.production"

echo "==> 1/2 Migration public.trainer (Reset-Token)"
docker exec -i "$DB" psql -U kursplan_user -d kursplan -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE public.trainer
    ADD COLUMN IF NOT EXISTS reset_password_token    VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reset_password_expires  TIMESTAMPTZ;
GRANT SELECT, UPDATE ON public.trainer TO n8n_writer;
SQL

echo "==> 2/2 SMTP_* + BASE_URL in .env.production sicherstellen"
if ! grep -q '^SMTP_HOST=' "$ENV_FILE"; then
  echo 'SMTP_HOST=CHANGE_ME' >> "$ENV_FILE"
  echo 'SMTP_PORT=587' >> "$ENV_FILE"
  echo 'SMTP_USER=CHANGE_ME' >> "$ENV_FILE"
  echo 'SMTP_PASS=CHANGE_ME' >> "$ENV_FILE"
  echo 'SMTP_FROM=webinarcenter.de' >> "$ENV_FILE"
  echo "   SMTP_* ergänzt (Werte bitte in $ENV_FILE setzen)"
else
  echo "   SMTP_* bereits vorhanden"
fi
if ! grep -q '^BASE_URL=' "$ENV_FILE"; then
  echo 'BASE_URL=http://46.62.206.211:3000' >> "$ENV_FILE"
  echo "   BASE_URL ergänzt"
else
  echo "   BASE_URL bereits vorhanden"
fi

echo "==> Kontrolle: Spalten"
docker exec "$DB" psql -U kursplan_user -d kursplan -t -A -c \
  "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='trainer' AND column_name IN ('reset_password_token','reset_password_expires') ORDER BY column_name;"

echo "DONE"