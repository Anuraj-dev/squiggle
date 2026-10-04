# Checkpoint — 2026-10-05

## State

- Repo: `github.com/Anuraj-dev/squiggle` (private). The chaos pilot is verified on `feat/chaos-role-challenges`; the remaining nine challenges are next.
- Fresh verification: `bun test` passes 70/0; `bun build public/app.js --outfile /tmp/squiggle-chaos-check.js` and `git diff --check` pass.

## Done (user-requested)

1. **Blank canvas per drawer.** The cause was that `clear` arrives before `state` and the client dropped it as stale. The client now tracks `boardSeq`. Checked in Chrome with the bot.
2. **Word bank.** 1054 easy, 1064 medium and 1052 hard drawable words. `words.test.js` requires at least 1000 per level, no duplicates and no abstract words.
3. **Chaos pilot.** Thirty challenges, including Five Strokes and Ink Budget for artists, Mystery Length and Curtain Reveal for guessers. Classic / Artist Chaos / Guesser Chaos / Mixed Chaos presets; chaos frequency remains Sometimes / Every turn. Mixed chooses either role equally, with 20% mild pairs. Each pool avoids its previous challenge.
4. **Forgiving scoring.** 15% grace window, whole seconds, a 120-point floor (40% of max) and no first-guess bonus.
5. **Host settings.** Rounds, draw time (30–240 s), word choices (1–5), hints (0–5), difficulty (mixed/easy/medium/hard) and chaos level. The server clamps all values (`settings` handler in game.js).
6. **Music.** Six procedural tracks with play/pause, previous/next and volume. Preferences live in `localStorage` (`sq-music`). Music starts on the first click.
7. **One sound button.** The old 🔊 button only muted sound effects. It is now a "Sound effects" switch inside the 🎵 panel (`sq-muted`).
8. **Player list.** Badges (👑 ✏️ ✅ 🔥N 💤) sit on their own line under the score, so they no longer cover the name or points.
9. **Challenge rules.** Private artist instructions, persistent stroke/ink consumption, one artist swap per player per match, guesser view relief for the final third, and both challenges named at reveal and in the gallery. Mystery Length reveals at halfway, including after pause and speedup.
10. **Checks and review.** Chrome at desktop and 390×844: role cards, five-stroke exhaustion/refusal, ink consumption, undo preserving budgets, curtain strips and Mystery Length after halfway. Deterministic test server controlled challenge selection. Independent reviews found one fractional timer edge, fixed with an odd-ms regression; final review found no blockers. Clear/skip in-game confirmations, pause/reconnect preserving ink, and the gallery recap passed Chrome checks through OBU.

## Open / unverified

- **Music sound:** the audio has never been listened to. Only the controls and state were checked.
- **Chaos modes on screen:** legacy modes remain mostly unit-tested. The pilot challenge flow and confirmations were checked in Chrome through OBU. Legacy modes remain mostly unit-tested.
- **Design detector:** parser dependencies unavailable; regex fallback found only the existing podium bounce. Computed contrast was not audited by the detector.
- **Words:** some fairy-tale names (e.g. "cinderella", "santa claus") are in the bank. Remove them if the user objects.

## How to resume

```sh
bun test
PORT=3791 bun server.js &          # note the PID; stop only that one
# create a room in Chrome, then:
PORT=3791 bun scripts/bot.js ROOMCODE
```
