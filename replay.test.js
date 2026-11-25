// Pure replay timeline and clip helpers, plus the recorder lifecycle against stubs.
import { expect, test } from 'bun:test';
import {
  orderStrokes, buildTimeline, frameAt, partialStroke, strokesAt, clipPlan, clipName, pickMime, recordSegments, CLIP_MS,
} from './public/replay.js';

const pen = (id, t, pts) => ({ id, t, tool: 'pen', color: '#000000', size: 6, pts });

test('strokes replay in saved start-time order; ties keep canvas order', () => {
  const a = pen('a', 300, [0, 0]), b = pen('b', 100, [0, 0]), c = pen('c', 100, [1, 1]), d = pen('d', undefined, [2, 2]);
  expect(orderStrokes([a, b, c]).map((s) => s.id)).toEqual(['b', 'c', 'a']);
  expect(orderStrokes([d, a]).map((s) => s.id)).toEqual(['d', 'a']);
});

test('timeline plays strokes one after another at an even pace with capped idle time', () => {
  const strokes = [
    pen('a', 0, [0, 0, 120, 0]),            // 120 px
    pen('b', 500, [0, 0, 240, 0]),          // 240 px, starts after a short pause
    pen('c', 60000, [0, 0, 120, 0]),        // a minute later: idle is compressed
    { id: 'f', t: 60100, tool: 'fill', color: '#ff0000', size: 6, pts: [5, 5] },
  ];
  const { items, total } = buildTimeline(strokes);
  expect(items[1].dur).toBeCloseTo(items[0].dur * 2, 5);
  for (let i = 1; i < items.length; i++) expect(items[i].start).toBeGreaterThanOrEqual(items[i - 1].start + items[i - 1].dur);
  expect(items[1].start - (items[0].start + items[0].dur)).toBe(400);   // 500 ms gap minus 100 ms drawing
  expect(items[2].start - (items[1].start + items[1].dur)).toBe(600);   // capped
  expect(items[3].dur).toBe(0);
  expect(total).toBe(items[3].start);
  expect(buildTimeline([])).toEqual({ items: [], total: 0 });
});

test('frames grow monotonically from blank to the finished drawing', () => {
  const strokes = orderStrokes([pen('a', 0, [0, 0, 100, 0, 100, 100]), pen('b', 900, [10, 10]), { id: 'r', t: 1200, tool: 'rect', color: '#000000', size: 6, pts: [0, 0, 40, 20] }]);
  const tl = buildTimeline(strokes);
  expect(strokesAt(strokes, tl, 0)).toEqual([]);
  expect(strokesAt(strokes, tl, tl.total)).toEqual(strokes);
  expect(strokesAt(strokes, tl, tl.total + 5000)).toEqual(strokes);
  let lastDone = 0;
  for (let ms = 0; ms <= tl.total; ms += 7) {
    const f = frameAt(tl, ms);
    expect(f.done).toBeGreaterThanOrEqual(lastDone);
    lastDone = f.done;
    if (f.partial) expect(f.partial.frac).toBeGreaterThan(0), expect(f.partial.frac).toBeLessThan(1);
  }
  // Halfway through the first stroke the pen is at the corner (100 px of 200).
  const mid = strokesAt(strokes, tl, tl.items[0].dur / 2);
  expect(mid.length).toBe(1);
  expect(mid[0].pts.slice(-2)).toEqual([100, 0]);
});

test('partial strokes cut paths by distance and grow shapes from their anchor', () => {
  const s = pen('a', 0, [0, 0, 100, 0, 100, 100]);
  expect(partialStroke(s, 0.25).pts).toEqual([0, 0, 50, 0]);
  expect(partialStroke(s, 0.75).pts).toEqual([0, 0, 100, 0, 100, 50]);
  expect(partialStroke(s, 1)).toBe(s);
  expect(partialStroke({ ...s, tool: 'line', pts: [10, 10, 30, 50] }, 0.5).pts).toEqual([10, 10, 20, 30]);
  const fill = { id: 'f', tool: 'fill', pts: [1, 1] };
  expect(partialStroke(fill, 0.3)).toBe(fill);
});

test('clips last about 6 s, never under 1 s or over 12 s, and never play slower than 1×', () => {
  const long = clipPlan(60000);
  expect(long.ms).toBeCloseTo(CLIP_MS, 5);
  expect(long.speed).toBeGreaterThan(1);
  const tiny = clipPlan(50);
  expect(tiny.speed).toBe(1);
  expect(tiny.ms).toBe(1000);
  expect(clipPlan(3000).speed).toBe(1);
  for (const t of [0, 1, 999, 5000, 1e6]) {
    const p = clipPlan(t);
    expect(p.ms).toBeGreaterThanOrEqual(1000);
    expect(p.ms).toBeLessThanOrEqual(12000);
  }
});

test('clip filenames are sanitised', () => {
  expect(clipName('Ice Cream', 'Raja', 'mp4')).toBe('ice-cream-by-raja.mp4');
  expect(clipName('../../etc/passwd', 'A/B:C*?', 'webm')).toBe('etc-passwd-by-a-b-c.webm');
  expect(clipName('', '🎨', 'mp4')).toBe('drawing-by-someone.mp4');
  expect(clipName('café', 'Zoë', 'mp4')).toBe('café-by-zoë.mp4');
  expect(clipName('x'.repeat(90), 'y', 'mp4').length).toBeLessThan(60);
});

test('recorder format prefers MP4, falls back to WebM, and reports none when unsupported', () => {
  expect(pickMime(() => true)).toEqual({ mime: 'video/mp4;codecs=avc1', ext: 'mp4' });
  expect(pickMime((m) => m.startsWith('video/webm'))).toEqual({ mime: 'video/webm;codecs=vp9', ext: 'webm' });
  expect(pickMime((m) => m === 'video/webm')).toEqual({ mime: 'video/webm', ext: 'webm' });
  expect(pickMime(() => false)).toBe(null);
  expect(pickMime(() => { throw new Error('nope'); })).toBe(null);
});

// Minimal recorder doubles: a canvas whose stream counts live tracks, and a
// MediaRecorder that fires onstop asynchronously like the real one.
function stubRecorder({ failCtor = false } = {}) {
  const log = { streams: 0, recorders: 0, live: 0, stopped: 0 };
  const saved = { document: globalThis.document, MediaRecorder: globalThis.MediaRecorder };
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({ setTransform() {}, fillRect() {}, drawImage() {}, save() {}, restore() {} }),
      captureStream: () => {
        log.streams++; log.live++;
        const track = { stop() { if (!this.done) { this.done = true; log.live--; } } };
        return { getTracks: () => [track] };
      },
    }),
  };
  globalThis.MediaRecorder = class {
    static isTypeSupported(m) { return m === 'video/webm'; }
    constructor() { if (failCtor) throw new Error('no encoder'); log.recorders++; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; log.stopped++; setTimeout(() => this.onstop?.(), 0); }
  };
  return { log, restore: () => Object.assign(globalThis, saved) };
}
const seg = (ms) => [{ ms, paint() {} }];

test('an already-aborted recording rejects without opening a stream', async () => {
  const { log, restore } = stubRecorder();
  try {
    const ctl = new AbortController(); ctl.abort();
    const err = await recordSegments(seg(1000), { signal: ctl.signal }).catch((e) => e);
    expect(err.name).toBe('AbortError');
    expect(log.streams).toBe(0); expect(log.recorders).toBe(0);
  } finally { restore(); }
});

test('cancelling mid-recording rejects at once and stops recorder and tracks', async () => {
  const { log, restore } = stubRecorder();
  try {
    const ctl = new AbortController();
    const p = recordSegments(seg(60000), { signal: ctl.signal });
    ctl.abort();
    const err = await p.catch((e) => e);
    expect(err.name).toBe('AbortError');
    expect(log.stopped).toBe(1); expect(log.live).toBe(0);
  } finally { restore(); }
});

test('a recorder setup failure rejects and stops the capture track', async () => {
  const { log, restore } = stubRecorder({ failCtor: true });
  try {
    const err = await recordSegments(seg(1000)).catch((e) => e);
    expect(err.message).toBe('no encoder');
    expect(log.streams).toBe(1); expect(log.live).toBe(0);
  } finally { restore(); }
});

test('a finished recording resolves a clip and releases its tracks', async () => {
  const { log, restore } = stubRecorder();
  try {
    const clip = await recordSegments(seg(30));
    expect(clip.ext).toBe('webm'); expect(clip.mime).toBe('video/webm');
    expect(log.stopped).toBe(1); expect(log.live).toBe(0);
  } finally { restore(); }
});
