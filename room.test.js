// In-process room tests: fake sockets and a manual clock, so every assertion
// is on observed messages/state and no test waits on wall time.
import { beforeEach, expect, test, spyOn } from 'bun:test';
import { clock, onMessage, onClose, rooms, setWordHistory, recapGuesses } from './game.js';
import { WordHistory } from './history.js';
import { DECK_BY_ID, DECK_CATALOG } from './decks.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NEW_WORDS } from './words-new.js';
import {
  GAME_GRACE, MAX_STROKE_PTS, MAX_TURN_COORDS, CHOOSE_MS, REVEAL_MS,
  guesserPts, drawerPts, jitterPts,
  INK_BUDGET, STROKE_BUDGET, forbiddenZone, slipperyPts, CHAOS_MODES,
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
  setWordHistory(new WordHistory());
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

test('drawer score uses the turn-start denominator; a leaving guesser only adds the all-guessed bonus', () => {
  const ctx = setup(3);
  const { drawer, guessers: [b, c], word } = startDrawing(ctx);
  b.act('chat', { text: word });
  const modes = [ctx.room.chaos, ctx.room.guesserChaos].filter(Boolean);
  const expected = drawerPts({ solved: 1, eligible: 2, diff: ctx.room.diff, chaos: modes });
  const dp = () => ctx.room.players.get(drawer.id).score;
  expect(dp()).toBe(expected);
  c.do('leave');
  const withBonus = drawerPts({ solved: 1, eligible: 2, diff: ctx.room.diff, chaos: modes, all: true });
  expect(dp()).toBe(withBonus);
  expect(ctx.room.state).toBe('reveal');
  expect(ctx.room.reveal.reason).toBe('all');
  expect(ctx.room.reveal.deltas.find((d) => d.drawer).pts).toBe(withBonus);
});

test('drawer all-guessed bonus only when every eligible guesser solved; reveal carries the multiplier', () => {
  const ctx = setup(3);
  const { drawer, guessers: [b, c], word } = startDrawing(ctx);
  ctx.room.diff = 'hard';
  ctx.room.chaos = null;
  ctx.room.guesserChaos = null;
  const dp = () => ctx.room.players.get(drawer.id).score;
  b.act('chat', { text: word });
  expect(ctx.room.state).toBe('drawing');
  expect(dp()).toBe(220); // 200 * 0.5 * 2.2, no all-guessed bonus yet
  c.act('chat', { text: word });
  expect(ctx.room.state).toBe('reveal');
  expect(ctx.room.reveal.reason).toBe('all');
  expect(dp()).toBe(660); // (200 + 100) * 2.2
  expect(ctx.room.reveal.diff).toBe('hard');
  expect(ctx.room.reveal.mult).toBe(2.2);
  expect(ctx.room.reveal.allBonus).toBe(220);
  expect(ctx.room.reveal.deltas.find((d) => d.drawer).pts).toBe(660);
});

test('when the last unsolved guesser leaves, the drawer still earns the all-guessed bonus it shows', () => {
  const ctx = setup(3);
  const { drawer, guessers: [b, c], word } = startDrawing(ctx);
  ctx.room.diff = 'hard';
  ctx.room.chaos = null;
  ctx.room.guesserChaos = null;
  b.act('chat', { text: word });
  c.do('leave');
  expect(ctx.room.reveal.reason).toBe('all');
  expect(ctx.room.players.get(drawer.id).score).toBe(440); // (200 / 2 + 100) * 2.2
  expect(ctx.room.reveal.allBonus).toBe(220);
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
  const modes = [ctx.room.chaos, ctx.room.guesserChaos].filter(Boolean);
  expect(pts).toBe(guesserPts({ elapsed: 25000, scoreLen: 80000, diff: ctx.room.diff, chaos: modes, streak: 1 }));
  // Scoring against the shortened 45s turn would have paid less.
  expect(pts).toBeGreaterThan(guesserPts({ elapsed: 25000, scoreLen: 45000, diff: ctx.room.diff, chaos: modes, streak: 1 }));
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

test('chaos: 2x rate by default, "off" never rolls, artist pool never repeats the previous challenge', () => {
  // A fresh room (no settings message yet) uses DEFAULTS.
  const host = sock('Host'); host.do('join', { name: 'H' });
  expect(rooms.get(host.out.find((m) => m.t === 'welcome').code).settings.chaos).toBe('x2');
  const off = setup(2, { chaos: 'off' });
  startDrawing(off);
  expect(off.room.chaos).toBeNull();
  expect(off.room.guesserChaos).toBeNull();
  const ctx = setup(2, { chaos: 'x4', chaosPool: 'artist', rounds: 5, customWords: 'cat, dog, cow' });
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
  const ctx = setup(2, { chaos: 'x4' });
  ctx.ss[0].do('start');
  ctx.room.chaos = tw('speed'); ctx.room.guesserChaos = null;
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
  const ctx = setup(2, { customOnly: false, customWords: '', wordChoices: 5, hints: 4, difficulty: 'hard', chaos: 'x4' });
  const s = ctx.room.settings;
  expect([s.wordChoices, s.hints, s.difficulty, s.chaos]).toEqual([5, 4, 'hard', 'x4']);
  ctx.ss[0].do('start');
  const drawer = ctx.ss.find((x) => x.id === ctx.room.drawerId);
  expect(drawer.state().choices.length).toBe(5);
  expect(drawer.state().choices.every((c) => c.diff === 'hard')).toBe(true);
  ctx.room.chaos = tw('mirror'); ctx.room.guesserChaos = null;
  drawer.act('choose', { i: 0 });
  const letters = [...ctx.room.word].filter((ch) => /[a-z0-9]/i.test(ch)).length;
  expect(ctx.room.hintPlan.length).toBe(Math.min(4, Math.floor(letters / 2)));
  // Out-of-range values clamp; unknown values fall back.
  ctx.room.toLobby();
  ctx.ss[0].do('settings', { settings: { wordChoices: 99, hints: -3, difficulty: 'insane', chaos: 'max' } });
  const t = ctx.room.settings;
  expect([t.wordChoices, t.hints, t.difficulty, t.chaos]).toEqual([5, 0, 'mix', 'off']);
});

test('decks: host picks decks, cards come from different decks with badges, unknown ids fall back', () => {
  const ctx = setup(2, { customOnly: false, customWords: '', decks: ['tech', 'dev', 'bogus'], difficulty: 'easy', wordChoices: 2 });
  expect(ctx.room.settings.decks).toEqual(['tech', 'dev']);
  expect(ctx.ss[1].state().deckCatalog).toEqual(DECK_CATALOG);
  ctx.ss[0].do('start');
  expect(ctx.ss[1].state().deckCatalog).toBeNull();
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
  const choices = drawer.state().choices;
  expect(choices.map((c) => c.deck.id).sort()).toEqual(['dev', 'tech']);
  for (const c of choices) {
    expect(c.diff).toBe('easy');
    expect(DECK_BY_ID.get(c.deck.id).easy).toContain(c.word);
    expect(c.deck).toEqual({ id: c.deck.id, name: DECK_BY_ID.get(c.deck.id).name, icon: DECK_BY_ID.get(c.deck.id).icon });
  }
  // The chosen word's deck is a public clue during drawing; the word is not.
  drawer.act('choose', { i: 0 });
  const g = ctx.ss.find((s) => s !== drawer).state();
  expect(g.deck).toEqual(choices[0].deck);
  expect(g.word).toBeNull();
  ctx.room.toLobby();
  ctx.ss[0].do('settings', { settings: { decks: [] } });
  expect(ctx.room.settings.decks).toEqual(['everyday', 'tech', 'memes']);
  ctx.ss[0].do('settings', { settings: { decks: 'tech' } });
  expect(ctx.room.settings.decks).toEqual(['everyday', 'tech', 'memes']);
});

test('no-hints chaos reveals nothing; chaos "off" never picks a mode', () => {
  const ctx = setup(2, { hints: 5, chaos: 'off' });
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
  const ctx = setup(2, { chaos: 'x4', chaosPool: 'artist' });
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

test('presets use separate pools; mixed pairs 35% of turns with a mild guesser side', () => {
  const ctx = setup(2, { chaos: 'x4' });
  const rng = spyOn(Math, 'random');
  try {
    for (const target of ['artist', 'guesser']) {
      ctx.room.settings.chaosPool = target; rng.mockReturnValue(0.4); ctx.room.rollChaos();
      expect((target === 'artist' ? ctx.room.chaos : ctx.room.guesserChaos).target).toBe(target);
      expect(target === 'artist' ? ctx.room.guesserChaos : ctx.room.chaos).toBeNull();
    }
    ctx.room.settings.chaosPool = 'mixed';
    // Pair roll 0.5 (no pair), then role roll 0.4 picks the artist side.
    rng.mockReturnValueOnce(0.5).mockReturnValueOnce(0.4); ctx.room.rollChaos();
    expect(ctx.room.chaos).not.toBeNull(); expect(ctx.room.guesserChaos).toBeNull();
    // Role roll 0.6 picks the guesser side.
    rng.mockReturnValueOnce(0.5).mockReturnValueOnce(0.6); ctx.room.rollChaos();
    expect(ctx.room.chaos).toBeNull(); expect(ctx.room.guesserChaos).not.toBeNull();
    // Pair roll 0.34 is a pair (below 0.35). The artist side may be a full challenge.
    const artistPool = CHAOS_MODES.filter((m) => m.target === 'artist');
    const full = artistPool.findIndex((m) => !m.mild);
    expect(full).toBeGreaterThanOrEqual(0);
    ctx.room.lastChaosId = null; ctx.room.lastGuesserChaosId = null;
    // Draw order: pair, role, artist seed (picks index `full`), guesser seed.
    rng.mockReturnValueOnce(0.34).mockReturnValueOnce(0.5).mockReturnValueOnce((full + 0.5) / 0xffffffff).mockReturnValueOnce(0.5);
    ctx.room.rollChaos();
    expect(ctx.room.chaos.id).toBe(artistPool[full].id); expect(ctx.room.chaos.mild).toBeFalsy();
    expect(ctx.room.guesserChaos.mild).toBe(true);
    expect(['mystery', 'batches']).toContain(ctx.room.guesserChaos.id);
    // Pair roll 0.36 is just above the 35% line, so no pair: the role roll 0.4 picks the artist side.
    rng.mockReturnValueOnce(0.36).mockReturnValueOnce(0.4); ctx.room.rollChaos();
    expect(ctx.room.chaos).not.toBeNull(); expect(ctx.room.guesserChaos).toBeNull();
  } finally { rng.mockRestore(); }
});

test('role cards: both challenges are public to every player in every state', () => {
  const ctx = setup(3);
  ctx.ss[0].do('start'); ctx.room.chaos = { ...tw('fivestrokes'), name: 'Five Strokes', desc: 'Five pen strokes.' };
  ctx.room.guesserChaos = { ...tw('mystery'), name: 'Mystery Length', desc: 'Word length appears halfway through.' };
  ctx.room.sync();
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId), guessers = ctx.ss.filter((s) => s !== drawer);
  for (const g of guessers) { expect(g.state().chaos.name).toBe('Five Strokes'); expect(g.state().guesserChaos.id).toBe('mystery'); }
  drawer.act('choose', { i: 0 });
  for (const g of guessers) {
    expect(g.state().state).toBe('drawing');
    expect(g.state().chaos).toEqual(ctx.room.chaos);
    expect(g.state().guesserChaos.name).toBe('Mystery Length');
    expect(g.state().word).toBeNull();
  }
  drawer.act('skip');
  for (const g of guessers) {
    expect(g.state().reveal.artistChaos.name).toBe('Five Strokes');
    expect(g.state().reveal.guesserChaos.name).toBe('Mystery Length');
  }
});

function startChallenges(n, artist, guesser, settings = {}) {
  const ctx = setup(n, { hints: 0, ...settings });
  ctx.ss[0].do('start');
  ctx.room.chaos = artist ? tw(artist) : null;
  ctx.room.guesserChaos = guesser ? tw(guesser) : null;
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
  drawer.act('choose', { i: 0 });
  return { ...ctx, drawer, guessers: ctx.ss.filter((s) => s !== drawer) };
}

test('straight lines, stamps and forbidden zones are enforced on authoritative strokes', () => {
  const c = startChallenges(2, 'straight');
  c.drawer.act('stroke', { s: pen('curve', [10, 10, 50, 80, 100, 10]) });
  expect(c.room.strokes).toEqual([]);
  c.drawer.act('stroke', { s: { ...pen('line', [10, 10, 100, 10]), tool: 'line' } });
  expect(c.room.strokes[0].tool).toBe('line');
  c.room.chaos = tw('stamps');
  c.drawer.act('stroke', { s: { ...pen('stamp', [0, 0, 0, 0]), tool: 'stamp', shape: 'star', size: 80 } });
  expect(c.room.strokes.at(-1)).toMatchObject({ tool: 'stamp', shape: 'star', pts: [0, 40, 80, 40], size: 4 });
  c.drawer.act('stroke', { s: { ...pen('heart', [100, 100, 200, 140]), tool: 'stamp', shape: 'heart', size: 10 } });
  expect(c.room.strokes.at(-1)).toMatchObject({ tool: 'stamp', shape: 'heart', size: 4 });
  c.drawer.act('stroke', { s: { ...pen('bad', [0, 0, 0, 0]), tool: 'stamp', shape: 'unknown' } });
  expect(c.room.strokes).toHaveLength(3);
  c.room.chaos = tw('forbidden');
  c.drawer.act('stroke', { s: { ...pen('zone', [0, 300, 999, 300]), forbidden: { x: 0, y: 0, w: 1000, h: 750 } } });
  expect(c.room.strokes.at(-1).forbidden).toEqual(forbiddenZone(7));
  c.drawer.act('stroke', { s: { ...pen('fill', [1, 1]), tool: 'fill' } });
  expect(c.room.strokes).toHaveLength(4);
});

test('shrinking brush uses unpaused original turn time and slippery points follow packet tails', () => {
  const c = startChallenges(2, 'shrinking');
  c.drawer.act('stroke', { s: pen('thick', [10, 10]) });
  expect(c.room.strokes[0].size).toBe(22);
  advance(40000);
  c.drawer.act('stroke', { s: pen('thin', [20, 20]) });
  expect(c.room.strokes[1].size).toBe(13);
  const g = c.guessers[0], token = g.out.find((m) => m.t === 'welcome').token;
  g.drop(); advance(5000);
  const back = sock('back'); back.do('join', { room: c.code, token });
  c.drawer.act('stroke', { s: pen('same', [30, 30]) });
  expect(c.room.strokes[2].size).toBe(13);
  c.room.chaos = tw('slippery');
  const raw = [10, 10, 20, 25, 400, 500, 500, 550];
  c.drawer.act('stroke', { s: pen('slip', raw.slice(0, 4)) });
  c.drawer.act('pts', { id: 'slip', pts: raw.slice(4) });
  expect(c.room.strokes.at(-1).pts).toEqual(slipperyPts(raw));
});

test('batch publication freezes appended points, clear, and reconnect snapshots', () => {
  const c = startChallenges(3, null, 'batches'), [a, b] = c.guessers;
  const mark = a.mark();
  c.drawer.act('stroke', { s: pen('one', [10, 10]) });
  c.drawer.act('pts', { id: 'one', pts: [20, 20] });
  expect(a.since(mark, 'stroke')).toEqual([]);
  expect(a.since(mark, 'pts')).toEqual([]);
  advance(1999); expect(c.room.publishedStrokes).toEqual([]);
  advance(1); expect(a.since(mark, 'canvas').at(-1).strokes[0].pts).toEqual([10, 10, 20, 20]);
  c.drawer.act('pts', { id: 'one', pts: [30, 30] });
  expect(c.room.publishedStrokes[0].pts).toEqual([10, 10, 20, 20]);
  const token = b.out.find((m) => m.t === 'welcome').token;
  b.drop(); const back = sock('back'); back.do('join', { room: c.code, token });
  expect(back.out.findLast((m) => m.t === 'canvas').strokes[0].pts).toEqual([10, 10, 20, 20]);
  const i = a.mark(); c.drawer.act('clear');
  expect(c.room.strokes).toEqual([]); expect(c.room.publishedStrokes).toHaveLength(1);
  expect(a.since(i, 'clear')).toEqual([]);
  advance(2000); expect(a.since(i, 'canvas').at(-1).strokes).toEqual([]);
});

test('batch timers freeze during pause and release after speedup and at reveal', () => {
  const c = startChallenges(2, null, 'batches'), g = c.guessers[0];
  c.drawer.act('stroke', { s: pen('one', [10, 10]) }); advance(1000);
  const token = g.out.find((m) => m.t === 'welcome').token;
  g.drop(); advance(5000); expect(c.room.publishedStrokes).toEqual([]);
  const back = sock('back'); back.do('join', { room: c.code, token });
  advance(999); expect(c.room.publishedStrokes).toEqual([]);
  advance(1); expect(c.room.publishedStrokes).toHaveLength(1);
  c.drawer.act('pts', { id: 'one', pts: [30, 30] }); c.drawer.act('skip');
  expect(back.out.findLast((m) => m.t === 'canvas').strokes[0].pts).toEqual([10, 10, 30, 30]);
  const d = startChallenges(3, null, 'batches'), [a, b] = d.guessers;
  advance(10001); a.act('chat', { text: d.room.word });
  // Turn total is 10001 + 25000 after the speedup; relief is at 85% of it (29750.85 ms, so 29751 ms elapsed).
  advance(19749); expect(d.room.batchReleased).toBe(false);
  advance(1); expect(d.room.batchReleased).toBe(true);
  const i = b.mark(); d.drawer.act('stroke', { s: pen('live', [5, 5]) });
  expect(b.since(i, 'stroke')).toHaveLength(1);
});

test('limited attempts charge distinct wrong answers but allow typos, repeats and correct answers at zero', () => {
  const c = startChallenges(3, null, 'limited'), [a, b] = c.guessers;
  for (const text of ['zzz', 'yyy', 'xxx']) a.act('chat', { text, requestId: text });
  expect(c.room.guessBudget(c.room.players.get(a.id)).remaining).toBe(0);
  const mark = b.mark(); a.act('chat', { text: 'www', requestId: 'rejected' });
  expect(b.chats(mark)).toEqual([]);
  expect(a.out.at(-1)).toMatchObject({ t: 'guess-result', requestId: 'rejected', accepted: false });
  a.act('chat', { text: 'zzz', requestId: 'duplicate' });
  expect(a.out.at(-1)).toMatchObject({ t: 'guess-result', accepted: true });
  a.act('chat', { text: c.room.word.slice(0, -1), requestId: 'typo' });
  expect(c.room.guessBudget(c.room.players.get(a.id)).remaining).toBe(0);
  expect(a.out.at(-1)).toMatchObject({ t: 'guess-result', accepted: true });
  const seq = c.room.turnSeq; a.act('chat', { text: c.room.word, requestId: 'right' });
  expect(c.room.guessed.has(a.id)).toBe(true);
  expect(a.out.at(-1)).toMatchObject({ t: 'guess-result', seq, requestId: 'right', accepted: true });
});

test('limited attempt replenishment and relief share unpaused time and reject stale guesses', () => {
  const c = startChallenges(2, null, 'limited'), g = c.guessers[0], p = c.room.players.get(g.id);
  g.act('chat', { text: 'zzz', requestId: 'one' });
  advance(3999); expect(c.room.guessBudget(p).remaining).toBe(2);
  advance(1); expect(g.out.findLast((m) => m.t === 'guess-budget').budget.remaining).toBe(3);
  g.act('chat', { text: 'yyy', requestId: 'two' });
  const seq = c.room.turnSeq, mark = c.drawer.mark();
  g.do('chat', { seq: seq - 1, text: 'xxx', requestId: 'stale' });
  expect(g.out.at(-1)).toMatchObject({ t: 'guess-result', accepted: false });
  expect(c.room.guessBudget(p).remaining).toBe(2); expect(c.drawer.chats(mark)).toEqual([]);
  const token = c.drawer.out.find((m) => m.t === 'welcome').token;
  c.drawer.drop(); advance(10000);
  g.act('chat', { text: 'qqq', requestId: 'paused' });
  expect(c.room.guessBudget(p).remaining).toBe(2);
  const back = sock('back'); back.do('join', { room: c.code, token });
  advance(3999); expect(c.room.guessBudget(p).remaining).toBe(2);
  advance(1); expect(c.room.guessBudget(p).remaining).toBe(3);
  // Turn total is 80000 ms; relief is at 85% (68000 ms elapsed). Unpaused elapsed is 8000 here.
  advance(59999); expect(c.room.guessBudget(p).unlimited).toBe(false);
  advance(1); expect(c.room.guessBudget(p).unlimited).toBe(true);
  for (const text of ['abc', 'def', 'ghi', 'jkl']) g.act('chat', { text, requestId: text });
  expect(g.out.at(-1)).toMatchObject({ t: 'guess-result', accepted: true });
  expect(c.room.guessBudget(p).remaining).toBe(3);
});

test('host-picked challenges: only they roll, one-sided picks follow the preset, none means plain turns', () => {
  const roll = (settings, n = 60) => {
    const ctx = setup(2, { chaos: 'x4', ...settings });
    const seen = { artist: new Set(), guesser: new Set() };
    for (let i = 0; i < n; i++) {
      ctx.room.rollChaos();
      if (ctx.room.chaos) seen.artist.add(ctx.room.chaos.id);
      if (ctx.room.guesserChaos) seen.guesser.add(ctx.room.guesserChaos.id);
    }
    return seen;
  };
  const picked = roll({ chaosIds: ['mirror', 'upside', 'fog', 'batches'] });
  expect([...picked.artist].every((id) => ['mirror', 'upside'].includes(id))).toBe(true);
  expect([...picked.guesser].every((id) => ['fog', 'batches'].includes(id))).toBe(true);
  expect(picked.artist.size + picked.guesser.size).toBe(4);
  // Mixed with artist-only picks never yields a guesser challenge.
  expect(roll({ chaosIds: ['mirror'] }).guesser.size).toBe(0);
  // Artist preset with only guesser picks stays plain instead of switching sides.
  const strict = roll({ chaosPool: 'artist', chaosIds: ['fog'] });
  expect(strict.artist.size + strict.guesser.size).toBe(0);
  const none = roll({ chaosIds: [] });
  expect(none.artist.size + none.guesser.size).toBe(0);
});

test('only the host in the lobby can change the challenge list; unknown ids are dropped; omitting it keeps it', () => {
  const ctx = setup(2, { chaosIds: ['mirror', 'laggy', 'bogus', 'fog'] });
  expect(ctx.room.settings.chaosIds).toEqual(['mirror', 'fog']);
  ctx.ss[1].do('settings', { settings: { chaosIds: [] } });
  expect(ctx.room.settings.chaosIds).toEqual(['mirror', 'fog']);
  ctx.ss[0].do('settings', { settings: { rounds: 2 } });
  expect(ctx.room.settings.chaosIds).toEqual(['mirror', 'fog']);
  expect(ctx.ss[1].state().settings.chaosIds).toEqual(['mirror', 'fog']);
});

test('chaos rate: 1x-4x scale the share of chaos turns, 4x is every turn, off and unknown levels never roll', () => {
  const share = (level, turns = 400) => {
    const ctx = setup(2, { chaos: level, chaosPool: 'artist' });
    let hits = 0;
    for (let i = 0; i < turns; i++) { ctx.room.rollChaos(); if (ctx.room.chaos) hits++; }
    return hits / turns;
  };
  expect(share('x4')).toBe(1);
  expect(share('off')).toBe(0);
  expect(share('some')).toBe(0);
  const [x1, x2, x3] = [share('x1'), share('x2'), share('x3')];
  expect(x1).toBeGreaterThan(0.15); expect(x1).toBeLessThan(0.35);
  expect(x2).toBeGreaterThan(0.4); expect(x2).toBeLessThan(0.6);
  expect(x3).toBeGreaterThan(0.65); expect(x3).toBeLessThan(0.85);
});

test('reactions: dislike is allowed and broadcast to everyone, unknown emoji are dropped', () => {
  const ctx = setup(3);
  startDrawing(ctx);
  const guesser = ctx.ss.find((s) => s.id !== ctx.room.drawerId);
  const seen = (s) => s.out.filter((m) => m.t === 'react').map((m) => m.e);
  guesser.act('react', { e: '👎' });
  for (const s of ctx.ss) expect(seen(s)).toEqual(['👎']);
  advance(300);
  guesser.act('react', { e: '🤮' });
  expect(seen(guesser)).toEqual(['👎']);
});

test('redo restores the sender’s last undone stroke; a new stroke, clear or locked chaos stops it', () => {
  const ctx = setup(2);
  const { drawer } = startDrawing(ctx);
  const ids = () => ctx.room.strokes.map((s) => s.id.split(':')[1]);
  for (const id of ['a', 'b', 'c']) { drawer.act('stroke', { s: pen(id, [1, 1, 5, 5]) }); advance(300); }
  const coords = ctx.room.coordCount;
  drawer.act('undo'); drawer.act('undo');
  expect(ids()).toEqual(['a']);
  const g = ctx.ss.find((s) => s !== drawer);
  const i = g.mark();
  drawer.act('redo');
  expect(ids()).toEqual(['a', 'b']);
  expect(g.since(i, 'stroke')[0].s.id).toBe(`${drawer.id}:b`);
  drawer.act('redo');
  expect(ids()).toEqual(['a', 'b', 'c']);
  expect(ctx.room.coordCount).toBe(coords);
  drawer.act('redo'); // nothing left
  expect(ids()).toEqual(['a', 'b', 'c']);
  // Drawing something new forks history: the old redo stack is gone.
  drawer.act('undo');
  drawer.act('stroke', { s: pen('d', [2, 2]) });
  drawer.act('redo');
  expect(ids()).toEqual(['a', 'b', 'd']);
  // Clear drops it too.
  drawer.act('undo'); drawer.act('clear'); drawer.act('redo');
  expect(ctx.room.strokes).toEqual([]);
  // Guessers cannot redo on the artist's canvas.
  drawer.act('stroke', { s: pen('e', [3, 3]) }); drawer.act('undo');
  g.act('redo');
  expect(ctx.room.strokes).toEqual([]);
});

test('redo does not refund or spend Five Strokes budget and respects locked chaos', () => {
  const ctx = setup(2);
  const { drawer } = startDrawing(ctx);
  ctx.room.chaos = tw('fivestrokes');
  drawer.act('stroke', { s: pen('p1', [1, 1]) });
  advance(300);
  drawer.act('undo');
  const used = ctx.room.strokeUsed;
  drawer.act('redo');
  expect(ctx.room.strokes.length).toBe(1);
  expect(ctx.room.strokeUsed).toBe(used);
  drawer.act('undo');
  ctx.room.chaos = tw('permanent');
  drawer.act('redo');
  expect(ctx.room.strokes).toEqual([]);
  expect(drawer.since(0, 'draw-reject').at(-1).reason).toBe('locked');
});

test('redo in the lobby is per player', () => {
  const ctx = setup(2);
  const [a, b] = ctx.ss;
  a.act('stroke', { s: pen('x', [10, 10]) });
  b.act('stroke', { s: pen('y', [20, 20]) });
  a.act('undo'); b.act('undo');
  a.act('redo');
  expect(ctx.room.strokes.map((s) => s.id)).toEqual([`${a.id}:x`]);
});

test('host pause freezes the timer, blocks guesses and drawing, and resume restores the clock', () => {
  const ctx = setup(3);
  const { drawer, guessers: [b] } = startDrawing(ctx);
  const host = ctx.ss.find((s) => s.id === ctx.room.hostId);
  advance(10000);
  host.do('pause', { on: true });
  const frozen = b.state();
  expect(frozen.hostPaused).toBe(true);
  expect(frozen.paused).toEqual(expect.objectContaining({ reason: 'Paused by the host' }));
  advance(60000);
  expect(ctx.room.state).toBe('drawing');
  expect(ctx.room.timeLeft()).toBe(frozen.timeLeft);
  expect(ctx.room.clockMs()).toBe(frozen.gameMs);

  const guessMark = b.mark();
  b.act('chat', { text: ctx.room.word, requestId: 'paused-guess' });
  expect(ctx.room.guessed.size).toBe(0);
  expect(b.since(guessMark, 'guess-result')[0]?.accepted).toBe(false);
  const drawMark = drawer.mark();
  drawer.act('stroke', { s: pen('during-pause', [1, 1]) });
  expect(drawer.since(drawMark, 'draw-reject')[0]?.reason).toBe('paused');

  host.do('pause', { on: false });
  expect(b.state().paused).toBeNull();
  expect(b.state().timeLeft).toBe(frozen.timeLeft);
  advance(1000);
  expect(ctx.room.timeLeft()).toBe(frozen.timeLeft - 1000);
});

test('only the host can pause, and pausing outside play does nothing', () => {
  const ctx = setup(3);
  const other = ctx.ss.find((s) => s.id !== ctx.room.hostId);
  other.do('start');
  expect(ctx.room.state).toBe('lobby');
  ctx.ss.find((s) => s.id === ctx.room.hostId).do('pause', { on: true });
  expect(ctx.room.hostPaused).toBe(false);
  expect(ctx.room.pausedAt).toBe(0);

  const { guessers: [b] } = startDrawing(ctx);
  b.do('pause', { on: true });
  expect(ctx.room.hostPaused).toBe(false);
  expect(b.state().paused).toBeNull();
});

test('a host pause holds across a phase change, and the new host can resume', () => {
  const ctx = setup(3);
  const { drawer, guessers: [b, c] } = startDrawing(ctx);
  expect(ctx.room.hostId).toBe(drawer.id);
  drawer.do('pause', { on: true });
  drawer.do('leave');
  expect(ctx.room.state).toBe('reveal');
  expect(ctx.room.pausedAt).toBeTruthy();
  advance(REVEAL_MS + 60000);
  expect(ctx.room.state).toBe('reveal');

  const newHost = [b, c].find((s) => s.id === ctx.room.hostId);
  newHost.do('pause', { on: false });
  expect(ctx.room.pausedAt).toBe(0);
  advance(REVEAL_MS + 1);
  expect(ctx.room.state).toBe('choosing');
});

test('a reconnect is reported ahead of a host pause, and the host pause outlasts it', () => {
  const ctx = setup(3);
  const { drawer, guessers: [b] } = startDrawing(ctx);
  drawer.do('pause', { on: true });
  drawer.drop();
  expect(b.state().paused.reason).toBe(`Waiting for ${drawer.name} to reconnect…`);
  const back = sock('back');
  back.do('join', { room: ctx.code, name: drawer.name, token: drawer.out.find((m) => m.t === 'welcome').token });
  expect(b.state().paused.reason).toBe('Paused by the host');
});

test('going back to the lobby clears a host pause', () => {
  const ctx = setup(2);
  const { drawer, guessers: [b] } = startDrawing(ctx);
  drawer.do('pause', { on: true });
  b.do('leave');
  expect(ctx.room.state).toBe('lobby');
  expect(ctx.room.hostPaused).toBe(false);
  expect(drawer.state().paused).toBeNull();
});

test('sentence guesses score; a list containing the answer stays private and spends a Limited attempt', () => {
  const c = startChallenges(3, null, 'limited'), [a, b] = c.guessers, word = c.room.word;
  const pa = c.room.players.get(a.id);
  let ma = a.mark(), mb = b.mark();
  a.act('chat', { text: `${word} dog car`, requestId: 'list' });
  expect(a.chats(ma).map((m) => [m.kind, m.text])).toEqual([['close', `“${word} dog car” — try one guess. Not shown to others.`]]);
  expect(a.out.at(-1)).toMatchObject({ t: 'guess-result', requestId: 'list', accepted: false });
  expect(b.chats(mb)).toEqual([]);
  expect(c.room.guessBudget(pa).remaining).toBe(2);
  a.act('chat', { text: `${word} dog car` }); // repeats stay free
  expect(c.room.guessBudget(pa).remaining).toBe(2);
  a.act('chat', { text: 'zzz' }); a.act('chat', { text: 'yyy' });
  expect(c.room.guessBudget(pa).remaining).toBe(0);
  ma = a.mark();
  a.act('chat', { text: `${word} or cow` });
  expect(a.chats(ma)).toEqual([]);
  expect(a.since(ma, 'toast')[0].text).toMatch(/Next attempt/);
  expect(b.chats(mb).map((m) => m.text)).toEqual(['zzz', 'yyy']);
  b.act('chat', { text: `is it a ${word}?` });
  expect(c.room.guessed.has(b.id)).toBe(true);
});

test('lists with a short-answer plural or a long answer stay private and spend a Limited attempt', () => {
  for (const [answer, list] of [['cd', 'CDs or DVDs'], ['a dog with a red hat', 'a dog with a red hat or cat']]) {
    const ctx = setup(3, { hints: 0, customWords: 'cd, a dog with a red hat' });
    ctx.ss[0].do('start');
    ctx.room.chaos = null;
    ctx.room.guesserChaos = tw('limited');
    const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
    drawer.act('choose', { i: ctx.room.choices.findIndex((c) => c.word === answer) });
    expect(ctx.room.word).toBe(answer);
    const [a, b] = ctx.ss.filter((s) => s !== drawer);
    const ma = a.mark(), mb = b.mark();
    a.act('chat', { text: list });
    expect(a.chats(ma).map((m) => m.kind)).toEqual(['close']);
    expect(b.chats(mb)).toEqual([]);
    expect(drawer.chats(ma).filter((m) => m.text === list)).toEqual([]);
    expect(ctx.room.guessBudget(ctx.room.players.get(a.id)).remaining).toBe(2);
    expect(ctx.room.guessed.has(a.id)).toBe(false);
  }
});

// Deals straight from a lobby room: each call is a new turn one second later.
function deal(room, n = room.settings.wordChoices, avoid) {
  room.turnSeq++;
  now += 1000;
  return room.pickWords(n, avoid).map((c) => c.word);
}
const EIGHT = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

test('word memory: never-seen first, then only the oldest 25%, so a word returns after 75% of its pool', () => {
  const { room } = setup(2, { customWords: EIGHT.join(','), wordChoices: 1 });
  const seq = Array.from({ length: 48 }, () => deal(room)[0]);
  expect(new Set(seq.slice(0, 8)).size).toBe(8);
  expect(seq.slice(0, 2)).toContain(seq[8]);
  for (let i = 0; i < seq.length; i++) {
    const back = seq.indexOf(seq[i], i + 1);
    if (back > 0) expect(back - i).toBeGreaterThanOrEqual(7);
  }
});

test('family cooldown skips shared content words, then relaxes to the window, then to anything', () => {
  const { room } = setup(2, { customWords: 'golf ball', wordChoices: 1 });
  expect(deal(room)).toEqual(['golf ball']);
  room.settings.customWords = ['golf ball', 'golf carts', 'golf club', 'apple', 'banana', 'cherry', 'mango', 'lemon'];
  const at = (oldest) => {
    room.customSeen = new Map(room.settings.customWords.map((w) => [w, now]));
    oldest.forEach((w, i) => room.customSeen.set(w, i + 1));
  };
  // Window = two oldest; "golf carts" shares "golf" with last turn's card.
  at(['golf carts', 'apple']);
  expect(deal(room)).toEqual(['apple']);
  // Both window words are golf: the cooldown gives way before the window does.
  at(['golf carts', 'golf club']);
  expect(['golf carts', 'golf club']).toContain(deal(room)[0]);
  // Five cards from a window of two: the rest come from anywhere, all distinct.
  at(['banana', 'cherry']);
  const five = deal(room, 5);
  expect(new Set(five).size).toBe(5);
  expect(five).toEqual(expect.arrayContaining(['banana', 'cherry']));
});

test('custom words are one card per deal, rotate by recency and are never written to disk', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'squiggle-room-')), 'h.json');
  const history = new WordHistory({ path, valid: null, delay: 1e9 });
  setWordHistory(history);
  const custom = ['my secret sam', 'inside joke', 'aunt rita', 'lucky sock'];
  const ctx = setup(2, { customOnly: false, customWords: custom.join(','), wordChoices: 3 });
  ctx.ss[0].do('start');
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
  const first = ctx.room.choices.map((c) => c.word);
  drawer.act('reroll');
  const rerolled = ctx.room.choices.map((c) => c.word);
  const shown = [], counts = new Map();
  for (let i = 0; i < 200; i++) {
    const cards = deal(ctx.room).filter((w) => custom.includes(w));
    expect(cards.length).toBeLessThanOrEqual(1);
    for (const w of cards) { shown.push(w); counts.set(w, (counts.get(w) || 0) + 1); }
  }
  // Each custom word comes back only after the other three: an even rotation,
  // not the old "same unpicked custom word on ~87.5% of turns".
  for (let i = 4; i < shown.length; i++) expect(shown.slice(i - 3, i)).not.toContain(shown[i]);
  for (const w of custom) expect(counts.get(w) / 200).toBeLessThan(0.25);
  history.flush();
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  for (const w of [...first, ...rerolled]) expect(Object.hasOwn(saved, w)).toBe(!custom.includes(w));
  for (const w of custom) expect(saved).not.toHaveProperty(w);
  expect(Object.keys(saved).length).toBeGreaterThan(10);
});

test('word memory survives a rematch and dealt cards come in shuffled order', () => {
  const ctx = setup(2, { customWords: EIGHT.join(','), wordChoices: 1 });
  ctx.ss[0].do('start');
  const firstGame = ctx.room.choices[0].word;
  ctx.room.toLobby();
  ctx.ss[0].do('start');
  expect(ctx.room.choices[0].word).not.toBe(firstGame);
  expect(ctx.room.customSeen.has(firstGame)).toBe(true);

  const mix = setup(2, { customOnly: false, customWords: '', wordChoices: 3 }).room;
  const DIFFS = ['easy', 'medium', 'hard'];
  let unsorted = false, sameTier = false;
  const firstDeck = new Set();
  for (let i = 0; i < 40; i++) {
    const cards = mix.pickWords(3);
    expect(new Set(cards.map((c) => c.deck.id)).size).toBe(3);
    firstDeck.add(cards[0].deck.id);
    const d = cards.map((c) => DIFFS.indexOf(c.diff));
    if (d.some((x, k) => k && x < d[k - 1])) unsorted = true;
    if (new Set(d).size < 3) sameTier = true;
  }
  expect(unsorted && sameTier).toBe(true);
  expect(firstDeck.size).toBe(3);
});

test('decoy doodle adds seeded strokes from frame 1 that survive undo, redo and clear while artist strokes undo/redo normally', () => {
  const c = startChallenges(3, 'decoy', null);
  const decoys = c.room.strokes.filter((s) => s.decoy);
  expect(decoys.length).toBeGreaterThanOrEqual(1);
  expect(decoys.length).toBeLessThanOrEqual(2);
  for (const g of c.guessers) {
    expect(g.out.findLast((m) => m.t === 'clear').strokes).toEqual(decoys);
  }
  const n0 = decoys.length;
  // Artist cannot undo decoy strokes, even before drawing anything.
  c.drawer.act('undo');
  expect(c.room.strokes).toHaveLength(n0);
  // Artist strokes undo and redo normally without touching decoys.
  c.drawer.act('stroke', { s: pen('a1', [10, 10, 20, 20]) });
  c.drawer.act('stroke', { s: pen('a2', [30, 30, 40, 40]) });
  expect(c.room.strokes).toHaveLength(n0 + 2);
  c.drawer.act('undo');
  expect(c.room.strokes).toHaveLength(n0 + 1);
  c.drawer.act('redo');
  expect(c.room.strokes).toHaveLength(n0 + 2);
  c.drawer.act('undo');
  c.drawer.act('undo');
  c.drawer.act('undo');
  expect(c.room.strokes).toEqual(decoys);
  // Redo still restores artist stroke after hitting the decoy floor; clear wipes artist strokes and redo stack, keeping decoys.
  c.drawer.act('redo');
  expect(c.room.strokes).toHaveLength(n0 + 1);
  c.drawer.act('clear');
  expect(c.room.strokes).toEqual(decoys);
  for (const g of c.guessers) expect(g.out.findLast((m) => m.t === 'clear').strokes).toEqual(decoys);
  c.drawer.act('redo');
  expect(c.room.strokes).toEqual(decoys);
  // Gallery includes the decoy strokes.
  c.drawer.act('skip');
  expect(c.room.gallery.at(-1).strokes).toEqual(decoys);
});

test('gravity ink records turn endMs on reveal and gallery for deterministic rendering', () => {
  const c = startChallenges(2, 'gravity', null);
  c.drawer.act('stroke', { s: pen('g1', [50, 50, 100, 50]) });
  expect(c.room.strokes[0].gravity).toBe(true);
  advance(12345);
  c.drawer.act('skip');
  expect(c.room.reveal.endMs).toBe(12345);
  expect(c.room.gallery.at(-1).endMs).toBe(12345);
  expect(c.room.gallery.at(-1).deck).toEqual({ id: expect.any(String), name: expect.any(String), icon: expect.any(String) });
});

// Draws one stroke and skips, so the turn lands in the gallery; then leaves the reveal.
function drawAndSkip(ctx) {
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
  drawer.act('choose', { i: 0 });
  drawer.act('stroke', { s: pen(`s${ctx.room.turnSeq}`, [5, 5, 50, 50]) });
  drawer.act('skip');
  expect(ctx.room.state).toBe('reveal');
  advance(REVEAL_MS);
  return drawer;
}

test('recap: most repeated wrong guess first, then longest; one per player; no close or answer-mentioning guesses', () => {
  const g = (id, text, close = false) => ({ id, text, close });
  const list = [
    g('a', 'toilet'), g('b', 'Toilet!'), g('c', 'sad potato'), g('a', 'a very long guess indeed'),
    g('d', 'rabbt', true), g('d', 'big rabbit ears'), g('c', 'toilet'), g('e', 'hat'),
  ];
  expect(recapGuesses(list, 'rabbit')).toEqual([
    { text: 'toilet', by: 'b', n: 3 },
    { text: 'a very long guess indeed', by: 'a', n: 1 },
    { text: 'sad potato', by: 'c', n: 1 },
  ]);
  // A player whose guesses all went to earlier picks is skipped, not repeated.
  expect(recapGuesses([g('a', 'one'), g('a', 'two')], 'rabbit')).toEqual([{ text: 'one', by: 'a', n: 1 }]);
  expect(recapGuesses([g('a', 'rabbt', true)], 'rabbit')).toEqual([]);
});

test('reveal carries the wrong-guess recap; close guesses stay out', () => {
  const ctx = setup(3);
  const { drawer, guessers: [b, c] } = startDrawing(ctx);
  b.act('chat', { text: 'sad potato' });
  c.act('chat', { text: 'sad potato' });
  c.act('chat', { text: 'toilet' });
  b.act('chat', { text: ctx.room.word.slice(0, -1) }); // a near typo, "sooo close"
  drawer.act('skip');
  expect(ctx.room.reveal.recap.map((r) => r.text)).toEqual(['sad potato', 'toilet']);
  expect(new Set(ctx.room.reveal.recap.map((r) => r.by)).size).toBe(2);
  expect(b.state().reveal.recap.length).toBe(2);
  advance(REVEAL_MS);
  expect(ctx.room.wrongGuesses).toEqual([]);
});

test('finale: only the last drawer of the last round scores 2× for guessers and drawer', () => {
  const ctx = setup(3);
  ctx.ss[0].do('start');
  drawAndSkip(ctx);
  expect(ctx.room.finale).toBe(false);
  drawAndSkip(ctx);
  expect(ctx.room.state).toBe('choosing');
  expect(ctx.room.finale).toBe(true);
  expect(ctx.ss[0].state().finale).toBe(true);
  expect(ctx.ss[0].chats().some((m) => /FINALE/.test(m.text))).toBe(true);
  const drawer = ctx.ss.find((s) => s.id === ctx.room.drawerId);
  const [b, c] = ctx.ss.filter((s) => s !== drawer);
  drawer.act('choose', { i: 0 });
  const r = ctx.room;
  const modes = () => [r.chaos, r.guesserChaos].filter(Boolean);
  const before = r.players.get(b.id).score;
  advance(10000);
  b.act('chat', { text: r.word });
  const pts = r.players.get(b.id).score - before;
  const base = guesserPts({ elapsed: 10000, scoreLen: r.scoreLen, diff: r.diff, chaos: modes(), streak: 1 });
  expect(pts).toBe(base * 2);
  expect(r.players.get(drawer.id).score).toBe(drawerPts({ solved: 1, eligible: 2, diff: r.diff, chaos: modes() }) * 2);
  c.act('chat', { text: r.word });
  expect(r.reveal.finale).toBe(true);
  expect(r.reveal.deltas.find((d) => d.drawer).pts).toBe(drawerPts({ solved: 2, eligible: 2, diff: r.diff, chaos: modes(), all: true }) * 2);
  advance(REVEAL_MS);
  expect(r.state).toBe('end');
  expect(r.finale).toBe(false);
});

test('finale: when the planned last drawer leaves, the actual last turn becomes the finale and earlier points double', () => {
  const ctx = setup(4);
  ctx.ss[0].do('start');
  drawAndSkip(ctx);
  drawAndSkip(ctx);
  const r = ctx.room;
  const drawer = ctx.ss.find((s) => s.id === r.drawerId);
  drawer.act('choose', { i: 0 });
  expect(r.finale).toBe(false);
  const last = ctx.ss.find((s) => s.id === r.queue[0]);
  const b = ctx.ss.find((s) => s !== drawer && s !== last);
  const before = r.players.get(b.id).score;
  advance(5000);
  b.act('chat', { text: r.word });
  const plain = r.players.get(b.id).score - before;
  const drawerPlain = r.players.get(drawer.id).score;
  last.do('leave');
  expect(r.finale).toBe(true);
  expect(r.state).toBe('drawing');
  expect(r.players.get(b.id).score - before).toBe(plain * 2);
  expect(r.guessed.get(b.id).pts).toBe(plain * 2);
  expect(r.players.get(drawer.id).score).toBeGreaterThan(drawerPlain);
  expect(b.state().finale).toBe(true);
});

test('finale: a last drawer who drops also makes the current turn the finale', () => {
  const ctx = setup(3);
  ctx.ss[0].do('start');
  drawAndSkip(ctx);
  const r = ctx.room;
  expect(r.finale).toBe(false);
  ctx.ss.find((s) => s.id === r.queue[0]).drop();
  expect(r.finale).toBe(true);
});

test('finale: at most one per game; a reconnected or fresh drawer after it plays at normal points', () => {
  const ctx = setup(3);
  ctx.ss[0].do('start');
  drawAndSkip(ctx);
  const r = ctx.room;
  const drawer = ctx.ss.find((s) => s.id === r.drawerId);
  drawer.act('choose', { i: 0 });
  const last = ctx.ss.find((s) => s.id === r.queue[0]);
  const token = last.out.find((m) => m.t === 'welcome').token;
  last.drop();
  expect(r.finale).toBe(true);
  // Back within grace: still queued for this round, but the finale is spent.
  const back = sock('back');
  back.do('join', { room: ctx.code, name: last.name, token });
  back.id = last.id;
  const fresh = sock('F');
  fresh.do('join', { room: ctx.code, name: 'F' });
  fresh.id = fresh.out.find((m) => m.t === 'welcome').id;
  drawer.act('skip');
  advance(REVEAL_MS);
  expect(r.drawerId).toBe(back.id);
  expect(r.finale).toBe(false);
  back.act('choose', { i: 0 });
  const guesser = ctx.ss.find((s) => s.id !== back.id && s !== last);
  const before = r.players.get(guesser.id).score;
  advance(10000);
  guesser.act('chat', { text: r.word });
  const modes = [r.chaos, r.guesserChaos].filter(Boolean);
  expect(r.players.get(guesser.id).score - before).toBe(guesserPts({ elapsed: 10000, scoreLen: r.scoreLen, diff: r.diff, chaos: modes, streak: 1 }));
  back.act('skip'); // ignored: someone solved, so end by time
  advance(r.timeLeft() + 1);
  advance(REVEAL_MS);
  expect(r.drawerId).toBe(fresh.id);
  expect(r.finale).toBe(false);
  expect(ctx.ss[0].chats().filter((m) => /FINALE/.test(m.text))).toHaveLength(1);
});

test('finale: the planned last drawer leaving during reveal changes nothing', () => {
  const ctx = setup(4);
  ctx.ss[0].do('start');
  drawAndSkip(ctx);
  drawAndSkip(ctx);
  const r = ctx.room;
  const drawer = ctx.ss.find((s) => s.id === r.drawerId);
  drawer.act('choose', { i: 0 });
  const last = ctx.ss.find((s) => s.id === r.queue[0]);
  const b = ctx.ss.find((s) => s !== drawer && s !== last && r.turnEligible.includes(s.id) && s.id !== r.queue[0]);
  advance(5000);
  b.act('chat', { text: r.word });
  advance(r.timeLeft() + 1);
  expect(r.state).toBe('reveal');
  const scores = [...r.players.values()].map((p) => p.score);
  const reveal = structuredClone(r.reveal);
  last.do('leave');
  expect(r.finale).toBe(false);
  expect(r.reveal).toEqual(reveal);
  expect(r.reveal.allBonus).toBe(0);
  expect([...r.players.values()].map((p) => p.score)).toEqual(scores.filter((_, i) => i !== ctx.ss.indexOf(last)));
  expect(ctx.ss[0].chats().some((m) => /FINALE/.test(m.text))).toBe(false);
  advance(REVEAL_MS);
  expect(r.state).toBe('end');
});

test('MVP vote: end state only, not your own, one changeable vote each, ties share, no points', () => {
  const ctx = setup(3);
  const [a, b, c] = ctx.ss;
  a.do('start');
  const byDrawer = {};
  for (let i = 0; i < 3; i++) {
    const d = drawAndSkip(ctx);
    byDrawer[d.id] = ctx.room.gallery.at(-1).id;
  }
  const r = ctx.room;
  expect(r.state).toBe('end');
  expect(b.out.findLast((m) => m.t === 'gallery').gallery.map((g) => g.id)).toEqual([1, 2, 3]);
  const scores = () => [...r.players.values()].map((p) => p.score);
  const before = scores();
  a.do('vote', { id: byDrawer[a.id] });
  a.do('vote', { id: 999 });
  expect(a.state().mvp).toEqual({ tally: {}, winners: [], mine: null });
  a.do('vote', { id: byDrawer[b.id] });
  b.do('vote', { id: byDrawer[c.id] });
  expect(c.state().mvp.winners.sort()).toEqual([byDrawer[b.id], byDrawer[c.id]].sort());
  c.do('vote', { id: byDrawer[b.id] });
  expect(c.state().mvp).toEqual({ tally: { [byDrawer[b.id]]: 2, [byDrawer[c.id]]: 1 }, winners: [byDrawer[b.id]], mine: byDrawer[b.id] });
  a.do('vote', { id: byDrawer[c.id] }); // changing a vote moves it
  expect(a.state().mvp.tally).toEqual({ [byDrawer[b.id]]: 1, [byDrawer[c.id]]: 2 });
  a.do('vote', { id: null });
  expect(a.state().mvp.mine).toBe(null);
  expect(scores()).toEqual(before);
  a.do('again');
  expect(r.votes.size).toBe(0);
  a.do('vote', { id: byDrawer[b.id] });
  expect(r.votes.size).toBe(0);
});

test('MVP vote: leaving drops the vote; fresh or post-grace joins cannot vote; a reconnected artist still cannot self-vote; tokens stay private', () => {
  const ctx = setup(3);
  const [a, b, c] = ctx.ss;
  a.do('start');
  const byDrawer = {};
  for (let i = 0; i < 3; i++) byDrawer[drawAndSkip(ctx).id] = ctx.room.gallery.at(-1).id;
  const r = ctx.room;
  expect(r.state).toBe('end');
  const token = (s) => s.out.find((m) => m.t === 'welcome').token;
  // A leaver's vote is removed from the tally.
  c.do('vote', { id: byDrawer[a.id] });
  expect(a.state().mvp.tally).toEqual({ [byDrawer[a.id]]: 1 });
  c.do('leave');
  expect(a.state().mvp.tally).toEqual({});
  // A fresh join at the end screen cannot vote.
  const f = sock('F');
  f.do('join', { room: ctx.code, name: 'F' });
  f.do('vote', { id: byDrawer[a.id] });
  expect(r.votes.size).toBe(0);
  expect(f.since(0, 'toast').at(-1).text).toMatch(/Only players/);
  // The artist reconnecting within grace is the same voter and still cannot vote for their own drawing.
  const tb = token(b);
  b.drop();
  const b2 = sock('B2');
  b2.do('join', { room: ctx.code, name: 'B', token: tb });
  b2.do('vote', { id: byDrawer[b.id] });
  expect(r.votes.size).toBe(0);
  b2.do('vote', { id: byDrawer[a.id] });
  expect(b2.state().mvp.mine).toBe(byDrawer[a.id]);
  // After the grace window a rejoin is a new player with a new token: no vote.
  const ta = token(a);
  a.drop();
  advance(GAME_GRACE + 1);
  expect(r.players.has(a.id)).toBe(false);
  const a2 = sock('A2');
  a2.do('join', { room: ctx.code, name: 'A', token: ta });
  expect(a2.out.find((m) => m.t === 'welcome').token).not.toBe(ta);
  a2.do('vote', { id: byDrawer[b.id] });
  expect(r.votes.size).toBe(1);
  // No reconnect token reaches any client in snapshots or the gallery.
  const tokens = [...r.players.values()].map((p) => p.token).concat(ta, tb, token(c));
  for (const s of [a, b, c, f, b2, a2]) {
    const seen = JSON.stringify(s.out.filter((m) => m.t !== 'welcome'));
    for (const t of tokens) expect(seen).not.toContain(t);
  }
});

test('MVP vote is ignored before the game ends', () => {
  const ctx = setup(2);
  ctx.ss[0].do('start');
  drawAndSkip(ctx);
  const id = ctx.room.gallery[0].id;
  const voter = ctx.ss.find((s) => s.id !== ctx.room.gallery[0].drawer.id);
  voter.do('vote', { id });
  expect(ctx.room.votes.size).toBe(0);
});

test('wins tonight: every top scorer gets a win, ties share, tally survives rematches and reconnects', () => {
  const ctx = setup(3);
  const [a, b, c] = ctx.ss;
  const r = ctx.room;
  const finish = (scores) => {
    a.do('start');
    [...r.players.values()].forEach((p, i) => { p.score = scores[i]; });
    r.endGame();
  };
  finish([300, 100, 300]);
  expect(a.state().wins).toEqual([{ name: 'A', n: 1 }, { name: 'C', n: 1 }]);
  a.do('again');
  finish([0, 500, 400]);
  a.do('again');
  finish([0, 0, 0]); // nobody scored: no winner
  expect(r.wins.size).toBe(3);
  const tokenC = c.out.find((m) => m.t === 'welcome').token;
  c.drop();
  const c2 = sock('C2');
  c2.do('join', { room: ctx.code, name: 'Cee', token: tokenC });
  expect(c2.state().wins).toEqual([{ name: 'A', n: 1 }, { name: 'B', n: 1 }, { name: 'Cee', n: 1 }]);
  expect(JSON.stringify(c2.state())).not.toContain(tokenC);
});
