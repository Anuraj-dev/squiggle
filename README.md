# Squiggle

A multiplayer drawing and guessing game for friends. Create a room, share the invite link, and take turns drawing words while everyone else guesses in real time.

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

The test suite exercises the multiplayer game flow over WebSockets.
