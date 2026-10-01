// Scripted second player for manual browser checks: joins a room, picks the
// first word when it is the drawer, and draws a wave plus a box.
// Usage: PORT=3789 bun scripts/bot.js ROOMCODE
const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT || 3789}/ws`);
let S = null, me = null, drewSeq = -1;
ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room: process.argv[2], name: 'Bot', avatar: '🤖' }));
const send = (t, d = {}) => ws.send(JSON.stringify({ t, seq: S?.seq, ...d }));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'welcome') me = m.id;
  if (m.t !== 'state') return;
  S = m;
  if (S.drawerId !== me) return;
  if (S.state === 'choosing' && S.choices) { console.log('choices', S.choices.map((c) => c.word + '/' + c.diff).join(', ')); send('choose', { i: 0 }); }
  if (S.state === 'drawing' && drewSeq !== S.seq) {
    drewSeq = S.seq;
    console.log('drawing', S.word, 'chaos', S.chaos?.id);
    const pts = []; for (let k = 0; k <= 60; k++) pts.push(200 + k * 10, 375 + Math.round(120 * Math.sin(k / 6)));
    send('stroke', { s: { id: 'b' + S.seq, tool: 'pen', color: '#3d7bff', size: 22, pts: pts.slice(0, 2) } });
    send('pts', { id: 'b' + S.seq, pts: pts.slice(2) });
    send('stroke', { s: { id: 'r' + S.seq, tool: 'rect', color: '#e8322a', size: 10, pts: [300, 150, 600, 300] } });
  }
};
ws.onclose = () => process.exit(0);
