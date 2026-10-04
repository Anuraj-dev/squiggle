# Checkpoint — 2026-10-05

## State

- Repo: `github.com/Anuraj-dev/squiggle` (private). Branch `feat/chaos-role-challenges`. Pilot committed as `b963868`; all nine remaining challenges are implemented, verified locally and independently reviewed. Final review disposition: `ship`, no confirmed findings.
- Fresh verification: `bun test` passes 81/0; `bun build public/app.js --outfile /tmp/squiggle-chaos-check.js` and `git diff --check` pass.

## Done (user-requested)

1. **Blank canvas per drawer.** The cause was that `clear` arrives before `state` and the client dropped it as stale. The client now tracks `boardSeq`. Checked in Chrome with the bot.
2. **Word bank.** 1054 easy, 1064 medium and 1052 hard drawable words. `words.test.js` requires at least 1000 per level, no duplicates and no abstract words.
3. **Chaos.** Thirty-nine challenges. The pilot added Five Strokes, Ink Budget, Mystery Length and Curtain Reveal. The remaining build adds Straight Lines Only, Forbidden Zone, Shrinking Brush, Stamp Artist and Slippery Pen for artists; Puzzle Board, Moving Spotlight, Ink in Batches and Limited Guesses for guessers. Classic / Artist Chaos / Guesser Chaos / Mixed Chaos presets; chaos frequency remains Sometimes / Every turn. Mixed chooses either role equally, with 20% mild pairs. Each pool avoids its previous challenge.
4. **Forgiving scoring.** 15% grace window, whole seconds, a 120-point floor (40% of max) and no first-guess bonus.
5. **Host settings.** Rounds, draw time (30–240 s), word choices (1–5), hints (0–5), difficulty (mixed/easy/medium/hard) and chaos level. The server clamps all values (`settings` handler in game.js).
6. **Music.** Six procedural tracks with play/pause, previous/next and volume. Preferences live in `localStorage` (`sq-music`). Music starts on the first click.
7. **One sound button.** The old 🔊 button only muted sound effects. It is now a "Sound effects" switch inside the 🎵 panel (`sq-muted`).
8. **Player list.** Badges (👑 ✏️ ✅ 🔥N 💤) sit on their own line under the score, so they no longer cover the name or points.
9. **Challenge rules.** Private artist instructions, persistent stroke/ink consumption, one artist swap per player per match, guesser view relief for the final third, and both challenges named at reveal and in the gallery. Mystery Length reveals at halfway, including after pause and speedup. Limited Guesses starts with three attempts and restores one every four unpaused seconds; correct answers, near typos and repeats are free. Batches publish a frozen drawing every two unpaused seconds. Both become unrestricted in the final third. Circle/square stamp proportions and drawing effects are enforced by the server.
10. **Checks and review.** Chrome through OBU at desktop and 390×844: role cards, pilot budgets, all nine new challenges, all five stamps, forbidden clipping, thinning brush, batch publication, attempt exhaustion/draft retention, zero-attempt typo/correct answers, pause/reconnect, puzzle/spotlight relief and the visible drawing recap. No horizontal overflow at 390px; composer stays within the viewport. Deterministic test server controlled challenge selection. Independent reviews found one fractional timer edge, fixed with an odd-ms regression; final review found no blockers. Clear/skip in-game confirmations, pause/reconnect preserving ink, and the gallery recap passed Chrome checks through OBU. The final remaining-feature review returned `ship` with no confirmed findings. The first review attempt reached its turn limit without a verdict; a fresh bounded review completed.

## Open / unverified

- **Music sound:** the audio has never been listened to. Only the controls and state were checked.
- **Chaos modes on screen:** legacy modes remain mostly unit-tested. The new thirteen challenges and clear/skip confirmations were exercised in Chrome. Exact batch/refill/speedup boundaries are covered by manual-clock tests.
- **Design detector:** parser dependencies unavailable; regex fallback found only the existing podium bounce. Computed contrast was not audited by the detector.
- **Words:** some fairy-tale names (e.g. "cinderella", "santa claus") are in the bank. Remove them if the user objects.

## How to resume

```sh
bun test
PORT=3791 bun server.js &          # note the PID; stop only that one
# create a room in Chrome, then:
PORT=3791 bun scripts/bot.js ROOMCODE
```
