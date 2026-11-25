import { join, normalize } from 'node:path';
import { onMessage, onClose, flushWordHistory } from './game.js';

const PORT = Number(process.env.PORT) || 3789;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = join(import.meta.dir, 'public');
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
    message: onMessage,
    close: onClose,
  },
});

console.log(`squiggle running at http://${server.hostname}:${server.port}`);

// Save word history before exiting so a pending debounced write is not lost.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flushWordHistory(); process.exit(0); });
