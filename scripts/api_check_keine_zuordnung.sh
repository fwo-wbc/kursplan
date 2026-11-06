#!/bin/bash
# Temporärer API-Verifikations-Check (Produktions-Host /opt/kursplan).
# Liest ADMIN_USER/ADMIN_PASSWORD aus der Container-Umgebung von kursplan-app
# und ruft GET /api/termine mit Basic-Auth ab. Gibt nur Statistiken aus,
# niemals die Zugangsdaten.
set -u

AUTH_HEADER=$(printf 'Authorization: Basic %s' \
  "$(printf '%s:%s' \
      "$(docker exec kursplan-app printenv ADMIN_USER)" \
      "$(docker exec kursplan-app printenv ADMIN_PASSWORD)" \
    | base64)" )

curl -s -o /tmp/api_termine.json -w 'HTTP_CODE=%{http_code}\n' \
  -H "$AUTH_HEADER" --max-time 30 http://127.0.0.1:3000/api/termine

echo "Treffer 'keine Zuordnung' im API-Output: $(grep -o 'keine Zuordnung' /tmp/api_termine.json | wc -l)"
echo "Kurs lo-imp-um-1126 im API-Output:      $(grep -o 'lo-imp-um-1126' /tmp/api_termine.json | wc -l)"
echo "Kurs lo-cal-gl-m1-1126 im API-Output:    $(grep -o 'lo-cal-gl-m1-1126' /tmp/api_termine.json | wc -l)"
echo ""

python3 - <<'PY'
import json

with open('/tmp/api_termine.json', encoding='utf-8') as f:
    raw = f.read()

try:
    d = json.loads(raw)
except Exception as e:
    print('JSON-Parse-Fehler:', e)
    print('Erste 300 Zeichen:', raw[:300])
    raise SystemExit(0)

if isinstance(d, dict):
    kurse = d.get('kurse') or d.get('data') or d.get('termine') or []
elif isinstance(d, list):
    kurse = d
else:
    kurse = []

ziel = ('lo-imp-um-1126', 'lo-cal-gl-m1-1126')
gesehen = set()
for k in kurse:
    nr = k.get('kursnr') or ''
    if nr in ziel and nr not in gesehen:
        gesehen.add(nr)
        print('KURS:', nr, '| name:', k.get('offer_name'))
        print('  offer_id:', k.get('offer_id'))
        print('  zuweisung_status (Kurs):', k.get('zuweisung_status'))
        for z in (k.get('zuweisungen') or []):
            t = z.get('trainer') or {}
            print('  ZUWEISUNG -> trainer_id:', z.get('trainer_id'),
                  '| quelle:', z.get('quelle'),
                  '| status:', z.get('status'),
                  '| trainer:', t.get('kuerzel'), t.get('vorname'), t.get('nachname'))
        for tm in (k.get('termine') or []):
            print('  TERMIN:', tm.get('date_id'),
                  '| zuweisung_status:', tm.get('zuweisung_status'),
                  '| trainer_id:', tm.get('trainer_id'))
for nr in ziel:
    if nr not in gesehen:
        print('WARNUNG: Kurs', nr, 'nicht im API-Output gefunden.')
PY
