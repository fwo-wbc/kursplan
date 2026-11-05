$ErrorActionPreference = 'Stop'

# =============================================================================
# Verifikation: Trainer-Portal /portal/verfuegbarkeit (neue 1:1-Kopie)
# Prüft remote im Container:
#   1) Container-Status (kursplan-app)
#   2) /portal/verfuegbarkeit liefert HTTP 200 (öffentlich, ohne Basic-Auth)
#      und enthält NICHT: Trainer-Auswahl (trainer-select), „Auswahl als
#      Standard festlegen“, zweite Menüleiste – aber sehr wohl Header-Brand
#      „Trainer-Portal“ + „Abmelden“.
#   3) Logo /webinarcenter_logo_header.png liefert OHNE Authorization 200
#      (kein Browser-Login-Popup) – Gefallen durch die neue Middleware-Regel.
#   4) Admin-Home mit Basic-Auth liefert weiterhin 200 (Auth bleibt aktiv).
# =============================================================================

$remote = @'
set -e
docker ps --filter name=kursplan-app --format 'name={{.Names}} status={{.Status}}'

docker exec kursplan-app node -e '
  const base = "http://127.0.0.1:3000";
  (async () => {
    // 1) Portal-Verfügbarkeit (öffentlich)
    const portal = await fetch(base + "/portal/verfuegbarkeit");
    const html = await portal.text();
    const checks = {
      status: portal.status,
      keineDozentenauswahl: !html.includes("trainer-select"),
      keinStandardHaken: !html.includes("Auswahl als Standard festlegen"),
      headerTitel: html.includes("Trainer-Portal"),
      abmeldenButton: html.includes("Abmelden"),
    };
    console.log("PORTAL-FETCH:", JSON.stringify(checks), "bytes=" + html.length);

    // 2) Logo-Asset ohne Authorization -> muss 200 sein (kein Auth-Popup)
    const logo = await fetch(base + "/webinarcenter_logo_header.png");
    console.log("LOGO-ohneAuth: status=" + logo.status + " type=" + logo.headers.get("content-type"));

    // 3) Admin-Home MIT Basic-Auth -> weiterhin geschützt/funktional
    const auth = "Basic " + Buffer.from(process.env.ADMIN_USER + ":" + process.env.ADMIN_PASSWORD).toString("base64");
    const admin = await fetch(base + "/", { headers: { authorization: auth } });
    console.log("ADMIN-mitAuth: status=" + admin.status + " bytes=" + (await admin.text()).length);

    let bad = 0;
    const portalOk = Number(portal.status) === 200;
    if (!portalOk) { console.error("FEHLER: Portal-Status = " + portal.status); bad++; }
    if (!checks.keineDozentenauswahl) { console.error("FEHLER: trainer-select (Dozentenauswahl) gefunden"); bad++; }
    if (!checks.keinStandardHaken) { console.error("FEHLER: StandardHaken-Text gefunden"); bad++; }
    if (!checks.headerTitel) { console.error("FEHLER: Header-Titel Trainer-Portal fehlt"); bad++; }
    if (!checks.abmeldenButton) { console.error("FEHLER: Abmelden-Button fehlt"); bad++; }
    if (logo.status !== 200) { console.error("FEHLER: Logo liefert kein 200 ohne Auth"); bad++; }
    if (admin.status !== 200) { console.error("FEHLER: Admin-Basic-Auth defekt"); bad++; }
    console.log(bad === 0 ? "VERIFIKATION: OK" : "VERIFIKATION: FEHLGESCHLAGEN (" + bad + " Fehler)");
    process.exitCode = bad ? 1 : 0;
  })().catch(e => { console.error("FEHLER:", e.message); process.exitCode = 1; });
'
'@

$remote = $remote -replace "`r`n", "`n"

$bytes = [Text.Encoding]::UTF8.GetBytes($remote)
$b64 = [Convert]::ToBase64String($bytes)

ssh -o BatchMode=yes root@46.62.206.211 "echo $b64 | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { throw "Remote-Verifikation fehlgeschlagen (Exit $LASTEXITCODE)" }
