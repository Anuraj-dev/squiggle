<h1 align="center">Squiggle</h1>

<p align="center">
  A multiplayer drawing and guessing game for friends, played in the browser.<br />
  Take turns drawing words while everyone else races to guess them.
</p>

<p align="center">
  <a href="#running-it">Run it locally</a>
  ·
  <a href="#documentation">Documentation</a>
</p>

Squiggle is a skribbl-style game for a room of friends. Each turn, one player picks a word from a few choices and draws it while everyone else types guesses into the chat. The earlier you guess, the more you score, and the drawer earns for each guesser who solves the word. The host decides how much chaos a match gets, from challenges that change how the artist can draw to ones that change what guessers see.

Squiggle runs as one Bun server with no build step, no database and no accounts. Each player needs a browser. The server keeps room state in memory, so active rooms end when it stops.

## What you get

- **Over 3,000 drawable words.** The Legacy bank has 642 easy, 1,018 medium and 589 hard words. The New bank adds 289, 309 and 326 technical and everyday words. Add your own comma-separated words, or turn on "Only use our words" to play with yours alone.
- **38 challenges, drawn at random.** Artist challenges limit the drawing. Five Strokes caps the strokes, Ink Budget meters the ink and Forbidden Zone blocks a marked area. Guesser challenges change what guessers see, such as Foggy Glasses, Puzzle Board and Moving Spotlight, or cap their tries with Limited Guesses.
- **Pick your chaos.** Choose Classic, Artist Chaos, Guesser Chaos or Mixed Chaos. The chaos rate sets how often a challenge runs. It goes from 1x, a quarter of turns, up to 4x, every turn. It defaults to 2x, and a challenge never repeats on the turn right after it ran.
- **A host who runs the match.** The host sets the number of rounds, from 1 to 10 with a default of 3. Draw time runs from 20 to 240 seconds, with a default of 80. Word choices go from 1 to 5, hints from 0 to 5, and difficulty can be mixed or fixed. The server clamps each value to its range, and the host can pause a running game.
- **Scoring that rewards speed.** A correct guess scores 100 points plus up to 200 for speed, and each streak step adds 10 points, up to 30. The first 15% of a turn counts as full speed, and time is counted in whole seconds, so a near tie never changes the score. Base points scale with difficulty, at 1x for easy, 1.5x for medium and 2.2x for hard. Each active challenge adds 25%, and so does Speedrun.
- **Seats held through dropped connections.** A player who loses the connection keeps their place for 20 seconds in the lobby and 2 minutes during a game. After that the player is removed. A room closes when its last player leaves.
- **One results image.** At the end of a game, Save results image puts the leaderboard, awards and every drawing into a single PNG. Each drawing can also download on its own.
- **Strokes checked on the server.** Before a stroke reaches other players, the server checks its tool, its point count and its stamp shape. It clamps the size to 1 to 80 and falls back to the default ink when the colour is not a six-digit hex value.

## Running it

Squiggle needs [Bun](https://bun.sh/). There are no dependencies to install.

### Start the server

```sh
bun run start
```

Open http://127.0.0.1:3789 in one browser window per player. Create a room, then copy the invite link from the lobby.

The server reads two optional environment variables:

| Variable | Default | What it sets |
| --- | --- | --- |
| `PORT` | `3789` | Port for the page and the `/ws` WebSocket. |
| `HOST` | `127.0.0.1` | Interface to listen on. `0.0.0.0` accepts connections from other devices on your network. |

Invite links use the address the host opened the game from. To invite friends on your network, open the game at your machine's network address instead of `127.0.0.1`.

### Try it with a bot

`scripts/bot.js` joins a room as a second player. When it is the drawer, it picks the first word and draws a wave and a box. Use it for quick browser checks:

```sh
PORT=3789 bun scripts/bot.js ROOMCODE
```

Replace `ROOMCODE` with the five-character code shown in the lobby.

### Run the tests

```sh
bun test
```

The suite covers the shared rules, the canvas renderer, the word bank, the room state machine and the multiplayer game flow over WebSockets. `game.test.js` starts a real server on a random port from 3900 to 3989. The other files run in the same process.

## How it works

`server.js` serves `public/` and upgrades `/ws` to a WebSocket. `game.js` holds the `Room` state machine and handles each message. `public/shared.js` holds the rules that the server and the browser both import, such as scoring, challenges and stroke checks. Time goes through an exported clock, so the room tests can drive a game with a manual clock and fake sockets.

The client is plain ES modules with no build step. The six background tracks are synthesized with WebAudio, so the repo ships no audio files. The game loads its fonts from Google Fonts and otherwise talks only to the server it runs on.

## Documentation

- [AGENTS.md](AGENTS.md) covers the commands, file layout and protocol rules for changing the code.
- [docs/CHECKPOINT.md](docs/CHECKPOINT.md) holds the dated status, decisions and open items.

## License

MIT. See [LICENSE](LICENSE).
