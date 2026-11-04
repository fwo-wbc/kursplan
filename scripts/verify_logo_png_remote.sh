#!/usr/bin/env bash
set -e

echo "=== Container-Status ==="
docker ps --filter name=kursplan-app --format 'name={{.Names}} status={{.Status}}'

echo "=== PNG-Datei im Image (public) ==="
docker exec kursplan-app ls -la /app/public/webinarcenter_logo_header.png

echo "=== HTTP-Verifikation via Container ==="
docker exec kursplan-app node -e '
  const auth = "Basic " + Buffer.from(process.env.ADMIN_USER + ":" + process.env.ADMIN_PASSWORD).toString("base64");
  const base = "http://127.0.0.1:3000";
  (async () => {
    const page = await fetch(base + "/", { headers: { authorization: auth } });
    const pt = await page.text();
    console.log("PAGE: code=" + page.status + " bytes=" + pt.length +
      " pngRef=" + pt.includes("webinarcenter_logo_header.png") +
      " altInlineSvg=" + pt.includes("m 347.7,257.12") +
      " titel=" + pt.includes("Kursplanung"));

    const png = await fetch(base + "/webinarcenter_logo_header.png", { headers: { authorization: auth } });
    const pb = Buffer.from(await png.arrayBuffer());
    console.log("PNG: code=" + png.status + " bytes=" + pb.length +
      " magic=" + pb.subarray(0, 8).toString("hex"));

    if (page.status !== 200) throw new Error("Seite liefert nicht 200");
    if (!pt.includes("webinarcenter_logo_header.png")) throw new Error("PNG-Referenz fehlt im HTML");
    if (pt.includes("m 347.7,257.12")) throw new Error("Altes Inline-SVG noch im HTML");
    if (png.status !== 200 || pb.length < 1000) throw new Error("PNG nicht korrekt ausgeliefert");
    console.log("VERIFY_OK");
  })().catch(e => { console.error("FEHLER:", e.message); process.exit(1); });
'
