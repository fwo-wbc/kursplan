#!/usr/bin/env bash
# Verifikation der web-app-optimierten Header-Logo-Variante nach Deployment.
# Prüft: Container-Status, SVG im Container, HTTP 200, viewBox 193x14.5,
# keine Unterzeile/Trennlinie, neue Logo-Referenz in der Startseite.
set -e

echo "=== Container-Status ==="
docker ps --filter name=kursplan-app --format 'name={{.Names}} status={{.Status}}'

echo "=== SVG-Datei im Container (public) ==="
docker exec kursplan-app ls -la /app/public/webinarcenter_Logo_2_2021_V2.4_weiss-header.svg

echo "=== HTTP-Verifikation via Container ==="
docker exec kursplan-app node -e '
  const auth = "Basic " + Buffer.from(process.env.ADMIN_USER + ":" + process.env.ADMIN_PASSWORD).toString("base64");
  const base = "http://127.0.0.1:3000";
  (async () => {
    const svg = await fetch(base + "/webinarcenter_Logo_2_2021_V2.4_weiss-header.svg", { headers: { authorization: auth } });
    const svgText = await svg.text();
    const svgOk = svg.status === 200
      && svgText.includes("viewBox=\"0 0 193 14.5\"")
      && !svgText.includes("path46")
      && !svgText.includes("rect");
    console.log("SVG-Header: status=" + svg.status + " bytes=" + svgText.length + " viewBoxHalbiert=" + svgOk);

    const page = await fetch(base + "/", { headers: { authorization: auth } });
    const pageText = await page.text();
    const neuRef = pageText.includes("webinarcenter_Logo_2_2021_V2.4_weiss-header.svg");
    const altRef = pageText.includes("webinarcenter_Logo_2_2021_V2.4_weiss-2.svg");
    console.log("PAGE: status=" + page.status + " bytes=" + pageText.length + " neueLogoRef=" + neuRef + " alteLogoLueckig=" + altRef);

    if (!svgOk || page.status !== 200 || !neuRef || altRef) process.exitCode = 1;
  })().catch(e => { console.error("FEHLER:", e.message); process.exitCode = 1; });
'
