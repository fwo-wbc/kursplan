#!/usr/bin/env bash
set -e

echo "=== Container-Status ==="
docker ps --filter name=kursplan-app --format 'name={{.Names}} status={{.Status}}'

echo "=== SVG-Datei im Image (public) ==="
docker exec kursplan-app ls -la /app/public/webinarcenter_Logo_2_2021_V2.4_weiss-2.svg

echo "=== HTTP-Verifikation via Container ==="
docker exec kursplan-app node -e '
  const auth = "Basic " + Buffer.from(process.env.ADMIN_USER + ":" + process.env.ADMIN_PASSWORD).toString("base64");
  const base = "http://127.0.0.1:3000";
  (async () => {
    const svg = await fetch(base + "/webinarcenter_Logo_2_2021_V2.4_weiss-2.svg", { headers: { authorization: auth } });
    const svgText = await svg.text();
    const svgOk = svg.status === 200 && svgText.includes("viewBox=\"0 0 193 28\"");
    console.log("SVG: status=" + svg.status + " bytes=" + svgText.length + " viewBoxOk=" + svgOk);

    const page = await fetch(base + "/", { headers: { authorization: auth } });
    const pageText = await page.text();
    const neuRef = pageText.includes("webinarcenter_Logo_2_2021_V2.4_weiss-2.svg");
    const altInline = pageText.includes("m 347.7,257.12");
    console.log("PAGE: status=" + page.status + " bytes=" + pageText.length + " neuesLogoImg=" + neuRef + " altesInlineSvg=" + altInline);

    if (!svgOk || page.status !== 200 || !neuRef || altInline) process.exitCode = 1;
  })().catch(e => { console.error("FEHLER:", e.message); process.exitCode = 1; });
'
