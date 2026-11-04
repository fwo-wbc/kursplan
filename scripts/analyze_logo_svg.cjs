/**
 * Analyse des Header-Logos (webinarcenter_Logo_2_2021_V2.4_weiss-2.svg):
 * - Listet alle Elemente mit ID, Klasse, Transform und d-Präfix
 * - Identifiziert rect (horizontale Trennlinie), Bildmarken-Pfade (Welle) und Schriftzug-Pfade
 * - Berechnet den exakten sichtbaren Bereich (Bounding Box) NUR für Bildmarke + Hauptschriftzug
 *   im viewBox-Koordinatensystem (g140-Matrix berücksichtigt)
 *
 * Aufruf: node scripts/analyze_logo_svg.cjs
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'app', 'public', 'webinarcenter_Logo_2_2021_V2.4_weiss-2.svg');
const c = fs.readFileSync(file, 'utf8');

console.log('FILE LENGTH:', c.length);
console.log('VIEWBOX:', (c.match(/viewBox="[^"]*"/) || [])[0] || 'n/a');
console.log(
  'WIDTH/HEIGHT:',
  (c.match(/width="[^"]*"/) || [])[0],
  (c.match(/height="[^"]*"/) || [])[0]
);

console.log('\n--- RECTS ---');
for (const m of c.matchAll(/<rect[^>]*\/?>/g)) console.log(m[0]);

console.log('\n--- PATHS (id | class | transform | d-Praefix) ---');
const paths = [];
for (const m of c.matchAll(/<path\b([^>]*)>/g)) {
  const attrs = m[1];
  const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
  const cls = (attrs.match(/\bclass="([^"]+)"/) || [])[1];
  const tf = (attrs.match(/\btransform="([^"]+)"/) || [])[1];
  const d = (attrs.match(/\bd="([^"]+)"/) || [])[1];
  paths.push({ id, cls, tf, d });
  console.log(
    `${id || '(keine id)'}`.padEnd(10),
    `| ${cls || ''}`.padEnd(8),
    `| ${tf || '(kein transform)'}`.padEnd(30),
    `| d: ${d ? d.slice(0, 40) : 'n/a'}`
  );
}

console.log('\n--- EXTENTS NUR Bildmarke (Welle, path88/path90) + Hauptschriftzug (path14..path44) ---');
const gTransform = (c.match(/<g id="g140"\s+transform="([^"]+)"/) || [])[1];
let a = 1, b = 0, cc = 0, d11 = 1, e = 0, f = 0;
if (gTransform) {
  const nums = gTransform.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number);
  [a, b, cc, d11, e, f] = nums;
}
console.log('g140-Matrix:', gTransform);

const keepIds = new Set(['path88', 'path90']);
for (let n = 14; n <= 44; n += 2) keepIds.add('path' + n);

// --- Exakte Bounding Box via Kurven-Sampling ---
// Beziers: 32 Samples pro Segment (deckt auch über die Kontrollpunkte hinausgehende Extrema ab)
function bezierMax(c0, c1, c2, c3, axis) {
  // Monotonie durch Ableitungspolynom: b(t) = (1-t)^3 p0 + 3(1-t)^2 t p1 + 3(1-t) t^2 p2 + t^3 p3
  // Für Sampling reicht ein Raster über [0,1], da 32 Samples die Extrema gut fassen.
  let mn = Math.min(c0, c3), mx = Math.max(c0, c3);
  for (let i = 1; i <= 32; i++) {
    const t = i / 32;
    const mt = 1 - t;
    const v = mt * mt * mt * c0 + 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t * c3;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return { mn, mx };
}

// Ellipsenbogen (a): Endpunkt bekannt; Extents ungefähr über die Achsradien am Bogensegment.
// Konservative Näherung: Endpunkt + gemittelter Ausschlag des Bogens (distance nicht exakt, aber inklusiv).
function arcBounds(cx0, cy0, c1x, c1y, c2x, c2y, ex, ey, rx, ry, sweep) {
  // c1x..c2y sind die Kontrollpunkte NICHT bekannt für a – wir nähern mit den Radien:
  const mx = (cx0 + ex) / 2, my = (cy0 + ey) / 2;
  const dx = ex - cx0, dy = ey - cy0;
  const len = Math.hypot(dx, dy);
  const radial = Math.max(rx, ry);
  // Puffer: max. Bogenhöhe ~ radial gegen Sehne
  let bulge = 0;
  if (len > 0 && radial > len / 2) {
    bulge = radial - Math.sqrt(Math.max(0, radial * radial - (len / 2) * (len / 2)));
  }
  const bx0 = Math.min(cx0, ex) - bulge, bx1 = Math.max(cx0, ex) + bulge;
  const by0 = Math.min(cy0, ey) - bulge, by1 = Math.max(cy0, ey) + bulge;
  return { mnX: bx0, mxX: bx1, mnY: by0, mxY: by1 };
}

// SVG-Pfad-Extents: zuverlässiger Token-Parser (Buchstaben + Zahlen), der auch
// implizite Wiederholungen (mehrere Punktpaare pro Kommando) korrekt verarbeitet.
// Liefert exakte visuelle Bounding Box (Bezier-Sampling), nicht nur Kontrollpunkte.
function pathExtents(d) {
  if (!d) return null;
  const parts = d.match(/[a-zA-Z]|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) || [];
  const arity = { m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0 };

  let x = 0, y = 0, x0 = 0, y0 = 0, cmd = null, firstPointOfCmd = true;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let prevC2x = null, prevC2y = null; // für S/s-Reflexion

  const push = (nx, ny) => {
    minX = Math.min(minX, nx); maxX = Math.max(maxX, nx);
    minY = Math.min(minY, ny); maxY = Math.max(maxY, ny);
  };
  let rel = () => cmd === cmd.toLowerCase();
  let prevC2 = null;   // für c/s-Reflexion
  let prevQ = null;    // für q/t-Reflexion

  const pushSeg = (seg) => {
    minX = Math.min(minX, seg.mnX); maxX = Math.max(maxX, seg.mxX);
    minY = Math.min(minY, seg.mnY); maxY = Math.max(maxY, seg.mxY);
  };
  const pushPt = (nx, ny) => {
    minX = Math.min(minX, nx); maxX = Math.max(maxX, nx);
    minY = Math.min(minY, ny); maxY = Math.max(maxY, ny);
  };
  const absX = (v) => (rel() ? x + v : v);
  const absY = (v) => (rel() ? y + v : v);
  const segOfCubic = (p0x, p0y, c1x, c1y, c2x, c2y, e1x, e1y) => {
    const bx = bezierMax(p0x, c1x, c2x, e1x);
    const by = bezierMax(p0y, c1y, c2y, e1y);
    return { mnX: bx.mn, mxX: bx.mx, mnY: by.mn, mxY: by.mx };
  };
  const segOfQuad = (p0x, p0y, qx, qy, e1x, e1y) => {
    // quadratisch -> kubisch: c1 = p + 2/3(q-p), c2 = e + 2/3(q-e)
    const c1x = p0x + (2 / 3) * (qx - p0x), c1y = p0y + (2 / 3) * (qy - p0y);
    const c2x = e1x + (2 / 3) * (qx - e1x), c2y = e1y + (2 / 3) * (qy - e1y);
    return segOfCubic(p0x, p0y, c1x, c1y, c2x, c2y, e1x, e1y);
  };

  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (/[a-zA-Z]/.test(p)) {
      cmd = p;
      rel = () => cmd === cmd.toLowerCase();
      firstPointOfCmd = true;
      i++;
      continue;
    }
    if (!cmd) { i++; continue; } // Zahlen vor erstem Kommando ignorieren
    let count = arity[cmd.toLowerCase()];
    if (count === 0) {
      // z: zurück zum Startpunkt
      pushPt(x0, y0);
      x = x0; y = y0;
      prevC2 = null; prevQ = null;
      i++;
      continue;
    }
    // Zahlen sammeln bis die Arity des Kommandos erreicht ist
    let nums = [];
    while (nums.length < count && i < parts.length) {
      const q = parts[i];
      if (/[a-zA-Z]/.test(q)) break; // neues Kommando -> Halt
      nums.push(parseFloat(q));
      i++;
    }
    if (nums.length < count) { i++; continue; } // unvollständig -> Ende
    const c = cmd.toLowerCase();
    const wasFirstM = (cmd === 'm' || cmd === 'M') && firstPointOfCmd;
    firstPointOfCmd = false;

    if (c === 'h') {
      x = absX(nums[0]);
      pushPt(x, y);
      prevC2 = null; prevQ = null;
      continue;
    }
    if (c === 'v') {
      y = absY(nums[0]);
      pushPt(x, y);
      prevC2 = null; prevQ = null;
      continue;
    }
    if (c === 'm' || c === 'l') {
      x = absX(nums[0]); y = absY(nums[1]);
      pushPt(x, y);
      // m setzt Startpunkt nur beim ersten Punkt
      if (wasFirstM) { x0 = x; y0 = y; }
      if (!wasFirstM && c === 'm') cmd = 'l'; // implizites l nach m
      prevC2 = null; prevQ = null;
      continue;
    }
    if (c === 'c') {
      const c1x = absX(nums[0]), c1y = absY(nums[1]);
      const c2x = absX(nums[2]), c2y = absY(nums[3]);
      const ex = absX(nums[4]), ey = absY(nums[5]);
      pushSeg(segOfCubic(x, y, c1x, c1y, c2x, c2y, ex, ey));
      prevC2 = [c2x, c2y]; prevQ = null;
      x = ex; y = ey;
      continue;
    }
    if (c === 's') {
      // Reflektion des letzten c2 über den aktuellen Punkt
      let c1x = x, c1y = y;
      if (prevC2) {
        c1x = 2 * x - prevC2[0];
        c1y = 2 * y - prevC2[1];
      }
      const c2x = absX(nums[0]), c2y = absY(nums[1]);
      const ex = absX(nums[2]), ey = absY(nums[3]);
      pushSeg(segOfCubic(x, y, c1x, c1y, c2x, c2y, ex, ey));
      prevC2 = [c2x, c2y]; prevQ = null;
      x = ex; y = ey;
      continue;
    }
    if (c === 'q') {
      const qx = absX(nums[0]), qy = absY(nums[1]);
      const ex = absX(nums[2]), ey = absY(nums[3]);
      pushSeg(segOfQuad(x, y, qx, qy, ex, ey));
      prevQ = [qx, qy]; prevC2 = null;
      x = ex; y = ey;
      continue;
    }
    if (c === 't') {
      let qx = x, qy = y;
      if (prevQ) {
        qx = 2 * x - prevQ[0];
        qy = 2 * y - prevQ[1];
      }
      const ex = absX(nums[0]), ey = absY(nums[1]);
      pushSeg(segOfQuad(x, y, qx, qy, ex, ey));
      prevQ = [qx, qy]; prevC2 = null;
      x = ex; y = ey;
      continue;
    }
    if (c === 'a') {
      const rx = nums[0], ry = nums[1];
      const sweep = !!nums[4];
      const ex = absX(nums[5]), ey = absY(nums[6]);
      const b = arcBounds(x, y, 0, 0, 0, 0, ex, ey, rx, ry, sweep);
      pushSeg(b);
      prevC2 = null; prevQ = null;
      x = ex; y = ey;
      continue;
    }
  }
  return { minX, maxX, minY, maxY };
}

// SVG-Reihenfolge: P' = M * (P + pathTranslate)
function applyM(x, y) {
  return [a * x + cc * y + e, b * x + d11 * y + f];
}

console.log('\n--- EXTENTS NACH MATRIX (pro Pfad, im viewBox-Koordinatensystem) ---');
const groups = {
  'Bildmarke (Welle)': ['path88', 'path90'],
  'Hauptschriftzug': ['path14', 'path16', 'path18', 'path20', 'path22', 'path24', 'path26', 'path28', 'path30', 'path32', 'path34', 'path36', 'path38', 'path40', 'path42', 'path44'],
  'Unterzeile': ['path46', 'path48', 'path50', 'path52', 'path54', 'path56', 'path58', 'path60', 'path62', 'path64', 'path66', 'path68', 'path70', 'path72', 'path74', 'path76', 'path78', 'path80', 'path82', 'path84', 'path86'],
};
const extOf = (p) => {
  const pm = p.tf ? p.tf.match(/translate\(([^)]+)\)/) : null;
  const [tx, ty] = pm ? pm[1].split(',').map(Number) : [0, 0];
  const ext = pathExtents(p.d);
  if (!ext) return null;
  const corners = [
    [ext.minX + tx, ext.minY + ty],
    [ext.maxX + tx, ext.maxY + ty],
    [ext.minX + tx, ext.maxY + ty],
    [ext.maxX + tx, ext.minY + ty],
  ];
  let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
  for (const [px, py] of corners) {
    const [rx, ry] = applyM(px, py);
    gx0 = Math.min(gx0, rx); gx1 = Math.max(gx1, rx);
    gy0 = Math.min(gy0, ry); gy1 = Math.max(gy1, ry);
  }
  return { minX: gx0, maxX: gx1, minY: gy0, maxY: gy1 };
};
for (const [name, ids] of Object.entries(groups)) {
  let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
  const detail = [];
  for (const id of ids) {
    const p = paths.find((q) => q.id === id);
    const e = extOf(p);
    if (!e) continue;
    detail.push(`${id}=x[${e.minX.toFixed(1)},${e.maxX.toFixed(1)}] y[${e.minY.toFixed(1)},${e.maxY.toFixed(1)}]`);
    gx0 = Math.min(gx0, e.minX); gx1 = Math.max(gx1, e.maxX);
    gy0 = Math.min(gy0, e.minY); gy1 = Math.max(gy1, e.maxY);
  }
  console.log(`${name}: x ${gx0.toFixed(1)}..${gx1.toFixed(1)} (w ${(gx1 - gx0).toFixed(1)}), y ${gy0.toFixed(1)}..${gy1.toFixed(1)} (h ${(gy1 - gy0).toFixed(1)})`);
  console.log('   ' + detail.join('\n   '));
}

// Trennlinie rect92 (hat KEIN eigenes translate):
const rectIn = (c.match(/<rect[^>]*\/?>/g) || [])[0];
if (rectIn) {
  const rx = parseFloat((rectIn.match(/x="([^"]+)"/) || [])[1]);
  const ry = parseFloat((rectIn.match(/y="([^"]+)"/) || [])[1]);
  const rw = parseFloat((rectIn.match(/width="([^"]+)"/) || [])[1]);
  const a0 = applyM(rx, ry);
  const a1 = applyM(rx + rw, ry);
  console.log(`Trennlinie rect92: x ${a0[0].toFixed(1)}..${a1[0].toFixed(1)}, y ${a0[1].toFixed(2)} (Hoehe ${(0.5 * 0.79226988).toFixed(2)})`);
}

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const p of paths) {
  if (!keepIds.has(p.id)) continue;
  const e = extOf(p);
  if (!e) continue;
  minX = Math.min(minX, e.minX); maxX = Math.max(maxX, e.maxX);
  minY = Math.min(minY, e.minY); maxY = Math.max(maxY, e.maxY);
}

console.log('\nEXTENTS (Bildmarke + Schriftzug) nach g140-Matrix:');
console.log(`x: ${minX.toFixed(2)} .. ${maxX.toFixed(2)}  (Breite ${(maxX - minX).toFixed(2)})`);
console.log(`y: ${minY.toFixed(2)} .. ${maxY.toFixed(2)}  (Hoehe ${(maxY - minY).toFixed(2)})`);

console.log('\nVergleich alte viewBox: "0 0 193 28" (kompletter Lockup inkl. Unterzeile + Trennlinie)');
console.log('Empfohlene neue viewBox (mit kleinem Puffer 0.5 je Seite):');
console.log(
  `viewBox="${(minX - 0.5).toFixed(1)} ${(minY - 0.5).toFixed(1)} ${(maxX - minX + 1).toFixed(1)} ${(maxY - minY + 1).toFixed(1)}"`
);
console.log('Seitenverhaeltnis neu:', ((maxX - minX + 1) / (maxY - minY + 1)).toFixed(2), '(alt: 6.89)');
