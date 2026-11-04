/**
 * Misst die Bounding-Box aller sichtbaren Pfade der Header-Logo-SVG
 * (Bildmarke "Welle" + Schriftzug "webinarcenter.de") inklusive aller
 * Transform-Ketten (affine Matrizen, korrekte SVG-Composition).
 * Bögen werden nach SVG F.6.5 geometrisch gesampelt.
 *
 * Quelle: app/public/webinarcenter_Logo_2_2021_V2.4_weiss-header.svg
 *
 * Aufruf: node scripts/measure_logo_bbox.cjs
 */
const fs = require('fs');
const path = require('path');

const srcFile = path.join(__dirname, '..', 'app', 'public', 'webinarcenter_Logo_2_2021_V2.4_weiss-header.svg');
const src = fs.readFileSync(srcFile, 'utf8');

// ---------- Affine Matrix [a,b,c,d,e,f] ; x' = a*x + c*y + e ; y' = b*x + d*y + f ----------
const ID = [1, 0, 0, 1, 0, 0];
const matMul = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const matApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** SVG: erste Transform ist äußerste (wird zuletzt angewandt). M = T1*T2*T3... */
function parseTransform(tf) {
  if (!tf) return ID;
  let m = ID;
  const re = /(translate|scale|matrix|rotate)\(\s*([^)]*)\)/g;
  let match;
  while ((match = re.exec(tf))) {
    const [, name, argsStr] = match;
    const args = argsStr.trim().split(/[\s,]+/).map(Number);
    let t;
    if (name === 'translate') t = [1, 0, 0, 1, args[0], args[1] ?? 0];
    else if (name === 'scale') t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
    else if (name === 'matrix') t = args;
    else if (name === 'rotate') {
      const r = (args[0] * Math.PI) / 180;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      t = args.length === 3 ? [cos, sin, -sin, cos, args[1], args[2]] : [cos, sin, -sin, cos, 0, 0];
    } else t = ID;
    m = matMul(m, t);
  }
  return m;
}

// ---------- SVG-Bogen nach F.6.5 sampeln ----------
function sampleArc(x, y, rx0, ry0, phiRad, largeArc, sweep, ax, ay, out) {
  if (x === ax && y === ay) return;
  let rx = rx0;
  let ry = ry0;
  if (rx === 0 || ry === 0) {
    out.push([ax, ay]);
    return;
  }
  const cosPhi = Math.cos(phiRad);
  const sinPhi = Math.sin(phiRad);
  const dx2 = (x - ax) / 2;
  const dy2 = (y - ay) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  const coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  const sign = (largeArc === sweep) ? -1 : 1;
  const cxp = sign * coef * (rx * y1p) / ry;
  const cyp = sign * coef * (-ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x + ax) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y + ay) / 2;
  const theta1 = Math.atan2((y - cy) / ry, (x - cx) / rx);
  const theta2 = Math.atan2((ay - cy) / ry, (ax - cx) / rx);
  let dTheta = theta2 - theta1;
  if (sweep === 0 && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep === 1 && dTheta < 0) dTheta += 2 * Math.PI;
  const steps = 32;
  for (let k = 0; k <= steps; k++) {
    const t = theta1 + (dTheta * k) / steps;
    const ex = cx + rx * Math.cos(t);
    const ey = cy + ry * Math.sin(t);
    out.push([cosPhi * ex - sinPhi * ey, sinPhi * ex + cosPhi * ey]);
  }
  out.push([ax, ay]);
}

// ---------- d-Parser ----------
function collectPoints(d) {
  const pts = [];
  const tokens = d.match(/[a-zA-Z]|[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  let i = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const hasNum = (idx) => idx < tokens.length && /[-+0-9.]/.test(tokens[idx][0]);

  while (i < tokens.length) {
    const raw = tokens[i];
    const cmd = raw.toLowerCase();
    const rel = raw === raw.toLowerCase();
    i++;
    const px = (vx) => (rel ? x + vx : vx);
    const py = (vy) => (rel ? y + vy : vy);

    if (cmd === 'm') {
      const ax = px(+tokens[i++]);
      const ay = py(+tokens[i++]);
      x = ax; y = ay; sx = x; sy = y;
      pts.push([x, y]);
    } else if (cmd === 'l') {
      while (hasNum(i)) {
        x = px(+tokens[i++]); y = py(+tokens[i++]);
        pts.push([x, y]);
      }
    } else if (cmd === 'h') {
      while (hasNum(i)) {
        x = rel ? x + +tokens[i++] : +tokens[i++];
        pts.push([x, y]);
      }
    } else if (cmd === 'v') {
      while (hasNum(i)) {
        y = rel ? y + +tokens[i++] : +tokens[i++];
        pts.push([x, y]);
      }
    } else if (cmd === 'c' || cmd === 's') {
      while (hasNum(i)) {
        const x1 = px(+tokens[i++]);
        const y1 = py(+tokens[i++]);
        const x2 = px(+tokens[i++]);
        const y2 = py(+tokens[i++]);
        const x3 = px(+tokens[i++]);
        const y3 = py(+tokens[i++]);
        pts.push([x1, y1]); pts.push([x2, y2]);
        // Kubik-Sampling (genaue Bounds)
        for (let k = 0; k <= 16; k++) {
          const t = k / 16;
          const u = 1 - t;
          const bx = u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
          const by = u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
          pts.push([bx, by]);
        }
        x = x3; y = y3;
      }
    } else if (cmd === 'q' || cmd === 't') {
      while (hasNum(i)) {
        const x1 = px(+tokens[i++]);
        const y1 = py(+tokens[i++]);
        const x2 = px(+tokens[i++]);
        const y2 = py(+tokens[i++]);
        pts.push([x1, y1]);
        for (let k = 0; k <= 16; k++) {
          const t = k / 16;
          const u = 1 - t;
          const bx = u * u * x + 2 * u * t * x1 + t * t * x2;
          const by = u * u * y + 2 * u * t * y1 + t * t * y2;
          pts.push([bx, by]);
        }
        x = x2; y = y2;
      }
    } else if (cmd === 'a') {
      while (hasNum(i)) {
        const rx = Math.abs(+tokens[i++]);
        const ry = Math.abs(+tokens[i++]);
        const phi = ((+tokens[i++]) * Math.PI) / 180;
        const large = +tokens[i++];
        const sweep = +tokens[i++];
        const ax = px(+tokens[i++]);
        const ay = py(+tokens[i++]);
        sampleArc(x, y, rx, ry, phi, large, sweep, ax, ay, pts);
        x = ax; y = ay;
      }
    } else if (cmd === 'z') {
      x = sx; y = sy;
      pts.push([x, y]);
    } else {
      break;
    }
  }
  return pts;
}

// ---------- Balancierter <g>-Parser ----------
function parseGroups(xml) {
  const tagRe = /<g\b([^>]*)>|<\/g>/g;
  const root = { transform: '', children: [] };
  const stack = [];
  let cursor = root;
  let match;
  let lastIndex = 0;
  const pathReGlobal = /<path\b([^>]*)>/g;
  while ((match = tagRe.exec(xml))) {
    const seg = xml.slice(lastIndex, match.index);
    let pm;
    const pr = new RegExp(pathReGlobal.source, 'g');
    while ((pm = pr.exec(seg))) {
      const attrs = pm[1];
      const d = (attrs.match(/\bd="([^"]+)"/) || [])[1];
      const tf = (attrs.match(/\btransform="([^"]+)"/) || [])[1];
      if (d) cursor.children.push({ type: 'path', d, transform: tf || '' });
    }
    if (match[0] === '</g>') {
      cursor = stack.pop();
    } else {
      const attrs = match[1];
      const tf = (attrs.match(/\btransform="([^"]+)"/) || [])[1] || '';
      const g = { transform: tf, children: [] };
      cursor.children.push({ type: 'group', ...g });
      stack.push(cursor);
      cursor = g;
    }
    lastIndex = match.index + match[0].length;
  }
  return root;
}

// ---------- Bounding-Box ----------
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
let pathCount = 0;

function walk(node, parentMatrix) {
  const own = parseTransform(node.transform || '');
  const total = matMul(parentMatrix, own); // Eltern * eigene (eigene zuerst angewandt)
  for (const child of node.children || []) {
    if (child.type === 'group') {
      walk(child, total);
    } else if (child.type === 'path') {
      pathCount++;
      const pathMatrix = parseTransform(child.transform || '');
      const effective = matMul(total, pathMatrix);
      for (const [px, py] of collectPoints(child.d)) {
        const [wx, wy] = matApply(effective, px, py);
        if (wx < minX) minX = wx;
        if (wy < minY) minY = wy;
        if (wx > maxX) maxX = wx;
        if (wy > maxY) maxY = wy;
      }
    }
  }
}

const root = parseGroups(src);
walk(root, ID);

if (!isFinite(minX)) throw new Error('Keine messbaren Pfade');

console.log('Pfade gemessen:', pathCount);
console.log('Bounding-Box (roh): minX=' + minX.toFixed(4) + ' minY=' + minY.toFixed(4) + ' maxX=' + maxX.toFixed(4) + ' maxY=' + maxY.toFixed(4));
console.log('Breite=' + (maxX - minX).toFixed(4) + ' Hoehe=' + (maxY - minY).toFixed(4));
