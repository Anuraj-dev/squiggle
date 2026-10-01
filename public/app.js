// Squiggle client: one module, no build step.
import { W, H, is, clientClock, applyChaos, allowedTool, jitterPts, podiumGroups } from './shared.js';
import { applyStroke, drawStroke, paintPaper, paintThumb } from './board.js';

const $ = (s, r = document) => r.querySelector(s);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const AVATARS = ['🦊', '🐸', '🐙', '🦄', '🐼', '🐯', '🦖', '🐧', '🐝', '🦉', '🐳', '🍄', '👾', '🤖', '👻', '🐌', '🦀', '🐢', '🦥', '🌵', '🐨', '🐷', '🦩', '🍕', '🥑', '🐲', '🧙', '🤠'];
const AV_COLORS = ['#ffc93c', '#ff8a6b', '#7fe0b5', '#8fb3ff', '#c8a8ff', '#ff9fcf', '#7fdcea', '#c6e67a'];
const PALETTE = ['#1d1b1a', '#8a847c', '#ffffff', '#e8322a', '#ff7a2f', '#ffc93c', '#8bd346', '#1f9d55',
  '#2ec4d6', '#3d7bff', '#9b6bff', '#ff7fbf', '#8a4b2a', '#ffd7b5'];
const SIZES = [4, 10, 22, 44];
const REACTIONS = ['😂', '🔥', '😮', '🤯', '💀', '👏'];
const ICONS = {
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  eraser: '<path d="M8 20h12"/><path d="M4 15l9-9 6 6-7 7H8z"/><path d="M9 10l6 6"/>',
  fill: '<path d="M5 11l7-7 7 7-7 7z"/><path d="M19 15c0 2 1 3 1 4a1.5 1.5 0 01-3 0c0-1 1-2 2-4z"/>',
  line: '<path d="M5 19L19 5"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  skip: '<path d="M5 5l9 7-9 7z"/><path d="M18 5v14"/>',
};
const svg = (name) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = ICONS[name]; return s; };

const profile = store.get('sq-profile', null) || {
  name: '', avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)], color: AV_COLORS[Math.floor(Math.random() * AV_COLORS.length)],
};
const tokens = store.get('sq-tokens', {});
const saveProfile = () => store.set('sq-profile', profile);

function renderAvatarPick() {
  const b = $('#avBig');
  b.textContent = profile.avatar;
  b.style.background = profile.color;
  fill($('#colorDots'), ...AV_COLORS.map((c) => h('button', {
    role: 'radio', 'aria-checked': String(c === profile.color), 'aria-label': `Color ${c}`, style: `background:${c}`,
    onclick: () => { profile.color = c; saveProfile(); renderAvatarPick(); },
  })));
}
const stepAvatar = (d) => {
  const i = AVATARS.indexOf(profile.avatar);
  profile.avatar = AVATARS[(i + d + AVATARS.length) % AVATARS.length];
  saveProfile(); renderAvatarPick();
};
$('#avPrev').onclick = () => stepAvatar(-1);
$('#avNext').onclick = () => stepAvatar(1);
$('#avBig').onclick = () => { profile.avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)]; profile.color = AV_COLORS[Math.floor(Math.random() * AV_COLORS.length)]; saveProfile(); renderAvatarPick(); };
$('#nameIn').value = profile.name;
$('#nameIn').oninput = (e) => { profile.name = e.target.value; saveProfile(); };

const inviteCode = (new URLSearchParams(location.search).get('r') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
function setupHome() {
  if (inviteCode) {
    $('#joinBanner').hidden = false;
    $('#joinCode').textContent = inviteCode;
    $('#joinBtn').hidden = false;
    $('#createBtn').classList.remove('primary');
    $('#createBtn').textContent = 'Create a new room instead';
  }
}
function needName() {
  if (!profile.name.trim()) {
    profile.name = ['Doodle', 'Sketchy', 'Scribbles', 'Crayon', 'Inky', 'Pixel'][Math.floor(Math.random() * 6)] + Math.floor(Math.random() * 90 + 10);
    $('#nameIn').value = profile.name;
    saveProfile();
  }
}
$('#createBtn').onclick = () => { needName(); unlockAudio(); connect(null); };
$('#joinBtn').onclick = () => { needName(); unlockAudio(); connect(inviteCode); };
$('#codeForm').onsubmit = (e) => {
  e.preventDefault();
  const c = $('#codeIn').value.toUpperCase().trim();
  if (c.length !== 5) return ($('#homeErr').textContent = 'Room codes are 5 characters');
  needName(); unlockAudio(); connect(c);
};
renderAvatarPick();
setupHome();

let ac = null;
let muted = store.get('sq-muted', false);
function unlockAudio() {
  if (!ac) try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  ac?.resume?.();
}
addEventListener('pointerdown', unlockAudio, { once: true });
function tone(f, at = 0, dur = 0.12, type = 'sine', vol = 0.12, f2 = null) {
  if (!ac || muted) return;
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const SFX = {
  join: () => { tone(520, 0, 0.08, 'triangle'); tone(780, 0.07, 0.1, 'triangle'); },
  correct: () => [660, 880, 1320].forEach((f, i) => tone(f, i * 0.08, 0.16, 'triangle', 0.16)),
  other: () => tone(880, 0, 0.1, 'sine', 0.08, 1320),
  close: () => tone(330, 0, 0.2, 'sawtooth', 0.05, 470),
  turn: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.16, 'square', 0.05)),
  tick: () => tone(1600, 0, 0.03, 'square', 0.03),
  reveal: () => { tone(520, 0, 0.18, 'triangle'); tone(390, 0.16, 0.3, 'triangle'); },
  allgot: () => [523, 659, 784, 659, 1047].forEach((f, i) => tone(f, i * 0.08, 0.14, 'triangle', 0.12)),
  end: () => [392, 523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.2, 'square', 0.06)),
  pop: () => tone(700, 0, 0.06, 'sine', 0.05, 1200),
};
const play = (s) => SFX[s]?.();
const setMuteIcon = () => { $('#muteBtn').textContent = muted ? '🔇' : '🔊'; };
$('#muteBtn').onclick = () => { muted = !muted; store.set('sq-muted', muted); setMuteIcon(); };
setMuteIcon();

let toastT;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2200);
}
function confetti(n = 60) {
  const box = $('#confetti');
  const colors = ['#ffc93c', '#ff5a3c', '#2fc98b', '#3d7bff', '#9b6bff', '#ff7fbf'];
  for (let i = 0; i < n; i++) {
    const c = h('i', { style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};--dx:${(Math.random() - 0.5) * 200}px;--rot:${Math.random() * 900}deg;animation-duration:${1.6 + Math.random() * 1.6}s;animation-delay:${Math.random() * 0.4}s` });
    box.append(c);
    setTimeout(() => c.remove(), 4000);
  }
}

// --- connection ------------------------------------------------------------

let ws = null, S = null, myId = null, roomCode = null, leaving = false, retry = 0, gallery = [], pingT = null;
let stateRecvAt = 0;

function send(t, data = {}) { if (ws?.readyState === 1) ws.send(JSON.stringify({ t, ...data })); }
// Turn-bound actions carry the phase token so the server can drop stale ones.
const act = (t, data = {}) => send(t, { ...data, seq: S?.seq });

function connect(code) {
  roomCode = code;
  leaving = false;
  $('#homeErr').textContent = '';
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  const sock = ws;
  sock.onopen = () => {
    retry = 0;
    send('join', { room: roomCode, name: profile.name.trim(), avatar: profile.avatar, color: profile.color, token: roomCode ? tokens[roomCode] : null });
    clearInterval(pingT);
    pingT = setInterval(() => send('ping'), 25000);
  };
  sock.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  sock.onclose = (e) => {
    if (sock !== ws) return;
    clearInterval(pingT);
    if (leaving || e.code === 4001 || e.code === 4000 || e.code === 4003) return;
    if (!myId) { goHome('Could not connect. Is the server up?'); return; }
    toast('Connection lost — reconnecting…');
    cancelLocal();
    setTimeout(() => { if (!leaving && sock === ws) connect(roomCode); }, Math.min(5000, 400 * 2 ** retry++));
  };
}

function goHome(err) {
  leaving = true;
  try { ws?.close(); } catch {}
  S = null; myId = null; strokes = []; gallery = [];
  cancelLocal();
  overlayKey = ''; toolbarKey = ''; lobbyMinimized = false;
  closeDialogs();
  $('#game').hidden = true;
  $('#home').hidden = false;
  $('#homeErr').textContent = err || '';
  document.title = 'Squiggle — draw badly, guess wildly';
}

$('#leaveBtn').onclick = () => {
  if (S && S.state !== 'lobby' && S.state !== 'end' && !confirm('Leave this game?')) return;
  send('leave');
  delete tokens[roomCode]; store.set('sq-tokens', tokens);
  history.replaceState(null, '', location.pathname);
  goHome();
};

const inviteLink = () => `${location.origin}${location.pathname}?r=${roomCode}`;
async function copyInvite() {
  try { await navigator.clipboard.writeText(inviteLink()); toast('Invite link copied — send it to your friends!'); }
  catch { prompt('Copy this invite link:', inviteLink()); }
}
$('#codeChip').onclick = copyInvite;

const sameTurn = (m) => m.seq == null || !S || m.seq === S.seq;

function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      roomCode = m.code; myId = m.id;
      tokens[m.code] = m.token; store.set('sq-tokens', tokens);
      history.replaceState(null, '', `?r=${m.code}`);
      overlayKey = ''; toolbarKey = ''; lobbyMinimized = false; gallery = [];
      $('#home').hidden = true; $('#game').hidden = false;
      $('#codeLbl').textContent = m.code;
      document.title = `Squiggle · ${m.code}`;
      break;
    case 'state': {
      const prev = S;
      S = m;
      stateRecvAt = performance.now();
      if (prev && (prev.state !== m.state || prev.seq !== m.seq || prev.drawerId !== m.drawerId || !!prev.paused !== !!m.paused)) cancelLocal();
      if (prev && (prev.state !== m.state || prev.seq !== m.seq)) markDirty();
      render(prev);
      break;
    }
    case 'canvas':
      if (!sameTurn(m)) break;
      strokes = m.strokes || [];
      cancelLocal();
      markDirty();
      break;
    case 'stroke': {
      if (!sameTurn(m)) break;
      const had = strokes.some((x) => x.id === m.s.id);
      const s = applyStroke(strokes, m.s);
      if (had) markDirty(); else drawLive(s, 0);
      break;
    }
    case 'pts': {
      if (!sameTurn(m)) break;
      const s = strokes.findLast((x) => x.id === m.id);
      if (!s) break;
      const from = s.pts.length / 2;
      s.pts.push(...m.pts);
      drawLive(s, from);
      break;
    }
    case 'undo':
      if (!sameTurn(m)) break;
      if (cur?.id === m.id) cancelLocal();
      strokes = strokes.filter((x) => x.id !== m.id);
      markDirty();
      break;
    case 'clear':
      if (!sameTurn(m)) break;
      cancelLocal();
      strokes = m.strokes || [];
      markDirty();
      break;
    case 'draw-reject':
      // The server follows every rejection with an authoritative canvas.
      toast(rejectText(m.reason));
      if (!m.id || cur?.id === m.id || shape?.id === m.id) cancelLocal();
      break;
    case 'chat': addMsg(m); break;
    case 'react': floatReaction(m); break;
    case 'sfx': play(m.s); if (m.s === 'correct') confetti(40); break;
    case 'toast': toast(m.text); break;
    case 'gallery': gallery = m.gallery; if (S?.state === 'end') renderEnd(true); break;
    case 'kicked': delete tokens[roomCode]; store.set('sq-tokens', tokens); history.replaceState(null, '', location.pathname); goHome('You were kicked from this room 🥾'); break;
    case 'error':
      if (roomCode) { delete tokens[roomCode]; store.set('sq-tokens', tokens); }
      history.replaceState(null, '', location.pathname);
      goHome(m.text);
      break;
  }
}

function rejectText(reason) {
  return ({
    tool: 'Not with this chaos!',
    budget: 'The canvas is full',
    onestroke: 'One stroke only!',
    paused: 'Game is paused',
  })[reason] || 'Oops — board resynced';
}

// --- canvas ------------------------------------------------------------------

const board = $('#board'), fx = $('#fx');
const ctx = board.getContext('2d', { willReadFrequently: true });
const fxc = fx.getContext('2d');
let strokes = [], dirty = true, lastFade = 0;

const gameMs = () => clientClock(S, stateRecvAt, performance.now()).gameMs;
const fading = () => S?.state === 'drawing' && is(S.chaos, 'fade');
const renderOpts = () => ({ chaos: S?.chaos, gameMs: gameMs(), fade: fading() });
const markDirty = () => { dirty = true; };

// Repaints the board when something changed; ghost ink repaints ~10×/s.
function present() {
  if (!dirty && !(fading() && performance.now() - lastFade > 100)) return;
  paintPaper(ctx, strokes, renderOpts());
  dirty = false;
  lastFade = performance.now();
}
function drawLive(s, from) {
  if (dirty || fading()) markDirty();
  else drawStroke(ctx, s, from, renderOpts());
}

let tool = 'pen', color = '#1d1b1a', size = 10, cur = null, shape = null, pending = [], flushT = null, hover = null;
const canDraw = () => !!S && !S.paused && (S.state === 'lobby' || (S.state === 'drawing' && S.drawerId === myId));
const nid = () => Math.random().toString(36).slice(2, 10);
const turnChaos = () => (S?.state === 'drawing' ? S.chaos : null);
const shaky = () => is(turnChaos(), 'shaky');
const effectiveTool = () => (is(turnChaos(), 'onestroke') ? 'pen' : tool);

function toXY(e) {
  const r = board.getBoundingClientRect();
  return [Math.round(((e.clientX - r.left) * W) / r.width), Math.round(((e.clientY - r.top) * H) / r.height)];
}
// Drops in-progress input. Points never sent are removed from the local copy
// so it matches what the server holds.
function cancelLocal() {
  clearTimeout(flushT); flushT = null;
  if (cur && pending.length) { cur.pts.length -= pending.length; markDirty(); }
  pending = [];
  cur = null;
  shape = null;
  drawFx();
}
function newStroke(t, rawPts) {
  const s = { id: `${myId}:${nid()}`, by: myId, tool: t, pts: rawPts, color, size, t: gameMs() };
  return S?.state === 'drawing' ? applyChaos(s, S.chaos) : s;
}
// What the server will store for these raw points (shaky jitter is applied by index).
const shown = (s, rawPts, from = 0) => (shaky() && s.tool !== 'fill' ? jitterPts(s.id, rawPts, from) : rawPts);
function flush() {
  clearTimeout(flushT); flushT = null;
  if (cur && pending.length) act('pts', { id: cur.id, pts: pending });
  pending = [];
}
function refuse() {
  const tw = turnChaos();
  if (is(tw, 'onestroke') && strokes.some((s) => s.by === myId)) return '➰ One stroke only — that was it!';
  if (!allowedTool(tw, effectiveTool())) return 'No fill with ghost ink 👻';
  return null;
}

board.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || !canDraw()) return;
  const [x, y] = toXY(e);
  const why = refuse();
  if (why) return toast(why);
  e.preventDefault();
  board.setPointerCapture(e.pointerId);
  const t = effectiveTool();
  if (t === 'fill') {
    const s = newStroke('fill', [x, y]);
    strokes.push(s); drawLive(s, 0); act('stroke', { s });
    return;
  }
  if (t === 'line' || t === 'rect' || t === 'ellipse') { shape = newStroke(t, [x, y, x, y]); return; }
  cur = newStroke(t, [x, y]);
  act('stroke', { s: { ...cur } });
  cur.pts = shown(cur, [x, y]);
  strokes.push(cur); drawLive(cur, 0);
});

board.addEventListener('pointermove', (e) => {
  const [hx, hy] = toXY(e);
  hover = canDraw() || (S?.state === 'drawing' && S.drawerId === myId) ? [hx, hy] : null;
  if ((cur || shape) && !canDraw()) cancelLocal();
  if (cur) {
    const from = cur.pts.length / 2;
    const raw = [];
    let [lx, ly] = cur.pts.slice(-2);
    for (const ev of e.getCoalescedEvents?.() || [e]) {
      const [px, py] = toXY(ev);
      if (Math.abs(px - lx) + Math.abs(py - ly) < 2) continue;
      raw.push(px, py);
      [lx, ly] = [px, py];
    }
    if (raw.length) {
      cur.pts.push(...shown(cur, raw, from));
      pending.push(...raw);
      drawLive(cur, from);
      if (!flushT) flushT = setTimeout(flush, 40);
    }
  } else if (shape) {
    [shape.pts[2], shape.pts[3]] = [hx, hy];
  }
  drawFx();
});

function endPointer() {
  if (!canDraw()) { cancelLocal(); return; }
  // Incremental painting approximates the curve's tail; repaint it exactly.
  if (cur) { flush(); cur = null; markDirty(); }
  if (shape) {
    const s = shape;
    shape = null;
    const [x1, y1, x2, y2] = s.pts;
    if (Math.abs(x2 - x1) + Math.abs(y2 - y1) > 3) {
      act('stroke', { s });
      s.pts = shown(s, s.pts);
      strokes.push(s); drawLive(s, 0);
    }
  }
  drawFx();
}
board.addEventListener('pointerup', endPointer);
board.addEventListener('pointercancel', () => { flush(); cancelLocal(); });
board.addEventListener('pointerleave', () => { hover = null; drawFx(); });

function drawFx() {
  fxc.clearRect(0, 0, W, H);
  if (!S || S.paused) return;
  // Preview what will land, including jitter.
  if (shape) drawStroke(fxc, { ...shape, pts: shown(shape, shape.pts) });
  if (hover && canDraw() && effectiveTool() !== 'fill') {
    fxc.save();
    fxc.lineWidth = 1.5;
    fxc.strokeStyle = 'rgba(29,27,26,.6)';
    fxc.beginPath(); fxc.arc(hover[0], hover[1], Math.max((is(turnChaos(), 'tiny') ? 3 : size) / 2, 2), 0, Math.PI * 2); fxc.stroke();
    fxc.restore();
  }
}

addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select') || document.querySelector('dialog[open]')) return;
  if (S?.state === 'choosing' && S.choices && /^[1-5]$/.test(e.key)) { act('choose', { i: +e.key - 1 }); return; }
  if (!canDraw()) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); act('undo'); return; }
  const map = { b: 'pen', p: 'pen', e: 'eraser', f: 'fill', g: 'fill', l: 'line', r: 'rect', o: 'ellipse' };
  if (map[e.key] && !e.ctrlKey && !e.metaKey) { tool = map[e.key]; renderToolbar(); }
  if (e.key === '[' || e.key === ']') {
    const i = SIZES.indexOf(size) + (e.key === ']' ? 1 : -1);
    size = SIZES[Math.max(0, Math.min(SIZES.length - 1, i))]; renderToolbar(); drawFx();
  }
});

// --- UI ----------------------------------------------------------------------

const playerById = (id) => S?.players.find((p) => p.id === id);
const avatarEl = (p, cls = '') => h('span', { class: `avatar ${cls}`, style: `background:${p?.color || '#ddd'}`, text: p?.avatar || '❔' });
const inGame = () => ['choosing', 'drawing', 'reveal'].includes(S?.state);

function render(prev) {
  const me = playerById(myId);
  const drawer = playerById(S.drawerId);
  const isDrawer = S.drawerId === myId;
  const changed = !prev || prev.state !== S.state || prev.drawerId !== S.drawerId;
  if (changed && S.state === 'choosing' && isDrawer) play('turn');
  if (changed && S.state === 'drawing' && !isDrawer && matchMedia('(min-width: 861px)').matches) $('#chatIn').focus();
  if (changed && S.state === 'end') confetti(120);
  if (prev?.state === 'end' && S.state !== 'end') gallery = [];

  const sorted = S.state === 'lobby' ? S.players : [...S.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let rank = 0, last = null;
  fill($('#playerList'), ...sorted.map((p, i) => {
    if (p.score !== last) { rank = i + 1; last = p.score; }
    const old = prev?.players.find((q) => q.id === p.id);
    const kickBtn = S.hostId === myId && p.id !== myId && h('button', {
      class: 'kick', title: `Kick ${p.name}`, 'aria-label': `Kick ${p.name}`, text: '✕',
      onclick: () => { if (confirm(`Kick ${p.name}?`)) send('kick', { id: p.id }); },
    });
    return h('li', { class: `pl${p.id === myId ? ' me' : ''}${p.guessed ? ' guessed' : ''}${p.id === S.drawerId && inGame() ? ' drawing' : ''}${p.connected ? '' : ' off'}` },
      h('span', { class: 'rank', text: S.state === 'lobby' ? '' : `#${rank}` }),
      avatarEl(p),
      h('span', { class: 'who' },
        h('span', { class: 'nm', text: p.name + (p.id === myId ? ' (you)' : '') }),
        h('span', { class: `sc${old && old.score !== p.score ? ' bump' : ''}`, text: `${p.score} pts` })),
      h('span', { class: 'badges' },
        p.id === S.hostId ? h('span', { title: 'Host', text: '👑' }) : null,
        p.id === S.drawerId && inGame() ? h('span', { title: 'Drawing', text: '✏️' }) : null,
        p.guessed ? h('span', { title: 'Guessed it', text: '✅' }) : null,
        p.streak > 1 ? h('span', { title: `${p.streak} streak`, text: `🔥${p.streak}` }) : null,
        !p.connected ? h('span', { title: 'Reconnecting…', text: '💤' }) : null,
        kickBtn));
  }));

  $('#roundLbl').textContent = inGame() ? `Round ${S.round} of ${S.settings.rounds}` : '';
  renderWord(isDrawer, drawer);
  $('#timer').hidden = !inGame();
  $('#timer').classList.toggle('paused', !!S.paused);

  $('#boardWrap').classList.toggle('can-draw', canDraw());
  const tw = turnChaos();
  $('#modChip').hidden = !tw;
  if (tw) $('#modChip').textContent = `${tw.icon} ${tw.name}`;
  if (tw) $('#modChip').title = tw.desc;
  $('#blind').hidden = !(is(tw, 'blind') && isDrawer);
  const pause = $('#pauseBanner');
  pause.hidden = !S.paused;
  if (S.paused) pause.textContent = `⏸️ ${S.paused.reason || 'Paused'}`;
  renderOverlay(isDrawer, drawer);
  renderToolbar();
  renderReactbar();

  const input = $('#chatIn');
  input.placeholder = S.state !== 'drawing' ? 'Say something…'
    : isDrawer ? 'No spoilers!'
    : S.word ? 'Chat with solvers…' : 'Type your guess…';

  if (S.state === 'end') renderEnd(changed);
  else closeDialogs();
}

function renderWord(isDrawer, drawer) {
  const area = $('#wordArea');
  if (S.state === 'lobby') return fill(area, h('span', { class: 'big', text: 'Lobby' }));
  if (S.state === 'end') return fill(area, h('span', { class: 'big', text: '🏁 Game over' }));
  if (S.state === 'choosing') return fill(area, h('span', { class: 'big', text: isDrawer ? 'Your turn ✏️' : `${drawer?.name || '…'} is choosing` }));
  if (S.state === 'reveal') return fill(area, h('span', { class: 'lbl', text: 'the word was' }), h('span', { class: 'big', text: S.reveal?.word || '' }));
  if (S.word) {
    return fill(area, h('span', { class: 'lbl', text: isDrawer ? 'draw this' : 'you got it' }), h('span', { class: `big${isDrawer ? '' : ' good'}`, text: S.word }));
  }
  const hint = S.hint || '';
  const slots = [...hint].map((ch) => {
    if (ch === ' ') return h('span', { class: 'slot gap' });
    if (ch === '_') return h('span', { class: 'slot' }, ' ');
    if (/[a-z0-9]/i.test(ch)) return h('span', { class: 'slot rev', text: ch });
    return h('span', { class: 'slot lit', text: ch });
  });
  const counts = hint.split(' ').map((w) => w.replace(/[^a-z0-9_]/gi, '').length).join(' ');
  fill(area, h('span', { class: 'slots', role: 'img', 'aria-label': `Hint: ${hint.replace(/_/g, ' blank ')}` }, slots), h('span', { class: 'counts', text: counts }));
}

let overlayKey = '', lobbyMinimized = false;
function renderOverlay(isDrawer, drawer) {
  const ov = $('#overlay');
  const pill = $('#settingsPill');
  let key = `${S.state}|${S.seq}`;
  if (S.state === 'choosing') key += `|${S.drawerId}|${isDrawer}|${S.rerolled}|${(S.choices || []).map((c) => c.word).join(',')}`;
  if (S.state === 'lobby') key += `|${lobbyMinimized}|${S.hostId === myId}`;
  const show = !(S.state === 'drawing' || S.state === 'end' || (S.state === 'lobby' && lobbyMinimized));
  ov.hidden = !show;
  $('#boardWrap').classList.toggle('expand', show);
  pill.hidden = !(S.state === 'lobby' && lobbyMinimized);
  if (!show) { overlayKey = key; return; }
  if (key !== overlayKey) {
    overlayKey = key;
    if (S.state === 'lobby') fill(ov, buildLobby());
    else if (S.state === 'choosing') fill(ov, buildChoosing(isDrawer, drawer));
    else if (S.state === 'reveal') fill(ov, buildReveal());
  }
  if (S.state === 'lobby') syncLobby();
}
$('#settingsPill').onclick = () => { lobbyMinimized = false; render(S); };

const chaosCard = (tw) => tw && h('div', { class: 'mod-card' }, h('b', { text: `${tw.icon} ${tw.name}` }), ` — ${tw.desc}`);

function buildChoosing(isDrawer, drawer) {
  if (isDrawer && S.choices) {
    return h('div', { class: 'ov-inner' },
      h('h2', { text: 'Pick a word' }),
      chaosCard(S.chaos),
      h('div', { class: 'choices' }, S.choices.map((c, i) => h('button', { class: 'choice', onclick: () => act('choose', { i }) },
        h('span', { class: `diff ${c.diff}`, text: c.diff }),
        h('span', { class: 'w', text: c.word })))),
      S.rerolled ? null : h('button', { class: 'btn ghost', text: '🔁 New words', onclick: () => act('reroll') }));
  }
  return h('div', { class: 'ov-inner' },
    avatarEl(drawer, 'big-av'),
    h('h2', { text: `${drawer?.name || 'Someone'} is picking…` }),
    chaosCard(S.chaos));
}

function buildReveal() {
  const r = S.reveal || {};
  const reason = { all: '🎉 Everybody got it!', time: '⏰ Time’s up!', left: '🏃 The artist left', skip: '⏭️ Skipped' }[r.reason] || '';
  const scored = (r.deltas || []).filter((d) => d.pts > 0).sort((a, b) => b.pts - a.pts);
  return h('div', { class: 'ov-inner' },
    h('p', { text: reason }),
    h('div', { class: 'reveal-word', text: r.word || '' }),
    scored.length ? h('ul', { class: 'deltas' }, scored.map((d) => {
      const p = playerById(d.id) || { name: d.name };
      return h('li', {}, avatarEl(p), h('span', { text: `${p.name || '?'}${d.drawer ? ' ✏️' : ''}` }), h('span', { class: 'p', text: `+${d.pts}` }));
    })) : h('p', { text: 'Nobody got it 😬' }));
}

const ROUNDS = [1, 2, 3, 4, 5, 6, 8, 10];
const TIMES = [40, 60, 80, 100, 120, 150];
let wordsT = null;
function readSettings() {
  const q = (n) => $('#overlay').querySelector(`[name=${n}]`);
  const out = { rounds: +q('rounds').value, drawTime: +q('drawTime').value, chaos: q('chaos').checked, customOnly: q('customOnly').checked };
  if (q('customWords')) out.customWords = q('customWords').value;
  return out;
}
const pushSettings = () => send('settings', { settings: readSettings() });

function buildLobby() {
  const host = S.hostId === myId;
  const select = (name, opts, fmt) => h('select', { name, onchange: pushSettings }, opts.map((v) => h('option', { value: String(v), text: fmt(v) })));
  return h('div', { class: 'card lobby' },
    h('div', { class: 'lobby-head' },
      h('button', { class: 'btn primary', text: `🔗 Invite friends · ${S.code}`, onclick: copyInvite }),
      h('button', { class: 'btn ghost', text: '✏️ Doodle', title: 'Hide settings and doodle while you wait', onclick: () => { lobbyMinimized = true; render(S); } })),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', { text: 'Rounds' }), select('rounds', ROUNDS, String)),
      h('label', { class: 'field' }, h('span', { text: 'Draw time' }), select('drawTime', TIMES, (v) => `${v}s`))),
    h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', name: 'chaos', onchange: pushSettings }),
      h('span', {}, h('b', { text: '🌀 Chaos' }), h('small', { text: 'Every turn gets one silly rule — mirror, blindfold, one line, ghost ink…' }))),
    h('details', { class: 'custom' },
      h('summary', { name: 'customSum' }),
      host ? h('textarea', { name: 'customWords', placeholder: 'inside jokes, friends’ names, comma separated…', maxLength: 6000,
        oninput: () => { clearTimeout(wordsT); wordsT = setTimeout(pushSettings, 500); } }) : null,
      h('label', { class: 'toggle' }, h('input', { type: 'checkbox', name: 'customOnly', onchange: pushSettings }), h('span', { text: 'Only use our words' }))),
    host ? h('button', { class: 'btn go big', name: 'start', onclick: () => send('start') })
      : h('p', { class: 'muted', text: 'Waiting for the host to start…' }));
}

// Refreshes values and enabled state in place so focus and drafts survive.
function syncLobby() {
  const s = S.settings;
  const host = S.hostId === myId;
  const active = document.activeElement;
  const q = (n) => $('#overlay').querySelector(`[name=${n}]`);
  for (const k of ['rounds', 'drawTime']) {
    const sel = q(k);
    if (![...sel.options].some((o) => o.value === String(s[k]))) sel.append(h('option', { value: String(s[k]), text: String(s[k]) }));
    if (sel !== active) sel.value = String(s[k]);
    sel.disabled = !host;
  }
  q('chaos').checked = !!s.chaos;
  q('customOnly').checked = !!s.customOnly;
  q('chaos').disabled = q('customOnly').disabled = !host;
  q('customSum').textContent = `✍️ Your own words${s.customWordCount ? ` (${s.customWordCount})` : ''}`;
  const ta = q('customWords');
  if (ta && ta !== active && Array.isArray(s.customWords)) ta.value = s.customWords.join(', ');
  const n = S.players.filter((p) => p.connected).length;
  const start = q('start');
  if (start) {
    start.disabled = n < 2;
    start.textContent = n < 2 ? 'Waiting for a friend to join…' : `Start game · ${n} players 🚀`;
  }
}

let toolbarKey = '';
function renderToolbar() {
  const bar = $('#toolbar');
  // In the lobby the doodle tools only show once the settings card is tucked away.
  const show = canDraw() && (S.state !== 'lobby' || lobbyMinimized);
  bar.hidden = !show;
  if (!show) { toolbarKey = ''; return; }
  const lobby = S.state === 'lobby';
  const tw = turnChaos();
  const active = effectiveTool();
  const tiny = is(tw, 'tiny');
  const one = is(tw, 'onestroke');
  const solved = S.players.some((p) => p.guessed);
  const host = S.hostId === myId;
  const key = JSON.stringify([active, size, color, S.seq, S.state, host, solved, tw?.id]);
  if (key === toolbarKey) return;
  toolbarKey = key;
  const tb = (name, label, on, onclick, disabled) => h('button', {
    class: `tbtn${on ? ' on' : ''}`, title: label, 'aria-label': label, 'aria-pressed': String(!!on), disabled: !!disabled, onclick,
  }, svg(name));
  const tools = [['pen', 'Pen (B)'], ['eraser', 'Eraser (E)'], ['fill', 'Fill (F)'], ['line', 'Line (L)'], ['rect', 'Rectangle (R)'], ['ellipse', 'Ellipse (O)']];
  const effSize = tiny ? SIZES[0] : size;
  fill(bar,
    h('div', { class: 'tgroup', role: 'group', 'aria-label': 'Tools' }, tools.map(([t, l]) => tb(t, l, active === t, () => { tool = t; renderToolbar(); }, !allowedTool(tw, t))),
      h('span', { class: 'tdiv' }),
      tb('undo', 'Undo (Ctrl+Z)', false, () => act('undo'), one),
      lobby ? (host ? tb('trash', 'Clear', false, () => act('clear')) : null)
        : tb('trash', 'Clear canvas', false, () => { if (confirm('Clear the whole canvas?')) act('clear'); }, one),
      !lobby && !solved ? tb('skip', 'Skip this word', false, () => { if (confirm('Skip your turn?')) act('skip'); }) : null),
    h('div', { class: 'tgroup', role: 'group', 'aria-label': 'Brush size' }, SIZES.map((sz) => h('button', {
      class: `tbtn sz${effSize === sz ? ' on' : ''}`, 'aria-label': `Brush size ${sz}`, 'aria-pressed': String(effSize === sz),
      disabled: tiny, onclick: () => { size = sz; renderToolbar(); },
    }, h('span', { class: 'size-dot', style: `width:${Math.max(4, sz * 0.5)}px;height:${Math.max(4, sz * 0.5)}px` })))),
    h('div', { class: 'tgroup pal', role: 'group', 'aria-label': 'Colors' },
      h('div', { class: 'palette' }, PALETTE.map((c) => h('button', {
        class: `sw${color === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': `Color ${c}`, 'aria-pressed': String(color === c),
        onclick: () => { color = c; if (tool === 'eraser') tool = 'pen'; renderToolbar(); },
      })))));
}

function renderReactbar() {
  const bar = $('#reactbar');
  const show = (S.state === 'drawing' && S.drawerId !== myId) || S.state === 'reveal';
  bar.hidden = !show;
  if (show && !bar.childElementCount) fill(bar, REACTIONS.map((e) => h('button', { class: 'rbtn', 'aria-label': `React ${e}`, text: e, onclick: () => send('react', { e }) })));
}

function floatReaction(m) {
  const p = playerById(m.from);
  const el = h('div', { class: 'floaty', style: `left:${8 + Math.random() * 80}%;--dx:${(Math.random() - 0.5) * 120}px` }, m.e, p ? h('small', { text: p.name }) : null);
  $('#reactLayer').append(el);
  play('pop');
  setTimeout(() => el.remove(), 2500);
}

function addMsg(m) {
  const box = $('#msgs');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const p = m.from ? playerById(m.from) : null;
  let el;
  if (m.kind === 'system') el = h('div', { class: `msg system ${m.tone || ''}`, text: m.text });
  else if (m.kind === 'correct') { el = h('div', { class: 'msg correct', text: `✅ ${m.text}` }); if (m.from !== myId) play('other'); }
  else if (m.kind === 'close') el = h('div', { class: 'msg close', text: `🤏 ${m.text}` });
  else el = h('div', { class: `msg ${m.kind}` }, h('b', { style: `color:${darken(p?.color)}`, text: `${p?.avatar || ''} ${p?.name || '???'}: ` }), m.text);
  box.append(el);
  while (box.children.length > 200) box.firstChild.remove();
  if (nearBottom || m.from === myId) box.scrollTop = box.scrollHeight;
}
function darken(hex = '#555555') {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * 0.55).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}
$('#chatForm').onsubmit = (e) => {
  e.preventDefault();
  const input = $('#chatIn');
  const text = input.value.trim();
  if (!text) return;
  act('chat', { text });
  input.value = '';
};

// --- end screen, gallery -----------------------------------------------------

function fullPng(g) {
  const cv = h('canvas', { width: W, height: H });
  paintPaper(cv.getContext('2d', { willReadFrequently: true }), g.strokes || []);
  return cv;
}

let thumbJob = 0;
// Thumbnails paint one per task so a big gallery never blocks the page.
function queueThumbs(items) {
  const job = ++thumbJob;
  const next = () => {
    if (job !== thumbJob || !items.length) return;
    const [cv, g] = items.shift();
    paintThumb(cv.getContext('2d'), cv.width, cv.height, g.strokes || []);
    setTimeout(next, 0);
  };
  next();
}

function openLightbox(g, opener) {
  const box = h('dialog', { class: 'lightbox', 'aria-label': `Drawing of ${g.word}` },
    fullPng(g),
    h('form', { method: 'dialog' }, h('button', { class: 'btn', text: 'Close' })));
  box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
  box.addEventListener('close', () => { box.remove(); opener?.focus(); });
  document.body.append(box);
  box.showModal();
}

function closeDialogs() {
  thumbJob++;
  for (const d of document.querySelectorAll('dialog.lightbox')) d.close();
  const modal = $('#endModal');
  if (modal.open) modal.close();
}

function renderEnd(fresh) {
  const modal = $('#endModal');
  const host = S.hostId === myId;
  if (!fresh && modal.open && modal.dataset.n === String(gallery.length)) {
    modal.querySelector('[name=again]').hidden = !host;
    modal.querySelector('[name=waitHost]').hidden = host;
    return;
  }
  modal.dataset.n = String(gallery.length);
  const { ranking = [], awards = [] } = S.end || {};
  const { podium, rest } = podiumGroups(ranking);
  const winners = podium[0]?.rank === 1 ? podium[0].players : [];
  const title = !winners.length ? '🏁 Game over'
    : winners.length > 1 ? '🤝 It’s a tie!'
    : winners[0].id === myId ? '🏆 You won!' : `🏆 ${winners[0].name} wins!`;
  const place = { 1: 'p1', 2: 'p2', 3: 'p3' };
  const thumbs = [];
  fill(modal, h('div', { class: 'card end-card' },
    h('h2', { id: 'endTitle', tabindex: '-1', text: title }),
    h('div', { class: 'podium' }, [podium[1], podium[0], podium[2]].filter(Boolean).map((g) => h('div', { class: `pod ${place[g.rank] || 'p3'}` },
      h('div', { class: 'pod-who' }, g.players.map((p) => h('div', { class: 'pod-p' }, avatarEl(p), h('span', { class: 'nm', text: p.name })))),
      h('span', { class: 'pts', text: `${g.players[0].score} pts${g.players.length > 1 ? ' · tied' : ''}` }),
      h('div', { class: 'blk', text: String(g.rank) })))),
    rest.length ? h('ol', { class: 'rest' }, rest.map((p) => h('li', {}, h('b', { text: `#${p.rank}` }), avatarEl(p), p.name, h('span', { class: 'p', text: String(p.score) })))) : null,
    awards.length ? h('div', { class: 'awards' }, awards.map((w) => h('div', { class: 'award' }, h('span', { class: 'i', text: w.icon }), h('span', {}, h('b', { text: `${w.title}: ${w.who}` }), h('small', { text: w.detail }))))) : null,
    gallery.length ? h('h3', { class: 'section-h', text: '🖼️ Tonight’s gallery' }) : null,
    h('div', { class: 'gallery' }, gallery.map((g) => {
      const cv = h('canvas', { class: 'thumb', width: 280, height: 210 });
      thumbs.push([cv, g]);
      const dl = () => fullPng(g).toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        h('a', { href: url, download: `squiggle-${g.word.replace(/[^a-z0-9]+/gi, '-')}.png` }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      const by = `${g.drawer?.avatar || ''} ${g.drawer?.name || '?'}${g.chaos ? ` · ${g.chaos.icon}` : ''}`;
      return h('figure', { class: 'gal' },
        h('button', { class: 'thumb-btn', 'aria-label': `Open drawing of ${g.word} by ${g.drawer?.name || 'someone'}`, onclick: (e) => openLightbox(g, e.currentTarget) }, cv),
        h('figcaption', { class: 'cap' },
          h('span', {}, h('span', { class: 'w', text: g.word }), h('br'), h('span', { class: 'by', text: by })),
          h('button', { class: 'dl', text: '⬇', title: 'Download PNG', 'aria-label': `Download ${g.word}`, onclick: dl })));
    })),
    h('div', { class: 'end-actions' },
      h('button', { class: 'btn go big', name: 'again', hidden: !host, text: '🔁 Back to lobby', onclick: () => send('again') }),
      h('button', { class: 'btn big', text: '🔗 Invite more friends', onclick: copyInvite }),
      h('p', { class: 'muted', name: 'waitHost', hidden: host, text: 'The host can take everyone back to the lobby for another game.' }))));
  if (!modal.open) modal.showModal();
  queueThumbs(thumbs);
  (modal.querySelector('[name=again]:not([hidden])') || modal.querySelector('#endTitle')).focus();
}
// The end screen has no "dismiss" — Esc must not strand players behind it.
$('#endModal').addEventListener('cancel', (e) => e.preventDefault());

// --- frame loop ----------------------------------------------------------------

let lastSec = -1;
function tick() {
  requestAnimationFrame(tick);
  if (!S) return;
  const now = performance.now();
  if (inGame()) {
    const { left } = clientClock(S, stateRecvAt, now);
    const sec = Math.ceil(left / 1000);
    $('#timer .prog').style.strokeDashoffset = String(119.4 * (1 - (S.phaseLen ? left / S.phaseLen : 0)));
    if (sec !== lastSec) {
      $('#timerTxt').textContent = String(sec);
      const urgent = S.state === 'drawing' && sec <= 10 && !S.paused;
      $('#timer').classList.toggle('urgent', urgent);
      if (urgent && sec > 0 && lastSec !== -1) play('tick');
      lastSec = sec;
    }
  }
  present();
}
requestAnimationFrame(tick);

if (inviteCode && tokens[inviteCode]) connect(inviteCode);
