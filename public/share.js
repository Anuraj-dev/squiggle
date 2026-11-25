// The end-of-game "results image": leaderboard, awards and every drawing on one
// PNG, painted straight onto a canvas (no DOM capture, no dependencies).
// `shareMetrics` is pure so the layout can be tested without a canvas.
import { paintThumb } from './board.js';

const CARD_W = 1600;
const PAD = 64;
const GAP = 28;
const HEAD_H = 230;
const ROW_H = 84, ROW_GAP = 14;
const AWARD_H = 100, AWARD_GAP = 16, AWARD_COLS = 3;
const SECTION_GAP = 48;
const SECTION_HEAD_H = 76;
const CAP_H = 84;
const FOOT_H = 70;
// Mobile Safari refuses canvases above ~16.7M px; stay under it everywhere.
const MAX_PIXELS = 16e6, MAX_SIDE = 16000;

const INK = '#1d1b1a', INK2 = '#5d574f', PAPER = '#f6f0e4', CARD = '#fffdf8', SUN = '#ffc93c';
const FONT = '"Bricolage Grotesque", ui-rounded, "Trebuchet MS", sans-serif';
const HAND = '"Caveat", "Comic Sans MS", cursive';
const RANK_BG = { 1: SUN, 2: '#dfe7f5', 3: '#f3c9a8' };
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

export const galleryCols = (n) => (n <= 4 ? 2 : n <= 9 ? 3 : n <= 20 ? 4 : 5);

export function shareMetrics(playerCount, awardCount, drawingCount, mvpCount = 0) {
  const lbCols = playerCount > 5 ? 2 : 1;
  const lbW = lbCols === 2 ? CARD_W - PAD * 2 : 760;
  const rowW = lbCols === 2 ? (lbW - GAP) / 2 : lbW;
  const lbRows = Math.ceil(playerCount / lbCols);
  const lb = { cols: lbCols, rowW, x: (CARD_W - lbW) / 2, y: HEAD_H, h: lbRows * ROW_H + Math.max(0, lbRows - 1) * ROW_GAP };
  let y = lb.y + lb.h;

  const awardW = (CARD_W - PAD * 2 - AWARD_GAP * (AWARD_COLS - 1)) / AWARD_COLS;
  const awardRows = Math.ceil(awardCount / AWARD_COLS);
  const aw = { y: y + SECTION_GAP, w: awardW, h: awardRows ? awardRows * AWARD_H + (awardRows - 1) * AWARD_GAP : 0 };
  if (awardRows) y = aw.y + aw.h;

  // Gallery MVP: the most voted drawing(s), bigger than gallery tiles, centred.
  const mvpCols = Math.min(3, mvpCount);
  const mvpW = mvpCols ? Math.min(560, (CARD_W - PAD * 2 - GAP * (mvpCols - 1)) / mvpCols) : 0;
  const mvpTileH = Math.round((mvpW * 3) / 4);
  const mvpRows = Math.ceil(mvpCount / 3);
  const mvp = { cols: mvpCols, tileW: mvpW, tileH: mvpTileH, headY: y + SECTION_GAP, y: y + SECTION_GAP + SECTION_HEAD_H, rowH: mvpTileH + CAP_H };
  if (mvpRows) y = mvp.y + mvpRows * mvp.rowH + (mvpRows - 1) * GAP;

  const cols = galleryCols(drawingCount);
  const tileW = (CARD_W - PAD * 2 - GAP * (cols - 1)) / cols;
  const tileH = Math.round((tileW * 3) / 4);
  const rows = Math.ceil(drawingCount / cols);
  const gal = { cols, tileW, tileH, headY: y + SECTION_GAP, y: y + SECTION_GAP + SECTION_HEAD_H, rowH: tileH + CAP_H };
  const galH = rows ? rows * gal.rowH + (rows - 1) * GAP : 0;
  y = drawingCount ? gal.y + galH : y;

  const height = y + FOOT_H + PAD / 2;
  // Downscale (never upscale) when a long game would blow past canvas limits.
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (CARD_W * height)), MAX_SIDE / height);
  return { width: CARD_W, height, scale, lb, aw, mvp, gal };
}

function rrect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Boxed shape with the game's thick ink outline and hard shadow.
function box(c, x, y, w, h, r, fill, shadow = 5) {
  c.fillStyle = INK; rrect(c, x + shadow, y + shadow, w, h, r); c.fill();
  c.fillStyle = fill; rrect(c, x, y, w, h, r); c.fill();
  c.lineWidth = 4; c.strokeStyle = INK; c.stroke();
}

function fit(c, text, maxW) {
  if (c.measureText(text).width <= maxW) return text;
  let s = [...text];
  while (s.length > 1 && c.measureText(`${s.join('')}…`).width > maxW) s.pop();
  return `${s.join('')}…`;
}

function text(c, str, x, y, { font, color = INK, align = 'left', maxW } = {}) {
  c.font = font; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle';
  c.fillText(maxW ? fit(c, str, maxW) : str, x, y);
}

function avatar(c, p, cx, cy, r) {
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = p?.color || '#ddd'; c.fill();
  c.lineWidth = 4; c.strokeStyle = INK; c.stroke();
  text(c, p?.avatar || '❔', cx, cy + 2, { font: `${Math.round(r * 1.1)}px ${FONT}`, align: 'center' });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// A captioned drawing tile laid out by a grid (`g`: cols, tileW, tileH, rowH,
// y) at index i of n; a short last row is centred instead of leaving a hole.
function tile(c, d, g, i, n, fill = CARD) {
  const { cols, tileW, tileH, rowH } = g, row = Math.floor(i / cols);
  const inRow = Math.min(cols, n - row * cols);
  const x = (CARD_W - (inRow * tileW + (inRow - 1) * GAP)) / 2 + (i % cols) * (tileW + GAP);
  const y = g.y + row * (rowH + GAP);
  box(c, x, y, tileW, rowH, 16, fill, 4);
  c.save();
  // Round only the top corners: the bottom edge meets the caption square.
  c.beginPath(); c.moveTo(x, y + tileH); c.lineTo(x, y + 16); c.arcTo(x, y, x + 16, y, 16);
  c.lineTo(x + tileW - 16, y); c.arcTo(x + tileW, y, x + tileW, y + 16, 16); c.lineTo(x + tileW, y + tileH); c.closePath(); c.clip();
  c.translate(x, y);
  paintThumb(c, tileW, tileH, d.strokes || []);
  c.restore();
  c.fillStyle = INK; c.fillRect(x, y + tileH, tileW, 4);
  c.lineWidth = 4; c.strokeStyle = INK; rrect(c, x, y, tileW, rowH, 16); c.stroke();
  text(c, d.word, x + 18, y + tileH + 32, { font: `800 30px ${FONT}`, maxW: tileW - 36 });
  text(c, d.by, x + 18, y + tileH + 64, { font: `600 21px ${FONT}`, color: INK2, maxW: tileW - 36 });
}

// data: { title, ranking, awards, drawings: [{ word, by, strokes }], mvp?: same shape plus votes }
// makeCanvas is injectable for tests; defaults to a DOM canvas.
export async function renderShareCard({ title, ranking, awards, drawings, mvp = [] }, makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h })) {
  try { await Promise.all([document.fonts.load(`800 40px ${FONT}`), document.fonts.load(`700 40px ${HAND}`)]); } catch {}
  const m = shareMetrics(ranking.length, awards.length, drawings.length, mvp.length);
  const cv = makeCanvas(Math.round(m.width * m.scale), Math.round(m.height * m.scale));
  const c = cv.getContext('2d');
  c.scale(m.scale, m.scale);
  c.imageSmoothingQuality = 'high';

  c.fillStyle = PAPER; c.fillRect(0, 0, m.width, m.height);

  // header
  text(c, 'squiggle.', m.width / 2, 78, { font: `800 76px ${FONT}`, align: 'center' });
  text(c, 'draw badly · guess wildly · laugh loudly', m.width / 2, 140, { font: `700 38px ${HAND}`, color: INK2, align: 'center' });
  text(c, title, m.width / 2, 196, { font: `800 52px ${FONT}`, align: 'center', maxW: m.width - PAD * 2 });

  // leaderboard
  ranking.forEach((p, i) => {
    const col = i % m.lb.cols, row = Math.floor(i / m.lb.cols);
    const x = m.lb.x + col * (m.lb.rowW + GAP), y = m.lb.y + row * (ROW_H + ROW_GAP);
    box(c, x, y, m.lb.rowW, ROW_H, 18, RANK_BG[p.rank] || CARD, 4);
    text(c, MEDAL[p.rank] || `#${p.rank}`, x + 56, y + ROW_H / 2 + 2, { font: `800 ${MEDAL[p.rank] ? 38 : 32}px ${FONT}`, align: 'center' });
    avatar(c, p, x + 126, y + ROW_H / 2, 26);
    text(c, `${p.score}`, x + m.lb.rowW - 28, y + ROW_H / 2 + 2, { font: `800 36px ${FONT}`, align: 'right' });
    const scoreW = c.measureText(`${p.score}`).width;
    text(c, p.name, x + 170, y + ROW_H / 2 + 2, { font: `800 32px ${FONT}`, maxW: m.lb.rowW - 170 - 28 - scoreW - 20 });
  });

  // awards
  awards.forEach((a, i) => {
    const col = i % AWARD_COLS, row = Math.floor(i / AWARD_COLS);
    const x = PAD + col * (m.aw.w + AWARD_GAP), y = m.aw.y + row * (AWARD_H + AWARD_GAP);
    box(c, x, y, m.aw.w, AWARD_H, 16, ['#fff2c7', '#d9f7e8', '#e8dcff'][i % 3], 4);
    text(c, a.icon, x + 52, y + AWARD_H / 2 + 2, { font: `46px ${FONT}`, align: 'center' });
    text(c, `${a.title}: ${a.who}`, x + 100, y + 36, { font: `800 25px ${FONT}`, maxW: m.aw.w - 120 });
    text(c, a.detail || '', x + 100, y + 70, { font: `600 21px ${FONT}`, color: INK2, maxW: m.aw.w - 120 });
  });

  // gallery MVP
  if (mvp.length) {
    const votes = mvp[0].votes;
    const head = `🏆 Gallery MVP${mvp.length > 1 ? 's' : ''}${votes ? ` · ${votes} vote${votes > 1 ? 's' : ''}${mvp.length > 1 ? ' each' : ''}` : ''}`;
    text(c, head, PAD, m.mvp.headY + SECTION_HEAD_H / 2, { font: `800 38px ${FONT}` });
    for (let i = 0; i < mvp.length; i++) tile(c, mvp[i], m.mvp, i, mvp.length, '#fff2c7');
    await tick();
  }

  // gallery
  if (drawings.length) {
    text(c, '🖼️ Tonight’s gallery', PAD, m.gal.headY + SECTION_HEAD_H / 2, { font: `800 38px ${FONT}` });
    for (let i = 0; i < drawings.length; i++) {
      tile(c, drawings[i], m.gal, i, drawings.length);
      if (i % 4 === 3) await tick();
    }
  }

  text(c, 'made with squiggle', m.width / 2, m.height - PAD / 2 - FOOT_H / 2, { font: `700 30px ${HAND}`, color: INK2, align: 'center' });
  return cv;
}
