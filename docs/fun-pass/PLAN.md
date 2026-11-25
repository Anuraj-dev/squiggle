# Fun pass — plan (2026-11-25)

Squiggle: one player draws a secret word, everyone else races to type it, and chaos cards bend the rules.
This pass makes guessing forgiving, words fresh and themed, chaos sharper, and the end of a game worth sharing.

Source: Raja's requests plus three independent consultations (GPT 6.2 Sol high, Opus 5.5 medium,
Gemini 4 Hydrogen high) — see `CONSULTATION.md`. Status of each item lives in the checklist at the bottom.

---

## 1 · Guessing that understands people

Sentences and plurals score. Only multi-word lists are stopped, privately.

```
 "is it a cat?"   → strip "is it a" → "cat"          ✅ scores
 "flash drives"   → plural          → "flash drive"  ✅ scores
 "cat dog car"    → a list          → "Try one guess" 🔒 only you see this
```

Rules
- Match the whole input first, then strip **one** known opener (`is it`, `it is`, `its`, `maybe`, `i think`,
  `i think its`, `probably`, `must be`, `looks like`) + an optional article (`a/an/the`) and known trailing
  fillers (`pls`, `please`, `lol`, `bro`, `right`, `maybe`), and match the whole remainder.
- Regular plurals count in both directions (`s`, `es`, `ies↔y`, `ves↔f/fe`), for every word source
  (legacy, decks, custom). No fuzzy/edit-distance wins.
- Any other message that mentions the answer is never shown to others and gets a private "Try one guess".
  Under Limited Guesses such a message spends one attempt (correct answers, near typos, repeats stay free).
- Never echo an accepted variant to the room; the existing "guessed it" event is unchanged.

Files: `words.js`, `game.js` (`guess`, `spoils`), tests.

## 2 · Fresh words + word history on disk

The drawer still picks one of N cards. What changes is which words land on the cards.

```
 today:   bank ──shuffle──► [easy][medium][hard]           memory wiped every game

 new:     enabled decks ──► only the oldest 25% by "last seen" (never-seen first), random among them
                        ──► skip: shares a content word with anything offered in the last 10 turns (golf… panda…)
                        ──► [🤖 Tech & AI · hard] [🏠 Everyday · easy] [😂 Memes · medium]   shuffled order
```

- **Seen = shown on a card**, picked or not.
- A word can come back only after 75% of its pool has been shown since it was last shown.
  ~1500-word setup, 45 cards per game → ≈ 25 games before any repeat. A 40-word deck → ≈ 10 turns.
- **Disk:** `data/word-history.json` = `{ canonKey: lastSeenMs }`, shared by every room on the server,
  one entry per word (overwritten, never grows past the bank, ~150 KB max). Unknown keys are pruned at load.
  Written atomically (tmp + rename), debounced. Delete the file to reset. `data/` is gitignored.
  Path override `SQUIGGLE_HISTORY` (tests use a temp file or in-memory store).
- **Custom words are never written to disk** — remembered per room (same rule) while the room lives.
- Card order is shuffled; each card shows its deck and difficulty badge.
- When no word fits the rules, relax in order: family cooldown → 25% window → anything not already on the cards.
- Fixes the bug where an unpicked custom word was offered on ~87.5% of turns (custom words go through the same
  recency rule and get at most one card per deal).

Files: `game.js` (`pickWords`, `start`), new `history.js`, `.gitignore`, tests.

## 3 · Category decks

```
 Lobby:     (🏠 Everyday✓) (🤖 Tech & AI✓) (😂 Internet & Memes✓) (💻 Dev Life) (🔭 Science & Space)
            (🛺 Desi & Campus) (🧠 Philosophy) (🔀 Double Meaning)
 Drawer:    ┌🤖 Tech & AI┐ ┌😂 Memes──┐ ┌🧠 Philosophy─┐
            │ robot dog  │ │ nyan cat │ │trolley problem│
            └────────────┘ └──────────┘ └───────────────┘
 Guessers:  🤖 Tech & AI ·  _ _ _ _ _   _ _ _
```

- Host toggles decks as chips (replaces the Legacy/New word-set selector). Default on: Everyday, Tech & AI,
  Internet & Memes. At least one deck must stay on unless custom-only.
- Each card in a deal comes from a different enabled deck where possible; custom words act as one more deck.
- Guessers see the chosen word's deck as a pill above the blanks once drawing starts (free clue).
- No per-turn category vote.
- **Everyday** = the existing legacy + New banks merged (concrete words), deduplicated.
- Every other deck is researched and curated for drawability: no brand/model names without an iconic picture,
  no pure abstractions. Each word tagged easy/medium/hard. Double Meaning: draw the object, the answer is the
  tech name (draw a crab → "rust").
- Deck data: `decks/<id>.json` → `{ "id", "name", "icon", "easy": [], "medium": [], "hard": [], "aliases": { "variant": "answer" } }`,
  loaded server-side by `decks.js`. Canonical answers are unique across all decks.

Files: new `decks.js`, `decks/*.json`, `game.js` (settings, snapshot), `public/app.js` (lobby chips, choice
cards, drawing header), `public/style.css`, `words.test.js`/new deck tests.

## 4 · Chaos changes

```
 KEEP as is   Ink in Batches · Tiny Pen · No Hints · Foggy · Earthquake · Morse · Mystery Ink
              Mirror · Kaleidoscope · Goldfish · everything else
 MERGE        Laggy Stream → becomes the name of Ink in Batches (id stays `batches`); the client-only
              laggy path is deleted
 REBUILD      Negative → "Opposite Colors": paper stays white, ink hue flips (red→cyan, blue→orange,
              black/white/grays unchanged); fades by rotating hue back, so no gray "blank" flash
 UPGRADE      Stamp Artist → + ♥ ☾ ☁ ⚡ 👁 shapes; dragging sets size and angle
 NEW          Gravity Ink (artist): strokes slowly slide down with age — melting drawings
              Decoy Doodle (artist): turn starts with a scribble that can't be erased/undone/cleared
              Macro Cam (guesser): guessers see a zoomed-in patch around recent ink that pulls back over time
```

Negative today: a CSS `invert(amount)` on the whole canvas; mid-fade `invert(0.5)` turns everything flat gray —
the "blank split-second".

Dropped: Narrator (drawer 3-word clue) — it is a hint dressed as chaos.

Files: `public/shared.js`, `public/board.js`, `game.js` (chaos rules), `public/app.js` (views, stamp picker), tests.

## 5 · Reveal + end of game

```
 Reveal:     It was 🐱 CAT    The room thought: "toilet" · "sad potato" · "Raja"
 Last turn:  🔥 FINALE · 2× points
 End:        gallery → tap a drawing → replay
             ┌──────────────────────────────┐
             │   🐱  (drawing builds up)    │
             └──────────────────────────────┘
              ▶ ❚❚   1× · 2× · 4× · 8×   ━━━━━●━━━   ⬇ Download clip
             ⭐ Download game reel (every drawing back to back with word title cards)
             🏆 Gallery MVP vote (one vote each, not your own, no points) → winner on the share image
 Lobby:      Wins tonight:  Arjun 3 · Raja 2
```

- Wrong-guess recap: up to 3 public wrong guesses, most repeated first then longest, at most one per player,
  never "close" guesses.
- Replay uses each stroke's saved start time `t`; undone strokes are absent; each stroke draws in at an even pace.
- Video is recorded in the player's browser (canvas → MediaRecorder; mp4 when supported, else webm). The server
  stores nothing. On phones, the share sheet opens when `navigator.canShare({ files })` allows it.
  Clip ≈ 0.5–1 MB, reel ≈ 5–10 MB; recording runs in real time with a progress bar.
- Wins tally is in-memory per room and survives rematches.

Files: `game.js` (reveal recap, finale, votes, tally), `public/shared.js` (finale scoring flag),
`public/app.js` (reveal, end screen, lobby tally), new `public/replay.js`, `public/share.js`, `public/style.css`, tests.

---

## Build

```
 feat/game-fun-pass (try worktree ../squiggle-wt/fun-pass)
   ├─ feat/fun-words   Opus 5.5 medium   §1 §2 §3 infrastructure
   ├─ feat/fun-chaos   Gemini 4 Hydrogen high (≈30% of the work, benchmarked)   §4
   ├─ feat/fun-reveal  Opus 5.5 high     §5
   └─ deck words       Haiku 5.5 researchers (one per deck) → Haiku curators (drawability, tiers)
 → driver merges, bun test, Chrome + bot check, GPT 6.2 Sol high review, app left running
```

Nothing is pushed until Raja says ship.

## Checklist

- [ ] §1 guessing
- [ ] §2 fresh words + disk history
- [ ] §3 decks: infrastructure
- [ ] §3 decks: researched words
- [ ] §4 chaos
- [ ] §5 reveal + end
- [ ] integrated, `bun test` green
- [ ] Chrome check with bot
- [ ] Sol review + fixes
- [ ] benchmark written (`BENCHMARK.md`)
