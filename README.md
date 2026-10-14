# Squiggle

A multiplayer drawing and guessing game for friends. Create a room, share the invite link, and take turns drawing words while everyone else guesses in real time.

- Over 3,000 drawable words in three difficulties
- 39 optional challenges for artists and guessers, including stamps, puzzle tiles and replenishing guess attempts
- Classic, Artist Chaos, Guesser Chaos and Mixed Chaos presets
- One artist challenge swap per player per match, with a challenge recap after each turn
- The host picks rounds, draw time, word choices, hints, difficulty and how often chaos happens (every turn, or every 2nd, 3rd or 4th turn)
- Calm procedural background music with player controls

## Requirements

- [Bun](https://bun.sh/)

## Run locally

```sh
bun install
bun run start
```

Open the local address printed by the server. The server keeps room state in memory, so active rooms end when it stops.

## Checks

```sh
bun test
```

The test suite covers the shared rules, the canvas renderer, the word bank, the room state machine and the multiplayer game flow over WebSockets.
