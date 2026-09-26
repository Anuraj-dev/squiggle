import { afterAll, beforeAll, expect, test } from 'bun:test';

const PORT = 3900 + Math.floor(Math.random() * 90);
let proc;

beforeAll(async () => {
  proc = Bun.spawn(['bun', 'server.js'], { cwd: import.meta.dir, env: { ...process.env, PORT: String(PORT) }, stdout: 'ignore', stderr: 'inherit' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return; } catch {}
    await Bun.sleep(100);
  }
  throw new Error('server did not start');
});
afterAll(() => proc?.kill());

// A scripted player that records every message and can wait for one matching a predicate.
function client(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const c = { ws, msgs: [], state: null, waiters: [] };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    c.msgs.push(m);
    if (m.t === 'state') c.state = m;
    c.waiters = c.waiters.filter((w) => !(w.pred(m) && (w.resolve(m), true)));
  };
  c.send = (t, d = {}) => ws.send(JSON.stringify({ t, ...d }));
  c.wait = (pred, ms = 12000) => {
    const hit = c.msgs.find(pred);
    if (hit) { c.msgs = c.msgs.filter((m) => m !== hit); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${name}: timed out; last: ${JSON.stringify(c.msgs.slice(-3)).slice(0, 600)}`)), ms);
      c.waiters.push({ pred, resolve: (m) => { clearTimeout(t); c.msgs = c.msgs.filter((x) => x !== m); resolve(m); } });
    });
  };
  c.open = new Promise((r) => (ws.onopen = r));
  return c;
}
const st = (pred) => (m) => m.t === 'state' && pred(m);

test('full game: create, join, draw, guess, close-guess, reveal, end', async () => {
  const a = client('A'), b = client('B');
  await Promise.all([a.open, b.open]);
  a.send('join', { name: 'Alice', avatar: '🦊', color: '#ffc93c' });
  const wa = await a.wait((m) => m.t === 'welcome');
  expect(wa.code).toMatch(/^[A-Z0-9]{5}$/);

  b.send('join', { room: wa.code, name: '<img src=x>', avatar: '🐸' });
  const wb = await b.wait((m) => m.t === 'welcome');
  await a.wait(st((m) => m.players.length === 2));

  // Non-host cannot change settings; host can, and values are clamped.
  b.send('settings', { settings: { rounds: 9 } });
  a.send('settings', { settings: { rounds: 1, drawTime: 999, hints: 1, wordChoices: 3, customWords: 'foo, bar' } });
  const s1 = await b.wait(st((m) => m.settings.rounds === 1));
  expect(s1.settings.drawTime).toBe(240);
  expect(s1.settings.customWords).toEqual(['foo', 'bar']);

  // Lobby doodle relays to the other player.
  b.send('stroke', { s: { id: 'x1', tool: 'pen', color: '#ff0000', size: 5, pts: [10, 10] } });
  const relayed = await a.wait((m) => m.t === 'stroke');
  expect(relayed.s.by).toBe(wb.id);

  a.send('start');
  for (let turn = 0; turn < 2; turn++) {
    const [ca, cb] = await Promise.all([a, b].map((c) => c.wait(st((m) => m.state === 'choosing'))));
    const [drawer, guesser] = ca.drawerId === wa.id ? [a, b] : [b, a];
    const [dState, gState] = ca.drawerId === wa.id ? [ca, cb] : [cb, ca];
    expect(dState.choices.length).toBeGreaterThan(0);
    // The guesser must never receive choices or the word.
    expect(gState.choices).toBeNull();
    drawer.send('choose', { i: 0 });
    const g = await guesser.wait(st((m) => m.state === 'drawing'));
    expect(g.word).toBeNull();
    expect(g.hint).toMatch(/_/);
    const { word } = await drawer.wait(st((m) => m.state === 'drawing'));

    // Guessers cannot draw; drawer strokes relay.
    guesser.send('stroke', { s: { id: 'bad', tool: 'pen', color: '#000000', size: 5, pts: [1, 1] } });
    drawer.send('stroke', { s: { id: 'd1', tool: 'pen', color: '#000000', size: 5, pts: [100, 100] } });
    drawer.send('pts', { id: 'd1', pts: [120, 130, 140, 150] });
    const sr = await guesser.wait((m) => m.t === 'stroke');
    expect(sr.s.id).toBe('d1');
    const pr = await guesser.wait((m) => m.t === 'pts');
    expect(pr.pts).toEqual([120, 130, 140, 150]);

    // Drawer cannot spoil the word in chat.
    drawer.send('chat', { text: `it is ${word}` });
    await drawer.wait((m) => m.t === 'chat' && /spoilers/.test(m.text));

    // Near miss (one letter off) for words long enough to allow it.
    if (word.replace(/[^a-z]/g, '').length >= 4) {
      const typo = word.slice(0, -1) + (word.endsWith('z') ? 'y' : 'z');
      guesser.send('chat', { text: typo });
      await guesser.wait((m) => m.t === 'chat' && m.kind === 'close');
    }
    guesser.send('chat', { text: word.toUpperCase() });
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
  expect(end.players.find((p) => p.id === wb.id).name).toBe('<img src=x>');

  // Reconnect with token keeps the same player and score.
  const scoreB = end.players.find((p) => p.id === wb.id).score;
  b.ws.close();
  await Bun.sleep(100);
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
  a.ws.close(); b2.ws.close();
}, 40000);

test('unknown room and static path traversal are rejected', async () => {
  const c = client('C');
  await c.open;
  c.send('join', { room: 'ZZZZZ', name: 'x' });
  const err = await c.wait((m) => m.t === 'error');
  expect(err.text).toMatch(/does not exist/);
  c.ws.close();
  const r = await fetch(`http://127.0.0.1:${PORT}/..%2fserver.js`);
  expect(r.status).toBe(404);
});
