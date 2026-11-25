# Opus 5.5 medium — consultation report (2026-11-25)

[V] = checked in code or with a read-only `bun -e` count. [O] = opinion.

## Notable findings

- [V] A custom word nobody picks keeps coming back. In `pickWords` (game.js:481–487) each slot has a 50% chance to take a "fresh" custom word, and a word stops being fresh only once someone picks it (`used.add`, game.js:504). With 3 choices and one unpicked custom word, it is offered on about 1 − 0.5³ ≈ 87.5% of turns.
- [V] Words shown but not picked are not tracked; they can come straight back.
- [V] All memory is wiped at each new game: `this.used.clear()` in `start()` (game.js:401). Nothing is saved to disk.
- [V] The choice layout never changes: on `mix` with ≥3 choices the tier pool is not shuffled (game.js:484) and the output is sorted easy → medium → hard (game.js:491).
- [V] The bank repeats ideas: tree 19, water 17, fire 15, ball 14, house 13, bear 12, robot 11, dragon 9; several golf entries; "panda" and "panda eating bamboo".
- [V] The legacy bank is 642 easy / 1018 medium / 589 hard after `uniq()`, not ~1050 each as CHECKPOINT said. New set: 289 / 309 / 326.

## Top 5 by fun per effort

1. **Accept guesses in a sentence (S).** If `mentionsAnswer` is true and the message has ≤ 6 tokens, call `correct(p)`; add `ies→y`, `ves→f`, trailing `'s`, articles. Keep "just the word" for longer messages.
2. **Fresh words (S–M).** See randomization.
3. **Chaos cleanup, 38 → ~24 (S).**
4. **Category cards (M–L).**
5. **Wrong-guess replay at reveal (S):** "You all thought it was: toilet, Raja's face, a sad potato" — up to 3 public wrong guesses, most repeated then longest, one per player, skip "close" ones.

## Raja's four points

**Guess input.** Count it; correct guesses are already private. Whole-word runs only, ≤ 6 tokens, never echo. Optionally accept 1-edit typos for 7+ letter answers that are not themselves bank words.

**Categories.** Each choice card carries a category ("🤖 AI · robot dog"), host enables category chips in the lobby, guessers see the category once drawing starts, no per-turn vote. Packs: Dev Life, Logos & Mascots, AI Era, Internet & Memes, Desi, Campus, Science, Philosophy-lite (Schrödinger's cat, trolley problem, Sisyphus, The Thinker, ship of Theseus, Plato's cave, butterfly effect, yin yang). Tag words concrete / icon / abstract; abstract only in the hard slot. Cut seed-list names with no picture (ramp, brex, plaid, okta, nebius, …); keep ~30%.

**Randomization.** A deck per room per tier/category; every word offered is discarded; reshuffle only when empty; do not clear on `start()`. Server-wide recency in a small JSON file weighted `1 − exp(−ageDays/3)`. Concept-family cooldown (golf*, panda*) within 10 turns. Shuffle card order. Custom words go through the same deck.

**Chaos overlap.** Laggy Stream ≈ Ink in Batches; keep Batches (server-enforced), give it the Laggy name, delete the client laggy path. Other merges: Ghost ≈ Goldfish (keep Goldfish); Mirror/Upside/Pancake → one Funhouse; Straight ⊂ Shapes; cut Tiny for Shrinking; keep One Color among cosmetic inks; cut Ink Budget; merge No Hints into Mystery Length; keep 8-Bit over Fog; cut Negative. New: Narrator (3-word drawer clue at halfway), Tag Team (pen passes to first solver, L).

## Bold ideas

1. Double Meaning pack: Rust → crab, Java → coffee, Python, Llama, Falcon, Ruby, Swift → bird, Spark, Apple, Amazon (river), Oracle, Opus, Haiku, Gemini (twins), Cursor.
2. Gallery vote at game end ("most cursed" / "best"), framed card + export.
3. Session rivalry tally across rematches in the lobby.
4. Timelapse at reveal from stroke `t`.
5. Bounty word: once per round one turn is ×2.

## What not to do

Substring matching; per-turn category vote; brand words with no picture; more chaos or a 4x default; penalising wrong guesses; accounts/ELO/AI judging; abstract words in the easy slot.
