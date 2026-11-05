#!/usr/bin/env bash
# =============================================================================
# Remote-Setup Trainerportal – wird auf dem Produktionsserver ausgeführt:
#   1. DDL-Migration auf public.trainer (idempotent)
#   2. Trainer Frank Woltmann identifizieren (edoobox_admin_id aus Seed-Schema)
#   3. Test-Portal-Account anlegen (portal_email + bcrypt-Hash)
#   4. SESSION_SECRET in /opt/kursplan/.env.production ergänzen (falls fehlt)
# =============================================================================
set -e

DB="kursplan-db"
ENV_FILE="/opt/kursplan/.env.production"

echo "==> 1/4 Migration public.trainer (Portaldaten)"
docker exec -i "$DB" psql -U kursplan_user -d kursplan -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE public.trainer
    ADD COLUMN IF NOT EXISTS portal_email VARCHAR(255) UNIQUE,
    ADD COLUMN IF NOT EXISTS password_hash  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS portal_active  BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS last_login     TIMESTAMP WITH TIME ZONE;
GRANT SELECT, UPDATE ON public.trainer TO n8n_writer;
SQL

echo "==> 2/4 Trainer Frank Woltmann suchen"
docker exec "$DB" psql -U kursplan_user -d kursplan -t -A -c \
  "SELECT 'id=' || id || ' | ' || vorname || ' ' || nachname FROM public.trainer WHERE edoobox_admin_id='admin_4c155f660347_225880320';"

echo "==> 3/4 Test-Portal-Account anlegen (frank.woltmann@webinarcenter.de)"
docker exec -i "$DB" psql -U kursplan_user -d kursplan -v ON_ERROR_STOP=1 <<'SQL'
UPDATE public.trainer
   SET portal_email = 'frank.woltmann@webinarcenter.de',
       password_hash = '$2b$12$E9DROFokbx5Tdc7bJuLF4eJTBMABpzGKZCxK5/1gLpLWfDKaZtrWK',
       portal_active = true,
       updated_at = NOW()
 WHERE edoobox_admin_id = 'admin_4c155f660347_225880320';
SQL

echo "==> 4/4 SESSION_SECRET sicherstellen"
if ! grep -q '^SESSION_SECRET=' "$ENV_FILE"; then
  echo 'SESSION_SECRET="c7f2a91d8e62b04e3810f5d96a72e81403c9b1d75f284e60a3b8c9d1e2f4a5b60"' >> "$ENV_FILE"
  echo "   SESSION_SECRET ergänzt"
else
  echo "   SESSION_SECRET bereits vorhanden"
fi

echo "==> Kontrolle: Spalten + Account"
docker exec "$DB" psql -U kursplan_user -d kursplan -t -A -c \
  "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='trainer' AND column_name IN ('portal_email','password_hash','portal_active','last_login') ORDER BY column_name;"
docker exec "$DB" psql -U kursplan_user -d kursplan -t -A -c \
  "SELECT id || ' | ' || vorname || ' ' || nachname || ' | ' || portal_email FROM public.trainer WHERE portal_email='frank.woltmann@webinarcenter.de';"

echo "DONE"
