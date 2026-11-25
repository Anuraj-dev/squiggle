import { afterAll, beforeAll, expect, test } from 'bun:test';

const PORT = 3900 + Math.floor(Math.random() * 90);
let proc;

beforeAll(async () => {
  proc = Bun.spawn(['bun', 'server.js'], { cwd: import.meta.dir, env: { ...process.env, PORT: String(PORT), SQUIGGLE_HISTORY: `${process.env.TMPDIR || '/tmp'}/squiggle-history-${PORT}.json` }, stdout: 'ignore', stderr: 'inherit' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return; } catch {}
    await Bun.sleep(100);
  }
  throw new Error('server did not start');
});
afterAll(() => proc?.kill());

function client(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const c = { ws, msgs: [], seen: [], state: null, waiters: [] };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    c.seen.push(m);
    c.msgs.push(m);
    if (m.t === 'state') c.state = m;
    c.waiters = c.waiters.filter((w) => !(w.pred(m) && (w.resolve(m), true)));
  };
  c.send = (t, d = {}) => ws.send(JSON.stringify({ t, ...d }));
  // Turn-bound actions carry the phase token from the latest state, as the app does.
  c.act = (t, d = {}) => c.send(t, { seq: c.state?.seq, ...d });
  c.wait = (pred, ms = 12000) => {
    const hit = c.msgs.find(pred);
    if (hit) { c.msgs = c.msgs.filter((m) => m !== hit); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${name}: timed out; last: ${JSON.stringify(c.seen.slice(-4)).slice(0, 800)}`)), ms);
      c.waiters.push({ pred, resolve: (m) => { clearTimeout(t); c.msgs = c.msgs.filter((x) => x !== m); resolve(m); } });
    });
  };
  c.open = new Promise((r) => (ws.onopen = r));
  c.close = () => { try { ws.close(); } catch {} };
  return c;
}
const st = (pred) => (m) => m.t === 'state' && pred(m);

async function roomPair() {
  const a = client('A'), b = client('B');
  await Promise.all([a.open, b.open]);
  a.send('join', { name: 'Alice', avatar: '🦊', color: '#ffc93c' });
  const wa = await a.wait((m) => m.t === 'welcome');
  b.send('join', { room: wa.code, name: 'Bob', avatar: '🐸' });
  const wb = await b.wait((m) => m.t === 'welcome');
  await a.wait(st((m) => m.players.length === 2));
  return { a, b, wa, wb };
}

test('full game: create, join, draw, guess, close-guess, reveal, end', async () => {
  const { a, b, wa, wb } = await roomPair();

  b.send('settings', { settings: { rounds: 9 } });
  b.send('chat', { text: 'after-b-settings' });
  await a.wait((m) => m.t === 'chat' && m.text === 'after-b-settings');
  expect(a.state.settings.rounds).toBe(3);

  a.send('settings', { settings: { rounds: 1, drawTime: 999, hints: 1, wordChoices: 3, customWords: 'foo, bar' } });
  const s1 = await b.wait(st((m) => m.settings.rounds === 1));
  expect(s1.settings.drawTime).toBe(240);
  expect(s1.settings.customWords).toBeUndefined();
  expect(s1.settings.customWordCount).toBe(2);
  const hostState = await a.wait(st((m) => m.settings.rounds === 1 && Array.isArray(m.settings.customWords)));
  expect(hostState.settings.customWords).toEqual(['foo', 'bar']);

  b.act('stroke', { s: { id: 'x1', tool: 'pen', color: '#ff0000', size: 5, pts: [10, 10] } });
  const relayed = await a.wait((m) => m.t === 'stroke');
  expect(relayed.s.by).toBe(wb.id);
  expect(relayed.s.id).toBe(`${wb.id}:x1`);

  a.send('start');
  for (let turn = 0; turn < 2; turn++) {
    const [ca, cb] = await Promise.all([a, b].map((c) => c.wait(st((m) => m.state === 'choosing'))));
    const [drawer, guesser] = ca.drawerId === wa.id ? [a, b] : [b, a];
    const [dState, gState] = ca.drawerId === wa.id ? [ca, cb] : [cb, ca];
    expect(dState.choices.length).toBeGreaterThan(0);
    expect(gState.choices).toBeNull();
    drawer.act('choose', { i: 0 });
    const g = await guesser.wait(st((m) => m.state === 'drawing'));
    expect(g.word).toBeNull();
    expect(g.hint).toMatch(/_/);
    const { word } = await drawer.wait(st((m) => m.state === 'drawing'));

    guesser.act('stroke', { s: { id: 'bad', tool: 'pen', color: '#000000', size: 5, pts: [1, 1] } });
    guesser.send('chat', { text: 'after-bad-draw' });
    await drawer.wait((m) => m.t === 'chat' && m.text === 'after-bad-draw');
    expect(drawer.seen.filter((m) => m.t === 'stroke' && String(m.s?.id).endsWith(':bad'))).toEqual([]);

    drawer.act('stroke', { s: { id: 'd1', tool: 'pen', color: '#000000', size: 5, pts: [100, 100] } });
    drawer.act('pts', { id: 'd1', pts: [120, 130, 140, 150] });
    const did = drawer.state.you;
    const sr = await guesser.wait((m) => m.t === 'stroke' && m.s?.id === `${did}:d1`);
    expect(sr.s.id).toBe(`${did}:d1`);
    const pr = await guesser.wait((m) => m.t === 'pts');
    expect(pr.pts).toEqual([120, 130, 140, 150]);

    drawer.act('chat', { text: `it is ${word}` });
    await drawer.wait((m) => m.t === 'chat' && /spoilers/.test(m.text));

    if (word.replace(/[^a-z]/g, '').length >= 4) {
      const typo = word.slice(0, -1) + (word.endsWith('z') ? 'y' : 'z');
      guesser.act('chat', { text: typo });
      await guesser.wait((m) => m.t === 'chat' && m.kind === 'close');
    }
    guesser.act('chat', { text: word.toUpperCase() });
    await guesser.wait((m) => m.t === 'chat' && m.kind === 'correct');
    const rev = await a.wait(st((m) => m.state === 'reveal'));
    expect(rev.reveal.word).toBe(word);
    expect(rev.reveal.reason).toBe('all');
  }

  const gal = await a.wait((m) => m.t === 'gallery', 15000);
  expect(gal.gallery.length).toBe(2);
  const end = await a.wait(st((m) => m.state === 'end'));
  expect(end.end.ranking.length).toBe(2);
  expect(end.end.ranking[0].score).toBeGreaterThan(0);
  expect(end.end.ranking[0].rank).toBe(1);
  expect(end.players.find((p) => p.id === wb.id).name).toBe('Bob');

  const scoreB = end.players.find((p) => p.id === wb.id).score;
  b.ws.close();
  await a.wait(st((m) => m.players.some((p) => p.id === wb.id && !p.connected)));
  const b2 = client('B2');
  await b2.open;
  b2.send('join', { room: wa.code, name: 'Bob', token: wb.token });
  const wb2 = await b2.wait((m) => m.t === 'welcome');
  expect(wb2.id).toBe(wb.id);
  const s2 = await b2.wait(st(() => true));
  expect(s2.players.find((p) => p.id === wb.id).score).toBe(scoreB);
  expect(s2.players.length).toBe(2);

  a.send('again');
  await b2.wait(st((m) => m.state === 'lobby'));
  a.close(); b2.close();
}, 40000);

test('unknown room and static path traversal are rejected', async () => {
  const c = client('C');
  await c.open;
  c.send('join', { room: 'ZZZZZ', name: 'x' });
  const err = await c.wait((m) => m.t === 'error');
  expect(err.text).toMatch(/does not exist/);
  c.close();
  const r = await fetch(`http://127.0.0.1:${PORT}/..%2fserver.js`);
  expect(r.status).toBe(404);
});

test('temporary drop pauses a two-player game instead of dumping to lobby', async () => {
  const { a, b, wa, wb } = await roomPair();
  a.send('settings', { settings: { rounds: 1, drawTime: 80, wordChoices: 1, hints: 0 } });
  await b.wait(st((m) => m.settings.rounds === 1));
  a.send('start');
  const choosing = await a.wait(st((m) => m.state === 'choosing'));
  const drawer = choosing.drawerId === wa.id ? a : b;
  drawer.act('choose', { i: 0 });
  await a.wait(st((m) => m.state === 'drawing'));
  b.ws.close();
  const paused = await a.wait(st((m) => m.paused && m.state === 'drawing' && m.players.some((p) => p.id === wb.id && !p.connected)));
  expect(paused.state).not.toBe('lobby');
  const b2 = client('B-re');
  await b2.open;
  b2.send('join', { room: wa.code, name: 'Bob', token: wb.token });
  await b2.wait((m) => m.t === 'welcome');
  const resumed = await a.wait(st((m) => !m.paused && m.state === 'drawing' && m.players.some((p) => p.id === wb.id && p.connected)));
  expect(resumed.word || resumed.hint).toBeTruthy();
  a.close(); b2.close();
}, 20000);

test('malformed shapes are rejected and do not relay', async () => {
  const { a, b } = await roomPair();
  a.act('stroke', { s: { id: 'bad-el', tool: 'ellipse', color: '#000000', size: 5, pts: [100, 100] } });
  a.send('chat', { text: 'after-bad-ellipse' });
  await b.wait((m) => m.t === 'chat' && m.text === 'after-bad-ellipse');
  expect(b.seen.filter((m) => m.t === 'stroke')).toEqual([]);
  // The rejection goes to A on its own socket; B seeing the chat says nothing about A's delivery.
  const rej = await a.wait((m) => m.t === 'draw-reject');
  expect(rej.reason).toBe('pts');
  a.close(); b.close();
});
