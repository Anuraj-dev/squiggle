# Squiggle — agent guide

Multiplayer draw-and-guess game (skribbl-style). Bun server, plain ES-module client with no build step.

## Commands

- `bun server.js` — serves `public/` and the `/ws` WebSocket. `PORT` (default 3789) and `HOST` (default 127.0.0.1).
- `bun test` — the full suite, 57 tests. `game.test.js` starts a real server; the other test files are in-process.
- `PORT=<port> bun scripts/bot.js <ROOM>` — a scripted second player for browser checks. When it is the drawer, it picks the first word and draws.

## Layout

| File | Role |
|---|---|
| `server.js` | HTTP static files + WebSocket upgrade only. |
| `game.js` | `Room` state machine and message handlers. Time goes through the exported `clock`, so `room.test.js` can drive it with a manual clock and fake sockets. |
| `public/shared.js` | Rules imported by **both** server and client: constants, chaos modes, scoring, stroke validation, tool rules, `clientClock`. |
| `public/board.js` | Canvas rendering: strokes, flood fill, chaos `views()` (mirror/kaleido/flip/squish/double), `paintPaper` memory/lag filters. |
| `public/app.js` | The whole client UI: home, lobby, toolbar, chat, overlays, music wiring. |
| `public/music.js` | Procedural WebAudio piano music (6 tracks). No audio files. |
| `words.js` | Word bank (~1050 per difficulty), `ALIASES`, answer matching. |

## Protocol invariants

- Every phase change bumps `turnSeq`. State snapshots carry it as `seq`. Turn-bound client actions (`act()` in app.js) echo `seq`, and the server drops stale ones.
- The server sends a turn's `clear` **before** the matching `state`. The client board follows its own `boardSeq` (`resetBoard` in app.js). Do not gate board resets on `S.seq`. That was the "next drawer sees the old drawing" bug.
- Chaos stroke effects are applied server-side (`applyChaos`) and painted client-side from stroke flags. View-only modes (`view: true`: fog, quake, spin, negative, pixel, laggy) change only what guessers see. The artist always sees the real board.
- Scoring (`guesserPts`) counts whole seconds after a 15% grace window. There is no first-guesser bonus, so a 1 ms tie must never change points.

## Verification traps

- In Chrome, screenshots time out while the tab is hidden. Check state through page JS (`document.querySelector(...)`) or keep the tab focused.
- `bun build public/app.js --outdir <tmp>` is a quick syntax and import check for the client.
- Only the UI and state of the music player are verified. Nobody has listened to the audio output yet.

## Project status

The dated status, decisions and open items are in `docs/CHECKPOINT.md`.
