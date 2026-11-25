// Gallery replays and video clips. The timeline maths at the top is pure, so
// it is unit-tested without a canvas; rendering goes through board.js, so a
// replay's chaos effects (mirror, kaleido, rainbow, …) match the live board.
import { W, H, CHAOS_MODES } from './shared.js';
import { drawStroke, paintPaper } from './board.js';

export const SPEEDS = [1, 2, 4, 8];
const PEN_PX_PER_MS = 1.2;   // even drawing pace for pen and eraser
const MIN_DRAW_MS = 60;      // a dot still visibly appears
const MAX_DRAW_MS = 2500;    // one huge scribble never stalls the replay
const SHAPE_MS = 240;        // lines, boxes, ellipses and stamps grow from their anchor
const MAX_IDLE_MS = 600;     // long thinking pauses are compressed to this
const NO_TIME_GAP_MS = 120;  // gap used when a stroke has no saved time
export const CLIP_MS = 6000, REEL_CLIP_MS = 4000, CARD_MS = 1000, HOLD_MS = 700;
const CLIP_MIN_MS = 1000, CLIP_MAX_MS = 12000;

const isPath = (s) => s.tool === 'pen' || s.tool === 'eraser' || !s.tool;
const isShape = (s) => ['line', 'rect', 'ellipse', 'stamp'].includes(s.tool);

function pathLength(p) {
  let len = 0;
  for (let i = 2; i < p.length; i += 2) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return len;
}

// Strokes in order of saved start time `t`. The sort is stable, so equal or
// missing times keep canvas order (and canvas order already follows `t`).
export function orderStrokes(strokes) {
  return strokes.map((s, i) => [s, i]).sort(([a, i], [b, j]) => (a.t ?? 0) - (b.t ?? 0) || i - j).map(([s]) => s);
}

// One entry per stroke: when it starts and how long it takes to draw, in replay
// ms at 1×. Strokes play one after another; the pause between two follows the
// real pause (start gap minus drawing time), capped so idle time stays short.
export function buildTimeline(ordered) {
  const items = [];
  let at = 0;
  ordered.forEach((s, i) => {
    const dur = isPath(s) && s.pts.length > 2 ? Math.min(MAX_DRAW_MS, Math.max(MIN_DRAW_MS, pathLength(s.pts) / PEN_PX_PER_MS))
      : isShape(s) ? SHAPE_MS : isPath(s) ? MIN_DRAW_MS : 0;
    if (i > 0) {
      const prev = ordered[i - 1], last = items[i - 1];
      const gap = s.t != null && prev.t != null ? s.t - prev.t - last.dur : NO_TIME_GAP_MS;
      at += Math.max(40, Math.min(MAX_IDLE_MS, gap));
    }
    items.push({ start: at, dur });
    at += dur;
  });
  return { items, total: at };
}

// How far the replay is at `ms`: `done` strokes are complete; `partial` is the
// stroke being drawn and the fraction of it on paper.
export function frameAt(tl, ms) {
  let done = 0;
  while (done < tl.items.length && tl.items[done].start + tl.items[done].dur <= ms) done++;
  const it = tl.items[done];
  const partial = it && ms > it.start ? { i: done, frac: (ms - it.start) / it.dur } : null;
  return { done, partial };
}

// The visible part of a stroke `frac` of the way through drawing it: paths
// cut at an even distance along their length, shapes grown from the anchor.
export function partialStroke(s, frac) {
  if (frac >= 1) return s;
  const p = s.pts;
  if (isShape(s)) {
    const [x1, y1, x2, y2] = p;
    return { ...s, pts: [x1, y1, x1 + (x2 - x1) * frac, y1 + (y2 - y1) * frac] };
  }
  if (!isPath(s) || p.length <= 2) return s;
  let left = pathLength(p) * Math.max(0, frac);
  const out = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const seg = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    if (seg >= left) {
      const f = seg ? left / seg : 1;
      out.push(p[i - 2] + (p[i] - p[i - 2]) * f, p[i - 1] + (p[i + 1] - p[i - 1]) * f);
      break;
    }
    left -= seg;
    out.push(p[i], p[i + 1]);
  }
  return { ...s, pts: out };
}

// Every stroke visible at `ms`, the last one possibly cut short.
export function strokesAt(ordered, tl, ms) {
  const { done, partial } = frameAt(tl, ms);
  const list = ordered.slice(0, done);
  if (partial) list.push(partialStroke(ordered[partial.i], partial.frac));
  return list;
}

// Playback speed and length for a downloaded clip: about `target` ms of
// drawing plus a short hold on the finished picture, never slower than 1×,
// and always 1–12 s long.
export function clipPlan(total, target = CLIP_MS) {
  const speed = Math.max(1, total / Math.max(1, target - HOLD_MS));
  const ms = Math.min(CLIP_MAX_MS, Math.max(CLIP_MIN_MS, total / speed + HOLD_MS));
  return { speed, ms };
}

// "<word>-by-<name>.<ext>", safe on every OS and still readable.
export function clipName(word, name, ext) {
  const safe = (v, fb) => String(v || '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || fb;
  return `${safe(word, 'drawing')}-by-${safe(name, 'someone')}.${ext}`;
}

// First container the browser can record. MP4 plays everywhere a clip gets
// shared, so it wins when offered.
const MIMES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
export function pickMime(isSupported) {
  const mime = MIMES.find((m) => { try { return isSupported(m); } catch { return false; } });
  return mime ? { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' } : null;
}

export function recordingSupported() {
  return typeof MediaRecorder === 'function' && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
    && !!pickMime((m) => MediaRecorder.isTypeSupported?.(m));
}

const paperCanvas = () => {
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  return [cv, cv.getContext('2d', { willReadFrequently: true })];
};

// Paints a replay frame onto a W×H context. Completed strokes are kept on a
// cache canvas and only new ones are added, so playback costs one stroke per
// frame; scrubbing backwards rebuilds the cache. A game reel passes one shared
// cache to every drawing's renderer; whoever drew last owns its contents.
export class ReplayRenderer {
  constructor(strokes, cache = null) {
    this.strokes = orderStrokes(strokes || []);
    this.tl = buildTimeline(this.strokes);
    this.cache = cache;
    this.doneN = 0;
  }

  get total() { return this.tl.total; }

  draw(ctx, ms) {
    const { done, partial } = frameAt(this.tl, ms);
    const k = (this.cache ||= {});
    if (!k.cv) [k.cv, k.c] = paperCanvas();
    if (k.owner !== this || done < this.doneN) { paintPaper(k.c, this.strokes.slice(0, done)); this.doneN = done; k.owner = this; }
    for (; this.doneN < done; this.doneN++) drawStroke(k.c, this.strokes[this.doneN]);
    ctx.drawImage(k.cv, 0, 0);
    if (partial) drawStroke(ctx, partialStroke(this.strokes[partial.i], partial.frac));
  }
}

// Play/pause/speed/seek for the lightbox. `onFrame(ms, playing, total)` fires after
// each painted frame so the controls can follow.
export class ReplayPlayer {
  constructor(canvas, strokes, onFrame = () => {}) {
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.r = new ReplayRenderer(strokes);
    this.onFrame = onFrame;
    this.ms = 0; this.speed = 1; this.playing = false; this.raf = 0; this.last = 0;
    this.seek(0);
  }

  get total() { return this.r.total; }

  play() {
    if (this.playing) return;
    if (this.ms >= this.total) this.ms = 0;
    this.playing = true; this.last = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      this.ms = Math.min(this.total, this.ms + (now - this.last) * this.speed);
      this.last = now;
      if (this.ms >= this.total) this.playing = false;
      this.paint();
      if (this.playing) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.paint();
  }

  pause() { this.playing = false; cancelAnimationFrame(this.raf); this.paint(); }
  seek(ms) { this.ms = Math.max(0, Math.min(this.total, ms)); this.last = performance.now(); this.paint(); }
  paint() { this.r.draw(this.ctx, this.ms); this.onFrame(this.ms, this.playing, this.total); }
  destroy() { this.playing = false; cancelAnimationFrame(this.raf); }
}

// The whole gallery back to back, each drawing after a title card.
export function reelSegments(gallery) {
  const cache = {};
  return gallery.flatMap((g, index) => drawingSegments(g, { target: REEL_CLIP_MS, card: { index, count: gallery.length }, cache }));
}

// Draws a drawing's title card for the game reel: word, artist and the turn's
// challenges, in the game's paper-and-ink style.
export function drawTitleCard(c, g, index, count) {
  const ink = '#1d1b1a', font = '"Bricolage Grotesque", ui-rounded, "Trebuchet MS", sans-serif';
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#f6f0e4'; c.fillRect(0, 0, W, H);
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = ink;
  c.font = `700 34px "Caveat", "Comic Sans MS", cursive`;
  c.fillText(`drawing ${index + 1} of ${count}`, W / 2, 200);
  c.font = `800 ${g.word.length > 14 ? 72 : 104}px ${font}`;
  c.fillText(g.word, W / 2, 320, W - 120);
  c.font = `700 40px ${font}`;
  c.fillText(`by ${g.drawer?.avatar || ''} ${g.drawer?.name || 'someone'}`.replace(/\s+/g, ' '), W / 2, 420, W - 120);
  const icon = (m) => CHAOS_MODES.find((x) => x.id === m.id)?.icon || '🌀';
  const tags = [g.deck?.name || (typeof g.deck === 'string' ? g.deck : null), ...[g.chaos, g.guesserChaos].filter(Boolean).map((m) => `${icon(m)} ${m.name || m.id}`)].filter(Boolean);
  if (tags.length) {
    c.font = `700 30px ${font}`; c.fillStyle = '#5d574f';
    c.fillText(tags.join('  ·  '), W / 2, 500, W - 120);
  }
  c.font = `800 30px ${font}`; c.fillStyle = ink;
  c.fillText('squiggle.', W / 2, H - 70);
  c.restore();
}

// Segments for one drawing: its replay squeezed to `target` ms, then a hold
// on the finished picture. A reel prefixes each drawing with a title card.
export function drawingSegments(g, { target = CLIP_MS, card = null, cache = null } = {}) {
  const r = new ReplayRenderer(g.strokes, cache);
  const plan = clipPlan(r.total, target);
  const segs = [];
  if (card) segs.push({ ms: CARD_MS, paint: (c) => drawTitleCard(c, g, card.index, card.count) });
  segs.push({ ms: plan.ms, paint: (c, t) => r.draw(c, Math.min(r.total, t * plan.speed)) });
  return segs;
}

// Records segments in real time from a hidden canvas: captureStream feeds a
// MediaRecorder while a timer paints frames. Timers (not rAF) keep it going in
// a background tab; times come from the wall clock, so a late tick never
// stretches the clip. Resolves { blob, mime, ext }; rejects with AbortError on
// cancel.
export function recordSegments(segments, { onProgress = () => {}, signal, fps = 30 } = {}) {
  return new Promise((resolve, reject) => {
    const picked = pickMime((m) => MediaRecorder.isTypeSupported(m));
    if (!picked) return reject(new Error('recording not supported'));
    const [cv, ctx] = paperCanvas();
    segments[0]?.paint(ctx, 0);
    const stream = cv.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: 4e6 });
    const chunks = [];
    const total = segments.reduce((n, s) => n + s.ms, 0);
    let timer = 0, aborted = false, t0 = 0;
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onerror = (e) => { clearTimeout(timer); stream.getTracks().forEach((t) => t.stop()); reject(e.error || new Error('recorder failed')); };
    rec.onstop = () => {
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      if (aborted) return reject(new DOMException('Recording cancelled', 'AbortError'));
      const type = picked.mime.split(';')[0];
      resolve({ blob: new Blob(chunks, { type }), mime: type, ext: picked.ext });
    };
    const abort = () => { aborted = true; if (rec.state !== 'inactive') rec.stop(); };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    const frame = () => {
      if (aborted) return;
      const el = Math.min(total, performance.now() - t0);
      let at = el, k = 0;
      while (k < segments.length - 1 && at >= segments[k].ms) at -= segments[k++].ms;
      segments[k]?.paint(ctx, Math.min(at, segments[k].ms));
      onProgress(total ? el / total : 1);
      if (el >= total) { signal?.removeEventListener('abort', abort); return rec.stop(); }
      timer = setTimeout(frame, 1000 / fps);
    };
    rec.start(500);
    t0 = performance.now();
    frame();
  });
}

// Hands a finished clip to the user. The share sheet needs a fresh tap (the
// one that started recording has expired), so when sharing files is possible
// this returns a `share` function for a button to call; otherwise it saves.
export function deliverClip({ blob, ext }, filename) {
  const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null;
  const save = () => {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  let canShare = false;
  try { canShare = !!(file && navigator.canShare?.({ files: [file] })); } catch {}
  if (!canShare) { save(); return { shared: false, save }; }
  return { shared: true, save, share: () => navigator.share({ files: [file], title: filename.replace(/\.\w+$/, '') }) };
}
