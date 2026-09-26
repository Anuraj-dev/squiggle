import { join, normalize } from 'node:path';
import { WORDS } from './words.js';

const PORT = Number(process.env.PORT) || 3789;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = join(import.meta.dir, 'public');
const W = 1000, H = 750; // logical canvas size shared with the client

const DEFAULTS = { rounds: 3, drawTime: 80, wordChoices: 3, hints: 2, maxPlayers: 12, chaos: false, customWords: [], customOnly: false };
const DIFF_MULT = { easy: 1, medium: 1.3, hard: 1.7 };
const CHOOSE_MS = 15000, REVEAL_MS = 6500;
const MODIFIERS = [
  { id: 'mirror', icon: '🪞', name: 'Mirror Mirror', desc: 'Everything you draw gets mirrored' },
  { id: 'rainbow', icon: '🌈', name: 'Rainbow Road', desc: 'Your brush is pure rainbow' },
  { id: 'tiny', icon: '🤏', name: 'Tiny Pen', desc: 'Brush stuck at the smallest size' },
  { id: 'onestroke', icon: '➰', name: 'One Line Wonder', desc: 'One stroke. No lifting. No undo.' },
  { id: 'mono', icon: '🖤', name: 'Noir', desc: 'Black ink only' },
  { id: 'shaky', icon: '☕', name: 'Too Much Coffee', desc: 'Your hand will not stop shaking' },
  { id: 'speed', icon: '⚡', name: 'Speedrun', desc: 'Half the time, 1.5x the points' },
  { id: 'blind', icon: '🙈', name: 'Blindfold', desc: 'The artist cannot see their own drawing' },
];
const REACTIONS = ['😂', '🔥', '😮', '🤯', '💀', '👏', '❤️', '🤔'];
const TOOLS = new Set(['pen', 'eraser', 'fill', 'line', 'rect', 'ellipse']);

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').trim().slice(0, max);
const clamp = (n, lo, hi, d) => (Number.isFinite(+n) ? Math.min(hi, Math.max(lo, Math.round(+n))) : d);
const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function makeCode() {
  let c;
  do c = Array.from({ length: 5 }, () => rand(CODE_CHARS)).join(''); while (rooms.has(c));
  return c;
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.order = [];
    this.hostId = null;
    this.settings = { ...DEFAULTS };
    this.state = 'lobby';
    this.round = 0;
    this.queue = [];
    this.drawerId = null;
    this.word = null;
    this.diff = null;
    this.choices = [];
    this.strokes = [];
    this.timers = [];
    this.deadline = 0;
    this.phaseLen = 0;
    this.turnStart = 0;
    this.revealed = [];
    this.guessed = new Map();
    this.ratings = new Map();
    this.gallery = [];
    this.used = new Set();
    this.modifier = null;
    this.banned = new Set();
    this.kickVotes = new Map();
    this.reveal = null;
    this.endData = null;
    this.drawerPts = 0;
    this.speedup = false;
  }

  get connected() { return [...this.players.values()].filter((p) => p.connected); }

  send(p, t, data = {}) {
    if (p?.connected && p.ws) p.ws.send(JSON.stringify({ t, ...data }));
  }

  broadcast(t, data = {}, exceptId = null) {
    const msg = JSON.stringify({ t, ...data });
    for (const p of this.players.values()) if (p.connected && p.ws && p.id !== exceptId) p.ws.send(msg);
  }

  system(text, tone = 'info') { this.broadcast('chat', { kind: 'system', tone, text }); }

  hint() {
    return [...this.word].map((ch, i) => (/[a-z0-9]/i.test(ch) && !this.revealed.includes(i) ? '_' : ch)).join('');
  }

  canSeeWord(p) {
    return p.id === this.drawerId || this.guessed.has(p.id) || this.state === 'reveal';
  }

  snapshot(p) {
    const up = [...this.ratings.values()].filter((v) => v > 0).length;
    return {
      you: p.id,
      code: this.code,
      hostId: this.hostId,
      settings: this.settings,
      state: this.state,
      round: this.round,
      drawerId: this.drawerId,
      timeLeft: this.deadline ? Math.max(0, this.deadline - Date.now()) : 0,
      phaseLen: this.phaseLen,
      hint: this.word && this.state === 'drawing' ? this.hint() : null,
      word: this.word && this.canSeeWord(p) ? this.word : null,
      diff: this.word ? this.diff : null,
      choices: this.state === 'choosing' && p.id === this.drawerId ? this.choices : null,
      modifier: this.modifier,
      reveal: this.state === 'reveal' ? this.reveal : null,
      end: this.state === 'end' ? this.endData : null,
      rating: { up, down: this.ratings.size - up, mine: this.ratings.get(p.id) || 0 },
      players: this.order.map((id) => this.players.get(id)).filter(Boolean).map((q) => ({
        id: q.id, name: q.name, avatar: q.avatar, color: q.color, score: q.score, connected: q.connected,
        guessed: this.guessed.has(q.id), streak: q.streak,
        kickVotes: this.kickVotes.get(q.id)?.size || 0,
      })),
    };
  }

  sync() { for (const p of this.players.values()) this.send(p, 'state', this.snapshot(p)); }

  clearTimers() { this.timers.forEach(clearTimeout); clearTimeout(this.phaseTimer); this.timers = []; this.deadline = 0; }

  phase(ms, fn) {
    clearTimeout(this.phaseTimer);
    this.phaseLen = ms;
    this.deadline = Date.now() + ms;
    this.phaseTimer = setTimeout(fn, ms);
  }

  // ---------- game flow ----------
  start(p) {
    if (p.id !== this.hostId || (this.state !== 'lobby' && this.state !== 'end')) return;
    if (this.connected.length < 2) return this.send(p, 'toast', { text: 'You need at least 2 players to start' });
    for (const q of this.players.values()) Object.assign(q, { score: 0, streak: 0, bestStreak: 0, close: 0, fastest: null });
    this.gallery = [];
    this.used.clear();
    this.round = 0;
    this.system('🎬 Game on! Good luck, artists.', 'good');
    this.nextRound();
  }

  nextRound() {
    this.round++;
    if (this.round > this.settings.rounds) return this.endGame();
    this.queue = this.order.filter((id) => this.players.get(id)?.connected);
    this.nextTurn();
  }

  nextTurn() {
    this.clearTimers();
    if (this.connected.length < 2) return this.toLobby('Not enough players left — back to the lobby.');
    let id = null;
    while (this.queue.length && !id) {
      const c = this.queue.shift();
      if (this.players.get(c)?.connected) id = c;
    }
    if (!id) return this.nextRound();
    Object.assign(this, { drawerId: id, word: null, diff: null, strokes: [], revealed: [], reveal: null, drawerPts: 0, speedup: false });
    this.guessed.clear();
    this.ratings.clear();
    this.modifier = this.settings.chaos ? rand(MODIFIERS.filter((m) => m.id !== this.modifier?.id)) : null;
    this.choices = this.pickWords(this.settings.wordChoices);
    this.state = 'choosing';
    this.phase(CHOOSE_MS, () => this.choose(Math.floor(Math.random() * this.choices.length)));
    this.broadcast('clear');
    this.sync();
  }

  pickWords(n) {
    const { customWords, customOnly } = this.settings;
    const diffOf = (w) => (w.length <= 5 ? 'easy' : w.length <= 10 ? 'medium' : 'hard');
    const diffs = n >= 3 ? ['easy', 'medium', 'hard'] : shuffle(['easy', 'medium', 'hard']);
    const out = [];
    for (let tries = 0; out.length < n && tries < 300; tries++) {
      let word, diff;
      if (customWords.length && (customOnly || Math.random() < 0.5)) { word = rand(customWords); diff = diffOf(word); }
      else { diff = diffs[out.length % 3]; word = rand(WORDS[diff]); }
      if (out.some((o) => o.word === word) || (this.used.has(word) && tries < 200)) continue;
      out.push({ word, diff });
    }
    if (!out.length) out.push({ word: rand(WORDS.easy), diff: 'easy' });
    const rank = { easy: 0, medium: 1, hard: 2 };
    return out.sort((a, b) => rank[a.diff] - rank[b.diff]);
  }

  choose(i) {
    if (this.state !== 'choosing') return;
    const c = this.choices[clamp(i, 0, this.choices.length - 1, 0)];
    this.clearTimers();
    Object.assign(this, { word: c.word, diff: c.diff, choices: [], state: 'drawing', turnStart: Date.now() });
    this.used.add(c.word);
    let ms = this.settings.drawTime * 1000;
    if (this.modifier?.id === 'speed') ms = Math.round(ms / 2);
    this.phase(ms, () => this.endTurn('time'));
    const letters = [...c.word].map((ch, idx) => (/[a-z0-9]/i.test(ch) ? idx : -1)).filter((idx) => idx >= 0);
    const n = Math.min(this.settings.hints, Math.floor(letters.length / 2));
    shuffle(letters).slice(0, n).forEach((idx, k) => {
      this.timers.push(setTimeout(() => { this.revealed.push(idx); this.sync(); }, (ms * (k + 1)) / (n + 1)));
    });
    const d = this.players.get(this.drawerId);
    this.system(`✏️ ${d.name} is drawing${this.modifier ? ` — ${this.modifier.icon} ${this.modifier.name}!` : ''}`);
    this.sync();
  }

  eligible() { return this.connected.filter((p) => p.id !== this.drawerId); }

  correct(p) {
    const now = Date.now();
    const frac = Math.max(0, (this.deadline - now) / this.phaseLen);
    const first = this.guessed.size === 0;
    const mult = DIFF_MULT[this.diff] * (this.modifier?.id === 'speed' ? 1.5 : 1);
    p.streak++;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
    const pts = Math.round((60 + 240 * frac) * mult) + (first ? 50 : 0) + Math.min(5, p.streak - 1) * 15;
    const ms = now - this.turnStart;
    this.guessed.set(p.id, { pts, ms });
    p.score += pts;
    if (p.fastest == null || ms < p.fastest) p.fastest = ms;
    const drawer = this.players.get(this.drawerId);
    const dp = Math.round(45 * mult);
    if (drawer) { drawer.score += dp; this.drawerPts += dp; }
    this.broadcast('chat', { kind: 'correct', from: p.id, text: `${p.name} guessed it! +${pts}${first ? ' · first!' : ''}${p.streak > 1 ? ` · 🔥${p.streak}` : ''}` });
    this.send(p, 'sfx', { s: 'correct' });
    const left = this.eligible().filter((q) => !this.guessed.has(q.id)).length;
    if (left === 0) return this.endTurn('all');
    // Keep the pace up once most of the room has it.
    if (!this.speedup && this.guessed.size * 2 >= this.eligible().length && this.deadline - now > 25000) {
      this.speedup = true;
      this.phase(25000, () => this.endTurn('time'));
      this.phaseLen = this.deadline - this.turnStart;
      this.system('⏩ Half the room got it — 25 seconds left!', 'warn');
    }
    this.sync();
  }

  endTurn(reason) {
    if (this.state !== 'drawing' && this.state !== 'choosing') return;
    this.clearTimers();
    const drawer = this.players.get(this.drawerId);
    if (!this.word) return this.nextTurn();
    const up = [...this.ratings.values()].filter((v) => v > 0).length;
    this.gallery.push({
      word: this.word, round: this.round, strokes: this.strokes,
      drawer: drawer ? { id: drawer.id, name: drawer.name, avatar: drawer.avatar, color: drawer.color } : null,
      up, down: this.ratings.size - up, modifier: this.modifier, guessed: this.guessed.size,
    });
    for (const q of this.eligible()) if (!this.guessed.has(q.id)) q.streak = 0;
    const deltas = [...this.guessed.entries()].map(([id, g]) => ({ id, pts: g.pts, ms: g.ms }));
    if (drawer) deltas.unshift({ id: drawer.id, pts: this.drawerPts, drawer: true });
    this.reveal = { word: this.word, reason, deltas, up, down: this.ratings.size - up };
    this.state = 'reveal';
    this.phase(REVEAL_MS, () => this.nextTurn());
    this.broadcast('sfx', { s: reason === 'all' ? 'allgot' : 'reveal' });
    this.sync();
  }

  endGame() {
    this.clearTimers();
    const players = this.order.map((id) => this.players.get(id)).filter(Boolean);
    const ranking = [...players].sort((a, b) => b.score - a.score).map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, color: p.color, score: p.score }));
    const awards = [];
    const best = (arr, key, pick) => arr.filter((x) => key(x) != null).sort((a, b) => pick(key(a), key(b)))[0];
    const fav = best(this.gallery.filter((g) => g.up > 0 && g.drawer), (g) => g.up - g.down, (a, b) => b - a);
    if (fav) awards.push({ icon: '🎨', title: 'Crowd Favorite', who: fav.drawer.name, detail: `“${fav.word}” got ${fav.up} 👍` });
    const quick = best(players, (p) => p.fastest, (a, b) => a - b);
    if (quick) awards.push({ icon: '⚡', title: 'Quickdraw', who: quick.name, detail: `guessed in ${(quick.fastest / 1000).toFixed(1)}s` });
    const streak = best(players.filter((p) => p.bestStreak > 1), (p) => p.bestStreak, (a, b) => b - a);
    if (streak) awards.push({ icon: '🔥', title: 'On Fire', who: streak.name, detail: `${streak.bestStreak} in a row` });
    const close = best(players.filter((p) => p.close > 0), (p) => p.close, (a, b) => b - a);
    if (close) awards.push({ icon: '🤏', title: 'Sooo Close', who: close.name, detail: `${close.close} near-misses` });
    this.endData = { ranking, awards };
    Object.assign(this, { state: 'end', drawerId: null, word: null, modifier: null, strokes: [] });
    this.broadcast('gallery', { gallery: this.gallery });
    this.broadcast('sfx', { s: 'end' });
    this.sync();
  }

  toLobby(msg) {
    this.clearTimers();
    Object.assign(this, { state: 'lobby', drawerId: null, word: null, modifier: null, strokes: [], round: 0, reveal: null, endData: null });
    this.guessed.clear();
    this.broadcast('clear');
    if (msg) this.system(msg, 'warn');
    this.sync();
  }

  // ---------- players ----------
  migrateHost() {
    if (this.players.get(this.hostId)?.connected) return;
    const next = this.order.map((id) => this.players.get(id)).find((p) => p?.connected);
    if (next) { this.hostId = next.id; this.system(`👑 ${next.name} is now the host`); }
  }

  onLeaveOrDrop(p) {
    this.migrateHost();
    const inGame = ['choosing', 'drawing', 'reveal'].includes(this.state);
    if (inGame && this.connected.length < 2) return this.toLobby('Not enough players left — back to the lobby.');
    if (p.id === this.drawerId && this.state === 'choosing') return this.nextTurn();
    if (p.id === this.drawerId && this.state === 'drawing') { this.system(`🏃 ${p.name} left mid-drawing`); return this.endTurn('left'); }
    if (this.state === 'drawing' && this.eligible().length && this.eligible().every((q) => this.guessed.has(q.id))) return this.endTurn('all');
    this.sync();
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    clearTimeout(p.dropTimer);
    this.players.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.kickVotes.delete(id);
    for (const v of this.kickVotes.values()) v.delete(id);
    if (!this.players.size) { this.clearTimers(); rooms.delete(this.code); return; }
    this.onLeaveOrDrop(p);
  }

  kick(p) {
    this.banned.add(p.token);
    this.send(p, 'kicked');
    this.system(`🥾 ${p.name} was kicked`, 'warn');
    p.ws?.close(4001, 'kicked');
    p.connected = false;
    this.remove(p.id);
  }
}

// ---------- message handling ----------
const handlers = {
  settings(room, p, m) {
    if (p.id !== room.hostId || room.state !== 'lobby') return;
    const s = m.settings || {};
    const words = Array.isArray(s.customWords) ? s.customWords : String(s.customWords || '').split(/[,\n]/);
    room.settings = {
      rounds: clamp(s.rounds, 1, 10, DEFAULTS.rounds),
      drawTime: clamp(s.drawTime, 20, 240, DEFAULTS.drawTime),
      wordChoices: clamp(s.wordChoices, 1, 5, DEFAULTS.wordChoices),
      hints: clamp(s.hints, 0, 5, DEFAULTS.hints),
      maxPlayers: clamp(s.maxPlayers, 2, 20, DEFAULTS.maxPlayers),
      chaos: !!s.chaos,
      customWords: [...new Set(words.map((w) => clean(w, 32).toLowerCase()).filter((w) => w.length >= 2 && /[a-z0-9]/.test(w)))].slice(0, 500),
      customOnly: !!s.customOnly,
    };
    room.sync();
  },
  start(room, p) { room.start(p); },
  again(room, p) { if (p.id === room.hostId && room.state === 'end') room.toLobby(); },
  choose(room, p, m) { if (p.id === room.drawerId) room.choose(m.i); },
  skip(room, p) { if (p.id === room.drawerId && room.state === 'drawing' && room.guessed.size === 0) { room.system(`⏭️ ${p.name} skipped their turn`); room.endTurn('skip'); } },

  stroke(room, p, m) {
    const lobby = room.state === 'lobby';
    if (!lobby && !(room.state === 'drawing' && p.id === room.drawerId)) return;
    if (room.strokes.length >= 4000) return;
    const s = m.s || {};
    if (!TOOLS.has(s.tool)) return;
    const mod = lobby ? null : room.modifier?.id;
    if (mod === 'onestroke' && room.strokes.length >= 1) return;
    const pts = (Array.isArray(s.pts) ? s.pts : []).slice(0, 4000).map((v, i) => clamp(v, -20, (i % 2 ? H : W) + 20, 0));
    if (pts.length < 2 || pts.length % 2) return;
    const out = {
      id: clean(s.id, 24), by: p.id, tool: s.tool,
      color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#1d1b1a',
      size: clamp(s.size, 1, 80, 6), pts,
    };
    if (mod === 'tiny') out.size = 3;
    if (mod === 'mono' && out.tool !== 'eraser') out.color = '#1d1b1a';
    if (mod === 'rainbow') out.rainbow = true;
    if (mod === 'mirror') out.mirror = true;
    room.strokes.push(out);
    room.broadcast('stroke', { s: out }, p.id);
  },
  pts(room, p, m) {
    if (room.state !== 'lobby' && !(room.state === 'drawing' && p.id === room.drawerId)) return;
    const s = room.strokes.findLast((x) => x.id === m.id && x.by === p.id);
    if (!s || (s.tool !== 'pen' && s.tool !== 'eraser') || !Array.isArray(m.pts) || m.pts.length % 2) return;
    if (s.pts.length + m.pts.length > 30000) return;
    const add = m.pts.slice(0, 2000).map((v, i) => clamp(v, -20, (i % 2 ? H : W) + 20, 0));
    s.pts.push(...add);
    room.broadcast('pts', { id: s.id, pts: add }, p.id);
  },
  undo(room, p) {
    const lobby = room.state === 'lobby';
    if (!lobby && !(room.state === 'drawing' && p.id === room.drawerId)) return;
    if (!lobby && room.modifier?.id === 'onestroke') return;
    const idx = room.strokes.findLastIndex((x) => x.by === p.id);
    if (idx < 0) return;
    const [s] = room.strokes.splice(idx, 1);
    room.broadcast('undo', { id: s.id });
  },
  clear(room, p) {
    const ok = room.state === 'lobby' ? p.id === room.hostId : room.state === 'drawing' && p.id === room.drawerId && room.modifier?.id !== 'onestroke';
    if (!ok) return;
    room.strokes = [];
    room.broadcast('clear');
  },

  chat(room, p, m) {
    const text = clean(m.text, 120);
    if (!text) return;
    const now = Date.now();
    p.chatTimes = (p.chatTimes || []).filter((t) => now - t < 5000);
    if (p.chatTimes.length >= 8) return room.send(p, 'toast', { text: 'Whoa, slow down 🐢' });
    p.chatTimes.push(now);
    if (room.state === 'drawing' && room.word) {
      const w = norm(room.word), g = norm(text);
      const solved = p.id === room.drawerId || room.guessed.has(p.id);
      if (!solved) {
        if (g === w || g.replace(/ /g, '') === w.replace(/ /g, '')) return room.correct(p);
        const tol = w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0;
        if (tol && lev(g, w) <= tol) {
          p.close++;
          room.send(p, 'chat', { kind: 'close', text: `“${text}” is sooo close!` });
          room.send(p, 'sfx', { s: 'close' });
        }
        return room.broadcast('chat', { kind: 'guess', from: p.id, text });
      }
      if (w.length > 1 && (g.includes(w) || g.replace(/ /g, '').includes(w.replace(/ /g, '')))) {
        return room.send(p, 'chat', { kind: 'system', tone: 'warn', text: 'Nice try — no spoilers! 🤐' });
      }
      const msg = JSON.stringify({ t: 'chat', kind: 'solved', from: p.id, text });
      for (const q of room.players.values()) if ((q.id === room.drawerId || room.guessed.has(q.id)) && q.connected) q.ws.send(msg);
      return;
    }
    room.broadcast('chat', { kind: 'guess', from: p.id, text });
  },
  react(room, p, m) {
    if (!REACTIONS.includes(m.e)) return;
    const now = Date.now();
    if (now - (p.lastReact || 0) < 250) return;
    p.lastReact = now;
    room.broadcast('react', { from: p.id, e: m.e });
  },
  rate(room, p, m) {
    if (room.state !== 'drawing' || p.id === room.drawerId) return;
    const v = m.v > 0 ? 1 : m.v < 0 ? -1 : 0;
    if (v) room.ratings.set(p.id, v); else room.ratings.delete(p.id);
    if (v > 0) room.broadcast('react', { from: p.id, e: '👍' });
    room.sync();
  },
  kick(room, p, m) {
    const target = room.players.get(m.id);
    if (!target || target.id === p.id) return;
    if (p.id === room.hostId) return room.kick(target);
    const votes = room.kickVotes.get(target.id) || new Set();
    votes.add(p.id);
    room.kickVotes.set(target.id, votes);
    const needed = Math.max(2, Math.floor((room.connected.length - 1) / 2) + 1);
    room.system(`🗳️ ${p.name} voted to kick ${target.name} (${votes.size}/${needed})`, 'warn');
    if (votes.size >= needed) room.kick(target);
    else room.sync();
  },
  ping(room, p) { room.send(p, 'pong'); },
  leave(room, p) {
    p.connected = false;
    p.ws = null;
    room.system(`👋 ${p.name} left`);
    room.remove(p.id);
  },
};

function joinRoom(ws, m) {
  const name = clean(m.name, 18) || 'Doodler';
  const avatar = clean(m.avatar, 8) || '🦊';
  const color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#ffc93c';
  let room;
  if (m.room) {
    room = rooms.get(String(m.room).toUpperCase());
    if (!room) return ws.send(JSON.stringify({ t: 'error', text: 'That room does not exist (anymore). Create a new one!' }));
  } else {
    room = new Room(makeCode());
    rooms.set(room.code, room);
  }
  if (m.token && room.banned.has(m.token)) return ws.send(JSON.stringify({ t: 'error', text: 'You were kicked from this room.' }));
  let p = m.token && [...room.players.values()].find((q) => q.token === m.token);
  if (p) {
    clearTimeout(p.dropTimer);
    if (p.ws && p.ws !== ws) try { p.ws.close(4000, 'replaced'); } catch {}
    Object.assign(p, { ws, connected: true, name, avatar, color });
    room.system(`👋 ${p.name} is back`);
  } else {
    if (room.players.size >= room.settings.maxPlayers) return ws.send(JSON.stringify({ t: 'error', text: 'Room is full.' }));
    p = {
      id: crypto.randomUUID().slice(0, 8), token: crypto.randomUUID(), name, avatar, color, ws, connected: true,
      score: 0, streak: 0, bestStreak: 0, close: 0, fastest: null,
    };
    room.players.set(p.id, p);
    room.order.push(p.id);
    if (['choosing', 'drawing', 'reveal'].includes(room.state)) room.queue.push(p.id);
    room.system(`🎉 ${p.name} joined`, 'good');
  }
  if (!room.players.get(room.hostId)?.connected) room.hostId = p.id;
  ws.data = { room: room.code, pid: p.id };
  room.send(p, 'welcome', { code: room.code, token: p.token, id: p.id });
  room.send(p, 'canvas', { strokes: room.strokes });
  if (room.state === 'end') room.send(p, 'gallery', { gallery: room.gallery });
  room.broadcast('sfx', { s: 'join' }, p.id);
  room.sync();
}

function onClose(ws) {
  const { room: code, pid } = ws.data || {};
  const room = rooms.get(code);
  const p = room?.players.get(pid);
  if (!p || p.ws !== ws) return;
  p.connected = false;
  p.ws = null;
  const grace = room.state === 'lobby' ? 20000 : 120000;
  p.dropTimer = setTimeout(() => { if (!p.connected) { room.system(`👋 ${p.name} left`); room.remove(p.id); } }, grace);
  room.onLeaveOrDrop(p);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (srv.upgrade(req, { data: {} })) return;
      return new Response('Expected a WebSocket', { status: 400 });
    }
    const file = normalize(join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC_DIR + '/')) return new Response('Not found', { status: 404 });
    const f = Bun.file(file);
    if (!(await f.exists())) return new Response('Not found', { status: 404 });
    const ext = file.slice(file.lastIndexOf('.'));
    return new Response(f, { headers: { 'content-type': MIME[ext] || f.type, 'cache-control': 'no-cache' } });
  },
  websocket: {
    maxPayloadLength: 128 * 1024,
    idleTimeout: 120,
    message(ws, raw) {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'join') { if (!ws.data?.pid) joinRoom(ws, m); return; }
      const room = rooms.get(ws.data?.room);
      const p = room?.players.get(ws.data?.pid);
      if (!p || p.ws !== ws || !Object.hasOwn(handlers, m.t)) return;
      try { handlers[m.t](room, p, m); } catch (e) { console.error('handler', m.t, e); }
    },
    close: onClose,
  },
});

console.log(`squiggle running at http://${server.hostname}:${server.port}`);
