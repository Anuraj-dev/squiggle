// Room state machine and message handlers. Transport-agnostic: sockets only
// need send(string), close(code, reason) and a mutable `data` object, and all
// time goes through `clock`, so tests can drive it deterministically.
import { matchesAnswer, mentionsAnswer, canonKey, singulars, dedupeCustom } from './words.js';
import { DECK_BY_ID, DECK_CATALOG, DEFAULT_DECKS, CUSTOM_DECK, ALL_DECK_KEYS, deckInfo, cleanDeckIds } from './decks.js';
import { WordHistory } from './history.js';
import {
  CHOOSE_MS, REVEAL_MS, MAX_STROKES, MAX_STROKE_PTS, MAX_TURN_COORDS,
  MAX_GALLERY, LOBBY_GRACE, GAME_GRACE, SPEEDUP_LEFT,
  CHAOS_LEVELS, CHAOS_RATE, CHAOS_POOLS, CHAOS_MODES, CHAOS_IDS, cleanChaosIds, INK_BUDGET, STROKE_BUDGET, inkCost, trimInk, turnProgress, RELIEF_AT,
  stampBounds, forbiddenZone, shrinkingSize, slipperyPts, decoyStrokes,
  clamp, clean, norm, lev, shuffleIn, pickChaos, is, canUndo,
  guesserPts, drawerPts, allBonus, scoreMult, tiedRanking, FINALE_MULT,
  strokeId, validateStroke, validatePts, galleryStrokes, jitterPts, allowedTool, applyChaos,
} from './public/shared.js';

export const clock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (t) => clearTimeout(t),
};

const DEFAULTS = {
  rounds: 3, drawTime: 80, chaos: 'x2', chaosPool: 'mixed', chaosIds: CHAOS_IDS, wordChoices: 3, hints: 2, difficulty: 'mix', decks: DEFAULT_DECKS, customWords: [], customOnly: false,
};
const MAX_PLAYERS = 12;
const REACTIONS = ['😂', '🔥', '😮', '🤯', '💀', '👏', '👎'];
const DRAW_MSGS = new Set(['stroke', 'pts', 'undo', 'redo', 'clear']);
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DIFFS = ['easy', 'medium', 'hard'];
const DIFFICULTIES = ['mix', ...DIFFS];
export const rooms = new Map();
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => shuffleIn(a, Math.random);
const raw = (ws, t, data = {}) => { try { ws.send(JSON.stringify({ t, ...data })); } catch {} };

// Server-wide word history, created on first use so importing game.js stays
// side-effect free. Tests inject an in-memory store with setWordHistory().
let sharedHistory = null;
export function setWordHistory(h) { sharedHistory = h; }
const wordHistory = () => sharedHistory ||= new WordHistory({
  path: process.env.SQUIGGLE_HISTORY || new URL('./data/word-history.json', import.meta.url).pathname,
  valid: ALL_DECK_KEYS,
});

// Family cooldown: content words (4+ letters, not function words) plus their
// singulars, so "golf ball" and "golf carts" count as one family.
const STOPWORDS = new Set(['with', 'from', 'that', 'this', 'into', 'onto', 'over', 'under', 'your', 'their', 'them', 'they', 'have', 'some', 'what', 'when', 'then', 'than', 'very', 'just', 'upon', 'about', 'after', 'before', 'while']);
const familyTokens = (w) => norm(w).split(' ').filter((t) => t.length >= 4 && !STOPWORDS.has(t)).flatMap((t) => [t, ...singulars(t)]);
const RECENT_TURNS = 10;

function makeCode() {
  let c;
  do c = Array.from({ length: 5 }, () => rand(CODE_CHARS)).join(''); while (rooms.has(c));
  return c;
}

// Token bucket per player; returns false when the burst is spent.
function take(p, key, cap, perSec) {
  const now = clock.now();
  const b = p[key] ||= { n: cap, at: now };
  b.n = Math.min(cap, b.n + ((now - b.at) * perSec) / 1000);
  b.at = now;
  if (b.n < 1) return false;
  b.n -= 1;
  return true;
}

// Up to 3 public wrong guesses for the reveal: the guess most players typed
// first (by normalised text), then the longest; at most one per player; never a
// "close" guess or one that mentions the answer. Each guess is shown as its
// first player typed it.
export function recapGuesses(list, word, max = 3) {
  const groups = new Map();
  list.forEach((g, i) => {
    const key = norm(g.text);
    if (!key || g.close || mentionsAnswer(g.text, word) || matchesAnswer(g.text, word)) return;
    const grp = groups.get(key) || { text: g.text, ids: [], first: i };
    if (!grp.ids.includes(g.id)) grp.ids.push(g.id);
    groups.set(key, grp);
  });
  const ranked = [...groups.values()].sort((a, b) => b.ids.length - a.ids.length || b.text.length - a.text.length || a.first - b.first);
  const out = [], used = new Set();
  ranked.forEach((grp, k) => {
    if (out.length >= max) return;
    // Credit the player with the fewest other guesses still to place, so a
    // popular guess does not use up someone whose only guess comes later.
    const later = (x) => ranked.slice(k + 1).filter((o) => o.ids.includes(x)).length;
    const id = grp.ids.filter((x) => !used.has(x)).sort((a, b) => later(a) - later(b))[0];
    if (id == null) return;
    used.add(id);
    out.push({ text: grp.text, by: id, n: grp.ids.length });
  });
  return out;
}

export class Room {
  constructor(code, history = wordHistory()) {
    this.code = code;
    this.players = new Map();
    this.order = [];
    this.hostId = null;
    this.settings = { ...DEFAULTS, customWords: [] };
    this.state = 'lobby';
    this.round = 0;
    this.queue = [];
    this.drawerId = null;
    this.word = null;
    this.diff = null;
    this.choices = [];
    this.timers = [];
    this.phaseTimer = null;
    this.phaseFn = null;
    this.deadline = 0;
    this.phaseLen = 0;
    this.scoreLen = 0;
    this.turnStart = 0;
    this.pauseAccum = 0;
    this.pausedAt = 0;
    this.pauseReason = null;
    this.remainingOnPause = 0;
    // Set by the host; holds play until they resume. Cleared when the room leaves play.
    this.hostPaused = false;
    this.revealed = [];
    this.hintPlan = [];
    this.guessed = new Map();
    this.lateSolved = new Set();
    this.gallery = [];
    // Word memory outlives games (rematches): deck words in the shared history,
    // custom words only here, and content tokens offered in the last turns.
    this.history = history;
    this.customSeen = new Map();
    this.recentOffers = [];
    this.deck = null;
    this.chaos = null;
    this.guesserChaos = null;
    this.lastChaosId = null;
    this.lastGuesserChaosId = null;
    this.inkUsed = 0;
    this.strokeUsed = 0;
    this.guessBudgets = new Map();
    this.challengeTimer = null;
    this.batchReleased = false;
    this.banned = new Set();
    this.reveal = null;
    this.endData = null;
    this.drawerAward = 0;
    this.speedup = false;
    // Bumped on every phase change; clients echo it on turn-bound actions so
    // nothing sent for one phase can act on the next.
    this.turnSeq = 0;
    this.turnEligible = [];
    this.drawnThisRound = new Set();
    this.rerolled = false;
    // Public wrong guesses this turn, for the reveal recap: { id, text, close }.
    this.wrongGuesses = [];
    // The last turn of the match scores 2×. Once announced it is never taken back.
    this.finale = false;
    this.galleryN = 0;
    // Gallery MVP: voter id -> gallery drawing id. End state only.
    this.votes = new Map();
    // Wins tonight, keyed by reconnect token so a win follows the player across
    // reconnects and survives rematches: token -> { name, n }.
    this.wins = new Map();
    this.resetCanvas();
  }

  get connected() { return [...this.players.values()].filter((p) => p.connected); }

  send(p, t, data = {}) { if (p?.connected && p.ws) raw(p.ws, t, data); }

  broadcast(t, data = {}, exceptId = null) {
    const msg = JSON.stringify({ t, ...data });
    for (const p of this.players.values()) if (p.connected && p.ws && p.id !== exceptId) try { p.ws.send(msg); } catch {}
  }

  system(text, tone = 'info') { this.broadcast('chat', { kind: 'system', tone, text }); }

  resetCanvas(publish = true) {
    this.strokes = [];
    this.coordCount = 0;
    this.redoStacks = new Map(); // playerId -> strokes they undid, newest last
    if (publish) this.publishedStrokes = [];
  }

  batching() { return this.state === 'drawing' && is(this.guesserChaos, 'batches') && !this.batchReleased; }

  canvasFor(p) { return this.batching() && p.id !== this.drawerId ? this.publishedStrokes : this.strokes; }

  publishCanvas() {
    // Freeze points too: an ongoing stroke must not mutate an already published batch.
    this.publishedStrokes = this.strokes.map((s) => ({ ...s, pts: [...s.pts] }));
    for (const p of this.players.values()) if (p.id !== this.drawerId) {
      this.send(p, 'canvas', { seq: this.turnSeq, strokes: this.publishedStrokes });
    }
  }

  broadcastDraw(t, data = {}, exceptId = null) {
    const held = this.batching();
    if (held && turnProgress(this.clockMs(), this.timeLeft()) >= RELIEF_AT) {
      this.batchReleased = true;
      this.publishCanvas();
    }
    for (const p of this.players.values()) if (p.id !== exceptId && (!held || p.id === this.drawerId)) this.send(p, t, data);
  }

  clockMs() {
    if (!this.turnStart) return 0;
    return Math.max(0, (this.pausedAt || clock.now()) - this.turnStart - this.pauseAccum);
  }

  timeLeft() {
    if (!this.deadline) return 0;
    return Math.max(0, this.deadline - (this.pausedAt || clock.now()));
  }

  pastDeadline() { return !this.pausedAt && this.deadline && clock.now() > this.deadline; }

  hint() {
    return [...this.word].map((ch, i) => (/[a-z0-9]/i.test(ch) && !this.revealed.includes(i) ? '_' : ch)).join('');
  }

  isSolver(p) { return p.id === this.drawerId || this.guessed.has(p.id) || this.lateSolved.has(p.id); }

  canSeeWord(p) { return this.state === 'reveal' || this.isSolver(p); }

  settingsFor(p) {
    const s = { ...this.settings, customWordCount: this.settings.customWords.length };
    if (p.id !== this.hostId) delete s.customWords;
    return s;
  }

  pauseUntil() {
    let until = 0;
    for (const p of this.players.values()) if (!p.connected && p.dropDeadline) until = Math.max(until, p.dropDeadline);
    return until || clock.now() + GAME_GRACE;
  }

  snapshot(p) {
    const drawing = this.state === 'drawing';
    const hideLength = drawing && is(this.guesserChaos, 'mystery') && turnProgress(this.clockMs(), this.timeLeft()) < 0.5;
    return {
      you: p.id,
      code: this.code,
      hostId: this.hostId,
      hostPaused: this.hostPaused,
      settings: this.settingsFor(p),
      state: this.state,
      round: this.round,
      drawerId: this.drawerId,
      timeLeft: this.timeLeft(),
      phaseLen: this.phaseLen,
      scoreLen: this.scoreLen,
      gameMs: this.clockMs(),
      seq: this.turnSeq,
      paused: this.pausedAt ? { reason: this.pauseReason, until: this.pauseUntil() } : null,
      hint: this.word && drawing && !hideLength ? this.hint() : null,
      word: this.word && this.canSeeWord(p) ? this.word : null,
      diff: this.word ? this.diff : null,
      deck: this.word ? this.deck : null,
      deckCatalog: this.state === 'lobby' ? DECK_CATALOG : null,
      choices: this.state === 'choosing' && p.id === this.drawerId ? this.choices : null,
      rerolled: this.rerolled,
      chaos: this.chaos,
      guesserChaos: this.guesserChaos,
      budget: p.id === this.drawerId ? this.drawBudget() : null,
      guessBudget: this.guessBudget(p),
      canRescue: this.state === 'choosing' && !this.pausedAt && !this.pastDeadline() && p.id === this.drawerId && !!this.chaos && !p.rescued,
      spectating: drawing && p.id !== this.drawerId && !this.turnEligible.includes(p.id),
      reveal: this.state === 'reveal' ? this.reveal : null,
      end: this.state === 'end' ? this.endData : null,
      finale: this.finale,
      mvp: this.state === 'end' ? this.mvpFor(p) : null,
      wins: this.winsList(),
      players: this.order.map((id) => this.players.get(id)).filter(Boolean).map((q) => ({
        id: q.id, name: q.name, avatar: q.avatar, color: q.color, score: q.score, connected: q.connected,
        guessed: this.guessed.has(q.id), streak: q.streak,
      })),
    };
  }

  sync() { for (const p of this.players.values()) this.send(p, 'state', this.snapshot(p)); }

  drawBudget() {
    if (is(this.chaos, 'fivestrokes')) return { strokesLeft: Math.max(0, STROKE_BUDGET - this.strokeUsed) };
    if (is(this.chaos, 'inkbudget')) return { inkLeft: Math.max(0, INK_BUDGET - this.inkUsed) };
    return null;
  }

  sendBudget(p) {
    const budget = this.drawBudget();
    if (budget) this.send(p, 'draw-budget', { seq: this.turnSeq, budget });
  }

  guessBudget(p) {
    if (this.state !== 'drawing' || !is(this.guesserChaos, 'limited') || this.isSolver(p)) return null;
    const elapsed = this.clockMs();
    let b = this.guessBudgets.get(p.id);
    if (!b) { b = { remaining: 3, refillAt: 4000, seen: new Set() }; this.guessBudgets.set(p.id, b); }
    if (elapsed >= b.refillAt) {
      const fills = Math.floor((elapsed - b.refillAt) / 4000) + 1;
      b.remaining = Math.min(3, b.remaining + fills);
      b.refillAt += fills * 4000;
    }
    return { remaining: b.remaining, nextIn: Math.max(0, b.refillAt - elapsed), unlimited: turnProgress(elapsed, this.timeLeft()) >= RELIEF_AT };
  }

  sendGuessBudget(p) {
    const budget = this.guessBudget(p);
    if (budget) this.send(p, 'guess-budget', { seq: this.turnSeq, budget });
  }

  scheduleChallenges() {
    clock.clear(this.challengeTimer);
    this.challengeTimer = null;
    if (this.state !== 'drawing' || this.pausedAt) return;
    const batches = is(this.guesserChaos, 'batches'), limited = is(this.guesserChaos, 'limited');
    if (!batches && !limited) return;
    const elapsed = this.clockMs(), left = this.timeLeft();
    if (turnProgress(elapsed, left) >= RELIEF_AT) {
      if (batches && !this.batchReleased) { this.batchReleased = true; this.publishCanvas(); }
      if (limited) for (const p of this.players.values()) this.sendGuessBudget(p);
      return;
    }
    // Unpaused ms until progress reaches RELIEF_AT; the turn total (elapsed + left) is fixed while running.
    const reliefIn = Math.max(1, Math.ceil(RELIEF_AT * (elapsed + left) - elapsed));
    let delay = reliefIn;
    if (batches) delay = Math.min(delay, 2000 - elapsed % 2000);
    if (limited) for (const p of this.players.values()) {
      const b = this.guessBudget(p);
      if (b && b.remaining < 3) delay = Math.min(delay, b.nextIn);
    }
    const seq = this.turnSeq;
    this.challengeTimer = clock.set(() => {
      this.challengeTimer = null;
      if (this.state !== 'drawing' || this.turnSeq !== seq || this.pausedAt) return;
      if (batches) {
        if (turnProgress(this.clockMs(), this.timeLeft()) >= RELIEF_AT) this.batchReleased = true;
        this.publishCanvas();
      }
      if (limited) for (const p of this.players.values()) this.sendGuessBudget(p);
      this.scheduleChallenges();
    }, Math.max(1, Math.ceil(delay)));
  }

  rollChaos() {
    this.chaos = null;
    this.guesserChaos = null;
    const rate = CHAOS_RATE[this.settings.chaos];
    if (!rate || (rate < 1 && Math.random() >= rate)) return;
    const seed = () => (Math.random() * 0xffffffff) >>> 0;
    const { chaosPool: pool, chaosIds: ids } = this.settings;
    const has = (target, mild) => CHAOS_MODES.some((t) => t.target === target && (!mild || t.mild) && ids.includes(t.id));
    // A paired turn keeps the guesser side mild so the artist can still get a full challenge.
    const both = pool === 'mixed' && Math.random() < 0.35 && has('artist') && has('guesser', true);
    let target = pool === 'mixed' ? (Math.random() < 0.5 ? 'artist' : 'guesser') : pool;
    // In Mixed, the host may have enabled challenges for one side only.
    if (!both && pool === 'mixed' && !has(target)) target = target === 'artist' ? 'guesser' : 'artist';
    if (!both && !has(target)) return;
    if (both || target === 'artist') {
      this.chaos = pickChaos(seed(), this.lastChaosId, 'artist', false, ids);
      if (this.chaos) this.lastChaosId = this.chaos.id;
    }
    if (both || target === 'guesser') {
      this.guesserChaos = pickChaos(seed(), this.lastGuesserChaosId, 'guesser', both, ids);
      if (this.guesserChaos) this.lastGuesserChaosId = this.guesserChaos.id;
    }
  }

  clearTimeoutsOnly() {
    this.timers.forEach(clock.clear);
    clock.clear(this.phaseTimer);
    clock.clear(this.challengeTimer);
    this.timers = [];
    this.phaseTimer = null;
    this.challengeTimer = null;
  }

  clearTimers() {
    this.clearTimeoutsOnly();
    this.deadline = 0;
    this.phaseFn = null;
  }

  phase(ms, fn) {
    this.phaseFn = fn;
    this.phaseLen = ms;
    this.deadline = clock.now() + ms;
    this.armPhase();
  }

  armPhase() {
    clock.clear(this.phaseTimer);
    if (!this.phaseFn || this.pausedAt) return;
    const seq = this.turnSeq, fn = this.phaseFn;
    this.phaseTimer = clock.set(() => {
      if (this.pausedAt || this.turnSeq !== seq) return;
      fn();
    }, this.timeLeft());
  }

  // Spreads the remaining hints over whatever time is left, so a speedup or
  // pause reschedules them instead of losing them.
  scheduleHints() {
    this.timers.forEach(clock.clear);
    this.timers = [];
    if (this.pausedAt || this.state !== 'drawing') return;
    const remaining = this.timeLeft();
    const pending = this.hintPlan.filter((idx) => !this.revealed.includes(idx));
    const seq = this.turnSeq;
    if (is(this.guesserChaos, 'mystery') && this.clockMs() < remaining) {
      this.timers.push(clock.set(() => {
        if (this.turnSeq === seq && this.state === 'drawing' && !this.pausedAt) this.sync();
      }, Math.ceil((remaining - this.clockMs()) / 2)));
    }
    pending.forEach((idx, k) => {
      this.timers.push(clock.set(() => {
        if (this.turnSeq !== seq || this.state !== 'drawing' || this.pausedAt) return;
        if (!this.revealed.includes(idx)) this.revealed.push(idx);
        this.sync();
      }, (remaining * (k + 1)) / (pending.length + 1)));
    });
  }

  inPlay() { return ['choosing', 'drawing', 'reveal'].includes(this.state); }

  // Why play is held right now, or null. A disconnect is shown ahead of a host pause.
  holdReason() {
    if (!this.inPlay()) return null;
    if (this.connected.length < 2) return 'Waiting for a player to reconnect…';
    const d = this.players.get(this.drawerId);
    if ((this.state === 'choosing' || this.state === 'drawing') && d && !d.connected) return `Waiting for ${d.name} to reconnect…`;
    return this.hostPaused ? 'Paused by the host' : null;
  }

  updatePause() {
    const hold = this.holdReason();
    if (hold) {
      this.pauseReason = hold;
      if (!this.pausedAt) {
        this.pausedAt = clock.now();
        this.clearTimeoutsOnly();
      }
    } else if (this.pausedAt) {
      this.pauseAccum += clock.now() - this.pausedAt;
      this.deadline += clock.now() - this.pausedAt;
      this.pausedAt = 0;
      this.pauseReason = null;
      this.armPhase();
      this.scheduleHints();
    }
    this.sync();
    this.scheduleChallenges();
  }

  start(p) {
    if (p.id !== this.hostId || (this.state !== 'lobby' && this.state !== 'end')) return;
    if (this.connected.length < 2) return this.send(p, 'toast', { text: 'You need at least 2 players to start' });
    if (this.settings.customOnly && this.settings.customWords.length < 2) {
      return this.send(p, 'toast', { text: 'Add at least 2 of your own words first' });
    }
    for (const q of this.players.values()) Object.assign(q, { score: 0, streak: 0, bestStreak: 0, close: 0, fastest: null, rescued: false });
    this.gallery = [];
    this.votes.clear();
    this.round = 0;
    this.chaos = null;
    this.nextRound();
  }

  nextRound() {
    this.round++;
    if (this.round > this.settings.rounds) return this.endGame();
    this.drawnThisRound.clear();
    this.queue = this.order.filter((id) => this.players.has(id));
    this.nextTurn();
  }

  beginPhase(state) {
    this.clearTimers();
    this.turnSeq++;
    this.state = state;
    if (!this.inPlay()) this.hostPaused = false;
    this.pausedAt = 0;
    this.pauseReason = null;
    this.pauseAccum = 0;
    this.turnStart = clock.now();
  }

  nextTurn() {
    if (this.connected.length < 2 && ![...this.players.values()].some((q) => !q.connected)) {
      return this.toLobby('Not enough players left — back to the lobby.');
    }
    let id = null;
    const skipped = [];
    while (this.queue.length && !id) {
      const c = this.queue.shift();
      const pl = this.players.get(c);
      if (pl?.connected) id = c;
      else if (pl) skipped.push(c);
    }
    this.queue.push(...skipped);
    if (!id) {
      if (skipped.length && !this.connected.length) return this.toLobby('Everyone dropped — back to the lobby.');
      return this.nextRound();
    }
    this.beginPhase('choosing');
    Object.assign(this, {
      drawerId: id, word: null, diff: null, revealed: [], hintPlan: [], reveal: null,
      drawerAward: 0, speedup: false, rerolled: false, turnEligible: [], wrongGuesses: [], finale: false,
    });
    this.resetCanvas();
    this.guessed.clear();
    this.lateSolved.clear();
    this.inkUsed = 0;
    this.strokeUsed = 0;
    this.guessBudgets.clear();
    this.refreshFinale();
    this.rollChaos();
    this.deck = null;
    this.choices = this.pickWords(this.settings.wordChoices);
    this.phase(CHOOSE_MS, () => this.choose(Math.floor(Math.random() * this.choices.length)));
    this.broadcast('clear', { seq: this.turnSeq, strokes: [] });
    this.updatePause();
  }

  // Deals up to n cards. Per card: rotate through the enabled decks (custom
  // words are one more deck, max one card unless custom-only), pick a tier
  // (random per card for "mix"), then pick at random among the oldest 25% of
  // that pool by last-shown time (every never-shown word if there are more),
  // skipping families offered in the last turns. Relaxes in order: family
  // cooldown, the 25% window, then anything not already on a card; `avoid`
  // (the previous cards on a reroll) only when nothing else exists.
  // Every dealt word counts as seen, picked or not.
  pickWords(n, avoid = []) {
    const { customWords, customOnly, difficulty } = this.settings;
    const tiers = difficulty === 'mix' ? DIFFS : [difficulty];
    const decks = customOnly ? [] : this.settings.decks.map((id) => DECK_BY_ID.get(id)).filter(Boolean)
      .map((d) => ({ info: deckInfo(d), list: (t) => d[t], seen: (k) => this.history.get(k), max: n }));
    const custom = customWords.length
      ? [{ info: CUSTOM_DECK, custom: true, list: () => customWords, seen: (k) => this.customSeen.get(k) || 0, max: customOnly ? n : 1 }] : [];
    const sources = shuffle([...decks, ...custom]);
    const avoidKeys = new Set(avoid.map(canonKey));
    const taken = new Set();
    const family = new Set(this.recentOffers.flatMap((o) => [...o.tokens]));
    const dealt = new Map(sources.map((s) => [s, 0]));
    const out = [];
    for (let i = 0; i < n; i++) {
      // Decks with the fewest cards so far first (stable sort keeps the shuffle).
      const order = sources.filter((s) => dealt.get(s) < s.max).sort((a, b) => dealt.get(a) - dealt.get(b));
      let card = null;
      for (const allowAvoid of [false, true]) {
        for (const src of order) if ((card = this.drawFrom(src, tiers, taken, avoidKeys, family, allowAvoid))) break;
        if (card) break;
      }
      if (!card) break;
      dealt.set(card.src, dealt.get(card.src) + 1);
      taken.add(card.key);
      for (const t of familyTokens(card.word)) family.add(t);
      out.push(card);
    }
    this.noteDealt(out);
    return shuffle(out.map(({ word, diff, src }) => ({ word, diff, deck: src.info })));
  }

  drawFrom(src, tiers, taken, avoidKeys, family, allowAvoid) {
    for (const tier of src.custom ? ['medium'] : shuffle([...tiers])) {
      const all = src.list(tier).map((word) => ({ word, key: canonKey(word) })).filter((x) => x.key);
      if (!all.length) continue;
      const ranked = shuffle(all).sort((a, b) => src.seen(a.key) - src.seen(b.key));
      const fresh = ranked.filter((x) => !src.seen(x.key)).length;
      const window = new Set(ranked.slice(0, Math.max(fresh, Math.ceil(all.length / 4))));
      const levels = allowAvoid ? [() => true] : [
        (x) => window.has(x) && !familyTokens(x.word).some((t) => family.has(t)),
        (x) => window.has(x),
        () => true,
      ];
      for (const ok of levels) {
        const pool = all.filter((x) => !taken.has(x.key) && (allowAvoid || !avoidKeys.has(x.key)) && ok(x));
        if (pool.length) return { ...rand(pool), diff: src.custom ? 'medium' : tier, src };
      }
    }
    return null;
  }

  // Marks dealt words seen (custom ones only in this room, never on disk) and
  // records their families; a reroll extends the current turn's entry.
  noteDealt(cards) {
    const now = clock.now();
    const deck = cards.filter((c) => !c.src.custom).map((c) => c.key);
    if (deck.length) this.history.mark(deck, now);
    for (const c of cards) if (c.src.custom) this.customSeen.set(c.key, now);
    let entry = this.recentOffers.at(-1);
    if (entry?.seq !== this.turnSeq) {
      this.recentOffers.push(entry = { seq: this.turnSeq, tokens: new Set() });
      if (this.recentOffers.length > RECENT_TURNS) this.recentOffers.shift();
    }
    for (const c of cards) for (const t of familyTokens(c.word)) entry.tokens.add(t);
  }

  choose(i) {
    if (this.state !== 'choosing') return;
    const c = this.choices[clamp(i, 0, this.choices.length - 1, 0)];
    if (!c) return this.nextTurn();
    this.beginPhase('drawing');
    this.resetCanvas();
    if (is(this.chaos, 'decoy')) {
      const decoys = decoyStrokes(this.chaos.seed);
      this.strokes.push(...decoys);
      this.coordCount = decoys.reduce((n, s) => n + s.pts.length, 0);
      this.publishedStrokes = decoys.map((s) => ({ ...s, pts: [...s.pts] }));
    }
    this.inkUsed = 0;
    this.strokeUsed = 0;
    this.guessBudgets.clear();
    this.batchReleased = false;
    this.word = c.word;
    this.diff = c.diff;
    this.deck = c.deck;
    this.choices = [];
    this.drawnThisRound.add(this.drawerId);
    // Only guessers present now can score this turn; later arrivals spectate.
    this.turnEligible = this.order.filter((id) => id !== this.drawerId && this.players.get(id)?.connected);
    let ms = this.settings.drawTime * 1000;
    if (is(this.chaos, 'speed')) ms = Math.round(ms / 2);
    this.scoreLen = ms;
    this.phase(ms, () => this.endTurn('time'));
    const letters = [...c.word].map((ch, idx) => (/[a-z0-9]/i.test(ch) ? idx : -1)).filter((idx) => idx >= 0);
    const hints = is(this.guesserChaos, 'nohints') ? 0 : this.settings.hints;
    this.hintPlan = shuffle(letters).slice(0, Math.min(hints, Math.floor(letters.length / 2)));
    this.scheduleHints();
    this.system(`✏️ ${this.players.get(this.drawerId).name} is drawing`, 'turn');
    this.broadcast('clear', { seq: this.turnSeq, strokes: this.strokes });
    this.updatePause();
  }

  allSolved() {
    const present = this.turnEligible.filter((id) => this.players.has(id));
    return present.length > 0 && present.every((id) => this.guessed.has(id));
  }

  awardDrawer() {
    const total = drawerPts({
      solved: this.guessed.size, eligible: this.turnEligible.length, diff: this.diff,
      chaos: [this.chaos, this.guesserChaos].filter(Boolean), all: this.allSolved(), finale: this.finale,
    });
    const drawer = this.players.get(this.drawerId);
    if (drawer) drawer.score += total - this.drawerAward;
    this.drawerAward = total;
  }

  // Unsolved guess. Answers only count while live, for eligible guessers, and
  // are never shown to the room.
  guess(p, text, seq) {
    const limited = is(this.guesserChaos, 'limited');
    if (limited && (this.pausedAt || seq !== this.turnSeq || this.pastDeadline())) {
      this.send(p, 'chat', { kind: 'system', tone: 'warn', text: this.pausedAt ? 'Paused. Your guess was kept.' : 'That turn has ended.' });
      return false;
    }
    if (matchesAnswer(text, this.word)) {
      if (this.pausedAt) return this.send(p, 'chat', { kind: 'system', tone: 'warn', text: 'Paused — guesses don’t count until the game resumes.' });
      if (seq !== this.turnSeq || this.pastDeadline()) return this.send(p, 'chat', { kind: 'system', tone: 'warn', text: 'Too late — that guess missed the turn.' });
      if (!this.turnEligible.includes(p.id)) {
        this.lateSolved.add(p.id);
        this.send(p, 'chat', { kind: 'system', tone: 'good', text: 'Correct! You joined mid-turn, so it doesn’t score — you can chat with the solvers now.' });
        this.send(p, 'state', this.snapshot(p));
        return true;
      }
      this.correct(p);
      return true;
    }
    const w = norm(this.word), g = norm(text);
    // A list or sentence that contains the answer stays private and, under
    // Limited Guesses, costs an attempt like any other wrong guess.
    if (this.spoils(text)) {
      if (limited && !this.chargeAttempt(p, g, false)) return false;
      this.send(p, 'chat', { kind: 'close', text: `“${text}” — try one guess. Not shown to others.` });
      return false;
    }
    const tol = w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0;
    const close = tol && (lev(g, w) <= tol || lev(canonKey(text), canonKey(this.word)) <= tol);
    if (limited && !this.chargeAttempt(p, g, close)) return false;
    this.broadcast('chat', { kind: 'guess', from: p.id, text });
    if (this.wrongGuesses.length < 500) this.wrongGuesses.push({ id: p.id, text, close: !!close });
    if (close) {
      p.close++;
      this.send(p, 'chat', { kind: 'close', text: `“${text}” is sooo close!` });
      this.send(p, 'sfx', { s: 'close' });
    }
    return true;
  }

  spoils(text) { return mentionsAnswer(text, this.word); }

  // Limited Guesses: one attempt per distinct guess; near typos (`free`) and
  // repeats cost nothing. False (with a toast) when no attempt is left.
  chargeAttempt(p, g, free) {
    const budget = this.guessBudget(p), b = this.guessBudgets.get(p.id);
    if (!budget.unlimited && !free && !b.seen.has(g)) {
      if (b.remaining === 0) {
        this.send(p, 'toast', { text: `Next attempt in ${Math.ceil(budget.nextIn / 1000)}s` });
        this.sendGuessBudget(p);
        return false;
      }
      b.remaining--;
    }
    b.seen.add(g);
    this.sendGuessBudget(p);
    this.scheduleChallenges();
    return true;
  }

  correct(p) {
    const elapsed = this.clockMs();
    const first = this.guessed.size === 0;
    p.streak++;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
    const pts = guesserPts({ elapsed, scoreLen: this.scoreLen, diff: this.diff, chaos: [this.chaos, this.guesserChaos].filter(Boolean), streak: p.streak, finale: this.finale });
    this.guessed.set(p.id, { pts, ms: elapsed, name: p.name });
    p.score += pts;
    if (p.fastest == null || elapsed < p.fastest) p.fastest = elapsed;
    this.awardDrawer();
    this.broadcast('chat', { kind: 'correct', from: p.id, text: `${p.name} guessed it! +${pts}${first ? ' · first!' : ''}${p.streak > 1 ? ` · 🔥${p.streak}` : ''}` });
    this.send(p, 'sfx', { s: 'correct' });
    if (this.allSolved()) return this.endTurn('all');
    if (!this.speedup && this.guessed.size * 2 >= this.turnEligible.length && this.timeLeft() > SPEEDUP_LEFT) {
      this.speedup = true;
      this.deadline = clock.now() + SPEEDUP_LEFT;
      this.phaseLen = SPEEDUP_LEFT;
      this.armPhase();
      this.scheduleHints();
      this.scheduleChallenges();
      this.system('⏩ 25 seconds left!', 'warn');
    }
    this.sync();
  }

  endTurn(reason) {
    if (this.state !== 'drawing' && this.state !== 'choosing') return;
    if (!this.word) return this.nextTurn();
    const drawer = this.players.get(this.drawerId);
    const endMs = this.clockMs();
    this.beginPhase('reveal');
    if (is(this.guesserChaos, 'batches')) { this.batchReleased = true; this.publishCanvas(); }
    this.awardDrawer();
    if (this.strokes.length && this.gallery.length >= MAX_GALLERY) this.gallery.shift();
    if (this.strokes.length) this.gallery.push({
      id: ++this.galleryN,
      word: this.word, strokes: galleryStrokes(this.strokes), chaos: this.chaos, guesserChaos: this.guesserChaos, endMs,
      drawer: drawer ? { id: drawer.id, name: drawer.name, avatar: drawer.avatar, color: drawer.color } : null,
    });
    for (const id of this.turnEligible) {
      const q = this.players.get(id);
      if (q && !this.guessed.has(id)) q.streak = 0;
    }
    const modes = [this.chaos, this.guesserChaos].filter(Boolean);
    this.reveal = {
      word: this.word, reason, deltas: this.revealDeltas(), artistChaos: this.chaos, guesserChaos: this.guesserChaos, endMs,
      diff: this.diff, mult: Math.round(scoreMult(this.diff, modes) * 100) / 100,
      allBonus: reason === 'all' ? allBonus(this.diff, modes) * (this.finale ? FINALE_MULT : 1) : 0,
      finale: this.finale, recap: recapGuesses(this.wrongGuesses, this.word),
    };
    this.phase(REVEAL_MS, () => this.nextTurn());
    this.broadcast('sfx', { s: reason === 'all' ? 'allgot' : 'reveal' });
    this.updatePause();
  }

  revealDeltas() {
    const drawer = this.players.get(this.drawerId);
    const deltas = [...this.guessed.entries()].map(([id, x]) => ({ id, name: x.name, pts: x.pts, ms: x.ms }));
    if (drawer) deltas.unshift({ id: drawer.id, name: drawer.name, pts: this.drawerAward, drawer: true });
    return deltas;
  }

  // True when nobody connected is left to draw after this turn in the final round.
  lastTurn() {
    return this.round >= this.settings.rounds && !this.queue.some((id) => this.players.get(id)?.connected);
  }

  // Marks the current turn as the finale once it is known to be the last one:
  // at the start of the turn, or later when the planned last drawer leaves or
  // drops. A late upgrade doubles points already scored this turn, so every
  // finale point is 2× however it became the finale. Never downgraded: if a
  // dropped player returns and draws after it, that turn is a finale too.
  refreshFinale() {
    if (this.finale || !this.inPlay() || !this.drawerId || !this.lastTurn()) return false;
    this.finale = true;
    for (const [id, x] of this.guessed) {
      const q = this.players.get(id);
      if (q) q.score += x.pts * (FINALE_MULT - 1);
      x.pts *= FINALE_MULT;
    }
    if (this.state !== 'choosing') this.awardDrawer();
    if (this.state === 'reveal' && this.reveal) {
      Object.assign(this.reveal, { finale: true, deltas: this.revealDeltas(), allBonus: this.reveal.allBonus * FINALE_MULT });
    }
    this.system('🔥 FINALE · 2× points: last turn of the game!', 'warn');
    return true;
  }

  // Live MVP tally for one viewer: { tally: { drawingId: votes }, winners, mine }.
  mvpFor(p) {
    const tally = {};
    for (const id of this.votes.values()) tally[id] = (tally[id] || 0) + 1;
    const top = Math.max(0, ...Object.values(tally));
    const winners = top ? this.gallery.filter((g) => tally[g.id] === top).map((g) => g.id) : [];
    return { tally, winners, mine: this.votes.get(p.id) ?? null };
  }

  vote(p, id) {
    if (this.state !== 'end') return;
    if (id == null) { this.votes.delete(p.id); return this.sync(); }
    const g = this.gallery.find((x) => x.id === id);
    if (!g) return;
    if (g.drawer?.id === p.id) return this.send(p, 'toast', { text: 'Vote for someone else’s drawing' });
    this.votes.set(p.id, id);
    this.sync();
  }

  winsList() {
    const name = (token, w) => [...this.players.values()].find((q) => q.token === token)?.name || w.name;
    return [...this.wins.entries()].map(([token, w]) => ({ name: name(token, w), n: w.n }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }

  endGame() {
    const players = this.order.map((id) => this.players.get(id)).filter(Boolean);
    const awards = [];
    const bestAll = (arr, key, better) => {
      const scored = arr.map((x) => ({ x, k: key(x) })).filter((s) => s.k != null).sort((a, b) => better(a.k, b.k));
      return scored.filter((s) => s.k === scored[0]?.k).map((s) => s.x);
    };
    const award = (icon, title, xs, who, detail) => {
      if (xs.length) awards.push({ icon, title: xs.length > 1 ? `${title} (tie)` : title, who: xs.map(who).join(' & '), detail });
    };
    const quick = bestAll(players, (p) => p.fastest, (a, b) => a - b);
    award('⚡', 'Quickdraw', quick, (p) => p.name, quick.length ? `guessed in ${(quick[0].fastest / 1000).toFixed(1)}s` : '');
    const streak = bestAll(players.filter((p) => p.bestStreak > 1), (p) => p.bestStreak, (a, b) => b - a);
    award('🔥', 'On Fire', streak, (p) => p.name, streak.length ? `${streak[0].bestStreak} in a row` : '');
    const close = bestAll(players.filter((p) => p.close > 0), (p) => p.close, (a, b) => b - a);
    award('🤏', 'Sooo Close', close, (p) => p.name, close.length ? `${close[0].close} near-miss${close[0].close > 1 ? 'es' : ''}` : '');
    this.beginPhase('end');
    this.endData = { ranking: tiedRanking(players), awards };
    this.votes.clear();
    // Every top scorer of a finished game gets a win; a game nobody scored in has no winner.
    for (const r of this.endData.ranking) {
      const q = this.players.get(r.id);
      if (r.rank !== 1 || r.score <= 0 || !q) continue;
      const w = this.wins.get(q.token) || { name: q.name, n: 0 };
      this.wins.set(q.token, { name: q.name, n: w.n + 1 });
    }
    Object.assign(this, { drawerId: null, word: null, chaos: null, guesserChaos: null, turnEligible: [], finale: false });
    this.resetCanvas();
    this.broadcast('clear', { seq: this.turnSeq, strokes: [] });
    this.broadcast('gallery', { gallery: this.gallery });
    this.broadcast('sfx', { s: 'end' });
    this.sync();
  }

  toLobby(msg) {
    this.beginPhase('lobby');
    Object.assign(this, {
      drawerId: null, word: null, chaos: null, guesserChaos: null, round: 0, reveal: null, endData: null, turnEligible: [], finale: false,
    });
    this.votes.clear();
    this.resetCanvas();
    this.guessed.clear();
    this.lateSolved.clear();
    this.broadcast('clear', { seq: this.turnSeq, strokes: [] });
    if (msg) this.system(msg, 'warn');
    this.sync();
  }

  setHostPaused(on) {
    if (!this.inPlay() || on === this.hostPaused) return;
    this.hostPaused = on;
    this.system(on ? '⏸️ The host paused the game' : '▶️ The host resumed the game', 'warn');
    this.updatePause();
  }

  migrateHost() {
    if (this.players.get(this.hostId)?.connected) return;
    const next = this.order.map((id) => this.players.get(id)).find((p) => p?.connected);
    if (next) this.hostId = next.id;
  }

  onDisconnect() {
    this.migrateHost();
    this.refreshFinale();
    this.updatePause();
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    clock.clear(p.dropTimer);
    clock.clear(p.resyncT);
    this.players.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.queue = this.queue.filter((x) => x !== id);
    if (!this.players.size) {
      this.clearTimers();
      rooms.delete(this.code);
      return;
    }
    this.migrateHost();
    if (this.inPlay() && this.players.size < 2) return this.toLobby('Not enough players left — back to the lobby.');
    if (p.id !== this.drawerId) this.refreshFinale();
    if (p.id === this.drawerId && this.state === 'choosing') return this.nextTurn();
    if (p.id === this.drawerId && this.state === 'drawing') return this.endTurn('left');
    if (this.state === 'drawing' && this.allSolved()) return this.endTurn('all');
    this.updatePause();
  }

  kick(p) {
    this.banned.add(p.token);
    this.send(p, 'kicked');
    this.system(`🥾 ${p.name} was kicked`, 'warn');
    try { p.ws?.close(4001, 'kicked'); } catch {}
    p.connected = false;
    this.remove(p.id);
  }

  // One canvas snapshot per player per second at most, however many
  // rejections or rate-limited messages triggered it.
  resyncSoon(p) {
    if (p.resyncT) return;
    const wait = Math.max(0, (p.lastResync || -Infinity) + 1000 - clock.now());
    p.resyncT = clock.set(() => {
      p.resyncT = null;
      p.lastResync = clock.now();
      this.send(p, 'canvas', { strokes: this.canvasFor(p), seq: this.turnSeq });
    }, wait);
  }

  rejectDraw(p, reason, id) {
    const now = clock.now();
    if (now - (p.rejectAt || -Infinity) >= 250) {
      p.rejectAt = now;
      this.send(p, 'draw-reject', { reason, id: id || null, seq: this.turnSeq });
    }
    this.resyncSoon(p);
  }

  canDraw(p) {
    if (this.pausedAt) return false;
    return this.state === 'lobby' || (this.state === 'drawing' && p.id === this.drawerId);
  }

  // Gate for every canvas mutation: right phase token, right role, not paused.
  drawGate(p, m, id) {
    if (m.seq !== this.turnSeq) { this.rejectDraw(p, 'stale', id); return false; }
    if (this.state === 'drawing' && this.pastDeadline()) { this.rejectDraw(p, 'stale', id); return false; }
    if (this.canDraw(p)) return true;
    if (this.pausedAt && (this.state === 'lobby' || p.id === this.drawerId)) this.rejectDraw(p, 'paused', id);
    return false;
  }

  shaky() { return this.state === 'drawing' && is(this.chaos, 'shaky'); }
}

const handlers = {
  settings(room, p, m) {
    if (p.id !== room.hostId || room.state !== 'lobby') return;
    const s = m.settings || {};
    room.settings = {
      rounds: clamp(s.rounds, 1, 10, DEFAULTS.rounds),
      drawTime: clamp(s.drawTime, 20, 240, DEFAULTS.drawTime),
      chaos: CHAOS_LEVELS.includes(s.chaos) ? s.chaos : s.chaos === true ? 'x4' : 'off',
      chaosPool: CHAOS_POOLS.includes(s.chaosPool) ? s.chaosPool : DEFAULTS.chaosPool,
      chaosIds: s.chaosIds == null ? room.settings.chaosIds : cleanChaosIds(s.chaosIds),
      wordChoices: clamp(s.wordChoices, 1, 5, DEFAULTS.wordChoices),
      hints: clamp(s.hints, 0, 5, DEFAULTS.hints),
      difficulty: DIFFICULTIES.includes(s.difficulty) ? s.difficulty : 'mix',
      decks: s.decks == null ? room.settings.decks : cleanDeckIds(s.decks),
      customWords: s.customWords == null ? room.settings.customWords : dedupeCustom(s.customWords),
      customOnly: !!s.customOnly,
    };
    room.sync();
  },
  start(room, p) { room.start(p); },
  again(room, p) { if (p.id === room.hostId && room.state === 'end') room.toLobby(); },
  choose(room, p, m) {
    if (p.id === room.drawerId && m.seq === room.turnSeq && !room.pausedAt) room.choose(m.i);
  },
  reroll(room, p, m) {
    if (p.id !== room.drawerId || room.state !== 'choosing' || m.seq !== room.turnSeq || room.rerolled || room.pausedAt) return;
    const prev = room.choices.map((c) => canonKey(c.word));
    const next = room.pickWords(room.settings.wordChoices, room.choices.map((c) => c.word));
    if (next.every((c) => prev.includes(canonKey(c.word)))) return room.send(p, 'toast', { text: 'No other words available to swap in.' });
    room.rerolled = true;
    room.choices = next;
    room.sync();
  },
  rescue(room, p, m) {
    if (p.id !== room.drawerId || room.state !== 'choosing' || m.seq !== room.turnSeq || p.rescued || !room.chaos || room.pausedAt || room.pastDeadline()) return;
    const next = pickChaos((Math.random() * 0xffffffff) >>> 0, room.chaos.id, 'artist', false, room.settings.chaosIds);
    if (!next || next.id === room.chaos.id) return room.send(p, 'toast', { text: 'No other challenge to swap in.' });
    room.chaos = next;
    room.lastChaosId = next.id;
    p.rescued = true;
    room.sync();
  },
  skip(room, p, m) {
    if (p.id === room.drawerId && room.state === 'drawing' && m.seq === room.turnSeq && room.guessed.size === 0 && !room.pausedAt) {
      room.endTurn('skip');
    }
  },

  stroke(room, p, m) {
    const cid = m.s?.id;
    if (!room.drawGate(p, m, cid)) return;
    const lobby = room.state === 'lobby';
    if (room.strokes.length >= MAX_STROKES) return room.rejectDraw(p, 'budget', cid);
    const v = validateStroke(m.s);
    if (!v.ok) return room.rejectDraw(p, v.reason, cid);
    const id = strokeId(p.id, cid);
    if (room.strokes.some((s) => s.id === id)) return room.rejectDraw(p, 'duplicate', id);
    const gm = room.clockMs();
    if (!lobby && !allowedTool(room.chaos, v.tool)) return room.rejectDraw(p, 'tool', id);
    if (!lobby && is(room.chaos, 'onestroke') && room.strokes.some((s) => s.by === p.id)) return room.rejectDraw(p, 'onestroke', id);
    if (!lobby && is(room.chaos, 'fivestrokes') && room.strokeUsed >= STROKE_BUDGET) return room.rejectDraw(p, 'strokes', id);
    if (room.coordCount + v.pts.length > MAX_TURN_COORDS) return room.rejectDraw(p, 'budget', id);
    let pts = room.shaky() && v.tool !== 'fill' ? jitterPts(id, v.pts) : v.pts;
    let clipped = false, cost = 0;
    if (!lobby && is(room.chaos, 'inkbudget')) {
      const left = INK_BUDGET - room.inkUsed;
      if (left < v.size) return room.rejectDraw(p, 'ink', id);
      if (v.tool === 'pen' || v.tool === 'eraser') {
        const trimmed = trimInk(pts, left - v.size);
        pts = trimmed.pts; cost = trimmed.cost + v.size; clipped = trimmed.clipped;
      } else {
        cost = inkCost(v);
        if (cost > left) return room.rejectDraw(p, 'ink', id);
      }
    }
    let out = { id, by: p.id, tool: v.tool, color: v.color, size: v.size, pts, t: gm };
    if (v.tool === 'stamp') { out.shape = v.shape; out.pts = stampBounds(pts, v.shape); out.size = 4; }
    if (!lobby && is(room.chaos, 'forbidden')) out.forbidden = forbiddenZone(room.chaos.seed);
    if (!lobby && is(room.chaos, 'shrinking')) out.size = shrinkingSize(gm, room.scoreLen);
    if (!lobby && is(room.chaos, 'slippery')) out.pts = slipperyPts(pts);
    if (!lobby) out = applyChaos(out, room.chaos);
    room.coordCount += pts.length;
    room.strokes.push(out);
    room.redoStacks.delete(p.id);
    room.strokeUsed++;
    room.inkUsed += cost;
    room.broadcastDraw('stroke', { s: out, seq: room.turnSeq });
    room.sendBudget(p);
    if (clipped) room.rejectDraw(p, 'ink', id);
  },
  pts(room, p, m) {
    const id = strokeId(p.id, m.id);
    if (!room.drawGate(p, m, id)) return;
    const s = room.strokes.findLast((x) => x.id === id && x.by === p.id);
    if (!s || (s.tool !== 'pen' && s.tool !== 'eraser')) return room.rejectDraw(p, 'stale', id);
    let add = validatePts(m.pts);
    if (!add) return room.rejectDraw(p, 'pts', id);
    if (s.pts.length + add.length > MAX_STROKE_PTS || room.coordCount + add.length > MAX_TURN_COORDS) return room.rejectDraw(p, 'budget', id);
    if (room.shaky()) add = jitterPts(id, add, s.pts.length / 2);
    if (room.state === 'drawing' && is(room.chaos, 'slippery')) add = slipperyPts(add, s.pts.slice(-2));
    let clipped = false;
    if (is(room.chaos, 'inkbudget')) {
      if (room.inkUsed >= INK_BUDGET) return room.rejectDraw(p, 'ink', id);
      const trimmed = trimInk(add, INK_BUDGET - room.inkUsed, s.pts.slice(-2));
      add = trimmed.pts; clipped = trimmed.clipped; room.inkUsed += trimmed.cost;
    }
    s.pts.push(...add);
    room.coordCount += add.length;
    room.broadcastDraw('pts', { id, pts: add, seq: room.turnSeq }, p.id);
    room.sendBudget(p);
    if (clipped) room.rejectDraw(p, 'ink', id);
  },
  undo(room, p, m) {
    if (!room.drawGate(p, m)) return;
    if (room.state === 'drawing' && !canUndo(room.chaos)) return room.rejectDraw(p, 'locked');
    const idx = room.strokes.findLastIndex((x) => x.by === p.id && !x.decoy);
    if (idx < 0) return;
    const [s] = room.strokes.splice(idx, 1);
    room.coordCount -= s.pts.length;
    if (!room.redoStacks.has(p.id)) room.redoStacks.set(p.id, []);
    room.redoStacks.get(p.id).push(s);
    room.broadcastDraw('undo', { id: s.id, seq: room.turnSeq });
  },
  // Restores the sender's last undone stroke. Undo never refunded stroke or ink
  // budgets, so redo charges nothing; a fresh stroke or clear drops the stack.
  redo(room, p, m) {
    if (!room.drawGate(p, m)) return;
    if (room.state === 'drawing' && !canUndo(room.chaos)) return room.rejectDraw(p, 'locked');
    const s = room.redoStacks.get(p.id)?.pop();
    if (!s) return;
    if (room.strokes.length >= MAX_STROKES || room.coordCount + s.pts.length > MAX_TURN_COORDS) return room.rejectDraw(p, 'budget', s.id);
    room.coordCount += s.pts.length;
    room.strokes.push(s);
    room.broadcastDraw('stroke', { s, seq: room.turnSeq });
  },
  clear(room, p, m) {
    const lobby = room.state === 'lobby';
    if (lobby ? p.id !== room.hostId : !canUndo(room.chaos)) return;
    if (!room.drawGate(p, m)) return;
    const kept = lobby ? [] : room.strokes.filter((x) => x.decoy);
    room.resetCanvas(!room.batching());
    if (kept.length) {
      room.strokes.push(...kept);
      room.coordCount = kept.reduce((n, x) => n + x.pts.length, 0);
      if (!room.batching()) room.publishedStrokes = kept.map((s) => ({ ...s, pts: [...s.pts] }));
    }
    room.broadcastDraw('clear', { seq: room.turnSeq, strokes: kept });
  },

  chat(room, p, m) {
    const requestId = clean(m.requestId, 40);
    const ack = (accepted) => { if (requestId) room.send(p, 'guess-result', { seq: m.seq, requestId, accepted }); };
    const text = clean(m.text, 120);
    if (!text) return ack(false);
    if (requestId && (room.state !== 'drawing' || room.pausedAt || m.seq !== room.turnSeq || room.pastDeadline())) {
      room.send(p, 'toast', { text: room.pausedAt ? 'Paused. Your guess was kept.' : 'That turn has ended.' });
      return ack(false);
    }
    const now = clock.now();
    p.chatTimes = (p.chatTimes || []).filter((t) => now - t < 5000);
    if (p.chatTimes.length >= 8) { room.send(p, 'toast', { text: 'Whoa, slow down 🐢' }); return ack(false); }
    p.chatTimes.push(now);
    if (room.state !== 'drawing' || !room.word) return room.broadcast('chat', { kind: 'guess', from: p.id, text });
    if (!room.isSolver(p)) return ack(room.guess(p, text, m.seq) === true);
    if (room.spoils(text)) { room.send(p, 'chat', { kind: 'system', tone: 'warn', text: 'Nice try — no spoilers! 🤐' }); return ack(false); }
    for (const q of room.players.values()) if (room.isSolver(q)) room.send(q, 'chat', { kind: 'solved', from: p.id, text });
    ack(true);
  },
  react(room, p, m) {
    if (!REACTIONS.includes(m.e)) return;
    const now = clock.now();
    if (now - (p.lastReact || -Infinity) < 250) return;
    p.lastReact = now;
    room.broadcast('react', { from: p.id, e: m.e });
  },
  kick(room, p, m) {
    const target = room.players.get(m.id);
    if (target && target.id !== p.id && p.id === room.hostId) room.kick(target);
  },
  pause(room, p, m) { if (p.id === room.hostId) room.setHostPaused(m.on === true); },
  vote(room, p, m) { room.vote(p, m.id == null ? null : Number(m.id)); },
  ping(room, p) { room.send(p, 'pong'); },
  leave(room, p) {
    p.connected = false;
    p.ws = null;
    room.system(`👋 ${p.name} left`);
    room.remove(p.id);
  },
};

function addPlayer(ws, room, { name, avatar, color, token }) {
  let p = token && [...room.players.values()].find((q) => q.token === token);
  if (p) {
    clock.clear(p.dropTimer);
    p.dropDeadline = 0;
    if (p.ws && p.ws !== ws) try { p.ws.close(4000, 'replaced'); } catch {}
    Object.assign(p, { ws, connected: true, name, avatar, color });
    if (room.inPlay() && !room.drawnThisRound.has(p.id) && p.id !== room.drawerId && !room.queue.includes(p.id)) room.queue.push(p.id);
  } else {
    if (room.players.size >= MAX_PLAYERS) {
      raw(ws, 'error', { text: 'Room is full.' });
      try { ws.close(4003, 'full'); } catch {}
      return;
    }
    p = {
      id: crypto.randomUUID().slice(0, 8), token: crypto.randomUUID(), name, avatar, color, ws, connected: true,
      score: 0, streak: 0, bestStreak: 0, close: 0, fastest: null, rescued: false, dropTimer: null, dropDeadline: 0,
    };
    room.players.set(p.id, p);
    room.order.push(p.id);
    if (room.inPlay()) room.queue.push(p.id);
    room.system(`🎉 ${p.name} joined`, 'good');
  }
  if (!room.players.get(room.hostId)?.connected) room.hostId = p.id;
  ws.data = { room: room.code, pid: p.id };
  room.send(p, 'welcome', { code: room.code, token: p.token, id: p.id });
  room.send(p, 'canvas', { strokes: room.canvasFor(p), seq: room.turnSeq });
  if (room.state === 'end') room.send(p, 'gallery', { gallery: room.gallery });
  room.broadcast('sfx', { s: 'join' }, p.id);
  room.updatePause();
}

export function joinRoom(ws, m) {
  const name = clean(m.name, 18) || 'Doodler';
  const avatar = clean(m.avatar, 8) || '🦊';
  const color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#ffc93c';
  let room;
  if (m.room) {
    room = rooms.get(String(m.room).toUpperCase());
    if (!room) return raw(ws, 'error', { text: 'That room does not exist (anymore). Create a new one!' });
  } else {
    room = new Room(makeCode());
    rooms.set(room.code, room);
  }
  const token = m.token ? String(m.token) : null;
  if (token && room.banned.has(token)) return raw(ws, 'error', { text: 'You were kicked from this room.' });
  addPlayer(ws, room, { name, avatar, color, token });
}

export function onClose(ws) {
  const data = ws.data || {};
  const room = rooms.get(data.room);
  const p = room?.players.get(data.pid);
  if (!p || p.ws !== ws) return;
  p.connected = false;
  p.ws = null;
  const grace = room.state === 'lobby' ? LOBBY_GRACE : GAME_GRACE;
  p.dropDeadline = clock.now() + grace;
  p.dropTimer = clock.set(() => {
    if (!p.connected && room.players.get(p.id) === p) { room.system(`👋 ${p.name} left`); room.remove(p.id); }
  }, grace);
  room.onDisconnect();
}

export function onMessage(ws, rawMsg) {
  let m;
  try { m = JSON.parse(rawMsg); } catch { return; }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
  if (m.t === 'join') { if (!ws.data?.pid) joinRoom(ws, m); return; }
  const room = rooms.get(ws.data?.room);
  const p = room?.players.get(ws.data?.pid);
  if (!p || p.ws !== ws || !Object.hasOwn(handlers, m.t)) return;
  // Dropped drawing messages always trigger a (coalesced) resync so the
  // artist's optimistic canvas cannot silently diverge.
  if (DRAW_MSGS.has(m.t)) {
    if (!take(p, 'drawBucket', 60, 40)) return room.rejectDraw(p, 'rate', m.s?.id ?? m.id);
  } else if (!take(p, 'msgBucket', 60, 30)) return;
  try { handlers[m.t](room, p, m); } catch (e) { console.error('handler', m.t, e); }
}
