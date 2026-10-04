// In-process room tests: fake sockets and a manual clock, so every assertion
// is on observed messages/state and no test waits on wall time.
import { beforeEach, expect, test, spyOn } from 'bun:test';
import { clock, onMessage, onClose, rooms } from './game.js';
import {
  GAME_GRACE, MAX_STROKE_PTS, MAX_TURN_COORDS, CHOOSE_MS,
  guesserPts, drawerPts, jitterPts,
  INK_BUDGET, STROKE_BUDGET,
} from './public/shared.js';

let now = 1e6, timers = [], tid = 0;
Object.assign(clock, {
  now: () => now,
  set: (fn, ms) => { const t = { id: ++tid, at: now + Math.floor(Math.max(0, ms || 0)), fn }; timers.push(t); return t; },
  clear: (t) => { timers = timers.filter((x) => x !== t); },
});
// Runs due timers in order; `ms` of fake time pass.
function advance(ms = 0) {
  const end = now + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at || a.id - b.id);
    const t = timers[0];
    if (!t || t.at > end) break;
    timers.shift();
    now = t.at;
    t.fn();
  }
  now = end;
}
beforeEach(() => {
  for (const r of rooms.values()) r.clearTimers();
  rooms.clear();
  timers = [];
});

function sock(name) {
  const s = { name, data: {}, out: [], closed: null };
  s.send = (str) => s.out.push(JSON.parse(str));
  s.close = (code) => { s.closed = code; };
  s.do = (t, d = {}) => onMessage(s, JSON.stringify({ t, ...d }));
  s.act = (t, d = {}) => s.do(t, { seq: s.state().seq, ...d });
  s.drop = () => onClose(s);
  s.state = () => s.out.findLast((m) => m.t === 'state');
  s.mark = () => s.out.length;
  s.since = (i, t) => s.out.slice(i).filter((m) => !t || m.t === t);
  s.chats = (i = 0) => s.since(i, 'chat');
  return s;
}

function setup(n, settings = {}) {
  const ss = Array.from({ length: n }, (_, i) => sock('ABCDEFG'[i]));
  ss[0].do('join', { name: 'A' });
  const code = ss[0].out.find((m) => m.t === 'welcome').code;
  for (const s of ss.slice(1)) s.do('join', { room: code, name: s.name });
  for (const s of ss) s.id = s.out.find((m) => m.t === 'welcome').id;
  ss[0].do('settings', { settings: { rounds: 1, drawTime: 80, customOnly: true, customWords: 'rabbit, elephant', ...settings } });
  return { ss, room: rooms.get(code), code };
}

// Starts the game and has the first drawer pick; returns roles.
function startDrawing(ctx) {
  const { ss, room } = ctx;
  ss[0].do('start');
  const drawer = ss.find((s) => s.id === room.drawerId);
  drawer.act('choose', { i: 0 });
  expect(room.state).toBe('drawing');
  return { drawer, guessers: ss.filter((s) => s !== drawer), word: room.word };
}

const tw = (id) => ({ id, seed: 7 });
const pen = (id, pts) => ({ id, tool: 'pen', color: '#000000', size: 6, pts });

test('artist and solver chat reach solvers only; spoilers and aliases are filtered', () => {
  const ctx = setup(3);
  const { drawer, guessers: [b, c], word } = startDrawing(ctx);
  let i = c.mark();
  drawer.act('chat', { text: 'hello solvers' });
  expect(drawer.chats(i).some((m) => m.kind === 'solved' && m.text === 'hello solvers')).toBe(true);
  expect(c.chats(i)).toEqual([]);
  b.act('chat', { text: word });
  expect(ctx.room.guessed.has(b.id)).toBe(true);
  i = c.mark();
  const j = drawer.mark();
  b.act('chat', { text: 'nice one' });
  expect(drawer.chats(j).some((m) => m.kind === 'solved' && m.text === 'nice one')).toBe(true);
  expect(c.chats(i).filter((m) => m.text === 'nice one')).toEqual([]);
  const alias = word === 'rabbit' ? 'bunny' : 'ELEPHANTS';
  const k = b.mark();
  b.act('chat', { text: `lol ${alias}` });
  if (word === 'rabbit') expect(b.chats(k).some((m) => /spoilers/.test(m.text))).toBe(true);
  expect(c.chats(i).some((m) => new RegExp(word, 'i').test(m.text))).toBe(false);
  // An unsolved guess that merely contains the answer is not shown to others.
  const l = b.mark();
  c.act('chat', { text: `a big ${word}?` });
  expect(b.chats(l)).toEqual([]);
  expect(ctx.room.guessed.has(c.id)).toBe(false);
});

test('a correct answer while paused stays private and does not score', () => {
  const ctx = setup(3);
  const { drawer, guessers: [b, c], word } = startDrawing(ctx);
  drawer.drop();
  expect(ctx.room.pausedAt).toBeTruthy();
  const i = c.mark();
  b.act('chat', { text: word });
  expect(c.chats(i)).toEqual([]);
  expect(b.chats(i).at(-1).text).toMatch(/Paused/);
  expect(ctx.room.players.get(b.id).score).toBe(0);
});

test('a correct answer after the deadline but before the timer fires does not score or leak', () => {
  const ctx = setup(3);
  const { guessers: [b, c], word } = startDrawing(ctx);
  now = ctx.room.deadline + 5;
  const i = c.mark();
  b.act('chat', { text: word });
  expect(c.chats(i)).toEqual([]);
  expect(b.chats(i).at(-1).text).toMatch(/Too late/);
  expect(ctx.room.guessed.size).toBe(0);
});

test('a guess carrying the previous phase token does not score', () => {
  const ctx = setup(2);
  const { guessers: [b], word } = startDrawing(ctx);
  b.do('chat', { text: word, seq: ctx.room.turnSeq - 1 });
  expect(ctx.room.guessed.size).toBe(0);
  b.do('chat', { text: word });
  expect(ctx.room.guessed.size).toBe(0);
});

test('late joiners spectate: no points, no speedup, word stays hidden from others', () => {
  const ctx = setup(3);
  const { drawer, guessers: [b, c], word } = startDrawing(ctx);
  const late = sock('L');
  late.do('join', { room: ctx.code, name: 'Late' });
  expect(late.state().spectating).toBe(true);
  const deadline = ctx.room.deadline;
  const i = b.mark();
  late.act('chat', { text: word });
  expect(ctx.room.players.get(late.out.find((m) => m.t === 'welcome').id).score).toBe(0);
  expect(ctx.room.deadline).toBe(deadline);
  expect(ctx.room.speedup).toBe(false);
  expect(b.chats(i)).toEqual([]);
  expect(late.state().word).toBe(word);
  expect(b.state().word).toBeNull();
  expect(drawer.state().players.find((p) => p.id === drawer.id).score).toBe(0);
  // Late solvers chat on the solver channel, not to the room.
  const j = c.mark();
  late.act('chat', { text: 'easy one' });
  expect(c.chats(j)).toEqual([]);
  expect(drawer.chats(j).some((m) => m.text === 'easy one')).toBe(true);
});

test('drawer score uses the turn-start denominator; a leaving guesser does not change it', () => {
  const ctx = setup(3);
  const { drawer, guessers: [b, c], word } = startDrawing(ctx);
  b.act('chat', { text: word });
  const expected = drawerPts({ solved: 1, eligible: 2, diff: ctx.room.diff, chaos: ctx.room.chaos });
  const dp = () => ctx.room.players.get(drawer.id).score;
  expect(dp()).toBe(expected);
  c.do('leave');
  expect(dp()).toBe(expected);
  expect(ctx.room.state).toBe('reveal');
  expect(ctx.room.reveal.reason).toBe('all');
  expect(ctx.room.reveal.deltas.find((d) => d.drawer).pts).toBe(expected);
});

test('a disconnected eligible guesser does not end the turn early', () => {
  const ctx = setup(3);
  const { guessers: [b, c], word } = startDrawing(ctx);
  b.act('chat', { text: word });
  expect(ctx.room.speedup).toBe(true);
  c.drop();
  expect(ctx.room.state).toBe('drawing');
  advance(25000);
  expect(ctx.room.state).toBe('reveal');
  expect(ctx.room.reveal.reason).toBe('time');
});

test('speedup keeps the original score curve and reschedules hints', () => {
  const ctx = setup(3, { customWords: 'elephant, crocodile' });
  const { guessers: [b, c], word } = startDrawing(ctx);
  advance(20000);
  b.act('chat', { text: word });
  expect(ctx.room.timeLeft()).toBe(25000);
  advance(5000);
  c.act('chat', { text: word });
  const pts = ctx.room.guessed.get(c.id).pts;
  expect(pts).toBe(guesserPts({ elapsed: 25000, scoreLen: 80000, diff: ctx.room.diff, chaos: ctx.room.chaos, streak: 1 }));
  // Scoring against the shortened 45s turn would have paid less.
  expect(pts).toBeGreaterThan(guesserPts({ elapsed: 25000, scoreLen: 45000, diff: ctx.room.diff, chaos: ctx.room.chaos, streak: 1 }));
});

test('hints still arrive after a speedup shortens the turn', () => {
  const ctx = setup(4, { customWords: 'elephant, crocodile' });
  const { guessers: [b, c], word } = startDrawing(ctx);
  b.act('chat', { text: word });
  c.act('chat', { text: word });
  expect(ctx.room.speedup).toBe(true);
  advance(24000);
  expect(ctx.room.state).toBe('drawing');
  expect(ctx.room.revealed.length).toBe(2);
});

test('pause freezes the phase clock and game time; resume restores them', () => {
  const ctx = setup(3);
  const { drawer, guessers: [b] } = startDrawing(ctx);
  advance(10000);
  drawer.drop();
  const frozen = b.state();
  expect(frozen.paused).toBeTruthy();
  advance(60000);
  expect(ctx.room.state).toBe('drawing');
  expect(ctx.room.timeLeft()).toBe(frozen.timeLeft);
  expect(ctx.room.clockMs()).toBe(frozen.gameMs);
  const back = sock('A2');
  back.do('join', { room: ctx.code, name: 'A', token: drawer.out.find((m) => m.t === 'welcome').token });
  const resumed = b.state();
  expect(resumed.paused).toBeNull();
  expect(resumed.timeLeft).toBe(frozen.timeLeft);
  expect(resumed.gameMs).toBe(frozen.gameMs);
});

test('two-player drop pauses; grace expiry returns to lobby', () => {
  const ctx = setup(2);
  const { guessers: [b] } = startDrawing(ctx);
  b.drop();
  expect(ctx.room.state).toBe('drawing');
  expect(ctx.room.pausedAt).toBeTruthy();
  advance(GAME_GRACE + 1);
  expect(ctx.room.state).toBe('lobby');
});

test('stale or missing phase tokens cannot mutate the canvas', () => {
  const ctx = setup(2);
  const { drawer } = startDrawing(ctx);
  const seq = ctx.room.turnSeq;
  drawer.do('stroke', { s: pen('nope', [1, 1]) });
  drawer.do('stroke', { s: pen('old', [1, 1]), seq: seq - 1 });
  expect(ctx.room.strokes).toEqual([]);
  expect(drawer.since(0, 'draw-reject').at(-1).reason).toBe('stale');
  drawer.act('stroke', { s: pen('ok', [1, 1]) });
  drawer.do('undo', { seq: seq - 1 });
  drawer.do('clear', { seq: seq - 1 });
  expect(ctx.room.strokes.length).toBe(1);
  // A non-artist's stroke is dropped without fan-out.
  const g = ctx.ss.find((s) => s !== drawer);
  const i = drawer.mark();
  g.act('stroke', { s: pen('g', [2, 2]) });
  expect(drawer.since(i)).toEqual([]);
});

test('reroll and choose need the current choosing token', () => {
  const ctx = setup(2, { customWords: 'cat, dog, cow, pig, hen' });
  ctx.ss[0].do('start');
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
  drawer.do('reroll', { seq: ctx.room.turnSeq - 1 });
  expect(ctx.room.rerolled).toBe(false);
  drawer.do('choose', { i: 0 });
  expect(ctx.room.state).toBe('choosing');
  drawer.act('reroll');
  expect(ctx.room.rerolled).toBe(true);
});

test('reroll with no alternative words says so and keeps the reroll', () => {
  const ctx = setup(2, { customWords: 'cat, dog, cow' });
  ctx.ss[0].do('start');
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
  drawer.act('reroll');
  expect(ctx.room.rerolled).toBe(false);
  expect(drawer.out.at(-1).text).toMatch(/No other words/);
});

test('custom words dedupe by canonical answer; custom-only needs two real answers', () => {
  const ctx = setup(2, { customWords: 'burger, hamburger, Hamburger , ham burger' });
  expect(ctx.room.settings.customWords).toEqual(['burger']);
  expect(ctx.ss[1].state().settings.customWordCount).toBe(1);
  expect(ctx.ss[1].state().settings.customWords).toBeUndefined();
  ctx.ss[0].do('start');
  expect(ctx.room.state).toBe('lobby');
  expect(ctx.ss[0].out.at(-1).text).toMatch(/at least 2/);
});

test('custom-only choices never fall back to the default bank', () => {
  const ctx = setup(2, { rounds: 3, customWords: 'cat, dog, cow' });
  ctx.ss[0].do('start');
  for (let turn = 0; turn < 5; turn++) {
    expect(ctx.room.choices.map((c) => c.word).sort()).toEqual(['cat', 'cow', 'dog']);
    const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
    drawer.act('choose', { i: 0 });
    drawer.act('skip');
    advance(7000);
  }
});

test('returning to the lobby resets the coordinate budget', () => {
  const ctx = setup(2);
  const { drawer, guessers: [b] } = startDrawing(ctx);
  const big = Array.from({ length: MAX_STROKE_PTS }, (_, i) => (i % 2 ? 300 : i % 997));
  for (let k = 0; k < MAX_TURN_COORDS / MAX_STROKE_PTS; k++) drawer.act('stroke', { s: pen(`b${k}`, big) });
  expect(ctx.room.coordCount).toBe(MAX_TURN_COORDS);
  advance(1000);
  drawer.act('stroke', { s: pen('over', [1, 1]) });
  expect(drawer.out.findLast((m) => m.t === 'draw-reject').reason).toBe('budget');
  b.do('leave');
  expect(ctx.room.state).toBe('lobby');
  drawer.act('stroke', { s: pen('lobby', [1, 1]) });
  expect(ctx.room.strokes.map((s) => s.id)).toEqual([`${drawer.id}:lobby`]);
});

test('draw floods are rate-limited with bounded rejections and one coalesced resync', () => {
  const ctx = setup(2);
  const { drawer, guessers: [b] } = startDrawing(ctx);
  drawer.act('stroke', { s: pen('f', [1, 1]) });
  const i = drawer.mark(), j = b.mark();
  for (let k = 0; k < 300; k++) drawer.act('pts', { id: 'f', pts: [k % 900, 5] });
  const relayed = b.since(j, 'pts').length;
  expect(relayed).toBeLessThan(80);
  expect(drawer.since(i, 'draw-reject').length).toBe(1);
  advance(0);
  expect(drawer.since(i, 'canvas').length).toBe(1);
  for (let k = 0; k < 50; k++) drawer.act('pts', { id: 'f', pts: [k, 9] });
  advance(500);
  expect(drawer.since(i, 'canvas').length).toBe(1);
  advance(600);
  expect(drawer.since(i, 'canvas').length).toBe(2);
});

test('chaos constrain tools server-side', () => {
  const ctx = setup(2);
  const { drawer } = startDrawing(ctx);
  ctx.room.chaos = tw('fade');
  drawer.act('stroke', { s: { id: 'f', tool: 'fill', color: '#ff0000', size: 6, pts: [5, 5] } });
  expect(ctx.room.strokes).toEqual([]);
  ctx.room.chaos = tw('onestroke');
  drawer.act('stroke', { s: { id: 'l', tool: 'line', color: '#000000', size: 6, pts: [0, 0, 10, 10] } });
  drawer.act('stroke', { s: pen('p1', [1, 1]) });
  advance(300);
  drawer.act('stroke', { s: pen('p2', [5, 5]) });
  drawer.act('undo');
  expect(ctx.room.strokes.map((s) => s.id)).toEqual([`${drawer.id}:p1`]);
});

test('shaky jitter is applied once on the server with the shared function', () => {
  const ctx = setup(2);
  const { drawer } = startDrawing(ctx);
  ctx.room.chaos = tw('shaky');
  drawer.act('stroke', { s: pen('s', [100, 100]) });
  drawer.act('pts', { id: 's', pts: [120, 100, 140, 100] });
  drawer.act('stroke', { s: { id: 'r', tool: 'rect', color: '#000000', size: 6, pts: [10, 10, 60, 60] } });
  const id = `${drawer.id}:s`;
  expect(ctx.room.strokes[0].pts).toEqual([...jitterPts(id, [100, 100]), ...jitterPts(id, [120, 100, 140, 100], 1)]);
  expect(ctx.room.strokes[1].pts).toEqual(jitterPts(`${drawer.id}:r`, [10, 10, 60, 60]));
});

test('duplicate ids are owner-scoped and undo removes only the sender’s stroke', () => {
  const ctx = setup(2);
  const [a, b] = ctx.ss;
  a.act('stroke', { s: pen('x1', [10, 10]) });
  b.act('stroke', { s: pen('x1', [20, 20]) });
  b.act('stroke', { s: pen('x1', [30, 30]) });
  expect(b.since(0, 'draw-reject').at(-1).reason).toBe('duplicate');
  const i = a.mark();
  b.act('undo');
  expect(a.since(i, 'undo')[0].id).toBe(`${b.id}:x1`);
  expect(ctx.room.strokes.map((s) => s.id)).toEqual([`${a.id}:x1`]);
});

test('only the host kicks; a kicked token is refused, a valid token reconnects', () => {
  const ctx = setup(3);
  const [a, b, c] = ctx.ss;
  const tokenC = c.out.find((m) => m.t === 'welcome').token;
  const tokenB = b.out.find((m) => m.t === 'welcome').token;
  b.do('kick', { id: c.id });
  expect(ctx.room.players.has(c.id)).toBe(true);
  a.do('kick', { id: c.id });
  expect(ctx.room.players.has(c.id)).toBe(false);
  const c2 = sock('C2');
  c2.do('join', { room: ctx.code, name: 'C', token: tokenC });
  expect(c2.out.at(-1).text).toMatch(/kicked/);
  b.drop();
  const b2 = sock('B2');
  b2.do('join', { room: ctx.code, name: 'B', token: tokenB });
  expect(b2.out.find((m) => m.t === 'welcome').id).toBe(b.id);
});

test('tied scores end with shared ranks for everyone', () => {
  const ctx = setup(4);
  ctx.ss[0].do('start');
  const r = ctx.room;
  const scores = [300, 200, 200, 100];
  [...r.players.values()].forEach((p, i) => { p.score = scores[i]; });
  r.endGame();
  expect(r.endData.ranking.map((p) => p.rank)).toEqual([1, 2, 2, 4]);
  expect(ctx.ss[3].state().end.ranking.length).toBe(4);
});

test('choosing times out to a random pick under the fake clock', () => {
  const ctx = setup(2);
  ctx.ss[0].do('start');
  advance(CHOOSE_MS);
  expect(ctx.room.state).toBe('drawing');
});

test('chaos: off by default, artist pool never repeats the previous challenge', () => {
  const off = setup(2);
  startDrawing(off);
  expect(off.room.chaos).toBeNull();
  const ctx = setup(2, { chaos: true, chaosPool: 'artist', rounds: 5, customWords: 'cat, dog, cow' });
  ctx.ss[0].do('start');
  let prev = null;
  for (let turn = 0; turn < 8; turn++) {
    const t = ctx.room.chaos;
    expect(t?.id).toBeTruthy();
    expect(t.id).not.toBe(prev);
    prev = t.id;
    const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
    drawer.act('choose', { i: 0 });
    expect(drawer.state().chaos.id).toBe(t.id);
    drawer.act('skip');
    advance(7000);
  }
});

test('speedrun halves the turn; clear wipes the canvas; blank turns skip the gallery', () => {
  const ctx = setup(2, { chaos: true });
  ctx.ss[0].do('start');
  ctx.room.chaos = tw('speed');
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
  const g = ctx.ss.find((s) => s !== drawer);
  drawer.act('choose', { i: 0 });
  expect(ctx.room.timeLeft()).toBe(40000);
  drawer.act('stroke', { s: pen('a', [5, 5]) });
  const i = g.mark();
  drawer.act('clear');
  expect(ctx.room.strokes).toEqual([]);
  expect(g.since(i, 'clear')[0].strokes).toEqual([]);
  // A blank canvas does not make it into the end-of-game gallery.
  drawer.act('skip');
  expect(ctx.room.state).toBe('reveal');
  expect(ctx.room.gallery).toEqual([]);
});

test('host settings: word choices, hints, difficulty and chaos level', () => {
  const ctx = setup(2, { customOnly: false, customWords: '', wordChoices: 5, hints: 4, difficulty: 'hard', chaos: 'always' });
  const s = ctx.room.settings;
  expect([s.wordChoices, s.hints, s.difficulty, s.chaos]).toEqual([5, 4, 'hard', 'always']);
  ctx.ss[0].do('start');
  const drawer = ctx.ss.find((x) => x.id === ctx.room.drawerId);
  expect(drawer.state().choices.length).toBe(5);
  expect(drawer.state().choices.every((c) => c.diff === 'hard')).toBe(true);
  ctx.room.chaos = tw('mirror');
  drawer.act('choose', { i: 0 });
  const letters = [...ctx.room.word].filter((ch) => /[a-z0-9]/i.test(ch)).length;
  expect(ctx.room.hintPlan.length).toBe(Math.min(4, Math.floor(letters / 2)));
  // Out-of-range values clamp; unknown values fall back.
  ctx.room.toLobby();
  ctx.ss[0].do('settings', { settings: { wordChoices: 99, hints: -3, difficulty: 'insane', chaos: 'max' } });
  const t = ctx.room.settings;
  expect([t.wordChoices, t.hints, t.difficulty, t.chaos]).toEqual([5, 0, 'mix', 'off']);
});

test('no-hints chaos reveals nothing; chaos "off" never picks a mode', () => {
  const ctx = setup(2, { hints: 5 });
  ctx.ss[0].do('start');
  expect(ctx.room.chaos).toBeNull();
  ctx.room.guesserChaos = tw('nohints');
  ctx.ss.find((x) => x.id === ctx.room.drawerId).act('choose', { i: 0 });
  expect(ctx.room.hintPlan).toEqual([]);
});

test('five strokes cannot be refilled by undo, clear, or a forbidden tool', () => {
  const ctx = setup(2);
  const { drawer } = startDrawing(ctx);
  ctx.room.chaos = tw('fivestrokes');
  drawer.act('stroke', { s: { id: 'shape', tool: 'rect', pts: [1, 1, 50, 50] } });
  expect(ctx.room.strokeUsed).toBe(0);
  for (let i = 0; i < STROKE_BUDGET; i++) drawer.act('stroke', { s: pen(`p${i}`, [i, i]) });
  expect(ctx.room.drawBudget()).toEqual({ strokesLeft: 0 });
  drawer.act('undo');
  drawer.act('clear');
  drawer.act('stroke', { s: pen('extra', [10, 10]) });
  expect(ctx.room.strokes).toHaveLength(0);
  expect(ctx.room.strokeUsed).toBe(STROKE_BUDGET);
  expect(drawer.out.findLast((m) => m.t === 'draw-budget').budget.strokesLeft).toBe(0);
});

test('ink clips at its limit, reconciles the artist, and survives canvas edits', () => {
  const ctx = setup(2);
  const { drawer, guessers: [g] } = startDrawing(ctx);
  ctx.room.chaos = tw('inkbudget');
  drawer.act('stroke', { s: pen('ink', [0, 100, 999, 100, 0, 100, 999, 100, 0, 100, 999, 100]) });
  expect(ctx.room.inkUsed).toBe(5001);
  drawer.act('pts', { id: 'ink', pts: [0, 100, 500, 100] });
  expect(ctx.room.inkUsed).toBe(INK_BUDGET);
  expect(ctx.room.strokes[0].pts.slice(-2)).toEqual([0, 100]);
  expect(g.out.findLast((m) => m.t === 'pts').pts).toEqual([0, 100]);
  advance(0);
  expect(drawer.out.findLast((m) => m.t === 'canvas').strokes[0].pts.slice(-2)).toEqual([0, 100]);
  drawer.act('undo'); drawer.act('clear');
  drawer.act('stroke', { s: pen('more', [5, 5]) });
  expect(ctx.room.strokes).toHaveLength(0);
  expect(ctx.room.drawBudget().inkLeft).toBe(0);
});

test('ink charges dots, erasing and shapes; fill cannot bypass the limit', () => {
  const ctx = setup(2);
  const { drawer } = startDrawing(ctx);
  ctx.room.chaos = tw('inkbudget');
  drawer.act('stroke', { s: pen('dot', [1, 1]) });
  expect(ctx.room.inkUsed).toBe(6);
  drawer.act('stroke', { s: { ...pen('erase', [1, 1, 4, 5]), tool: 'eraser' } });
  expect(ctx.room.inkUsed).toBe(17);
  drawer.act('stroke', { s: { ...pen('box', [0, 0, 100, 100]), tool: 'rect' } });
  expect(ctx.room.inkUsed).toBe(417);
  drawer.act('stroke', { s: { ...pen('fill', [50, 50]), tool: 'fill' } });
  expect(ctx.room.strokes).toHaveLength(3);
  expect(ctx.room.inkUsed).toBe(417);
});

test('mystery length stays private until halfway, including across a pause', () => {
  const ctx = setup(3, { hints: 0 });
  ctx.ss[0].do('start');
  ctx.room.guesserChaos = tw('mystery');
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
  drawer.act('choose', { i: 0 });
  const guessers = ctx.ss.filter((s) => s !== drawer);
  for (const g of guessers) expect(g.state().hint).toBeNull();
  expect(drawer.state().word).toBe(ctx.room.word);
  advance(20000);
  drawer.drop(); advance(10000);
  for (const g of guessers) expect(g.state().hint).toBeNull();
  const token = drawer.out.find((m) => m.t === 'welcome').token;
  const returning = sock('Return'); returning.do('join', { room: ctx.code, token, name: 'Return' });
  advance(19999);
  for (const g of guessers) expect(g.state().hint).toBeNull();
  advance(1);
  for (const g of guessers) expect(g.state().hint).toBe(ctx.room.hint());
});

test('a speedup advances mystery length relief for every remaining guesser', () => {
  const ctx = setup(3, { hints: 0 });
  ctx.ss[0].do('start'); ctx.room.guesserChaos = tw('mystery');
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
  drawer.act('choose', { i: 0 });
  const [a, b] = ctx.ss.filter((s) => s !== drawer);
  advance(10001); a.act('chat', { text: ctx.room.word });
  expect(ctx.room.timeLeft()).toBe(25000);
  advance(7499); expect(b.state().hint).toBeNull();
  advance(1); expect(b.state().hint).toBe(ctx.room.hint());
});

test('rescue is artist-only, once per match, and survives reconnect', () => {
  const ctx = setup(2, { chaos: 'always', chaosPool: 'artist' });
  ctx.ss[0].do('start');
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId), other = ctx.ss.find((s) => s !== drawer);
  const original = ctx.room.chaos.id, deadline = ctx.room.deadline;
  other.act('rescue'); drawer.do('rescue', { seq: ctx.room.turnSeq - 1 });
  expect(ctx.room.chaos.id).toBe(original);
  const otherToken = other.out.find((m) => m.t === 'welcome').token;
  other.drop();
  expect(drawer.state().canRescue).toBe(false);
  drawer.act('rescue'); expect(ctx.room.chaos.id).toBe(original);
  const otherReturn = sock('ReturnOther');
  otherReturn.do('join', { room: ctx.code, token: otherToken });
  otherReturn.id = other.id;
  ctx.ss[ctx.ss.indexOf(other)] = otherReturn;
  expect(drawer.state().canRescue).toBe(true);
  drawer.act('rescue');
  const replacement = ctx.room.chaos.id;
  expect(replacement).not.toBe(original);
  expect(ctx.room.deadline).toBe(deadline);
  drawer.act('rescue'); expect(ctx.room.chaos.id).toBe(replacement);
  const token = drawer.out.find((m) => m.t === 'welcome').token;
  drawer.drop(); const returning = sock('Return'); returning.do('join', { room: ctx.code, token });
  expect(returning.state().canRescue).toBe(false);
  returning.act('rescue'); expect(ctx.room.chaos.id).toBe(replacement);
  ctx.room.queue = [drawer.id];
  returning.act('choose', { i: 0 }); returning.act('skip'); advance(6000);
  expect(ctx.room.drawerId).toBe(drawer.id);
  expect(returning.state().canRescue).toBe(false);
  ctx.room.toLobby();
  ctx.ss.find((s) => s.id === ctx.room.hostId).do('start');
  expect(ctx.room.players.get(drawer.id).rescued).toBe(false);
});

test('presets use separate pools; mixed chooses either role or a mild pair', () => {
  const ctx = setup(2, { chaos: 'always' });
  const rng = spyOn(Math, 'random');
  try {
    for (const target of ['artist', 'guesser']) {
      ctx.room.settings.chaosPool = target; rng.mockReturnValue(0.4); ctx.room.rollChaos();
      expect((target === 'artist' ? ctx.room.chaos : ctx.room.guesserChaos).target).toBe(target);
      expect(target === 'artist' ? ctx.room.guesserChaos : ctx.room.chaos).toBeNull();
    }
    ctx.room.settings.chaosPool = 'mixed';
    rng.mockReturnValueOnce(0.3).mockReturnValueOnce(0.4); ctx.room.rollChaos();
    expect(ctx.room.chaos).not.toBeNull(); expect(ctx.room.guesserChaos).toBeNull();
    rng.mockReturnValueOnce(0.3).mockReturnValueOnce(0.6); ctx.room.rollChaos();
    expect(ctx.room.chaos).toBeNull(); expect(ctx.room.guesserChaos).not.toBeNull();
    rng.mockReturnValueOnce(0.1); ctx.room.rollChaos();
    expect(ctx.room.chaos.mild).toBe(true); expect(ctx.room.guesserChaos.mild).toBe(true);
    expect(['mystery', 'curtain']).toContain(ctx.room.guesserChaos.id);
  } finally { rng.mockRestore(); }
});

test('role cards keep artist instructions private and reveal both challenges afterward', () => {
  const ctx = setup(3);
  ctx.ss[0].do('start'); ctx.room.chaos = { ...tw('fivestrokes'), name: 'Five Strokes', desc: 'Five pen strokes.' };
  ctx.room.guesserChaos = { ...tw('curtain'), name: 'Curtain Reveal', desc: 'The drawing opens in strips.' };
  ctx.room.sync();
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId), guessers = ctx.ss.filter((s) => s !== drawer);
  for (const g of guessers) { expect(g.state().chaos).toBeNull(); expect(g.state().guesserChaos.id).toBe('curtain'); }
  drawer.act('choose', { i: 0 });
  for (const g of guessers) { expect(g.state().chaos.name).toBeUndefined(); expect(g.state().word).toBeNull(); }
  drawer.act('skip');
  for (const g of guessers) {
    expect(g.state().reveal.artistChaos.name).toBe('Five Strokes');
    expect(g.state().reveal.guesserChaos.name).toBe('Curtain Reveal');
  }
});
