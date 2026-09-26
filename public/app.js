// Squiggle client: one module, no build step.
const $ = (s, r = document) => r.querySelector(s);
const W = 1000, H = 750;

// Tiny DOM builder. Strings become text nodes, so player input is never parsed as HTML.
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

// replaceChildren neither flattens arrays nor skips null, so builders go through this.
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const AVATARS = ['🦊', '🐸', '🐙', '🦄', '🐼', '🐯', '🦖', '🐧', '🐝', '🦉', '🐳', '🍄', '👾', '🤖', '👻', '🐌', '🦀', '🐢', '🦥', '🌵', '🐨', '🐷', '🦩', '🍕', '🥑', '🐲', '🧙', '🤠'];
const AV_COLORS = ['#ffc93c', '#ff8a6b', '#7fe0b5', '#8fb3ff', '#c8a8ff', '#ff9fcf', '#7fdcea', '#c6e67a'];
const PALETTE = ['#1d1b1a', '#6b6560', '#b9b2a8', '#ffffff', '#e8322a', '#ff7a2f', '#ffc93c', '#fff27a', '#8bd346',
  '#1f9d55', '#2ec4d6', '#3d7bff', '#1f3a93', '#9b6bff', '#ff7fbf', '#8a4b2a', '#d9a066', '#ffd7b5'];
const SIZES = [3, 8, 16, 30, 54];
const REACTIONS = ['😂', '🔥', '😮', '🤯', '💀', '👏', '❤️', '🤔'];
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

// ---------- profile & home ----------
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

// ---------- sound ----------
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

// ---------- toast & confetti ----------
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

// ---------- networking ----------
let ws = null, S = null, myId = null, roomCode = null, leaving = false, retry = 0, gallery = [], pingT = null;
let localDeadline = 0;

function send(t, data = {}) { if (ws?.readyState === 1) ws.send(JSON.stringify({ t, ...data })); }

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
    if (leaving || e.code === 4001 || e.code === 4000) return;
    if (!myId) { goHome('Could not connect. Is the server up?'); return; }
    toast('Connection lost — reconnecting…');
    setTimeout(() => { if (!leaving && sock === ws) connect(roomCode); }, Math.min(5000, 400 * 2 ** retry++));
  };
}

function goHome(err) {
  leaving = true;
  try { ws?.close(); } catch {}
  S = null; myId = null;
  $('#game').hidden = true;
  $('#endModal').hidden = true;
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

function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      roomCode = m.code; myId = m.id;
      tokens[m.code] = m.token; store.set('sq-tokens', tokens);
      history.replaceState(null, '', `?r=${m.code}`);
      $('#home').hidden = true; $('#game').hidden = false;
      $('#codeLbl').textContent = m.code;
      document.title = `Squiggle · ${m.code}`;
      break;
    case 'state': { const prev = S; S = m; localDeadline = performance.now() + m.timeLeft; render(prev); break; }
    case 'canvas': strokes = m.strokes; redraw(); break;
    case 'stroke': strokes.push(m.s); drawStroke(ctx, m.s, 0); break;
    case 'pts': {
      const s = strokes.findLast((x) => x.id === m.id);
      if (!s) break;
      const from = s.pts.length / 2;
      for (const v of m.pts) s.pts.push(v);
      drawStroke(ctx, s, from);
      break;
    }
    case 'undo': strokes = strokes.filter((x) => x.id !== m.id); redraw(); break;
    case 'clear': strokes = []; redraw(); break;
    case 'chat': addMsg(m); break;
    case 'react': floatReaction(m); break;
    case 'sfx': play(m.s); if (m.s === 'correct') confetti(40); break;
    case 'toast': toast(m.text); break;
    case 'gallery': gallery = m.gallery; if (S?.state === 'end') renderEnd(true); break;
    case 'kicked': delete tokens[roomCode]; store.set('sq-tokens', tokens); history.replaceState(null, '', location.pathname); goHome('You were kicked from the room 🥾'); break;
    case 'error':
      if (roomCode) { delete tokens[roomCode]; store.set('sq-tokens', tokens); }
      history.replaceState(null, '', location.pathname);
      goHome(m.text);
      break;
  }
}

// ---------- canvas rendering ----------
const board = $('#board'), fx = $('#fx');
const ctx = board.getContext('2d', { willReadFrequently: true });
const fxc = fx.getContext('2d');
let strokes = [];

const hashId = (id) => { let x = 0; for (const c of String(id)) x = (x * 31 + c.charCodeAt(0)) | 0; return Math.abs(x); };
const RAINBOW_FILLS = ['#ff6b6b', '#ffb84d', '#ffe66d', '#7ee081', '#5ec8f2', '#8f7bff', '#ff8fd8'];

function clearCtx(c) { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.restore(); }
function redraw() { clearCtx(ctx); for (const s of strokes) drawStroke(ctx, s, 0); }

function drawStroke(c, s, from = 0) {
  paint(c, s, from, false);
  if (s.mirror) paint(c, s, from, true);
}

function paint(c, s, from, mirror) {
  const p = s.pts;
  if (s.tool === 'fill') {
    const color = s.rainbow ? RAINBOW_FILLS[hashId(s.id) % RAINBOW_FILLS.length] : s.color;
    return floodFill(c, mirror ? W - 1 - p[0] : p[0], p[1], color);
  }
  c.save();
  if (mirror) c.setTransform(-1, 0, 0, 1, W, 0);
  c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = s.size;
  const base = s.tool === 'eraser' ? '#ffffff' : s.color;
  if (s.tool === 'line' || s.tool === 'rect' || s.tool === 'ellipse') {
    const [x1, y1, x2, y2] = p;
    if (s.rainbow) {
      const g = c.createLinearGradient(x1, y1, x2, y2);
      ['#ff3b3b', '#ff9f1c', '#ffe600', '#2ecc71', '#3d7bff', '#9b59ff'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
      c.strokeStyle = g;
    } else c.strokeStyle = base;
    c.beginPath();
    if (s.tool === 'line') { c.moveTo(x1, y1); c.lineTo(x2, y2); }
    else if (s.tool === 'rect') c.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    else c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    c.stroke();
    return c.restore();
  }
  const n = p.length / 2;
  const hue0 = hashId(s.id) % 360;
  const colorAt = (k) => (s.rainbow ? `hsl(${(hue0 + k * 5) % 360} 90% 55%)` : base);
  if (n === 1) {
    c.fillStyle = colorAt(0);
    c.beginPath(); c.arc(p[0], p[1], s.size / 2, 0, Math.PI * 2); c.fill();
    return c.restore();
  }
  // Midpoint-quadratic smoothing: piece k runs mid(k-1,k) -> mid(k,k+1) with p[k] as control.
  const mx = (i) => (p[2 * i] + p[2 * i + 2]) / 2, my = (i) => (p[2 * i + 1] + p[2 * i + 3]) / 2;
  const piece = (k) => {
    if (k === 0) { c.lineTo(mx(0), my(0)); }
    else if (k < n - 1) c.quadraticCurveTo(p[2 * k], p[2 * k + 1], mx(k), my(k));
    else c.lineTo(p[2 * k], p[2 * k + 1]);
  };
  const startPt = (k) => (k === 0 ? [p[0], p[1]] : [mx(k - 1), my(k - 1)]);
  const start = Math.max(0, from - 2);
  if (s.rainbow) {
    for (let k = start; k < n; k++) {
      c.beginPath(); c.strokeStyle = colorAt(k);
      const [sx, sy] = startPt(k); c.moveTo(sx, sy); piece(k); c.stroke();
    }
  } else {
    c.strokeStyle = base;
    c.beginPath();
    const [sx, sy] = startPt(start); c.moveTo(sx, sy);
    for (let k = start; k < n; k++) piece(k);
    c.stroke();
  }
  c.restore();
}

function floodFill(c, x0, y0, hex) {
  x0 = Math.round(x0); y0 = Math.round(y0);
  if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return;
  const img = c.getImageData(0, 0, W, H), d = img.data;
  const fr = parseInt(hex.slice(1, 3), 16), fg = parseInt(hex.slice(3, 5), 16), fb = parseInt(hex.slice(5, 7), 16);
  const i0 = (y0 * W + x0) * 4, tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
  if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 6) return;
  const seen = new Uint8Array(W * H);
  const ok = (x, y) => {
    const q = y * W + x;
    if (seen[q]) return false;
    const i = q * 4;
    return Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= 110;
  };
  const set = (x, y) => { const q = y * W + x, i = q * 4; seen[q] = 1; d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255; };
  const stack = [x0, y0];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    let xi = x;
    while (xi >= 0 && ok(xi, y)) xi--;
    xi++;
    let up = false, down = false;
    while (xi < W && ok(xi, y)) {
      set(xi, y);
      if (y > 0) { if (ok(xi, y - 1)) { if (!up) { stack.push(xi, y - 1); up = true; } } else up = false; }
      if (y < H - 1) { if (ok(xi, y + 1)) { if (!down) { stack.push(xi, y + 1); down = true; } } else down = false; }
      xi++;
    }
  }
  c.putImageData(img, 0, 0);
}

// ---------- drawing input ----------
let tool = 'pen', color = '#1d1b1a', size = 8, cur = null, shape = null, pending = [], flushT = null, hover = null;
const canDraw = () => !!S && (S.state === 'lobby' || (S.state === 'drawing' && S.drawerId === myId));
const activeMod = () => (S?.state === 'drawing' ? S.modifier?.id : null);
const nid = () => Math.random().toString(36).slice(2, 10);

function toXY(e) {
  const r = board.getBoundingClientRect();
  return [Math.round(((e.clientX - r.left) * W) / r.width), Math.round(((e.clientY - r.top) * H) / r.height)];
}
function newStroke(t, pts) {
  const mod = activeMod();
  return {
    id: nid(), by: myId, tool: t, pts,
    color: mod === 'mono' && t !== 'eraser' ? '#1d1b1a' : color,
    size: mod === 'tiny' ? 3 : size,
    ...(mod === 'rainbow' && { rainbow: true }),
    ...(mod === 'mirror' && { mirror: true }),
  };
}
function blockedByOneStroke() {
  if (activeMod() === 'onestroke' && strokes.length >= 1) { toast('➰ One stroke only — that was it!'); return true; }
  return false;
}
function flush() {
  clearTimeout(flushT); flushT = null;
  if (cur && pending.length) send('pts', { id: cur.id, pts: pending });
  pending = [];
}

board.addEventListener('pointerdown', (e) => {
  if (!canDraw() || e.button > 0 || blockedByOneStroke()) return;
  e.preventDefault();
  board.setPointerCapture(e.pointerId);
  const [x, y] = toXY(e);
  if (tool === 'fill') {
    const s = newStroke('fill', [x, y]);
    strokes.push(s); drawStroke(ctx, s); send('stroke', { s });
    return;
  }
  if (tool === 'line' || tool === 'rect' || tool === 'ellipse') { shape = newStroke(tool, [x, y, x, y]); return; }
  cur = newStroke(tool, [x, y]);
  strokes.push(cur); drawStroke(ctx, cur); send('stroke', { s: cur });
});

board.addEventListener('pointermove', (e) => {
  const [hx, hy] = toXY(e);
  hover = canDraw() ? [hx, hy] : null;
  if (cur) {
    const evs = e.getCoalescedEvents?.() || [e];
    const from = cur.pts.length / 2;
    const shaky = activeMod() === 'shaky';
    for (const ev of evs) {
      let [x, y] = toXY(ev);
      if (shaky) { x += Math.round((Math.random() - 0.5) * 16); y += Math.round((Math.random() - 0.5) * 16); }
      const lx = cur.pts[cur.pts.length - 2], ly = cur.pts[cur.pts.length - 1];
      if (Math.abs(x - lx) + Math.abs(y - ly) < 2) continue;
      cur.pts.push(x, y); pending.push(x, y);
    }
    if (cur.pts.length / 2 > from) drawStroke(ctx, cur, from);
    if (!flushT) flushT = setTimeout(flush, 40);
  } else if (shape) {
    shape.pts[2] = hx; shape.pts[3] = hy;
  }
  drawFx();
});

function endPointer() {
  if (cur) { flush(); cur = null; }
  if (shape) {
    const [x1, y1, x2, y2] = shape.pts;
    if (Math.abs(x2 - x1) + Math.abs(y2 - y1) > 3) { strokes.push(shape); drawStroke(ctx, shape); send('stroke', { s: shape }); }
    shape = null;
  }
  drawFx();
}
board.addEventListener('pointerup', endPointer);
board.addEventListener('pointercancel', endPointer);
board.addEventListener('pointerleave', () => { hover = null; drawFx(); });

function drawFx() {
  fxc.clearRect(0, 0, W, H);
  if (shape) {
    drawStroke(fxc, shape);
  }
  if (hover && tool !== 'fill') {
    const r = (activeMod() === 'tiny' ? 3 : size) / 2;
    fxc.save();
    fxc.lineWidth = 1.5;
    fxc.strokeStyle = 'rgba(29,27,26,.6)';
    fxc.beginPath(); fxc.arc(hover[0], hover[1], Math.max(r, 2), 0, Math.PI * 2); fxc.stroke();
    fxc.restore();
  }
}

addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (S?.state === 'choosing' && S.choices && /^[1-5]$/.test(e.key)) { send('choose', { i: +e.key - 1 }); return; }
  if (!canDraw()) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); send('undo'); return; }
  const map = { b: 'pen', p: 'pen', e: 'eraser', f: 'fill', g: 'fill', l: 'line', r: 'rect', o: 'ellipse' };
  if (map[e.key]) { tool = map[e.key]; renderToolbar(); }
  if (e.key === '[' || e.key === ']') {
    const i = SIZES.indexOf(size) + (e.key === ']' ? 1 : -1);
    size = SIZES[Math.max(0, Math.min(SIZES.length - 1, i))]; renderToolbar(); drawFx();
  }
});

// ---------- UI rendering ----------
const playerById = (id) => S?.players.find((p) => p.id === id);
const avatarEl = (p, cls = '') => h('span', { class: `avatar ${cls}`, style: `background:${p?.color || '#ddd'}`, text: p?.avatar || '❔' });
const inGame = () => ['choosing', 'drawing', 'reveal'].includes(S?.state);

function render(prev) {
  const me = playerById(myId);
  const drawer = playerById(S.drawerId);
  const isDrawer = S.drawerId === myId;

  // sound + focus cues on transitions
  const changed = !prev || prev.state !== S.state || prev.drawerId !== S.drawerId;
  if (changed && S.state === 'choosing' && isDrawer) { play('turn'); toast('✏️ Your turn to draw!'); }
  if (changed && S.state === 'drawing' && !isDrawer && matchMedia('(min-width: 861px)').matches) $('#chatIn').focus();
  if (changed && S.state === 'end') { confetti(120); }
  if (prev?.state === 'end' && S.state !== 'end') gallery = [];

  // players
  const sorted = S.state === 'lobby' ? S.players : [...S.players].sort((a, b) => b.score - a.score);
  let rank = 0, last = null;
  fill($('#playerList'), ...sorted.map((p, i) => {
    if (p.score !== last) { rank = i + 1; last = p.score; }
    const old = prev?.players.find((q) => q.id === p.id);
    const kickBtn = p.id !== myId && h('button', {
      class: 'kick', title: S.hostId === myId ? `Kick ${p.name}` : `Vote to kick ${p.name}`, 'aria-label': `Kick ${p.name}`, text: '🥾',
      onclick: () => { if (confirm(S.hostId === myId ? `Kick ${p.name}?` : `Vote to kick ${p.name}?`)) send('kick', { id: p.id }); },
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
        !p.connected ? h('span', { title: 'Disconnected', text: '💤' }) : null,
        p.kickVotes ? h('span', { class: 'votes', title: 'Kick votes', text: `🗳️${p.kickVotes}` }) : null,
        kickBtn));
  }));

  // top bar
  $('#roundLbl').textContent = inGame() ? `Round ${S.round} of ${S.settings.rounds}` : S.state === 'lobby' ? 'Lobby' : 'Game over';
  renderWord(isDrawer, drawer, me);
  $('#timer').hidden = !(S.state === 'choosing' || S.state === 'drawing' || S.state === 'reveal');

  // stage
  const wrap = $('#boardWrap');
  wrap.classList.toggle('can-draw', canDraw());
  const mod = S.modifier;
  $('#modChip').hidden = !(mod && S.state === 'drawing');
  if (mod) $('#modChip').textContent = `${mod.icon} ${mod.name}`;
  $('#blind').hidden = !(mod?.id === 'blind' && isDrawer && S.state === 'drawing');
  renderOverlay(isDrawer, drawer);
  renderToolbar();
  renderReactbar(isDrawer);

  // chat
  const input = $('#chatIn');
  input.placeholder = S.state !== 'drawing' ? 'Say something…' : isDrawer ? 'Chat (no spoilers!)' : me?.guessed ? 'Chat with fellow solvers…' : 'Type your guess…';

  if (S.state === 'end') renderEnd(changed); else $('#endModal').hidden = true;
}

function renderWord(isDrawer, drawer, me) {
  const area = $('#wordArea');
  const diffTag = S.diff ? h('span', { class: `diff ${S.diff}`, text: S.diff }) : null;
  if (S.state === 'lobby') return fill(area, h('span', { class: 'big', text: 'Waiting for players' }));
  if (S.state === 'end') return fill(area, h('span', { class: 'big', text: '🏁 Game over' }));
  if (S.state === 'choosing') return fill(area, h('span', { class: 'big', text: isDrawer ? 'Pick a word!' : `${drawer?.name || '…'} is choosing` }));
  if (S.state === 'reveal') return fill(area, h('span', { class: 'lbl', text: 'the word was' }), h('span', { class: 'big', text: S.reveal?.word || '' }));
  if (S.word) {
    return fill(area, h('span', { class: 'lbl', text: isDrawer ? 'draw this' : 'you got it' }), h('span', { class: `big${isDrawer ? '' : ' good'}`, text: S.word }), diffTag);
  }
  const hint = S.hint || '';
  const slots = [...hint].map((ch) => {
    if (ch === ' ') return h('span', { class: 'slot gap' });
    if (ch === '_') return h('span', { class: 'slot' }, ' ');
    if (/[a-z0-9]/i.test(ch)) return h('span', { class: 'slot rev', text: ch });
    return h('span', { class: 'slot lit', text: ch });
  });
  const counts = hint.split(' ').map((w) => w.replace(/[^a-z0-9_]/gi, '').length).join(' ');
  fill(area, h('span', { class: 'lbl', text: 'guess' }), h('span', { class: 'slots', 'aria-label': `${hint.length} characters` }, slots), h('span', { class: 'counts', text: counts }), diffTag);
}

// Overlay DOM is rebuilt only when its identity changes, so inputs keep focus between syncs.
let overlayKey = '', lobbyMinimized = false;
function renderOverlay(isDrawer, drawer) {
  const ov = $('#overlay');
  const pill = $('#settingsPill');
  let key = S.state;
  if (S.state === 'choosing') key += `|${S.drawerId}|${isDrawer}|${S.round}`;
  if (S.state === 'reveal') key += `|${S.reveal?.word}|${S.drawerId}`;
  if (S.state === 'lobby') key += `|${lobbyMinimized}`;
  const show = !(S.state === 'drawing' || S.state === 'end' || (S.state === 'lobby' && lobbyMinimized));
  ov.hidden = !show;
  $('#boardWrap').classList.toggle('expand', show);
  pill.hidden = !(S.state === 'lobby' && lobbyMinimized);
  if (!show) { overlayKey = key; return; }
  if (key === overlayKey) { if (S.state === 'lobby') syncLobby(); return; }
  overlayKey = key;
  if (S.state === 'lobby') fill(ov, buildLobby()), syncLobby();
  else if (S.state === 'choosing') fill(ov, buildChoosing(isDrawer, drawer));
  else if (S.state === 'reveal') fill(ov, buildReveal(drawer));
}
$('#settingsPill').onclick = () => { lobbyMinimized = false; render(S); };

const modCard = (m) => m && h('div', { class: 'mod-card' }, h('b', { text: `${m.icon} Chaos: ${m.name}` }), m.desc);

function buildChoosing(isDrawer, drawer) {
  if (isDrawer && S.choices) {
    return h('div', { class: 'ov-inner' },
      h('h2', { text: 'Your turn! Pick a word' }),
      modCard(S.modifier),
      h('div', { class: 'choices' }, S.choices.map((c, i) => h('button', { class: 'choice', onclick: () => send('choose', { i }) },
        h('span', { class: `diff ${c.diff}`, text: c.diff }),
        h('span', { class: 'w', text: c.word }),
        h('span', { class: 'm', text: { easy: '×1 points', medium: '×1.3 points', hard: '×1.7 points' }[c.diff] }),
        h('kbd', { text: `press ${i + 1}` })))),
      h('p', { class: 'muted', text: 'Harder words score more for everyone. A random one is picked when the timer runs out.' }));
  }
  return h('div', { class: 'ov-inner' },
    avatarEl(drawer, 'big-av'),
    h('h2', { text: `${drawer?.name || 'Someone'} is picking a word…` }),
    modCard(S.modifier),
    h('p', { text: 'Get your guessing fingers ready.' }));
}

function buildReveal(drawer) {
  const r = S.reveal || {};
  const reason = { all: '🎉 Everybody got it!', time: '⏰ Time’s up!', left: '🏃 The artist left', skip: '⏭️ Skipped' }[r.reason] || '';
  const guessers = (r.deltas || []).filter((d) => !d.drawer);
  return h('div', { class: 'ov-inner' },
    h('p', { text: reason }),
    h('p', { text: 'The word was' }),
    h('div', { class: 'reveal-word', text: r.word || '' }),
    guessers.length ? null : h('p', { text: 'Nobody got it 😬' }),
    h('ul', { class: 'deltas' }, (r.deltas || []).filter((d) => d.pts > 0 || d.drawer).sort((a, b) => b.pts - a.pts).map((d) => {
      const p = playerById(d.id);
      return h('li', {}, avatarEl(p), h('span', { text: `${p?.name || '?'}${d.drawer ? ' ✏️' : ''}` }),
        d.ms != null ? h('span', { class: 't', text: `${(d.ms / 1000).toFixed(1)}s` }) : null,
        h('span', { class: 'p', text: `+${d.pts}` }));
    })),
    r.up || r.down ? h('p', { text: `Drawing rated ${r.up} 👍 · ${r.down} 👎` }) : null);
}

const FIELDS = [
  ['rounds', 'Rounds', [1, 2, 3, 4, 5, 6, 8, 10]],
  ['drawTime', 'Draw time', [30, 45, 60, 80, 100, 120, 150, 180, 240], (v) => `${v}s`],
  ['wordChoices', 'Word choices', [1, 2, 3, 4, 5]],
  ['hints', 'Hints', [0, 1, 2, 3, 4, 5]],
  ['maxPlayers', 'Max players', [2, 3, 4, 5, 6, 8, 10, 12, 16, 20]],
];
let wordsT = null;
function readSettings() {
  const ov = $('#overlay');
  const out = {};
  for (const [k] of FIELDS) out[k] = +ov.querySelector(`[name=${k}]`).value;
  out.chaos = ov.querySelector('[name=chaos]').checked;
  out.customOnly = ov.querySelector('[name=customOnly]').checked;
  out.customWords = ov.querySelector('[name=customWords]').value;
  return out;
}
const pushSettings = () => send('settings', { settings: readSettings() });

function buildLobby() {
  const host = S.hostId === myId;
  return h('div', { class: 'card lobby' },
    h('div', { class: 'lobby-head' },
      h('div', {}, h('h2', { text: 'Room settings' }), h('p', { text: host ? 'You’re the host — tweak away.' : 'Only the host can change these.' })),
      h('button', { class: 'btn', text: '✏️ Doodle', title: 'Hide settings and doodle together while you wait', onclick: () => { lobbyMinimized = true; render(S); } })),
    h('div', { class: 'invite' },
      h('span', { class: 'code', text: S.code }),
      h('span', { class: 'grow', text: 'Share the link — friends join straight into this room.' }),
      h('button', { class: 'btn primary', text: '🔗 Copy invite', onclick: copyInvite })),
    h('div', { class: 'grid5' }, FIELDS.map(([k, label, opts, fmt]) => h('label', {}, label,
      h('select', { name: k, disabled: !host, onchange: pushSettings }, opts.map((v) => h('option', { value: String(v), text: fmt ? fmt(v) : String(v) })))))),
    h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', name: 'chaos', disabled: !host, onchange: pushSettings }),
      h('span', {}, h('b', { text: '🌀 Chaos mode' }), h('small', { text: 'Every turn gets a random twist: mirror, rainbow brush, one-stroke, blindfold, speedrun…' }))),
    h('label', { class: 'field' }, h('span', { text: 'Custom words (comma separated)' }),
      h('textarea', { name: 'customWords', disabled: !host, placeholder: 'inside jokes, your friends’ names, that one meme…', maxLength: 6000,
        oninput: () => { clearTimeout(wordsT); wordsT = setTimeout(pushSettings, 500); } })),
    h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', name: 'customOnly', disabled: !host, onchange: pushSettings }),
      h('span', {}, h('b', { text: 'Only use custom words' }), h('small', { text: 'Otherwise they’re mixed in with the built-in list.' }))),
    h('div', { class: 'foot' },
      host
        ? h('button', { class: 'btn go big', name: 'start', onclick: () => send('start') })
        : h('p', { class: 'muted', name: 'wait', text: 'Waiting for the host to start the game…' })));
}

function syncLobby() {
  const ov = $('#overlay');
  const s = S.settings;
  const active = document.activeElement;
  const setVal = (el, v) => { if (el && el !== active) el.value = String(v); };
  for (const [k, , opts] of FIELDS) {
    const sel = ov.querySelector(`[name=${k}]`);
    if (sel && !opts.includes(s[k])) sel.append(h('option', { value: String(s[k]), text: String(s[k]) }));
    setVal(sel, s[k]);
  }
  const chaos = ov.querySelector('[name=chaos]'); if (chaos) chaos.checked = s.chaos;
  const only = ov.querySelector('[name=customOnly]'); if (only) only.checked = s.customOnly;
  const ta = ov.querySelector('[name=customWords]');
  if (ta && ta !== active) ta.value = s.customWords.join(', ');
  const start = ov.querySelector('[name=start]');
  if (start) {
    const n = S.players.filter((p) => p.connected).length;
    start.disabled = n < 2;
    start.textContent = n < 2 ? 'Need at least 2 players' : `Start game · ${n} players 🚀`;
  }
}

// Rebuilt only when something it shows changes, so an open native color picker survives chat syncs.
let toolbarKey = '';
function renderToolbar() {
  const bar = $('#toolbar');
  const show = canDraw();
  bar.hidden = !show;
  if (!show) return;
  const mod = activeMod();
  const lobby = S.state === 'lobby';
  const key = JSON.stringify([tool, size, color, mod, S.state, S.hostId === myId, S.players.some((p) => p.guessed)]);
  if (key === toolbarKey) return;
  toolbarKey = key;
  const tb = (name, label, active, onclick, disabled) => h('button', { class: `tbtn${active ? ' on' : ''}`, title: label, 'aria-label': label, 'aria-pressed': String(!!active), disabled, onclick }, svg(name));
  const tools = [['pen', 'Pen (B)'], ['eraser', 'Eraser (E)'], ['fill', 'Fill (F)'], ['line', 'Line (L)'], ['rect', 'Rectangle (R)'], ['ellipse', 'Ellipse (O)']];
  const effSize = mod === 'tiny' ? 3 : size;
  fill(bar,
    h('div', { class: 'tgroup' }, tools.map(([t, l]) => tb(t, l, tool === t, () => { tool = t; renderToolbar(); })),
      h('span', { class: 'tdiv' }),
      tb('undo', 'Undo (Ctrl+Z)', false, () => send('undo'), mod === 'onestroke'),
      (lobby ? S.hostId === myId : mod !== 'onestroke') ? tb('trash', lobby ? 'Clear the doodle wall' : 'Clear canvas', false, () => { if (lobby || confirm('Clear the whole canvas?')) send('clear'); }) : null,
      !lobby && !S.players.some((p) => p.guessed) ? tb('skip', 'Skip this word', false, () => { if (confirm('Skip your turn?')) send('skip'); }) : null),
    h('div', { class: `tgroup${mod === 'tiny' ? ' disabled' : ''}` }, SIZES.map((sz) => h('button', {
      class: `tbtn sz${effSize === sz ? ' on' : ''}`, title: `Size ${sz}`, 'aria-label': `Brush size ${sz}`,
      onclick: () => { size = sz; renderToolbar(); },
    }, h('span', { class: 'size-dot', style: `width:${Math.max(4, sz * 0.5)}px;height:${Math.max(4, sz * 0.5)}px` })))),
    h('div', { class: `tgroup pal${mod === 'mono' || mod === 'rainbow' ? ' disabled' : ''}` },
      h('div', { class: 'palette' }, PALETTE.map((c) => h('button', {
        class: `sw${color === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': `Color ${c}`,
        onclick: () => { color = c; if (tool === 'eraser') tool = 'pen'; renderToolbar(); },
      }))),
      h('input', { type: 'color', class: 'custom-color', value: color, title: 'Custom color', 'aria-label': 'Custom color', oninput: (e) => { color = e.target.value; }, onchange: () => renderToolbar() })));
}

function renderReactbar(isDrawer) {
  const bar = $('#reactbar');
  const show = S.state === 'drawing' || S.state === 'reveal';
  bar.hidden = !show;
  if (!show) return;
  const r = S.rating;
  const canRate = S.state === 'drawing' && !isDrawer;
  fill(bar, 
    canRate ? h('button', { class: `rbtn${r.mine > 0 ? ' on' : ''}`, title: 'Love this drawing', onclick: () => send('rate', { v: r.mine > 0 ? 0 : 1 }) }, '👍', h('small', { text: String(r.up) })) : null,
    canRate ? h('button', { class: `rbtn${r.mine < 0 ? ' on' : ''}`, title: 'Not a fan', onclick: () => send('rate', { v: r.mine < 0 ? 0 : -1 }) }, '👎', h('small', { text: String(r.down) })) : null,
    canRate ? h('span', { class: 'sep' }) : null,
    REACTIONS.map((e) => h('button', { class: 'rbtn', 'aria-label': `React ${e}`, text: e, onclick: () => send('react', { e }) })));
}

function floatReaction(m) {
  const p = playerById(m.from);
  const el = h('div', { class: 'floaty', style: `left:${8 + Math.random() * 80}%;--dx:${(Math.random() - 0.5) * 120}px` }, m.e, p ? h('small', { text: p.name }) : null);
  $('#reactLayer').append(el);
  play('pop');
  setTimeout(() => el.remove(), 2500);
}

// ---------- chat ----------
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
  send('chat', { text });
  input.value = '';
};

// ---------- end screen ----------
function renderEnd(fresh) {
  const modal = $('#endModal');
  if (!fresh && !modal.hidden && modal.dataset.n === String(gallery.length)) {
    const again = modal.querySelector('[name=again]');
    if (again) again.hidden = S.hostId !== myId;
    return;
  }
  modal.dataset.n = String(gallery.length);
  const { ranking = [], awards = [] } = S.end || {};
  const [a, b, c] = ranking;
  const pod = (p, cls, n) => p && h('div', { class: `pod ${cls}` }, avatarEl(p), h('span', { class: 'nm', text: p.name }), h('span', { class: 'pts', text: `${p.score} pts` }), h('div', { class: 'blk', text: n }));
  const host = S.hostId === myId;
  fill(modal, h('div', { class: 'card end-card' },
    h('h2', { text: a && a.id === myId ? '🏆 You won!' : `🏆 ${a?.name || 'Nobody'} wins!` }),
    h('div', { class: 'podium' }, pod(b, 'p2', '2'), pod(a, 'p1', '1'), pod(c, 'p3', '3')),
    ranking.length > 3 ? h('ol', { class: 'rest', start: 4 }, ranking.slice(3).map((p, i) => h('li', {}, h('b', { text: `#${i + 4}` }), avatarEl(p), p.name, h('span', { class: 'p', text: String(p.score) })))) : null,
    awards.length ? h('div', { class: 'awards' }, awards.map((w) => h('div', { class: 'award' }, h('span', { class: 'i', text: w.icon }), h('span', {}, h('b', { text: `${w.title}: ${w.who}` }), h('small', { text: w.detail }))))) : null,
    gallery.length ? h('h3', { class: 'section-h', text: '🖼️ Tonight’s gallery' }) : null,
    h('div', { class: 'gallery' }, gallery.map((g) => {
      const cv = h('canvas', { width: W, height: H });
      const gc = cv.getContext('2d', { willReadFrequently: true });
      clearCtx(gc);
      for (const s of g.strokes) drawStroke(gc, s, 0);
      const dl = () => cv.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        h('a', { href: url, download: `squiggle-${g.word.replace(/[^a-z0-9]+/gi, '-')}.png` }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      return h('figure', { class: 'gal', style: 'margin:0' }, cv, h('figcaption', { class: 'cap' },
        h('span', {}, h('span', { class: 'w', text: g.word }), h('br'), h('span', { class: 'by', text: `${g.drawer?.avatar || ''} ${g.drawer?.name || '?'}${g.modifier ? ` · ${g.modifier.icon}` : ''}${g.up ? ` · ${g.up}👍` : ''}` })),
        h('button', { class: 'dl', text: '⬇', title: 'Download PNG', 'aria-label': `Download ${g.word}`, onclick: dl })));
    })),
    h('div', { class: 'end-actions' },
      h('button', { class: 'btn go big', name: 'again', hidden: !host, text: '🔁 Back to lobby', onclick: () => send('again') }),
      h('button', { class: 'btn big', text: '🔗 Invite more friends', onclick: copyInvite }),
      host ? null : h('p', { class: 'muted', text: 'The host can take everyone back to the lobby for another game.' }))));
  modal.hidden = false;
}

// ---------- timer loop ----------
let lastSec = -1;
function tick() {
  requestAnimationFrame(tick);
  if (!S || $('#timer').hidden) return;
  const left = Math.max(0, localDeadline - performance.now());
  const frac = S.phaseLen ? left / S.phaseLen : 0;
  const sec = Math.ceil(left / 1000);
  $('#timer .prog').style.strokeDashoffset = String(119.4 * (1 - frac));
  if (sec !== lastSec) {
    $('#timerTxt').textContent = String(sec);
    const urgent = S.state === 'drawing' && sec <= 10;
    $('#timer').classList.toggle('urgent', urgent);
    if (urgent && sec > 0 && lastSec !== -1) play('tick');
    lastSec = sec;
  }
}
requestAnimationFrame(tick);

// Auto-rejoin if this tab already belongs to the invited room (e.g. after a refresh).
if (inviteCode && tokens[inviteCode]) connect(inviteCode);
