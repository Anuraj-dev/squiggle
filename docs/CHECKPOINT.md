# Checkpoint — 2026-10-01

## State

- Repo: `github.com/Anuraj-dev/squiggle` (private). All work is on `main`, and `bun test` passes 57/0.
- The history is a sequence of single-concern commits. Every commit passes `bun test` and `bun build public/app.js`.

## Done (user-requested)

1. **Blank canvas per drawer.** The cause was that `clear` arrives before `state` and the client dropped it as stale. The client now tracks `boardSeq`. Checked in Chrome with the bot.
2. **Word bank.** 1054 easy, 1064 medium and 1052 hard drawable words. `words.test.js` requires at least 1000 per level, no duplicates and no abstract words.
3. **Chaos mode** (renamed from "Twists"). There are 26 modes in `CHAOS_MODES`. The lobby setting is Off / Sometimes (50% of turns) / Every turn, and the same mode never runs twice in a row.
4. **Forgiving scoring.** 15% grace window, whole seconds, a 120-point floor (40% of max) and no first-guess bonus.
5. **Host settings.** Rounds, draw time (30–240 s), word choices (1–5), hints (0–5), difficulty (mixed/easy/medium/hard) and chaos level. The server clamps all values (`settings` handler in game.js).
6. **Music.** Six procedural tracks with play/pause, previous/next and volume. Preferences live in `localStorage` (`sq-music`). Music starts on the first click.
7. **One sound button.** The old 🔊 button only muted sound effects. It is now a "Sound effects" switch inside the 🎵 panel (`sq-muted`).
8. **Player list.** Badges (👑 ✏️ ✅ 🔥N 💤) sit on their own line under the score, so they no longer cover the name or points.

## Open / unverified

- **Music sound:** the audio has never been listened to. Only the controls and state were checked.
- **Chaos modes on screen:** most of the 26 are covered only by unit tests. Only Rainbow and No Hints were seen in the scripted test game.
- **Words:** some fairy-tale names (e.g. "cinderella", "santa claus") are in the bank. Remove them if the user objects.

## How to resume

```sh
bun test
PORT=3791 bun server.js &          # note the PID; stop only that one
# create a room in Chrome, then:
PORT=3791 bun scripts/bot.js ROOMCODE
```
