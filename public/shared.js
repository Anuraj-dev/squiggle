// Shared protocol for Squiggle. Imported by the server and the browser so
// stroke contracts, chaos and scoring cannot drift.

export const W = 1000, H = 750;
export const CHOOSE_MS = 25000, REVEAL_MS = 6000;
export const DIFF_MULT = { easy: 1, medium: 1.5, hard: 2.2 };
export const MAX_STROKES = 2500;
export const MAX_STROKE_PTS = 8000;
export const MAX_TURN_COORDS = 80000;
export const MAX_GALLERY = 48;
export const GALLERY_COORDS = 24000;
export const LOBBY_GRACE = 20000, GAME_GRACE = 120000;
export const SPEEDUP_LEFT = 25000;
export const TOOLS = new Set(['pen', 'eraser', 'fill', 'line', 'rect', 'ellipse', 'stamp']);
export const STAMP_SHAPES = ['circle', 'triangle', 'square', 'arrow', 'star', 'heart', 'moon', 'cloud', 'bolt', 'eye'];
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
  { id: 'negative', icon: '🌗', name: 'Opposite Colors', desc: 'Guessers see every ink color flipped.', view: true },
  { id: 'pixel', icon: '👾', name: '8-Bit', desc: 'Guessers see chunky pixels', view: true },
  { id: 'fivestrokes', icon: '✋', name: 'Five Strokes', desc: "Five pen strokes. Undo and clear don't restore them." },
  { id: 'inkbudget', icon: '🖋️', name: 'Ink Budget', desc: "Erasing uses ink. Undo and clear don't refill it.", mild: true },
  { id: 'mystery', icon: '❓', name: 'Mystery Length', desc: 'Word length appears halfway through.', view: true, mild: true },
  { id: 'straight', icon: '📏', name: 'Straight Lines Only', desc: 'Draw with straight lines.' },
  { id: 'forbidden', icon: '🚧', name: 'Forbidden Zone', desc: 'Ink cannot enter the marked area.' },
  { id: 'shrinking', icon: '🪡', name: 'Shrinking Brush', desc: 'Your pen gets thinner as time passes.', mild: true },
  { id: 'stamps', icon: '🔺', name: 'Stamp Artist', desc: 'Tap or drag to stamp a shape.' },
  { id: 'slippery', icon: '🧊', name: 'Slippery Pen', desc: 'Your pen trails behind your hand.', mild: true },
  { id: 'puzzle', icon: '🧩', name: 'Puzzle Board', desc: 'Tiles return to place as time passes.', view: true },
  { id: 'spotlight', icon: '🔦', name: 'Moving Spotlight', desc: 'A moving window opens onto the drawing.', view: true },
  { id: 'batches', icon: '🐌', name: 'Laggy Stream', desc: 'The drawing reaches you in bursts.', view: true, mild: true },
  { id: 'limited', icon: '🎯', name: 'Limited Guesses', desc: 'Three attempts. One returns every four seconds. Typos are free.', view: true },
  { id: 'gravity', icon: '🫠', name: 'Gravity Ink', desc: 'Everything you draw slowly slides down.' },
  { id: 'decoy', icon: '🪱', name: 'Decoy Doodle', desc: 'Start from a scribble you can’t erase.' },
  { id: 'macro', icon: '🔍', name: 'Macro Cam', desc: 'Guessers see a zoomed-in patch that pulls back.', view: true },
].map((mode) => ({ ...mode, target: mode.view || mode.id === 'nohints' ? 'guesser' : 'artist',
  mild: mode.mild || ['tiny', 'rainbow', 'onecolor', 'dotted'].includes(mode.id) }));
// Chaos rate: chance a turn is a chaos turn. 1x is the baseline (about 1 turn in 4); each step multiplies it, so 4x is every turn.
export const CHAOS_RATE = { x1: 0.25, x2: 0.5, x3: 0.75, x4: 1 };
export const CHAOS_LEVELS = ['off', ...Object.keys(CHAOS_RATE)];
export const CHAOS_POOLS = ['artist', 'guesser', 'mixed'];
export const MEMORY_STROKES = 4, GRAVITY_PX_PER_SEC = 10;
// Saturated inks for One Color / Mystery Ink.
export const INKS = ['#e8322a', '#ff7a2f', '#1f9d55', '#2ec4d6', '#3d7bff', '#9b6bff', '#ff4fa3', '#8a4b2a'];

export const CHAOS_IDS = CHAOS_MODES.map((t) => t.id);

// The host's chosen challenges: known ids only, in canonical order. Anything
// that is not a list means "keep every challenge".
export function cleanChaosIds(list) {
  if (!Array.isArray(list)) return CHAOS_IDS;
  const want = new Set(list);
  return CHAOS_IDS.filter((id) => want.has(id));
}

// `allowed` is the host's id list (null = every challenge). Returns null when
// nothing qualifies. Avoids repeating prevId unless it is the only option.
export function pickChaos(seed, prevId, target, mild = false, allowed = null) {
  const ok = (t) => (!allowed || allowed.includes(t.id)) && (!target || t.target === target) && (!mild || t.mild);
  let pool = CHAOS_MODES.filter((t) => ok(t) && t.id !== prevId);
  if (!pool.length) pool = CHAOS_MODES.filter(ok);
  return pool.length ? { ...pool[seed % pool.length], seed } : null;
}

// Guesser relief: challenge effects stay full until FADE_FROM of the turn, then fade to 0 at RELIEF_AT.
export const RELIEF_AT = 0.85;
const FADE_FROM = 0.4;
// Same elapsed clock and deadline for every guesser. A speedup brings relief forward.
export function turnProgress(elapsed, left) {
  return elapsed + left > 0 ? Math.min(1, Math.max(0, elapsed / (elapsed + left))) : 1;
}
export function viewStrength(elapsed, left) {
  const p = turnProgress(elapsed, left);
  if (p <= FADE_FROM) return 1;
  return Math.max(0, (RELIEF_AT - p) / (RELIEF_AT - FADE_FROM));
}

export function forbiddenZone(seed = 0) {
  const n = seed >>> 0;
  return { x: 100 + n % 601, y: 90 + (Math.imul(n, 31) >>> 0) % 421, w: 200, h: 150 };
}
export const shrinkingSize = (elapsed, scoreLen) => Math.round(22 - 18 * Math.min(1, Math.max(0, elapsed / (scoreLen || 1))));

// Derive size and rotation from the drag vector, keep taps upright at default
// size, and shift so even a rotated stamp stays on paper.
export function stampBounds(pts, shape) {
  let [x1, y1, x2, y2] = pts;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  let s;
  if (len < 2) {
    s = 80;
    x1 = x1 - s / 2;
    x2 = x1 + s;
    y2 = y1;
  } else {
    s = Math.min(240, Math.max(30, len));
    const scale = s / len;
    x2 = x1 + dx * scale;
    y2 = y1 + dy * scale;
  }
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const ux = (x2 - x1) / s, uy = (y2 - y1) / s;
  const pad = Math.ceil(shape === 'circle' ? s / 2 : (s / 2) * (Math.abs(ux) + Math.abs(uy)));
  const sx = Math.ceil(Math.max(0, pad - cx)) - Math.ceil(Math.max(0, cx + pad - (W - 1)));
  const sy = Math.ceil(Math.max(0, pad - cy)) - Math.ceil(Math.max(0, cy + pad - (H - 1)));
  return [x1 + sx, y1 + sy, x2 + sx, y2 + sy].map(Math.round);
}

// Rotate a #rrggbb color's hue by 180° * strength while keeping lightness and
// saturation intact, so black/white/grays and the paper stay unchanged.
export function rotateHue(hex, strength = 1) {
  if (!strength || strength <= 0 || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return hex;
  const l = (max + min) / 2;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h / 6 + 0.5 * Math.min(1, strength)) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const chan = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const byte = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${byte(chan(h + 1 / 3))}${byte(chan(h))}${byte(chan(h - 1 / 3))}`;
}

export function strokeMaxY(s) {
  const p = s?.pts;
  if (!p?.length) return 0;
  if (s.tool === 'stamp' && p.length >= 4) {
    const [x1, y1, x2, y2] = p;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (!len) return Math.min(H - 1, Math.max(0, y1));
    const pad = s.shape === 'circle' ? len / 2 : (len / 2) * (Math.abs(dx / len) + Math.abs(dy / len));
    return Math.min(H - 1, Math.max(0, (y1 + y2) / 2 + pad));
  }
  let maxY = 0;
  for (let i = 1; i < p.length; i += 2) if (p[i] > maxY) maxY = p[i];
  return Math.min(H - 1, maxY);
}

// Downward pixel offset for Gravity Ink, capped so strokes remain on paper.
export function gravityOffset(ageMs, maxY = 0) {
  const raw = Math.max(0, ageMs || 0) * GRAVITY_PX_PER_SEC / 1000;
  const cap = Math.max(0, H - 1 - Math.min(H - 1, Math.max(0, maxY)));
  return Math.min(cap, raw);
}

// Deterministic 1–2 seeded scribble strokes for Decoy Doodle.
export function decoyStrokes(seed = 0) {
  let state = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0 || 1;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
  next(); next();
  const count = next() < 0.5 ? 1 : 2;
  const out = [];
  for (let i = 0; i < count; i++) {
    let x = 180 + next() * (W - 360);
    let y = 140 + next() * (H - 280);
    let ang = next() * Math.PI * 2;
    let turn = (next() < 0.5 ? 1 : -1) * (0.35 + next() * 0.45);
    const pts = [Math.round(x), Math.round(y)];
    const steps = 8 + Math.floor(next() * 5);
    for (let k = 0; k < steps; k++) {
      ang += turn + (next() - 0.5) * 0.5;
      if (next() < 0.25) turn = -turn;
      const step = 30 + next() * 35;
      x = Math.min(W - 80, Math.max(80, x + Math.cos(ang) * step));
      y = Math.min(H - 80, Math.max(80, y + Math.sin(ang) * step));
      pts.push(Math.round(x), Math.round(y));
    }
    out.push({ id: `decoy:${i}`, by: null, tool: 'pen', color: '#1d1b1a', size: 10, pts, t: 0, decoy: true });
  }
  return out;
}

export function recentInkCenter(strokes) {
  for (let i = (strokes?.length || 0) - 1; i >= 0; i--) {
    const s = strokes[i];
    if (!s || s.tool === 'eraser' || !s.pts?.length) continue;
    const p = s.pts.slice(-24);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let j = 0; j < p.length; j += 2) {
      if (p[j] < minX) minX = p[j]; if (p[j] > maxX) maxX = p[j];
      if (p[j + 1] < minY) minY = p[j + 1]; if (p[j + 1] > maxY) maxY = p[j + 1];
    }
    const cx = (minX + maxX) / 2;
    let cy = (minY + maxY) / 2;
    if (s.squish) cy = cy * 0.5 + H / 4;
    if (s.flipY) cy = H - cy;
    return { x: cx, y: cy };
  }
  return { x: W / 2, y: H / 2 };
}

// Zooms 2.5x around `focus` at full strength, easing back to 1x at 0,
// clamped so the zoomed viewport never exposes outside the paper.
export function macroView(focus, amount) {
  if (!amount || amount <= 0) return { zoom: 1, tx: 0, ty: 0 };
  const zoom = 1 + 1.5 * Math.min(1, amount);
  const u = Math.min(1, Math.max(0, (focus?.x ?? W / 2) / W));
  const v = Math.min(1, Math.max(0, (focus?.y ?? H / 2) / H));
  const lim = (zoom - 1) / 2;
  const clampLim = (val) => Math.max(-lim, Math.min(lim, val));
  return { zoom, tx: clampLim(zoom * (0.5 - u)), ty: clampLim(zoom * (0.5 - v)) };
}

// Packet boundaries must not change the path: carry the last rendered point.
export function slipperyPts(pts, previous) {
  const out = [];
  let last = previous;
  for (let i = 0; i < pts.length; i += 2) {
    const raw = pts.slice(i, i + 2);
    let next = last ? raw.map((v, j) => last[j] + (v - last[j]) * 0.25) : raw;
    const gap = Math.hypot(raw[0] - next[0], raw[1] - next[1]);
    if (gap > 18) next = raw.map((v, j) => v + (next[j] - v) * 18 / gap);
    out.push(...next); last = next;
  }
  return out;
}

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

// Harder words pay more. Each active chaos mode (artist and guesser) adds 25%,
// and Speedrun adds another 25% on top. `modes` is an array of mode objects,
// a single mode, or null.
export function scoreMult(diff, modes) {
  const list = (Array.isArray(modes) ? modes : [modes]).filter(Boolean);
  const chaosMult = 1 + 0.25 * list.length;
  const speedMult = list.some((m) => m?.id === 'speed') ? 1.25 : 1;
  return (DIFF_MULT[diff] || 1) * chaosMult * speedMult;
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
// chaos is the array of active modes for the turn (see scoreMult).
// `finale` (the last turn of the match) doubles the whole award, chaos and streak included.
export const FINALE_MULT = 2;
export function guesserPts({ elapsed, scoreLen, diff, chaos, streak, finale }) {
  const streakN = Math.min(3, Math.max(0, (streak || 1) - 1));
  const pts = Math.round((100 + 200 * timeFrac(elapsed, scoreLen)) * scoreMult(diff, chaos)) + streakN * 10;
  return finale ? pts * FINALE_MULT : pts;
}

// eligible is the number of guessers present when drawing started; it does
// not shrink when someone leaves, so the drawer's share stays stable. `all`
// means every guesser still in the room solved it, which earns the bonus.
export function drawerPts({ solved, eligible, diff, chaos, all, finale }) {
  if (!eligible) return 0;
  const frac = Math.max(0, Math.min(1, solved / eligible));
  const bonus = all ? 100 : 0;
  return Math.round((200 * frac + bonus) * scoreMult(diff, chaos)) * (finale ? FINALE_MULT : 1);
}

export function allBonus(diff, chaos) {
  return Math.round(100 * scoreMult(diff, chaos));
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
  stamp: { exact: 4 },
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
  if (tool === 'stamp' && !STAMP_SHAPES.includes(s.shape)) return { ok: false, reason: 'shape' };
  return { ok: true, tool, pts, color, size, ...(tool === 'stamp' ? { shape: s.shape } : {}) };
}

// Which drawing tools the artist may use under a chaos mode.
export function allowedTool(chaos, tool) {
  if (!TOOLS.has(tool)) return false;
  if (is(chaos, 'stamps')) return tool === 'stamp';
  if (tool === 'stamp') return false;
  if (is(chaos, 'straight')) return tool === 'line';
  if (is(chaos, 'shrinking')) return tool === 'pen';
  if (is(chaos, 'slippery')) return tool === 'pen' || tool === 'eraser';
  if (is(chaos, 'forbidden')) return tool !== 'fill';
  if (is(chaos, 'onestroke')) return tool === 'pen';
  if (is(chaos, 'fivestrokes')) return tool === 'pen';
  if (is(chaos, 'inkbudget')) return tool !== 'fill';
  if (is(chaos, 'fade')) return tool !== 'fill';
  if (is(chaos, 'shapes')) return tool !== 'pen' && tool !== 'eraser';
  if (is(chaos, 'permanent')) return tool !== 'eraser';
  // Gravity slides each stroke by its own age, so a fill seed or an eraser pass
  // would drift away from the ink it was aimed at.
  if (is(chaos, 'gravity')) return tool !== 'fill' && tool !== 'eraser';
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
  for (const [id, flag] of [['mirror', 'mirror'], ['kaleido', 'kaleido'], ['upside', 'flipY'], ['squish', 'squish'], ['double', 'double'], ['gravity', 'gravity']]) {
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
