import { expect, test } from 'bun:test';
import {
  W, H, GALLERY_COORDS, CHAOS_MODES,
  validateStroke, strokeId, applyChaos, pickChaos,
  guesserPts, drawerPts, timeFrac, tiedRanking, podiumGroups,
  allowedTool, canUndo, fadeAlpha, galleryStrokes, clientClock, jitter, jitterPts,
  inkCost, trimInk, turnProgress, viewStrength, STAMP_SHAPES, stampBounds, forbiddenZone, shrinkingSize, slipperyPts,
} from './public/shared.js';

test('stamp shapes and bounds are validated without enabling stamps in ordinary turns', () => {
  for (const shape of STAMP_SHAPES) {
    const s = validateStroke({ id: 's', tool: 'stamp', shape, pts: [0, 0, 0, 0] });
    expect(s.ok).toBe(true); expect(s.shape).toBe(shape);
  }
  expect(validateStroke({ id: 's', tool: 'stamp', shape: 'script', pts: [0, 0, 0, 0] }).ok).toBe(false);
  expect(allowedTool(null, 'stamp')).toBe(false);
  expect(allowedTool({ id: 'stamps' }, 'pen')).toBe(false);
  expect(stampBounds([0, 0, 0, 0])).toEqual([0, 0, 80, 80]);
  expect(stampBounds([999, 749, 999, 749])).toEqual([919, 669, 999, 749]);
  expect(stampBounds([900, 700, 100, 100])).toEqual([900, 700, 660, 460]);
  for (const shape of ['circle', 'square']) expect(stampBounds([100, 100, 220, 150], shape)).toEqual([100, 100, 220, 220]);
});

test('slippery paths are continuous across packet boundaries and stay close to the pointer', () => {
  const raw = [10, 10, 12, 15, 500, 600, 520, 640, 550, 610];
  const full = slipperyPts(raw), head = slipperyPts(raw.slice(0, 6));
  expect([...head, ...slipperyPts(raw.slice(6), head.slice(-2))]).toEqual(full);
  expect(full.slice(0, 2)).toEqual([10, 10]);
  for (let i = 0; i < raw.length; i += 2) expect(Math.hypot(raw[i] - full[i], raw[i + 1] - full[i + 1])).toBeLessThanOrEqual(18.000001);
  expect(full).not.toEqual(raw);
});

test('new artist restrictions and deterministic drawing parameters are bounded', () => {
  for (const [id, allowed] of [['straight', ['line']], ['shrinking', ['pen']], ['slippery', ['pen', 'eraser']]]) {
    for (const tool of ['pen', 'eraser', 'fill', 'line', 'rect', 'ellipse', 'stamp']) expect(allowedTool({ id }, tool)).toBe(allowed.includes(tool));
  }
  expect(allowedTool({ id: 'forbidden' }, 'fill')).toBe(false);
  expect([shrinkingSize(0, 60000), shrinkingSize(30000, 60000), shrinkingSize(90000, 60000)]).toEqual([22, 13, 4]);
  for (const seed of [0, 12, 10000, 0xffffffff]) {
    const z = forbiddenZone(seed);
    expect(z).toEqual(forbiddenZone(seed));
    expect(z.x).toBeGreaterThan(0); expect(z.x + z.w).toBeLessThan(W);
    expect(z.y).toBeGreaterThan(0); expect(z.y + z.h).toBeLessThan(H);
  }
});

test('ellipse and fill coordinate contracts', () => {
  expect(validateStroke({ id: 'a', tool: 'ellipse', pts: [100, 100] }).ok).toBe(false);
  expect(validateStroke({ id: 'a', tool: 'ellipse', pts: [100, 100, 200, 180] }).ok).toBe(true);
  expect(validateStroke({ id: 'a', tool: 'fill', pts: [10, 10] }).ok).toBe(true);
  expect(validateStroke({ id: 'a', tool: 'fill', pts: [10, 10, 20, 20] }).ok).toBe(false);
  expect(validateStroke({ id: 'a', tool: 'pen', pts: [1] }).ok).toBe(false);
  expect(validateStroke({ id: 'a', tool: 'pen', pts: [1, 'x'] }).ok).toBe(false);
  expect(validateStroke({ id: 'a', tool: 'pen', pts: [1, NaN] }).ok).toBe(false);
  expect(validateStroke({ tool: 'pen', pts: [1, 2] }).ok).toBe(false);
  expect(validateStroke({ id: 'a', tool: 'pen', pts: [1e9, -1e9] }).pts).toEqual([W - 1, 0]);
  expect(validateStroke({ id: 'a', tool: 'fill', pts: [-3, H + 9] }).pts).toEqual([0, H - 1]);
});

test('ink measures geometry and clips a freehand segment at the remaining distance', () => {
  expect(inkCost({ tool: 'pen', size: 6, pts: [0, 0, 3, 4] })).toBe(11);
  expect(inkCost({ tool: 'pen', size: 6, pts: [3, 4] }, [0, 0])).toBe(5);
  expect(inkCost({ tool: 'rect', size: 6, pts: [10, 10, 110, 60] })).toBe(300);
  expect(inkCost({ tool: 'ellipse', size: 6, pts: [0, 0, 100, 100] })).toBeCloseTo(Math.PI * 100);
  expect(trimInk([3, 4, 6, 8], 7, [0, 0])).toEqual({ pts: [3, 4, 4.2, 5.6], cost: 7, clipped: true });
  expect(trimInk([10, 10, 13, 14], 5)).toEqual({ pts: [10, 10, 13, 14], cost: 5, clipped: false });
  expect(trimInk([3, 4], 0, [0, 0])).toEqual({ pts: [], cost: 0, clipped: true });
  expect(allowedTool({ id: 'inkbudget' }, 'fill')).toBe(false);
  expect(allowedTool({ id: 'inkbudget' }, 'eraser')).toBe(true);
  expect(allowedTool({ id: 'fivestrokes' }, 'line')).toBe(false);
});

test('guesser views clear for the final third and use the current deadline', () => {
  expect(turnProgress(0, 80000)).toBe(0);
  expect(turnProgress(40000, 40000)).toBe(0.5);
  expect(turnProgress(10000, 25000)).toBeCloseTo(2 / 7);
  expect(viewStrength(0, 80000)).toBe(1);
  expect(viewStrength(40000, 40000)).toBe(0.25);
  expect(viewStrength(54000, 26000)).toBe(0);
  expect(viewStrength(80000, 0)).toBe(0);
  expect(viewStrength(0, 0)).toBe(0);
});

test('stroke ids are owner-prefixed and stable', () => {
  expect(strokeId('abc', 'x1')).toBe('abc:x1');
  expect(strokeId('abc', 'abc:x1')).toBe('abc:x1');
  expect(strokeId('abc', '')).toBe('');
  expect(strokeId('abc', 'x y<>')).toBe('abc:xy');
});

test('rainbow ink does not mark erasers', () => {
  const tw = { id: 'rainbow' };
  const pen = applyChaos({ tool: 'pen', color: '#ff0000', size: 8 }, tw);
  const eraser = applyChaos({ tool: 'eraser', color: '#ff0000', size: 8 }, tw);
  expect(pen.rainbow).toBe(true);
  expect(eraser.rainbow).toBeUndefined();
  expect(eraser.color).toBe('#ff0000');
});

test('chaos pays a bonus; speedrun pays most; no chaos pays base', () => {
  const at = (chaos) => guesserPts({ elapsed: 0, scoreLen: 80000, diff: 'easy', chaos, streak: 1 });
  expect(at(null)).toBe(300);
  expect(at({ id: 'mirror' })).toBe(360);
  expect(at({ id: 'speed' })).toBe(450);
  expect(guesserPts({ elapsed: 80000, scoreLen: 80000, diff: 'easy', chaos: null, streak: 3 })).toBe(120 + 30);
});

test('scoring is forgiving: grace window, whole seconds, no first-guess cliff', () => {
  const pts = (elapsed) => guesserPts({ elapsed, scoreLen: 80000, diff: 'medium', chaos: null, streak: 1 });
  // Anything in the first 15% of the turn scores the maximum.
  expect(pts(0)).toBe(pts(11999));
  // A millisecond apart never changes points.
  for (const t of [12500, 30001, 47500, 79000]) expect(pts(t + 1)).toBe(pts(t));
  // Each later second costs only a few points, and the floor stays high.
  expect(pts(30000) - pts(31000)).toBeLessThanOrEqual(4);
  expect(pts(80000)).toBe(Math.round(120 * 1.3));
  expect(timeFrac(46000, 80000)).toBeCloseTo(1 - 34000 / 68000);
});

test('chaos tool rules and stroke effects', () => {
  expect(allowedTool({ id: 'shapes' }, 'pen')).toBe(false);
  expect(allowedTool({ id: 'shapes' }, 'rect')).toBe(true);
  expect(allowedTool({ id: 'permanent' }, 'eraser')).toBe(false);
  expect(canUndo({ id: 'permanent' })).toBe(false);
  expect(canUndo({ id: 'mirror' })).toBe(true);
  expect(applyChaos({ tool: 'pen', size: 8 }, { id: 'giant' }).size).toBe(44);
  const one = { id: 'onecolor', seed: 77 };
  expect(applyChaos({ id: 'a', tool: 'pen', color: '#000000' }, one).color)
    .toBe(applyChaos({ id: 'b', tool: 'line', color: '#ffffff' }, one).color);
  expect(applyChaos({ tool: 'pen' }, { id: 'upside' }).flipY).toBe(true);
  expect(applyChaos({ tool: 'fill' }, { id: 'dotted' }).dotted).toBeUndefined();
  expect(CHAOS_MODES.length).toBeGreaterThanOrEqual(20);
  expect(new Set(CHAOS_MODES.map((c) => c.id)).size).toBe(CHAOS_MODES.length);
});

test('pickChaos never repeats the previous chaos', () => {
  for (let seed = 1; seed < 200; seed++) {
    for (const prev of CHAOS_MODES.map((t) => t.id)) expect(pickChaos(seed, prev).id).not.toBe(prev);
  }
});

test('drawer score is a fraction of eligible guessers', () => {
  expect(drawerPts({ solved: 1, eligible: 1, diff: 'easy', chaos: null })).toBe(180);
  expect(drawerPts({ solved: 1, eligible: 8, diff: 'easy', chaos: null })).toBe(23);
  expect(drawerPts({ solved: 0, eligible: 3, diff: 'easy', chaos: null })).toBe(0);
  expect(drawerPts({ solved: 0, eligible: 0, diff: 'easy', chaos: null })).toBe(0);
});

test('tied ranking: shared places, everyone on the results exactly once', () => {
  const mk = (id, score) => ({ id, name: id, avatar: '🦊', color: '#000', score });
  const r = tiedRanking([mk('a', 300), mk('b', 200), mk('c', 200), mk('d', 100)]);
  expect(r.map((p) => p.rank)).toEqual([1, 2, 2, 4]);
  const { podium, rest } = podiumGroups(r);
  expect(podium.map((g) => [g.rank, g.players.map((p) => p.id)])).toEqual([[1, ['a']], [2, ['b', 'c']]]);
  expect(rest.map((p) => p.id)).toEqual(['d']);
  const shown = [...podium.flatMap((g) => g.players), ...rest].map((p) => p.id).sort();
  expect(shown).toEqual(['a', 'b', 'c', 'd']);
  const zero = podiumGroups(tiedRanking([mk('a', 0), mk('b', 0), mk('c', 0), mk('d', 0)]));
  expect(zero.podium).toHaveLength(1);
  expect(zero.podium[0].players).toHaveLength(4);
  expect(zero.rest).toEqual([]);
});

test('tool rules: one line is pen only, ghost ink has no fill', () => {
  expect(['pen', 'eraser', 'fill', 'line'].filter((t) => allowedTool({ id: 'onestroke' }, t))).toEqual(['pen']);
  expect(allowedTool({ id: 'fade' }, 'fill')).toBe(false);
  expect(allowedTool({ id: 'fade' }, 'eraser')).toBe(true);
  expect(allowedTool(null, 'fill')).toBe(true);
  expect(allowedTool(null, 'stamp')).toBe(false);
});

test('client clock freezes while paused', () => {
  const S = { timeLeft: 30000, gameMs: 5000, paused: null };
  expect(clientClock(S, 1000, 3000)).toEqual({ left: 28000, gameMs: 7000 });
  expect(clientClock({ ...S, paused: { reason: 'x' } }, 1000, 60000)).toEqual({ left: 30000, gameMs: 5000 });
  expect(clientClock(S, 1000, 99999).left).toBe(0);
});

test('shaky jitter is deterministic, bounded, and index-addressed', () => {
  expect(jitter('p:1', 3)).toEqual(jitter('p:1', 3));
  const all = jitterPts('p:1', [0, 0, 10, 10, 20, 20]);
  expect(jitterPts('p:1', [10, 10, 20, 20], 1)).toEqual(all.slice(2));
  for (const v of all.map((n, i) => n - [0, 0, 10, 10, 20, 20][i])) expect(Math.abs(v)).toBeLessThanOrEqual(7);
});

test('ghost ink stays, then fades out', () => {
  expect(fadeAlpha(8000, 8000)).toBe(1);
  expect(fadeAlpha(9000, 8000)).toBeLessThan(1);
  expect(fadeAlpha(20000, 8000)).toBe(0);
});

test('gallery keeps every stroke and its true endpoint within a bounded budget', () => {
  const zig = (n, y0) => Array.from({ length: n }, (_, i) => (i % 2 ? y0 + (i % 7) : i % 991));
  const strokes = Array.from({ length: 2500 }, (_, k) => ({ id: `s${k}`, tool: 'pen', pts: zig(k < 10 ? 8000 : 20, k) }));
  strokes.push({ id: 'last', tool: 'pen', pts: [5, 5, 6, 6, 7, 400] });
  const kept = galleryStrokes(strokes);
  expect(kept).toHaveLength(strokes.length);
  expect(kept.at(-1).pts.slice(-2)).toEqual([7, 400]);
  for (let k = 0; k < 10; k++) expect(kept[k].pts.slice(-2)).toEqual(strokes[k].pts.slice(-2));
  expect(kept.reduce((n, s) => n + s.pts.length, 0)).toBeLessThan(GALLERY_COORDS * 2.5);
  const small = [{ id: 'a', tool: 'pen', pts: [1, 2, 3, 4] }];
  expect(galleryStrokes(small)).toBe(small);
});
