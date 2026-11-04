$ErrorActionPreference = 'Stop'

$remote = @'
set -e
echo "== Container-Status =="
docker compose -f /opt/kursplan/docker-compose.yml ps kursplan-app
echo "== Farbwert #193C6F im gebauten CSS =="
if docker exec kursplan-app sh -c 'grep -ril "193c6f" .next/static/css/ | head -5' 2>/dev/null; then
  echo "--- Konkrete CSS-Regel(n): ---"
  docker exec kursplan-app sh -c 'grep -rio "background-color:[^;}]*19..." .next/static/css/ | sort -u | head -5' 2>/dev/null || true
  echo "FARBE 193C6F/193c6f: gefunden (OK)"
else
  echo "FARBE 193C6F: NICHT gefunden (FAIL)"
  exit 1
fi
echo "== HTTP-Check Startseite (Port 3000) =="
docker exec kursplan-app node -e '
  const auth = "Basic " + Buffer.from(process.env.ADMIN_USER + ":" + process.env.ADMIN_PASSWORD).toString("base64");
  fetch("http://127.0.0.1:3000/", { headers: { authorization: auth } })
    .then(r => r.text().then(t => {
      console.log("HTTP code=" + r.status + " bytes=" + t.length + " farbe193C6F=" + (t.indexOf("193C6F") !== -1 ? "ja" : "nein"));
      if (r.status !== 200) process.exitCode = 1;
    }))
    .catch(e => { console.log("FEHLER: " + e.message); process.exitCode = 1; });
'
'@

$remote = $remote -replace "`r`n", "`n"

$bytes = [Text.Encoding]::UTF8.GetBytes($remote)
$b64 = [Convert]::ToBase64String($bytes)

ssh -o BatchMode=yes root@46.62.206.211 "echo $b64 | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { throw "Remote-Verifikation fehlgeschlagen (Exit $LASTEXITCODE)" }
