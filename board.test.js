// Rendering contracts, exercised through the real board.js paint code with a
// small recording 2D context (tracks the transform and a pixel buffer).
import { expect, test } from 'bun:test';
import { W, H, STAMP_SHAPES } from './public/shared.js';
import { applyStroke, drawLiveStroke, drawStroke, floodRegion, paintPaper, paintThumb, setCanvasFactory, views } from './public/board.js';

class FakeCtx {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4).fill(255);
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.ops = [];
    this.strokes = [];
    this.globalAlpha = 1;
  }
  save() { this.stack.push({ m: [...this.m], a: this.globalAlpha }); }
  restore() { const s = this.stack.pop(); this.m = s.m; this.globalAlpha = s.a; }
  setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
  transform(a, b, c, d, e, f) {
    const [A, B, C, D, E, F] = this.m;
    this.m = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
  }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
  pt(x, y) { const [a, b, c, d, e, f] = this.m; return [a * x + c * y + e, b * x + d * y + f]; }
  moveTo(x, y) { this.ops.push(['pt', ...this.pt(x, y)]); }
  lineTo(x, y) { this.ops.push(['pt', ...this.pt(x, y)]); }
  quadraticCurveTo(cx, cy, x, y) { this.ops.push(['pt', ...this.pt(x, y)]); }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) { this.ops.push(['pt', ...this.pt(x, y)]); }
  arc(x, y) { this.ops.push(['pt', ...this.pt(x, y)]); }
  ellipse(x, y) { this.ops.push(['pt', ...this.pt(x, y)]); }
  rect(x, y, w, h) { this.ops.push(['pt', ...this.pt(x, y)], ['pt', ...this.pt(x + w, y + h)]); }
  beginPath() {} stroke() { this.strokes.push(this.strokeStyle); } fill() { this.strokes.push(this.fillStyle); } closePath() {}
  clip(rule) { this.ops.push(['clip', rule]); }
  createLinearGradient() { return { addColorStop() {} }; }
  fillRect(x, y, w, h) {
    // Paint a solid black block (or the white clear) into the pixel buffer.
    const v = this.fillStyle === '#fff' ? 255 : 0;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = (yy * this.w + xx) * 4;
      this.data[i] = this.data[i + 1] = this.data[i + 2] = v; this.data[i + 3] = 255;
    }
  }
  getImageData() { return { data: this.data }; }
  createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; }
  putImageData(img) { this.ops.push(['put']); this.img = img; }
  drawImage(src, x, y, w, h) {
    this.ops.push(['image', src, this.globalAlpha, ...this.pt(x, y), w ?? src.width, h ?? src.height]);
    const img = src.ctx.img;
    if (img && !w && this.m.join() === '1,0,0,1,0,0') {
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]) this.data.set(img.data.slice(i, i + 3), i);
    }
  }
}
const canvases = [];
setCanvasFactory((w, h) => {
  const cv = { width: w, height: h };
  cv.ctx = new FakeCtx(w, h);
  cv.getContext = () => cv.ctx;
  canvases.push(cv);
  return cv;
});
const pts = (ctx) => ctx.ops.filter((o) => o[0] === 'pt').map((o) => [o[1], o[2]]);

test('flood region stays inside walls', () => {
  const w = 10, h = 10, data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let i = 0; i < 10; i++) { const q = (4 * w + i) * 4; data[q] = data[q + 1] = data[q + 2] = 0; }
  const mask = floodRegion(data, 2, 2, [255, 0, 0], w, h);
  expect(mask.slice(0, 4 * w).every((v) => v === 1)).toBe(true);
  expect(mask.slice(4 * w).some((v) => v === 1)).toBe(false);
  expect(floodRegion(data, -1, 2, [255, 0, 0], w, h)).toBeNull();
});

test('mirrored strokes compose with a scaled context instead of escaping it', () => {
  const c = new FakeCtx(280, 210);
  c.scale(280 / W, 210 / H);
  drawStroke(c, { id: 'm', tool: 'line', size: 6, color: '#000000', pts: [100, 100, 200, 100], mirror: true });
  const got = pts(c).map(([x, y]) => [Math.round(x), Math.round(y)]);
  expect(got).toEqual([[28, 28], [56, 28], [252, 28], [224, 28]]);
  for (const [x, y] of got) { expect(x).toBeLessThanOrEqual(280); expect(y).toBeLessThanOrEqual(210); }
});

test('fill composites through drawImage so alpha and transforms apply', () => {
  const c = new FakeCtx(W, H);
  const chaos = { id: 'fade', seed: 1 };
  drawStroke(c, { id: 'f', tool: 'fill', color: '#ff0000', pts: [5, 5], t: 0 }, 0, { fade: true, chaos, gameMs: 7700 });
  const img = c.ops.find((o) => o[0] === 'image');
  expect(img).toBeTruthy();
  expect(img[2]).toBeGreaterThan(0);
  expect(img[2]).toBeLessThan(1);
  expect(c.ops.some((o) => o[0] === 'put')).toBe(false);
  const faded = new FakeCtx(W, H);
  drawStroke(faded, { id: 'f', tool: 'fill', color: '#ff0000', pts: [5, 5], t: 0 }, 0, { fade: true, chaos, gameMs: 60000 });
  expect(faded.ops).toEqual([]);
});

test('thumbnails rasterise fills at full size, then scale once', () => {
  const thumb = new FakeCtx(280, 210);
  const wall = { id: 'r', tool: 'rect', size: 4, color: '#000000', pts: [0, 0, 10, 10] };
  paintThumb(thumb, 280, 210, [wall, { id: 'f', tool: 'fill', color: '#ff0000', pts: [500, 400] }]);
  const [op] = thumb.ops;
  expect(op[0]).toBe('image');
  expect(op[1].width).toBe(W);
  expect(op.slice(3)).toEqual([0, 0, 280, 210]);
  const paper = op[1].ctx;
  const i = (400 * W + 500) * 4;
  expect([...paper.data.slice(i, i + 3)]).toEqual([255, 0, 0]);
});

test('server acks reconcile into the live stroke object and keep newer local points', () => {
  const cur = { id: 'me:1', tool: 'pen', pts: [1, 1, 2, 2, 3, 3] };
  const strokes = [cur];
  const merged = applyStroke(strokes, { id: 'me:1', tool: 'pen', pts: [1, 2], rainbow: true, by: 'me' });
  expect(merged).toBe(cur);
  expect(strokes).toEqual([cur]);
  expect(cur.pts).toEqual([1, 2, 2, 2, 3, 3]);
  expect(cur.rainbow).toBe(true);
  cur.pts.push(4, 4);
  expect(strokes[0].pts.slice(-2)).toEqual([4, 4]);
  const other = { id: 'them:1', tool: 'pen', pts: [9, 9] };
  applyStroke(strokes, other);
  expect(strokes[1]).toBe(other);
});

test('chaos stroke flags map to painted copies', () => {
  expect(views({})).toEqual([[1, 1, 0, 0, 1]]);
  expect(views({ kaleido: true })).toHaveLength(4);
  expect(views({ flipY: true })).toEqual([[1, -1, 0, H, 1]]);
  expect(views({ mirror: true, double: true }).map((v) => v[4])).toEqual([1, 0.35, 1, 0.35]);
  // Pancake squashes y into the middle half of the page.
  const [[, sy, , ty]] = views({ squish: true });
  expect([sy * 0 + ty, sy * H + ty]).toEqual([H / 4, (3 * H) / 4]);
});

test('forbidden zones clip canonical ink and survive thumbnail rendering', () => {
  const s = { id: 'z', tool: 'line', pts: [0, 100, 999, 100], size: 4, color: '#000000', forbidden: { x: 100, y: 90, w: 200, h: 150 } };
  const c = new FakeCtx(W, H);
  drawStroke(c, s);
  expect(c.ops).toEqual([['pt', 0, 0], ['pt', W, H], ['pt', 100, 90], ['pt', 300, 240], ['clip', 'evenodd'], ['pt', 0, 100], ['pt', 999, 100]]);
  const thumb = new FakeCtx(280, 210);
  paintThumb(thumb, 280, 210, [s]);
  expect(thumb.ops[0][1].ctx.ops.some((o) => o[0] === 'clip' && o[1] === 'evenodd')).toBe(true);
});

test('stamps draw all shapes with size and rotation from drag vector', () => {
  for (const shape of STAMP_SHAPES) {
    const c = new FakeCtx(W, H);
    drawStroke(c, { id: shape, tool: 'stamp', shape, pts: [100, 100, 200, 100], size: 4, color: '#000000' });
    expect(pts(c).length).toBeGreaterThan(0);
    for (const [x, y] of pts(c)) {
      expect(x).toBeGreaterThanOrEqual(99); expect(x).toBeLessThanOrEqual(201);
      expect(y).toBeGreaterThanOrEqual(99 - 50); expect(y).toBeLessThanOrEqual(151);
    }
  }
  // Rotating 90 degrees rotates the shape path around its center.
  const upright = new FakeCtx(W, H), rotated = new FakeCtx(W, H);
  drawStroke(upright, { id: 'h1', tool: 'stamp', shape: 'heart', pts: [100, 100, 200, 100], size: 4, color: '#000000' });
  drawStroke(rotated, { id: 'h2', tool: 'stamp', shape: 'heart', pts: [150, 50, 150, 150], size: 4, color: '#000000' });
  expect(pts(rotated).map(([x, y]) => [Math.round(x), Math.round(y)]))
    .not.toEqual(pts(upright).map(([x, y]) => [Math.round(x), Math.round(y)]));
  const c = new FakeCtx(W, H);
  drawStroke(c, { id: 'left', tool: 'stamp', shape: 'arrow', pts: [200, 200, 100, 100], size: 4, color: '#000000' });
  expect(pts(c).slice(0, 2).map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual([[200, 200], [100, 100]]);
});

test('Gravity Ink slides strokes down deterministically across live and gallery renders', () => {
  const s = { id: 'g', tool: 'line', size: 4, color: '#000000', pts: [100, 100, 200, 100], t: 1000, gravity: true };
  const live = new FakeCtx(W, H);
  drawStroke(live, s, 0, { gameMs: 6000 });
  expect(pts(live)).toEqual([[100, 150], [200, 150]]);
  const thumb = new FakeCtx(280, 210);
  paintThumb(thumb, 280, 210, [s], { gameMs: 6000 });
  expect(pts(thumb.ops[0][1].ctx).slice(-2)).toEqual([[100, 150], [200, 150]]);
});

test('Decoy Doodle renders decoys again after erasers so they cannot be erased', () => {
  const c = new FakeCtx(W, H);
  const decoy = { id: 'decoy:0', by: null, tool: 'line', size: 10, color: '#1d1b1a', pts: [10, 10, 50, 50], decoy: true };
  const eraser = { id: 'p:1', by: 'p', tool: 'eraser', size: 20, color: '#000000', pts: [10, 10, 50, 50] };
  paintPaper(c, [decoy, eraser]);
  expect(c.strokes).toEqual(['#1d1b1a', '#ffffff', '#1d1b1a']);
});

test('live incremental strokes leave decoys on top, as a full repaint does', () => {
  const decoy = { id: 'decoy:0', by: null, tool: 'line', size: 10, color: '#1d1b1a', pts: [10, 10, 50, 50], decoy: true };
  const white = { id: 'p:1', by: 'p', tool: 'line', size: 20, color: '#ffffff', pts: [10, 10, 50, 50] };
  const eraser = { id: 'p:2', by: 'p', tool: 'eraser', size: 20, color: '#000000', pts: [10, 10, 50, 50] };
  const strokes = [decoy, white, eraser];
  const live = new FakeCtx(W, H), full = new FakeCtx(W, H);
  drawLiveStroke(live, strokes, decoy);
  drawLiveStroke(live, strokes, white);
  drawLiveStroke(live, strokes, eraser);
  paintPaper(full, strokes);
  expect(live.strokes.at(-1)).toBe('#1d1b1a');
  expect(full.strokes.at(-1)).toBe('#1d1b1a');
  // A decoy itself is not drawn twice by the live path.
  expect(live.strokes.slice(0, 1)).toEqual(['#1d1b1a']);
  expect(live.strokes[1]).toBe('#ffffff');
});
