#!/usr/bin/env bash
# =============================================================================
# End-to-End-Verifikation Passwort-Reset (auf dem Produktionsserver):
#   1. Token für Test-Trainer in der DB setzen
#   2. reset-password-Endpunkt mit gültigem Token aufrufen
#   3. DB-Kontrolle: Token geleert, Ablauf NULL, password_hash neu
# =============================================================================
set -e

DB="kursplan-db"
EMAIL="frank.woltmann@webinarcenter.de"

echo "==> 1/3 Token setzen"
docker exec "$DB" psql -U kursplan_user -d kursplan -v ON_ERROR_STOP=1 -c \
  "UPDATE public.trainer SET reset_password_token='e2e-test-token-123', reset_password_expires=NOW() + INTERVAL '2 hours' WHERE portal_email='$EMAIL';"

echo "==> 2/3 reset-password POST (gueltig)"
curl -s -w '\nHTTP:%{http_code}\n' -X POST http://127.0.0.1:3000/portal/api/auth/reset-password \
  -H 'Content-Type: application/json' \
  -d '{"token":"e2e-test-token-123","password":"NeuesPasswort123"}'

echo "==> 3/3 DB-Kontrolle"
docker exec "$DB" psql -U kursplan_user -d kursplan -t -A -c \
  "SELECT 'token=' || COALESCE(reset_password_token,'NULL') || ' | expires=' || COALESCE(reset_password_expires::text,'NULL') || ' | hash_len=' || LENGTH(COALESCE(password_hash,'')) FROM public.trainer WHERE portal_email='$EMAIL';"

echo "DONE"