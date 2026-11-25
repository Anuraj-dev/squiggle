# Checkpoint — 2026-11-25

## State

- Repo: `github.com/Anuraj-dev/squiggle` (private). Branch `feat/chaos-role-challenges`. Pilot committed as `b963868`; all nine remaining challenges are implemented, verified locally and independently reviewed. Final review disposition: `ship`, no confirmed findings.
- Fresh verification (2026-10-14, fun pass): `bun test` passes 88/0; `bun build public/app.js` passes. Chrome with the bot: top chaos banner, DOUBLE CHAOS splash, everybody-got-it reveal with confetti and artist bonus, 390px layout, no console errors.

## Done (user-requested)

1. **Blank canvas per drawer.** The cause was that `clear` arrives before `state` and the client dropped it as stale. The client now tracks `boardSeq`. Checked in Chrome with the bot.
2. **Word bank.** 1054 easy, 1064 medium and 1052 hard drawable words. `words.test.js` requires at least 1000 per level, no duplicates and no abstract words.
3. **Chaos.** Thirty-eight challenges. The pilot added Five Strokes, Ink Budget and Mystery Length. The remaining build adds Straight Lines Only, Forbidden Zone, Shrinking Brush, Stamp Artist and Slippery Pen for artists; Puzzle Board, Moving Spotlight, Ink in Batches and Limited Guesses for guessers. Classic / Artist Chaos / Guesser Chaos / Mixed Chaos presets; chaos rate is 1x / 2x / 3x / 4x (`CHAOS_RATE`: 25 / 50 / 75 / 100% of turns; 4x is every turn). Chaos defaults to 2x. Mixed chooses either role equally, and 35% of mixed turns pair both roles (only the guesser side must be mild). Each pool avoids its previous challenge.
4. **Scoring.** Guesser `100 + 200 × speed` (15% grace window, whole seconds, no first-guess bonus) plus 10 per streak step (streak 2 +10, 3 +20, 4 and up +30). Drawer `200 × solved share`, plus 100 when every remaining guesser solved it. Everything is multiplied by difficulty (easy ×1, medium ×1.5, hard ×2.2), +25% per active challenge and ×1.25 for Speedrun. Hard with everyone guessing pays the drawer 660 without chaos.
5. **Host settings.** Rounds, draw time (30–240 s), word choices (1–5), hints (0–5), difficulty (mixed/easy/medium/hard) and chaos level. The server clamps all values (`settings` handler in game.js).
6. **Music.** Six procedural tracks with play/pause, previous/next and volume. Preferences live in `localStorage` (`sq-music`). Music starts on the first click.
7. **One sound button.** The old 🔊 button only muted sound effects. It is now a "Sound effects" switch inside the 🎵 panel (`sq-muted`).
8. **Player list.** Badges (👑 ✏️ ✅ 🔥N 💤) sit on their own line under the score, so they no longer cover the name or points.
9. **Challenge rules.** Artist challenge public to everyone, persistent stroke/ink consumption, one artist swap per player per match, guesser view effects at full strength until 40% of the turn, fading out by 85% (`RELIEF_AT`), and both challenges named at reveal and in the gallery. Mystery Length reveals at halfway, including after pause and speedup. Limited Guesses starts with three attempts and restores one every four unpaused seconds; correct answers, near typos and repeats are free. Batches publish a frozen drawing every two unpaused seconds. Both become unrestricted from 85%. Circle/square stamp proportions and drawing effects are enforced by the server.
10. **Checks and review.** Chrome through OBU at desktop and 390×844: role cards, pilot budgets, all nine new challenges, all five stamps, forbidden clipping, thinning brush, batch publication, attempt exhaustion/draft retention, zero-attempt typo/correct answers, pause/reconnect, puzzle/spotlight relief and the visible drawing recap. No horizontal overflow at 390px; composer stays within the viewport. Deterministic test server controlled challenge selection. Independent reviews found one fractional timer edge, fixed with an odd-ms regression; final review found no blockers. Clear/skip in-game confirmations, pause/reconnect preserving ink, and the gallery recap passed Chrome checks through OBU. The final remaining-feature review returned `ship` with no confirmed findings. The first review attempt reached its turn limit without a verdict; a fresh bounded review completed.

11. **Fun pass.** The chaos banner sits above the board with role pills ("· you" marks your side) and the turn multiplier. A splash card announces each chaos turn. The reveal recap moved into the top banner, and an everybody-got-it turn launches confetti and shows the artist bonus. Word choices show their multiplier.

12. **Fun pass 2 (2026-11-25, `feat/game-fun-pass`).** Plan in `docs/fun-pass/PLAN.md`; build, review and fix rounds in `docs/fun-pass/BENCHMARK.md`.
    - Guess matching accepts sentences and plurals. Lists that contain the answer stay private.
    - Word history persists on disk (`data/`, gitignored).
    - Eight category decks.
    - Chaos changes: Gravity Ink, Decoy Doodle, Macro Cam, Opposite Colors, new stamps, Laggy Stream.
    - Reveal recap ("The room thought"), a one-per-game FINALE at 2×, wins tonight, MVP votes.
    - End-screen replay lightbox with speeds, a scrubber and prev/next, plus clip and game-reel video download.
    - UI: a one-screen lobby, the board sized so the toolbar never crops, no deck pill while drawing, still badges, gallery cards that don't clip, a drawn scrubber that fills at the end, and a clip recording that stops when the lightbox closes.
    - Verified: `bun test` 158/0 and Chrome through OBU.

## Open / unverified

- **Video export:** Chrome may block repeat script downloads after the first; the app fires the download and toast regardless. Firefox and the 390px replay lightbox were not checked.
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
