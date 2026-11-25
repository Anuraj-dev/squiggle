import { expect, test } from 'bun:test';
import {
  W, H, GALLERY_COORDS, CHAOS_MODES,
  validateStroke, strokeId, applyChaos, pickChaos, cleanChaosIds, CHAOS_IDS,
  guesserPts, drawerPts, allBonus, scoreMult, timeFrac, tiedRanking, podiumGroups,
  allowedTool, canUndo, fadeAlpha, galleryStrokes, clientClock, jitter, jitterPts,
  inkCost, trimInk, turnProgress, viewStrength, STAMP_SHAPES, stampBounds, forbiddenZone, shrinkingSize, slipperyPts,
  rotateHue, gravityOffset, strokeMaxY, decoyStrokes, recentInkCenter, macroView,
} from './public/shared.js';

test('stamp shapes and bounds are validated without enabling stamps in ordinary turns', () => {
  expect(STAMP_SHAPES).toEqual(['circle', 'triangle', 'square', 'arrow', 'star', 'heart', 'moon', 'cloud', 'bolt', 'eye']);
  for (const shape of STAMP_SHAPES) {
    const s = validateStroke({ id: 's', tool: 'stamp', shape, pts: [0, 0, 0, 0] });
    expect(s.ok).toBe(true); expect(s.shape).toBe(shape);
  }
  expect(validateStroke({ id: 's', tool: 'stamp', shape: 'script', pts: [0, 0, 0, 0] }).ok).toBe(false);
  expect(allowedTool(null, 'stamp')).toBe(false);
  expect(allowedTool({ id: 'stamps' }, 'pen')).toBe(false);
  // Taps produce an upright 80px horizontal vector kept inside the paper.
  expect(stampBounds([0, 0, 0, 0])).toEqual([0, 40, 80, 40]);
  expect(stampBounds([999, 749, 999, 749])).toEqual([919, 709, 999, 709]);
  // Drags preserve angle, clamp size to [30, 240], and keep rotated corners on paper.
  const diag = stampBounds([900, 700, 100, 100], 'square');
  expect(Math.hypot(diag[2] - diag[0], diag[3] - diag[1])).toBeCloseTo(240, 0);
  expect(Math.atan2(diag[3] - diag[1], diag[2] - diag[0])).toBeCloseTo(Math.atan2(-600, -800), 1);
  const cx = (diag[0] + diag[2]) / 2, cy = (diag[1] + diag[3]) / 2;
  const pad = 120 * (Math.abs((diag[2] - diag[0]) / 240) + Math.abs((diag[3] - diag[1]) / 240));
  expect(cy + pad).toBeLessThanOrEqual(H - 1);
  expect(cx + pad).toBeLessThanOrEqual(W - 1);
  // Tiny drag is clamped up to minimum size 30 while keeping direction.
  const tiny = stampBounds([200, 200, 200, 205], 'heart');
  expect(tiny).toEqual([200, 200, 200, 230]);
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

test('guesser views stay full to 40% of the turn, fade out, and are gone by 85%', () => {
  expect(turnProgress(0, 80000)).toBe(0);
  expect(turnProgress(40000, 40000)).toBe(0.5);
  expect(turnProgress(10000, 25000)).toBeCloseTo(2 / 7);
  expect(viewStrength(0, 80000)).toBe(1);
  // Full strength through 40%; odd-ms boundary on the fade's start.
  expect(viewStrength(32000, 48000)).toBe(1);
  expect(viewStrength(32001, 47999)).toBeLessThan(1);
  expect(viewStrength(32001, 47999)).toBeGreaterThan(0.99);
  // Linear from 40% (1) to 85% (0).
  expect(viewStrength(40000, 40000)).toBeCloseTo(7 / 9);
  expect(viewStrength(50000, 30000)).toBeCloseTo(0.5);
  // Odd-ms boundary on RELIEF_AT: total 80001 ms, 85% is 68000.85 ms.
  expect(viewStrength(68000, 12001)).toBeGreaterThan(0);
  expect(viewStrength(68001, 12000)).toBe(0);
  expect(viewStrength(68000, 12000)).toBe(0);
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

test('each active chaos mode adds 25%; speedrun adds another 25%; no chaos pays base', () => {
  const at = (chaos) => guesserPts({ elapsed: 0, scoreLen: 80000, diff: 'easy', chaos, streak: 1 });
  expect(at(null)).toBe(300);
  expect(at([])).toBe(300);
  expect(at([{ id: 'mirror' }])).toBe(375);
  expect(at([{ id: 'speed' }])).toBe(469); // 300 * 1.5625
  expect(guesserPts({ elapsed: 80000, scoreLen: 80000, diff: 'easy', chaos: null, streak: 3 })).toBe(100 + 20);
});

test('two chaos modes multiply more than one; a single mode or null is accepted', () => {
  const one = [{ id: 'mirror' }];
  const two = [{ id: 'mirror' }, { id: 'fade' }];
  expect(scoreMult('easy', two)).toBeGreaterThan(scoreMult('easy', one));
  expect(scoreMult('easy', two)).toBe(1.5);
  expect(scoreMult('easy', { id: 'mirror' })).toBe(1.25);
  expect(scoreMult('easy', null)).toBe(1);
  expect(scoreMult('easy', [null, { id: 'speed' }])).toBe(1.25 * 1.25);
  const pts = (chaos) => guesserPts({ elapsed: 0, scoreLen: 80000, diff: 'easy', chaos, streak: 1 });
  expect(pts(two)).toBe(450);
  expect(pts(two)).toBeGreaterThan(pts(one));
});

test('harder words pay more for both roles', () => {
  const g = (diff) => guesserPts({ elapsed: 0, scoreLen: 80000, diff, chaos: null, streak: 1 });
  const d = (diff) => drawerPts({ solved: 1, eligible: 2, diff, chaos: null, all: false });
  expect(g('medium')).toBeGreaterThan(g('easy'));
  expect(g('hard')).toBeGreaterThan(g('medium'));
  expect(g('hard')).toBe(660); // 300 * 2.2
  expect(d('hard')).toBeGreaterThan(d('easy'));
  expect(d('hard')).toBe(220);
  expect(allBonus('hard', null)).toBeGreaterThan(allBonus('easy', null));
  expect(allBonus('easy', null)).toBe(100);
  expect(allBonus('hard', null)).toBe(220);
});

test('streak adds 10 per step, capped at +30 from streak 4', () => {
  const at = (streak) => guesserPts({ elapsed: 0, scoreLen: 80000, diff: 'easy', chaos: null, streak });
  expect(at(1)).toBe(300);
  expect(at(2)).toBe(310);
  expect(at(3)).toBe(320);
  expect(at(4)).toBe(330);
  expect(at(5)).toBe(330);
  expect(at(12)).toBe(330);
});

test('scoring is forgiving: grace window, whole seconds, no first-guess cliff', () => {
  const pts = (elapsed) => guesserPts({ elapsed, scoreLen: 80000, diff: 'medium', chaos: null, streak: 1 });
  // Anything in the first 15% of the turn scores the maximum.
  expect(pts(0)).toBe(pts(11999));
  // A millisecond apart never changes points.
  for (const t of [12500, 30001, 47500, 79000]) expect(pts(t + 1)).toBe(pts(t));
  // Each later second costs only a few points, and the floor stays high.
  expect(pts(30000) - pts(31000)).toBeLessThanOrEqual(5);
  expect(pts(80000)).toBe(Math.round(100 * 1.5));
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
  expect(drawerPts({ solved: 1, eligible: 1, diff: 'easy', chaos: null })).toBe(200);
  expect(drawerPts({ solved: 1, eligible: 8, diff: 'easy', chaos: null })).toBe(25);
  expect(drawerPts({ solved: 0, eligible: 3, diff: 'easy', chaos: null })).toBe(0);
  expect(drawerPts({ solved: 0, eligible: 0, diff: 'easy', chaos: null })).toBe(0);
});

test('drawer all-guessed bonus follows the all flag', () => {
  const d = (solved, eligible, all) => drawerPts({ solved, eligible, diff: 'easy', chaos: null, all });
  expect(d(2, 2, true)).toBe(300);
  expect(d(2, 2, false)).toBe(200);
  // The only unsolved guesser left: everyone still here got it, so the bonus applies.
  expect(d(2, 3, true)).toBe(233);
  expect(d(1, 1, true) - d(1, 1, false)).toBe(100);
});

test('a 1 ms difference inside one second never changes points', () => {
  const pts = (elapsed) => guesserPts({ elapsed, scoreLen: 80000, diff: 'hard', chaos: [{ id: 'mirror' }], streak: 1 });
  expect(pts(41000)).toBe(pts(41001));
  expect(pts(41000)).toBe(pts(41999));
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

test('pickChaos honours the host list, repeats only when forced, and returns null when empty', () => {
  const allowed = ['mirror', 'fog', 'quake'];
  for (let seed = 0; seed < 40; seed++) {
    expect(allowed).toContain(pickChaos(seed, null, null, false, allowed).id);
    expect(pickChaos(seed, 'mirror', 'artist', false, allowed).id).toBe('mirror');
    expect(pickChaos(seed, 'fog', 'guesser', false, allowed).id).toBe('quake');
  }
  expect(pickChaos(1, null, 'artist', false, ['fog'])).toBeNull();
  expect(pickChaos(1, null, 'guesser', true, ['fog'])).toBeNull();
  expect(pickChaos(1, null, 'artist', false, [])).toBeNull();
});

test('cleanChaosIds keeps known ids in canonical order and treats non-lists as everything', () => {
  expect(cleanChaosIds(['fog', 'nope', 'mirror', 'fog'])).toEqual(['mirror', 'fog']);
  expect(cleanChaosIds(['laggy', 'batches'])).toEqual(['batches']);
  expect(CHAOS_IDS).not.toContain('laggy');
  expect(CHAOS_MODES.find((m) => m.id === 'batches')).toMatchObject({ icon: '🐌', name: 'Laggy Stream', mild: true });
  expect(cleanChaosIds([])).toEqual([]);
  expect(cleanChaosIds(undefined)).toEqual(CHAOS_IDS);
  expect(cleanChaosIds('fog')).toEqual(CHAOS_IDS);
});

test('rotateHue flips ink hue without turning grays or mid-fades gray', () => {
  expect(rotateHue('#ff0000', 1)).toBe('#00ffff');
  expect(rotateHue('#00ff00', 1)).toBe('#ff00ff');
  expect(rotateHue('#000000', 1)).toBe('#000000');
  expect(rotateHue('#ffffff', 1)).toBe('#ffffff');
  expect(rotateHue('#777777', 1)).toBe('#777777');
  expect(rotateHue('#ff0000', 0)).toBe('#ff0000');
  expect(rotateHue('#ff0000', 0.5)).toBe('#80ff00');
});

test('gravityOffset slides at 10 px/s and caps so strokes stay on paper', () => {
  expect(gravityOffset(0, 100)).toBe(0);
  expect(gravityOffset(-500, 100)).toBe(0);
  expect(gravityOffset(5000, 100)).toBe(50);
  expect(gravityOffset(100000, 100)).toBe(H - 1 - 100);
  expect(gravityOffset(5000, 730)).toBe(19);
  expect(strokeMaxY({ tool: 'pen', pts: [10, 50, 20, 310, 30, 200] })).toBe(310);
});

test('decoyStrokes produces 1-2 deterministic dark medium strokes inside the paper', () => {
  const a = decoyStrokes(12345);
  expect(a).toEqual(decoyStrokes(12345));
  expect(a.length).toBeGreaterThanOrEqual(1);
  expect(a.length).toBeLessThanOrEqual(2);
  for (const s of a) {
    expect(s.decoy).toBe(true);
    expect(s.by).toBeNull();
    expect(s.tool).toBe('pen');
    expect(s.size).toBe(10);
    expect(s.color).toBe('#1d1b1a');
    for (let i = 0; i < s.pts.length; i += 2) {
      expect(s.pts[i]).toBeGreaterThanOrEqual(0);
      expect(s.pts[i]).toBeLessThan(W);
      expect(s.pts[i + 1]).toBeGreaterThanOrEqual(0);
      expect(s.pts[i + 1]).toBeLessThan(H);
    }
  }
  const counts = new Set(Array.from({ length: 20 }, (_, i) => decoyStrokes(i + 1).length));
  expect(counts).toEqual(new Set([1, 2]));
});

test('macroView zooms 2.5x around recent ink, eases to 1x, and never shows outside the paper', () => {
  expect(recentInkCenter([])).toEqual({ x: W / 2, y: H / 2 });
  expect(recentInkCenter([
    { tool: 'line', pts: [100, 100, 200, 200] },
    { tool: 'eraser', pts: [800, 600, 900, 700] },
  ])).toEqual({ x: 150, y: 150 });
  expect(macroView({ x: W / 2, y: H / 2 }, 1)).toEqual({ zoom: 2.5, tx: 0, ty: 0 });
  expect(macroView({ x: 0, y: 0 }, 1)).toEqual({ zoom: 2.5, tx: 0.75, ty: 0.75 });
  expect(macroView({ x: W, y: H }, 1)).toEqual({ zoom: 2.5, tx: -0.75, ty: -0.75 });
  expect(macroView({ x: 100, y: 100 }, 0)).toEqual({ zoom: 1, tx: 0, ty: 0 });
});
