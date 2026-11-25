# Consultation: make Squiggle more playful, fun and enjoyable

You are one of three independent consultants. Your job is **advice only**: do NOT edit, create, or delete any file in the repo, do not run git commands that change state, do not start servers. Reading files is fine.

## The product

Squiggle is a multiplayer draw-and-guess game (skribbl.io-style) played by a group of friends (tech-heavy, Indian college/dev crowd, meme-literate). Repo: `/home/raja/Projects/active/squiggle`. Bun server, plain ES-module client, no build step. Read `AGENTS.md` and `docs/CHECKPOINT.md` first for layout and invariants.

Key files: `game.js` (Room state machine, guessing at `guess()` ~line 535, word picking `pickWords()` ~line 464), `words.js` (legacy word bank ~1050/difficulty, `ALIASES`, `matchesAnswer`, `mentionsAnswer` at the bottom), `words-new.js` ("New" word set: devices, science, everyday), `public/shared.js` (38 chaos challenges in `CHAOS_MODES`, `pickChaos`, scoring), `public/app.js` (client UI), `public/board.js` (canvas + view effects).

Already shipped: 38 chaos challenges (artist and guesser sides, 1x–4x rate, host picks which can roll), streak scoring, difficulty multipliers, redo, pause, procedural music, gallery export, reactions, confetti, Legacy/New word set selector, custom words.

## What the owner (Raja) wants — his own words, interpreted

1. **Guess input is unfriendly.** If a guesser types the answer inside a sentence ("is it a cat"), or a near form like a plural ("cats" when the answer is "cat"), the server replies privately `"…" — just the word, please. Not shown to others.` and the guess does not count. Raja finds this bad. Code: `game.js` `guess()` → `spoils()` → `words.js` `mentionsAnswer()` (whole-word runs, matches answer/alias/`+s`/`+es`). `matchesAnswer()` only accepts exact canonical match or the same with spaces removed. Decide what the right behavior is (accept? accept with rules? how to stay cheat-safe and not leak the answer to others?).
2. **Word categories.** Instead of only easy/medium/hard, have exciting, researched categories: e.g. Tech, Science, AI, Philosophy (light, drawable-ish, not deep), and others you think land with this crowd. Raja has a seed list of tech/AI/meme words in `squiggle-words.txt` (untracked, his own; many are brands/abstract — judge drawability). How should categories work in the lobby and in a turn (host picks? vote? per-turn category card? mixed)? How do we keep abstract categories drawable and fair?
3. **Words feel predictable / repeat.** Raja can predict which word will come; one word "comes again and again". Facts: `pickWords` shuffles with `Math.random` and ranks unused words first, but `this.used` is cleared on every `start()` (each new game in the same room), and with difficulty `mix` each choice set is one easy + one medium + one hard sorted by difficulty. There is no memory across games, rooms or server restarts, and no per-player memory. Propose a randomization/selection algorithm that feels fresh (e.g. persistent recency decay, shuffle-bag/deck per room, per-player seen sets, category rotation, weighting) and explain why the current one feels repetitive.
4. **Chaos.** Chaos is "okay" overall. Some challenges feel like duplicates — Raja specifically named **Laggy Stream** and **Ink in Batches** as basically the same thing. Audit the 38 for overlap/redundancy and recommend merges/cuts. More chaos is optional — propose a few only if they are genuinely different and funny.

## What we want back from you

A self-contained report (markdown, ≤ ~1500 words) with:

1. **Top 5 recommendations ranked by fun-per-effort**, each: the player-visible experience, why it is fun, concrete mechanic/rules, which files change, rough size (S/M/L), risks.
2. A specific answer for each of Raja's 4 points above (guess input, categories, randomization, chaos overlap).
3. **Up to 5 bold ideas** beyond Raja's list that would make sessions more memorable (social moments, rivalry, surprise, end-of-game payoff) — not more settings screens.
4. **What NOT to do** — ideas that sound fun but would hurt the game.

Ground claims in the actual code (cite `file:line` where relevant). Separate what you verified in code from what is opinion. Be concrete and opinionated; no generic game-design filler.
