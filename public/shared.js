// Shared protocol for Squiggle. Imported by the server and the browser so
// stroke contracts, chaos and scoring cannot drift.

export const W = 1000, H = 750;
export const CHOOSE_MS = 15000, REVEAL_MS = 6000;
export const DIFF_MULT = { easy: 1, medium: 1.3, hard: 1.7 };
export const MAX_STROKES = 2500;
export const MAX_STROKE_PTS = 8000;
export const MAX_TURN_COORDS = 80000;
export const MAX_GALLERY = 48;
export const GALLERY_COORDS = 24000;
export const LOBBY_GRACE = 20000, GAME_GRACE = 120000;
export const SPEEDUP_LEFT = 25000;
export const TOOLS = new Set(['pen', 'eraser', 'fill', 'line', 'rect', 'ellipse']);
export const JITTER = 7;
export const INK_BUDGET = 6000, STROKE_BUDGET = 5;

// Artist rules affect tools and strokes. Guesser rules affect clues and the view.
export const CHAOS_MODES = [
  { id: 'mirror', icon: '🪞', name: 'Mirror Mirror', desc: 'Everything you draw is mirrored' },
  { id: 'onestroke', icon: '➰', name: 'One Line', desc: 'One pen stroke — don’t lift!' },
  { id: 'blind', icon: '🙈', name: 'Blindfold', desc: 'You can’t see your drawing. They can.' },
  { id: 'tiny', icon: '🤏', name: 'Tiny Pen', desc: 'Smallest brush only' },
  { id: 'giant', icon: '🖍️', name: 'Fat Marker', desc: 'Biggest brush only' },
  { id: 'shaky', icon: '☕', name: 'Too Much Coffee', desc: 'Your hand won’t stop shaking' },
  { id: 'rainbow', icon: '🌈', name: 'Rainbow Ink', desc: 'Every line is a rainbow' },
  { id: 'fade', icon: '👻', name: 'Ghost Ink', desc: 'Lines vanish after a few seconds' },
  { id: 'speed', icon: '⚡', name: 'Speedrun', desc: 'Half the time, 1.5× points' },
  { id: 'onecolor', icon: '🎨', name: 'One Color', desc: 'Stuck with one random color' },
  { id: 'randomink', icon: '🎲', name: 'Mystery Ink', desc: 'Every stroke picks its own color' },
  { id: 'upside', icon: '🙃', name: 'Upside Down', desc: 'Everything lands upside down' },
  { id: 'kaleido', icon: '❄️', name: 'Kaleidoscope', desc: 'Four-way mirror on everything' },
  { id: 'squish', icon: '🥞', name: 'Pancake', desc: 'Everything gets squashed flat' },
  { id: 'shapes', icon: '🔷', name: 'Shapes Only', desc: 'Lines, boxes, circles and fill — no pen' },
  { id: 'permanent', icon: '🖊️', name: 'Permanent Marker', desc: 'No eraser, no undo, no clear' },
  { id: 'dotted', icon: '🫧', name: 'Morse Code', desc: 'Every line comes out dotted' },
  { id: 'double', icon: '😵‍💫', name: 'Double Vision', desc: 'Everything has a ghostly twin' },
  { id: 'memory', icon: '🐠', name: 'Goldfish Memory', desc: 'Only the last 4 strokes stay visible' },
  { id: 'nohints', icon: '🤐', name: 'No Hints', desc: 'No letters get revealed this turn' },
  { id: 'fog', icon: '🌫️', name: 'Foggy Glasses', desc: 'Guessers see a blur that slowly clears', view: true },
  { id: 'quake', icon: '🌋', name: 'Earthquake', desc: 'The guessers’ screen won’t stop shaking', view: true },
  { id: 'spin', icon: '🎠', name: 'Merry-Go-Round', desc: 'The canvas slowly spins for guessers', view: true },
  { id: 'negative', icon: '🌚', name: 'Negative', desc: 'Guessers see inverted colors', view: true },
  { id: 'pixel', icon: '👾', name: '8-Bit', desc: 'Guessers see chunky pixels', view: true },
  { id: 'laggy', icon: '🐌', name: 'Laggy Stream', desc: 'Strokes arrive late, then catch up.', view: true },
  { id: 'fivestrokes', icon: '✋', name: 'Five Strokes', desc: "Five pen strokes. Undo and clear don't restore them." },
  { id: 'inkbudget', icon: '🖋️', name: 'Ink Budget', desc: "Erasing uses ink. Undo and clear don't refill it.", mild: true },
  { id: 'mystery', icon: '❓', name: 'Mystery Length', desc: 'Word length appears halfway through.', view: true, mild: true },
  { id: 'curtain', icon: '🎭', name: 'Curtain Reveal', desc: 'The drawing opens in strips.', view: true, mild: true },
].map((mode) => ({ ...mode, target: mode.view || mode.id === 'nohints' ? 'guesser' : 'artist',
  mild: mode.mild || ['tiny', 'rainbow', 'onecolor', 'dotted'].includes(mode.id) }));
export const CHAOS_LEVELS = ['off', 'some', 'always'];
export const CHAOS_POOLS = ['artist', 'guesser', 'mixed'];
export const LAG_MS = 4000, MEMORY_STROKES = 4;
// Saturated inks for One Color / Mystery Ink.
export const INKS = ['#e8322a', '#ff7a2f', '#1f9d55', '#2ec4d6', '#3d7bff', '#9b6bff', '#ff4fa3', '#8a4b2a'];

export function pickChaos(seed, prevId, target, mild = false) {
  const pool = CHAOS_MODES.filter((t) => t.id !== prevId && (!target || t.target === target) && (!mild || t.mild));
  return { ...pool[seed % pool.length], seed };
}

// Same elapsed clock and deadline for every guesser. A speedup brings relief forward.
export function turnProgress(elapsed, left) {
  return elapsed + left > 0 ? Math.min(1, Math.max(0, elapsed / (elapsed + left))) : 1;
}
export const viewStrength = (elapsed, left) => Math.max(0, 1 - turnProgress(elapsed, left) * 1.5);

export function inkCost(s, previous) {
  const p = s.pts;
  if (s.tool === 'rect') return 2 * (Math.abs(p[2] - p[0]) + Math.abs(p[3] - p[1]));
  if (s.tool === 'ellipse') {
    const a = Math.abs(p[2] - p[0]) / 2, b = Math.abs(p[3] - p[1]) / 2;
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  }
  // Charge the initial mark too, so repeated dots cannot bypass the budget.
  let cost = previous ? 0 : s.size, last = previous || p.slice(0, 2);
  for (let i = previous ? 0 : 2; i < p.length; i += 2) {
    cost += Math.hypot(p[i] - last[0], p[i + 1] - last[1]);
    last = p.slice(i, i + 2);
  }
  return cost;
}

// Freehand ink ends exactly at the remaining budget, rather than dropping its tail.
export function trimInk(pts, remaining, previous) {
  const out = [], start = previous ? 0 : 2;
  let last = previous || pts.slice(0, 2), spent = 0;
  if (!previous) out.push(...last);
  for (let i = start; i < pts.length; i += 2) {
    const next = pts.slice(i, i + 2), distance = Math.hypot(next[0] - last[0], next[1] - last[1]);
    if (spent + distance > remaining) {
      const part = Math.max(0, remaining - spent) / distance;
      if (part > 0) out.push(last[0] + (next[0] - last[0]) * part, last[1] + (next[1] - last[1]) * part);
      return { pts: out, cost: Math.max(0, remaining), clipped: true };
    }
    out.push(...next); spent += distance; last = next;
  }
  return { pts: out, cost: spent, clipped: false };
}

export const is = (chaos, id) => chaos?.id === id;

export const clamp = (n, lo, hi, d) => (Number.isFinite(+n) ? Math.min(hi, Math.max(lo, Math.round(+n))) : d);
export const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').trim().slice(0, max);
export const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

export function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export function shuffleIn(a, rnd) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- scoring ---------------------------------------------------------------

// A chaos mode makes drawing harder, so it pays a little more; Speedrun pays most.
export function scoreMult(diff, chaos) {
  return (DIFF_MULT[diff] || 1) * (!chaos ? 1 : is(chaos, 'speed') ? 1.5 : 1.2);
}

// Share of the speed bonus still on offer. Time counts in whole seconds and
// the first 15% of the turn is a free grace window, so network jitter or a
// near-tie between guessers never changes the score.
export function timeFrac(elapsed, scoreLen) {
  if (!scoreLen) return 0;
  const grace = scoreLen * 0.15;
  const t = Math.floor(Math.max(0, elapsed) / 1000) * 1000;
  return Math.max(0, Math.min(1, 1 - (t - grace) / (scoreLen - grace)));
}

// elapsed is unpaused turn time; scoreLen is the turn length at the start of
// the turn, so a speedup that shortens the deadline never changes the curve.
// No first-guesser bonus: a 1 ms tie must not be worth points.
export function guesserPts({ elapsed, scoreLen, diff, chaos, streak }) {
  const streakN = Math.min(5, Math.max(0, (streak || 1) - 1));
  return Math.round((120 + 180 * timeFrac(elapsed, scoreLen)) * scoreMult(diff, chaos)) + streakN * 15;
}

// eligible is the number of guessers present when drawing started; it does
// not shrink when someone leaves, so the drawer's share stays stable.
export function drawerPts({ solved, eligible, diff, chaos }) {
  if (!eligible) return 0;
  const frac = Math.max(0, Math.min(1, solved / eligible));
  return Math.round(180 * frac * scoreMult(diff, chaos));
}

export function tiedRanking(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score || String(a.name).localeCompare(b.name));
  let rank = 1;
  return sorted.map((p, i) => {
    if (i && p.score < sorted[i - 1].score) rank = i + 1;
    return { id: p.id, name: p.name, avatar: p.avatar, color: p.color, score: p.score, rank };
  });
}

// Podium shows every player whose competition rank is 1–3, grouped by rank.
// Everyone else is in `rest`. Each player appears exactly once.
export function podiumGroups(ranking) {
  const podium = [];
  for (const p of ranking) {
    if (p.rank > 3) continue;
    const g = podium.find((x) => x.rank === p.rank);
    if (g) g.players.push(p); else podium.push({ rank: p.rank, players: [p] });
  }
  return { podium, rest: ranking.filter((p) => p.rank > 3) };
}

// --- strokes ---------------------------------------------------------------

const TOOL_SPEC = {
  pen: { min: 2, max: MAX_STROKE_PTS },
  eraser: { min: 2, max: MAX_STROKE_PTS },
  fill: { exact: 2 },
  line: { exact: 4 },
  rect: { exact: 4 },
  ellipse: { exact: 4 },
};

export function strokeId(playerId, clientId) {
  const raw = clean(clientId, 40).replace(/[^\w:-]/g, '');
  if (!raw) return '';
  const prefix = `${playerId}:`;
  return (raw.startsWith(prefix) ? raw : `${prefix}${raw}`).slice(0, 48);
}

// Points are clamped onto the page.
const coord = (v, i) => {
  const n = +v;
  if (!Number.isFinite(n)) return null;
  return Math.min(i % 2 ? H - 1 : W - 1, Math.max(0, Math.round(n)));
};

export function validatePts(pts, max = 2000) {
  if (!Array.isArray(pts) || !pts.length || pts.length % 2 || pts.length > max) return null;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const v = coord(pts[i], i);
    if (v == null) return null;
    out.push(v);
  }
  return out;
}

export function validateStroke(s) {
  if (!s || typeof s !== 'object') return { ok: false, reason: 'invalid' };
  if (!clean(s.id, 40).replace(/[^\w:-]/g, '')) return { ok: false, reason: 'id' };
  const tool = s.tool;
  const spec = Object.hasOwn(TOOL_SPEC, tool) && TOOL_SPEC[tool];
  if (!spec) return { ok: false, reason: 'tool' };
  const n = Array.isArray(s.pts) ? s.pts.length : -1;
  if (spec.exact != null ? n !== spec.exact : (n < spec.min || n > spec.max)) return { ok: false, reason: 'pts' };
  const pts = validatePts(s.pts, MAX_STROKE_PTS);
  if (!pts) return { ok: false, reason: 'pts' };
  const color = /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : '#1d1b1a';
  const size = clamp(s.size, 1, 80, 6);
  return { ok: true, tool, pts, color, size };
}

// Which drawing tools the artist may use under a chaos mode.
export function allowedTool(chaos, tool) {
  if (!TOOLS.has(tool)) return false;
  if (is(chaos, 'onestroke')) return tool === 'pen';
  if (is(chaos, 'fivestrokes')) return tool === 'pen';
  if (is(chaos, 'inkbudget')) return tool !== 'fill';
  if (is(chaos, 'fade')) return tool !== 'fill';
  if (is(chaos, 'shapes')) return tool !== 'pen' && tool !== 'eraser';
  if (is(chaos, 'permanent')) return tool !== 'eraser';
  return true;
}

export const canUndo = (chaos) => !is(chaos, 'onestroke') && !is(chaos, 'permanent');

// Stroke-level effects; render flags are read by board.js.
export function applyChaos(out, chaos) {
  const ink = out.tool !== 'eraser';
  if (is(chaos, 'tiny')) out.size = 3;
  if (is(chaos, 'giant')) out.size = 44;
  if (is(chaos, 'onecolor') && ink) out.color = INKS[(chaos.seed >>> 3) % INKS.length];
  if (is(chaos, 'randomink') && ink) out.color = INKS[hashStr(String(out.id)) % INKS.length];
  if (is(chaos, 'rainbow') && ink) out.rainbow = true;
  for (const [id, flag] of [['mirror', 'mirror'], ['kaleido', 'kaleido'], ['upside', 'flipY'], ['squish', 'squish'], ['double', 'double']]) {
    if (is(chaos, id)) out[flag] = true;
  }
  if (is(chaos, 'dotted') && out.tool !== 'fill') out.dotted = true;
  return out;
}

export function hashStr(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return x >>> 0;
}

// Deterministic "shaky hand" offset for point k of a stroke. The server applies
// it once; the client applies the same function to its optimistic copy.
export function jitter(id, k) {
  const h = hashStr(`${id}#${k}`);
  return [(h & 0xff) / 255 * 2 * JITTER - JITTER, ((h >>> 8) & 0xff) / 255 * 2 * JITTER - JITTER].map(Math.round);
}

// Returns a jittered copy of pts whose first pair is point index `from`.
export function jitterPts(id, pts, from = 0) {
  const out = [];
  for (let i = 0; i < pts.length; i += 2) {
    const [dx, dy] = jitter(id, from + i / 2);
    out.push(pts[i] + dx, pts[i + 1] + dy);
  }
  return out;
}

// --- ghost ink ---------------------------------------------------------------

export function fadeMs(seed) {
  return 6000 + (seed % 4) * 1000;
}

export function fadeAlpha(age, life) {
  if (age <= life) return 1;
  return Math.max(0, 1 - (age - life) / 1400);
}

// Client clock: phase time left and unpaused turn time, frozen while paused.
export function clientClock(S, recvAt, now) {
  if (!S) return { left: 0, gameMs: 0 };
  const dt = S.paused ? 0 : Math.max(0, now - recvAt);
  return { left: Math.max(0, (S.timeLeft || 0) - dt), gameMs: (S.gameMs || 0) + dt };
}

// --- gallery ---------------------------------------------------------------

function thin(pts, stride) {
  const pairs = pts.length / 2;
  if (stride <= 1 || pairs <= 2) return pts;
  const out = [];
  for (let i = 0; i < pairs; i += stride) out.push(pts[2 * i], pts[2 * i + 1]);
  const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
  if (out[out.length - 2] !== lx || out[out.length - 1] !== ly) out.push(lx, ly);
  return out;
}

// Keeps every stroke; if the drawing exceeds the retention budget, freehand
// strokes are evenly thinned (endpoints kept) across the whole drawing.
export function galleryStrokes(strokes) {
  const total = strokes.reduce((n, s) => n + s.pts.length, 0);
  if (total <= GALLERY_COORDS) return strokes;
  const stride = Math.ceil(total / GALLERY_COORDS);
  return strokes.map((s) => (s.tool === 'pen' || s.tool === 'eraser' ? { ...s, pts: thin(s.pts, stride) } : s));
}
