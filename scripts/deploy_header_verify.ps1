$ErrorActionPreference = 'Stop'

$remote = @'
set -e
for T in http://127.0.0.1:3000/ http://46.62.206.211:3000/; do
  docker exec kursplan-app node -e '
    const u = process.argv[1];
    const auth = "Basic " + Buffer.from(process.env.ADMIN_USER + ":" + process.env.ADMIN_PASSWORD).toString("base64");
    fetch(u, { headers: { authorization: auth } })
      .then(r => r.text().then(t => ({ status: r.status, t })))
      .then(({ status, t }) => {
        const title = (t.match(/<title>([^<]*)<\/title>/) || [])[1] || "n/a";
        const nav = (t.match(/<nav|<header/gi) || []).length;
        console.log(u + " -> code=" + status + " title=" + title + " navheader=" + nav + " bytes=" + t.length);
      })
      .catch(e => { console.log(u + " -> FEHLER: " + e.message); process.exitCode = 1; });
  ' "$T"
done
'@

$remote = $remote -replace "`r`n", "`n"

$bytes = [Text.Encoding]::UTF8.GetBytes($remote)
$b64 = [Convert]::ToBase64String($bytes)

ssh -o BatchMode=yes root@46.62.206.211 "echo $b64 | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { throw "Remote-Verifikation fehlgeschlagen (Exit $LASTEXITCODE)" }
