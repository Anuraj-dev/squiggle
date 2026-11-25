// Canvas model and rendering shared by the live board, thumbnails and PNG
// export. Every paint function draws in paper coordinates onto a full-size
// (W×H) context whose transform is identity on entry, so live view, gallery
// and download all rasterise the same way. No DOM access at import time.
import { W, H, fadeAlpha, fadeMs, gravityOffset, strokeMaxY } from './shared.js';

let makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
export function setCanvasFactory(fn) { makeCanvas = fn; }

let fillScratch = null;
const scratch = () => (fillScratch ||= makeCanvas(W, H));

export const hashId = (id) => { let x = 0; for (const c of String(id)) x = (x * 31 + c.charCodeAt(0)) | 0; return Math.abs(x); };
const RAINBOW = ['#ff3b3b', '#ff9f1c', '#ffe600', '#2ecc71', '#3d7bff', '#9b59ff'];
const RAINBOW_FILLS = ['#ff6b6b', '#ffb84d', '#ffe66d', '#7ee081', '#5ec8f2', '#8f7bff', '#ff8fd8'];

// Merges a server stroke into the local list. A stroke we already hold is our
// own optimistic copy: keep the same object (an in-progress drag keeps
// appending to it), take the server's fields and its leading points as
// authoritative, and keep any newer local points after them.
export function applyStroke(strokes, s) {
  const local = strokes.find((x) => x.id === s.id);
  if (!local) { strokes.push(s); return s; }
  const tail = local.pts.slice(s.pts.length);
  Object.assign(local, s, { pts: [...s.pts, ...tail] });
  return local;
}

// Pixels connected to (x0, y0) within colour tolerance, as a 0/1 mask.
// Returns null when the seed is off the page or already the fill colour.
export function floodRegion(data, x0, y0, rgb, w = W, h = H) {
  x0 = Math.round(x0); y0 = Math.round(y0);
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return null;
  const [fr, fg, fb] = rgb;
  const i0 = (y0 * w + x0) * 4, tr = data[i0], tg = data[i0 + 1], tb = data[i0 + 2];
  if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 6) return null;
  const mask = new Uint8Array(w * h);
  const ok = (x, y) => {
    const q = y * w + x;
    if (mask[q]) return false;
    const i = q * 4;
    return Math.abs(data[i] - tr) + Math.abs(data[i + 1] - tg) + Math.abs(data[i + 2] - tb) <= 110;
  };
  const stack = [x0, y0];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    let xi = x;
    while (xi >= 0 && ok(xi, y)) xi--;
    xi++;
    let up = false, down = false;
    while (xi < w && ok(xi, y)) {
      mask[y * w + xi] = 1;
      if (y > 0) { if (ok(xi, y - 1)) { if (!up) { stack.push(xi, y - 1); up = true; } } else up = false; }
      if (y < h - 1) { if (ok(xi, y + 1)) { if (!down) { stack.push(xi, y + 1); down = true; } } else down = false; }
      xi++;
    }
  }
  return mask;
}

// Flood fill composited with drawImage, so globalAlpha and the context
// transform apply exactly as they do to every other mark.
function fillAt(c, x, y, hex) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mask = floodRegion(c.getImageData(0, 0, W, H).data, x, y, rgb);
  if (!mask) return;
  const sc = scratch();
  const sctx = sc.getContext('2d');
  const img = sctx.createImageData(W, H);
  for (let q = 0; q < mask.length; q++) {
    if (!mask[q]) continue;
    const i = q * 4;
    img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  c.drawImage(sc, 0, 0);
}

// Affine copies a stroke is painted under, as [sx, sy, tx, ty, alpha]:
// x' = sx·x + tx, y' = sy·y + ty. Built from the stroke's chaos flags.
export function views(s) {
  let v = [[1, s.squish ? 0.5 : 1, 0, s.squish ? H / 4 : 0, 1]];
  if (s.flipY) v = v.map(([sx, sy, tx, ty, a]) => [sx, -sy, tx, H - ty, a]);
  if (s.mirror || s.kaleido) v = v.flatMap((x) => [x, [-x[0], x[1], W - x[2], x[3], x[4]]]);
  if (s.kaleido) v = v.flatMap((x) => [x, [x[0], -x[1], x[2], H - x[3], x[4]]]);
  if (s.double) v = v.flatMap((x) => [x, [x[0], x[1], x[2] + 16, x[3] + 12, 0.35]]);
  return v;
}

// opts.fade: apply ghost-ink alpha using opts.gameMs and opts.chaos.
export function drawStroke(c, s, from = 0, opts = {}) {
  let alpha = 1;
  if (opts.fade) {
    alpha = fadeAlpha((opts.gameMs || 0) - (s.t || 0), fadeMs(opts.chaos?.seed || 1));
    if (alpha <= 0) return;
  }
  const dy = s.gravity ? gravityOffset((opts.gameMs || 0) - (s.t || 0), strokeMaxY(s)) : 0;
  const color = s.tool === 'fill' && s.rainbow ? RAINBOW_FILLS[hashId(s.id) % RAINBOW_FILLS.length] : s.color;
  for (const [sx, sy, tx, ty, a] of views(s)) {
    c.save();
    c.globalAlpha = alpha * a;
    if (s.tool === 'fill') {
      const px = (v, max) => Math.min(max - 1, Math.max(0, Math.round(v)));
      fillAt(c, px(sx * s.pts[0] + tx, W), px(sy * s.pts[1] + ty + dy, H), color);
    } else {
      // Compose onto the current transform rather than replacing it.
      c.transform(sx, 0, 0, sy, tx, ty + dy);
      if (s.forbidden) {
        const { x, y, w, h } = s.forbidden;
        c.beginPath(); c.rect(0, 0, W, H); c.rect(x, y, w, h);
        c.clip('evenodd');
      }
      paint(c, s, from);
    }
    c.restore();
  }
}

// opts.memory keeps only the newest strokes. Decoy strokes render once in order
// (so fills respect them) and again on top so erasers cannot wipe them.
export function paintPaper(c, strokes, opts = {}) {
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = '#fff';
  c.fillRect(0, 0, W, H);
  c.restore();
  const list = opts.memory ? strokes.slice(-opts.memory) : strokes;
  const decoys = list.filter((s) => s.decoy);
  for (const s of list) drawStroke(c, s, 0, opts);
  for (const s of decoys) drawStroke(c, s, 0, opts);
}

// Incremental counterpart of paintPaper: paints one new stroke or segment, then
// the decoys again on top, so live, resync and replay stack them the same way.
export function drawLiveStroke(c, strokes, s, from = 0, opts = {}) {
  drawStroke(c, s, from, opts);
  if (!s.decoy) for (const d of strokes) if (d.decoy) drawStroke(c, d, 0, opts);
}

let thumbPaper = null;
// Thumbnails rasterise at full resolution on one reusable canvas, then scale.
export function paintThumb(tctx, w, h, strokes, opts = {}) {
  thumbPaper ||= makeCanvas(W, H);
  paintPaper(thumbPaper.getContext('2d', { willReadFrequently: true }), strokes, opts);
  tctx.drawImage(thumbPaper, 0, 0, w, h);
}

function paint(c, s, from) {
  const p = s.pts;
  c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = s.size;
  if (s.dotted) c.setLineDash?.([0.1, s.size * 2]);
  const erasing = s.tool === 'eraser';
  const base = erasing ? '#ffffff' : s.color;
  const rainbow = !!(s.rainbow && !erasing);
  if (s.tool === 'stamp') {
    const [x1, y1, x2, y2] = p;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const len = Math.hypot(x2 - x1, y2 - y1), r = len / 2;
    const a = len ? Math.atan2(y2 - y1, x2 - x1) : 0;
    const cos = Math.cos(a), sin = Math.sin(a);
    c.save();
    c.transform(cos, sin, -sin, cos, cx, cy);
    c.strokeStyle = base; c.beginPath();
    if (s.shape === 'circle') c.arc(0, 0, r, 0, Math.PI * 2);
    else if (s.shape === 'square') c.rect(-r, -r, len, len);
    else if (s.shape === 'triangle') {
      c.moveTo(0, -r * 0.92); c.lineTo(r * 0.9, r * 0.82); c.lineTo(-r * 0.9, r * 0.82); c.closePath();
    } else if (s.shape === 'star') {
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + i * Math.PI / 5, rad = (i % 2 ? 0.42 : 1) * r;
        const point = [Math.cos(ang) * rad, Math.sin(ang) * rad];
        if (i === 0) c.moveTo(...point); else c.lineTo(...point);
      }
      c.closePath();
    } else if (s.shape === 'arrow') {
      const head = len * 0.35;
      c.moveTo(-r, 0); c.lineTo(r, 0);
      c.moveTo(r - Math.cos(Math.PI / 6) * head, -Math.sin(Math.PI / 6) * head);
      c.lineTo(r, 0);
      c.lineTo(r - Math.cos(Math.PI / 6) * head, Math.sin(Math.PI / 6) * head);
    } else if (s.shape === 'heart') {
      c.moveTo(0, r * 0.9);
      c.bezierCurveTo(-r * 1.15, r * 0.25, -r * 0.95, -r * 0.85, 0, -r * 0.32);
      c.bezierCurveTo(r * 0.95, -r * 0.85, r * 1.15, r * 0.25, 0, r * 0.9);
      c.closePath();
    } else if (s.shape === 'moon') {
      const mr = r * 0.9, tx = mr * Math.cos(-0.38 * Math.PI), ty = mr * Math.sin(-0.38 * Math.PI);
      c.arc(0, 0, mr, -0.38 * Math.PI, 0.38 * Math.PI, true);
      c.quadraticCurveTo(-r * 0.25, 0, tx, ty);
      c.closePath();
    } else if (s.shape === 'cloud') {
      c.moveTo(-r * 0.6, r * 0.42);
      c.lineTo(r * 0.62, r * 0.42);
      c.bezierCurveTo(r * 0.98, r * 0.42, r * 0.98, -r * 0.14, r * 0.56, -r * 0.12);
      c.bezierCurveTo(r * 0.52, -r * 0.68, -r * 0.12, -r * 0.72, -r * 0.22, -r * 0.32);
      c.bezierCurveTo(-r * 0.55, -r * 0.52, -r * 0.82, -r * 0.25, -r * 0.72, r * 0.05);
      c.bezierCurveTo(-r * 0.98, r * 0.12, -r * 0.92, r * 0.42, -r * 0.6, r * 0.42);
      c.closePath();
    } else if (s.shape === 'bolt') {
      c.moveTo(r * 0.18, -r * 0.92);
      c.lineTo(-r * 0.55, r * 0.08);
      c.lineTo(-r * 0.04, r * 0.08);
      c.lineTo(-r * 0.22, r * 0.92);
      c.lineTo(r * 0.58, -r * 0.1);
      c.lineTo(r * 0.06, -r * 0.1);
      c.closePath();
    } else if (s.shape === 'eye') {
      c.moveTo(-r * 0.92, 0);
      c.quadraticCurveTo(0, -r * 0.78, r * 0.92, 0);
      c.quadraticCurveTo(0, r * 0.78, -r * 0.92, 0);
      c.closePath();
      c.moveTo(r * 0.36, 0); c.arc(0, 0, r * 0.36, 0, Math.PI * 2);
      c.moveTo(r * 0.14, 0); c.arc(0, 0, r * 0.14, 0, Math.PI * 2);
    }
    c.stroke();
    c.restore();
    return;
  }
  if (s.tool === 'line' || s.tool === 'rect' || s.tool === 'ellipse') {
    const [x1, y1, x2, y2] = p;
    if (rainbow) {
      const g = c.createLinearGradient(x1, y1, x2, y2);
      RAINBOW.forEach((col, i) => g.addColorStop(i / (RAINBOW.length - 1), col));
      c.strokeStyle = g;
    } else c.strokeStyle = base;
    c.beginPath();
    if (s.tool === 'line') { c.moveTo(x1, y1); c.lineTo(x2, y2); }
    else if (s.tool === 'rect') c.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    else c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    c.stroke();
    return;
  }
  const n = p.length / 2;
  const hue0 = hashId(s.id) % 360;
  const colorAt = (k) => (rainbow ? `hsl(${(hue0 + k * 5) % 360} 90% 55%)` : base);
  if (n === 1) {
    c.fillStyle = colorAt(0);
    c.beginPath(); c.arc(p[0], p[1], s.size / 2, 0, Math.PI * 2); c.fill();
    return;
  }
  const mx = (i) => (p[2 * i] + p[2 * i + 2]) / 2, my = (i) => (p[2 * i + 1] + p[2 * i + 3]) / 2;
  const piece = (k) => {
    if (k === 0) c.lineTo(mx(0), my(0));
    else if (k < n - 1) c.quadraticCurveTo(p[2 * k], p[2 * k + 1], mx(k), my(k));
    else c.lineTo(p[2 * k], p[2 * k + 1]);
  };
  const startPt = (k) => (k === 0 ? [p[0], p[1]] : [mx(k - 1), my(k - 1)]);
  const start = Math.max(0, from - 2);
  if (rainbow) {
    for (let k = start; k < n; k++) {
      c.beginPath(); c.strokeStyle = colorAt(k);
      c.moveTo(...startPt(k)); piece(k); c.stroke();
    }
  } else {
    c.strokeStyle = base;
    c.beginPath();
    c.moveTo(...startPt(start));
    for (let k = start; k < n; k++) piece(k);
    c.stroke();
  }
}
