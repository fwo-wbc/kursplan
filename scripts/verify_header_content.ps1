$ErrorActionPreference = 'Stop'

# Remote-Skript: prüft SVG-Auslieferung, Logo-Referenz im HTML und
# Entfernung der alten Untertitel auf der Startseite.
$remote = @'
set -e
docker exec kursplan-app node -e '
  const auth = "Basic " + Buffer.from(process.env.ADMIN_USER + ":" + process.env.ADMIN_PASSWORD).toString("base64");
  const u = "http://127.0.0.1:3000/webinarcenter_Logo_2_2021_V2.4_weiss.svg";
  fetch(u, { headers: { authorization: auth } })
    .then(r => r.text().then(t => ({ s: r.status, t })))
    .then(({ s, t }) => {
      console.log("SVG -> code=" + s + " bytes=" + t.length + " svgTag=" + (t.includes("<svg") ? "ja" : "nein"));
      return fetch("http://127.0.0.1:3000/", { headers: { authorization: auth } }).then(r => r.text());
    })
    .then(html => {
      console.log("logoRef=" + (html.includes("webinarcenter_Logo_2_2021_V2.4_weiss.svg") ? "ja" : "nein"));
      console.log("altUntertitel=" + (html.includes("Traineranzeige wird aus edoobox") || html.includes("Stufenlose Wochenliste") ? "NOCH VORHANDEN" : "entfernt"));
    })
    .catch(e => { console.log("FEHLER: " + e.message); process.exitCode = 1; });
'
'@

$remote = $remote -replace "`r`n", "`n"

$bytes = [Text.Encoding]::UTF8.GetBytes($remote)
$b64 = [Convert]::ToBase64String($bytes)

ssh -o BatchMode=yes root@46.62.206.211 "echo $b64 | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { throw "Remote-Verifikation fehlgeschlagen (Exit $LASTEXITCODE)" }
