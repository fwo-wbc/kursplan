#!/usr/bin/env bash
# Verifikation des Inline-Logos (HeaderLogo.tsx) nach Deployment.
# Prüft: Container-Status, HTTP 200, exakte viewBox, preserveAspectRatio meet,
# Tailwind-Klasse, keine Verbotskriterien (preserveAspectRatio="none", mm-Breiten).
set -e

echo "=== Container-Status ==="
docker ps --filter name=kursplan-app --format 'name={{.Names}} status={{.Status}}'

echo "=== HTTP-Verifikation via Container ==="
docker exec kursplan-app node -e '
  const auth = "Basic " + Buffer.from(process.env.ADMIN_USER + ":" + process.env.ADMIN_PASSWORD).toString("base64");
  const base = "http://127.0.0.1:3000";
  (async () => {
    const page = await fetch(base + "/", { headers: { authorization: auth } });
    const t = await page.text();
    const checks = {
      status200: page.status === 200,
      viewBox: t.includes("viewBox=\"7.3 0 185.3 14.9\""),
      preserveMeet: t.includes("preserveAspectRatio=\"xMidYMid meet\""),
      tailwindKlasse: t.includes("h-7 sm:h-8 w-auto text-white fill-white shrink-0"),
      keinNone: !t.includes("preserveAspectRatio=\"none\""),
      keinMm: !t.includes("width=\"193mm\"")
    };
    console.log("PAGE: status=" + page.status + " bytes=" + t.length);
    console.log(JSON.stringify(checks, null, 2));
    if (!checks.status200 || !checks.viewBox || !checks.preserveMeet || !checks.tailwindKlasse || !checks.keinNone || !checks.keinMm) process.exitCode = 1;
  })().catch(e => { console.error("FEHLER:", e.message); process.exitCode = 1; });
'
