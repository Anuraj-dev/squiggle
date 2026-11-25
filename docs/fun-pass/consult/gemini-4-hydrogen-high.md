# Squiggle Fun & Product Consultation

*Verified facts are cited with `file:line`; everything else is design judgment for a tech-heavy, meme-literate Indian college/dev friend group.*

---

## 1. Top 5 Recommendations (Ranked by Fun-per-Effort)

### 1. Fix Unfriendly Guess Matching (Plurals & Polite Wrappers) — **Size: S**
- **Experience:** Typing `"gpus"`, `"flash drives"`, `"is it a cat"`, or `"maybe a dog"` scores immediately instead of getting privately scolded.
- **Why it’s fun:** Nothing kills momentum faster than getting the drawing right, seeing a private `"just the word, please"` block, and watching someone else steal the points two seconds later.
- **Mechanic:** Expand `matchesAnswer()` (`words.js:1722-1729`) to accept singular/plural inflections and strip a small whitelist of conversational prefixes/suffixes before checking `mentionsAnswer()` (`words.js:1734-1746`).
- **Files:** `words.js`, `game.js`.
- **Risks:** Loose matching could let players stuff multiple nouns into one guess; mitigated by stripping only non-content wrapper words (detailed in §2.1).

### 2. Persistent Shuffle-Bag & Cross-Game Word Memory — **Size: S–M**
- **Experience:** Rematches in the same room (and across nights on the same server) stop recycling yesterday’s words, and the 3 word choices stop arriving in a predictable Easy/Medium/Hard ladder.
- **Why it’s fun:** Surprise during the 25s choosing screen and fresh prompts across a 3-game session keep regulars engaged.
- **Mechanic:** Stop calling `this.used.clear()` on `start()` (`game.js:401`); add a lightweight disk-persisted recency map (`canonKey -> { lastAt, count }`) plus per-player token cooldowns (`app.js:59, 218`), and sample from the least-recently-used deck without deterministic tier sorting (`game.js:491`).
- **Files:** `game.js`, small persistence module (e.g. `history.js`), optional `words.js`.
- **Risks:** Tiny custom-word lists (`customOnly`) will still cycle fast; handle gracefully by sorting strictly by least-recently-used timestamp.

### 3. Curated Category Packs + Visible Category Pill — **Size: M**
- **Experience:** Instead of a flat `Legacy` vs `New` radio (`app.js:932-936`), hosts toggle themed packs (`Everyday`, `Tech & Code`, `AI & Sci-Fi`, `Memes`, `Desi`, `Thought Experiments`). Each turn offers choices from different active packs and displays the active category pill above the blanks.
- **Why it’s fun:** Inside-culture prompts (`merge conflict`, `kermit tea`, `trolley problem`, `auto rickshaw`) land way harder with this crowd than generic objects, and showing the category makes abstract/meme words solvable without writing text.
- **Mechanic:** Tag words by category (retaining difficulty for scoring), offer cross-category choices in `pickWords()`, and expose `category` in `Room.snapshot()` (`game.js:181-216`) alongside `diff`.
- **Files:** `words.js`, `words-new.js` (or unified `packs.js`), `game.js`, `public/app.js`, `public/style.css`.
- **Risks:** Bloating the lobby UI or shipping undrawable buzzwords; mitigate with multi-select chips and strict visual curation (§2.2).

### 4. Cut Redundant Chaos Modes (~38 → ~30) + 3 High-Comedy Replacements — **Size: S–M**
- **Experience:** Fewer "wait, didn't we just get this?" or blurry eye-strain turns (`laggy`, `fog`, `quake`, `onecolor`), replaced by punchier twists like **Macro Cam** or **Decoy Doodle**.
- **Why it’s fun:** Chaos defaults to 2x (`game.js:23`); when every chaos roll changes *how* you think rather than just hurting readability, chaos turns become highlights instead of chores.
- **Mechanic:** Prune 8 overlapping/weak modes in `CHAOS_MODES` (`public/shared.js:20-60`) and wire 2–3 distinct mechanics using existing canvas/stroke hooks.
- **Files:** `public/shared.js`, `public/board.js`, `public/app.js`, `game.js`.
- **Risks:** Breaking saved `chaosIds` lists or tests referencing removed IDs (`shared.test.js`, `room.test.js`—keep `cleanChaosIds` tolerant).

### 5. End-of-Game Roast: Stroke Replay, "Best Worst Drawing" Vote & Wildest Misses — **Size: M**
- **Experience:** The end modal (`app.js:1154-1208`) becomes a social recap: clicking any thumbnail replays the drawing stroke-by-stroke at 4× speed, everyone votes once for **Gallery MVP** (+50 pts), and an extra award highlights the **Funniest Wild Guess** or **Most Reacted** canvas.
- **Why it’s fun:** The funniest moments in friend-group Pictionary happen *after* the turn when people argue over "what was THAT supposed to be?!"
- **Mechanic:** Every stroke already stores `t: gm` (`game.js:845`) and `gallery` already holds `galleryStrokes` (`game.js:624-627`). Track `reactCount` and notable near/early guesses per turn on `Room`, add a `vote` handler in `end` state, and animate `s.t` inside `openLightbox()` (`app.js:1115`).
- **Files:** `game.js`, `public/app.js`, `public/style.css`.
- **Risks:** Delays clicking "Back to lobby" if votes block; keep voting instant/optional with live tally updates.

---

## 2. Specific Answers to Raja’s 4 Points

### 2.1 Guess Input (`game.js:541-589`, `words.js:1717-1746`)
**What happens in code today:**
- `ALIASES` (`words.js:327-1693`) maps many legacy plurals (`"cats": "cat"`), so legacy plurals happen to work. **However**, `NEW_WORDS` (`words-new.js`) and `customWords` have no entries in `ALIASES`.
- `matchesAnswer()` (`words.js:1722-1729`) only checks exact `canonKey` equality (with or without spaces).
- When `"gpus"` or `"flash drives"` or `"is it a cat"` misses `matchesAnswer()`, `guess()` (`game.js:559`) calls `mentionsAnswer()` (`words.js:1734-1746`), which explicitly checks `c === w || c === "${w}s" || c === "${w}es"` (`words.js:1742`). So the server *knows* `"flash drives"` is the plural of the answer, yet rejects it privately as `"just the word, please"`!

**Recommended rule (cheat-safe, zero leaks):**
1. **Accept inflections in `matchesAnswer()`:** Bidirectional plural/singular normalization (`+s`, `+es`, `ies↔y`, `ves↔f/fe`) plus space/hyphen equivalence (`canonKey` already normalizes punctuation via `norm()` at `shared.js:174`). Never leak to chat because `correct(p)` keeps the guess private.
2. **Accept safe conversational wrappers, reject multi-noun spam:** Before `matchesAnswer()`, strip a strict leading/trailing wrapper whitelist: leading `is it (a|an|the)?`, `it is (a|an|the)?`, `its (a|an|the)?`, `maybe (a|an|the)?`, `i think (its|it is)? (a|an|the)?`, `a|an|the`; trailing `please|pls|right|lol|bro|maybe`. If the stripped string matches the answer, **award it as correct**.
3. **Keep blocking multi-content sentences in `spoils()`:** Never accept arbitrary sentences containing the word (e.g. `"cat dog house tree"`), or guessers can carpet-bomb 5 words per message—especially broken in `Limited Guesses` (`game.js:566-578`). Keep `spoils()` private, **and** under `limited` chaos deduct 1 attempt if `spoils()` triggers on `>1` non-stopword token so sentence-stuffing isn't a free probe.

### 2.2 Word Categories (`squiggle-words.txt`, `words.js`, `words-new.js`)
**Audit of `squiggle-words.txt`:**
- **Great hits for this crowd:**
  - *Tech & Code:* `merge conflict`, `blue screen`, `null pointer`, `memory leak`, `docker`, `linux`, `github`, `phishing`, `cookie`, `bug`, `server crash`, `rubber duck` (add!), `404` / `infinite loop`.
  - *AI & Future:* `chatbot`, `deepfake`, `jailbreak`, `gpu cluster`, `robot barista`, `self-driving car`, `hallucinate`, `prompt injection`, `data center`, `liquid cooling`.
  - *Memes & Brainrot:* `pepe the frog`, `doge`, `stonks`, `nyan cat`, `cat loaf`, `kermit tea`, `trollface`, `rickroll`, `doomscrolling`, `touch grass`, `galaxy brain`, `sad hamster`, `rage comic`.
  - *Desi / Local:* `swiggy`, `zomato`, `ola`, `infosys`? (Logos/uniforms work for delivery apps: `swiggy`, `zomato`, `auto rickshaw`, `chai`, `upi qr`), though avoid generic company names with no distinct visual (`sarvam`, `krutrim`, `wipro`).
- **Cut / Do not include (undrawable text-boxes):**
  - Interchangeable SaaS/AI/infra brands (`pinecone`, `weaviate`, `milvus`, `qdrant`, `crusoe`, `nebius`, `runpod`, `modal`, `snowflake`, `okta`), model tier clones (`claude opus/sonnet/haiku`, `gemini flash/ultra`, `qwen max`, `mixtral`), and pure corporate abstractions (`initial public offering`, `corporate governance`, `export controls`, `series b`, `changelog`, `early access`). If the only way to draw it is writing the name or drawing "server box #4", cut it.
  - Note lines 1–2 (`golf course`, `panda`) are stray non-tech words.
- **How to make "Philosophy" drawable & funny:** Frame it as **Thought Experiments & Paradoxes** rather than `-isms`: `trolley problem`, `schrodingers cat`, `platos cave`, `ship of theseus`, `sisyphus`, `brain in a vat`, `butterfly effect`, `occams razor`, `panopticon`, `chicken or the egg`. Every one of those is an instant visual gag.

**How categories should work:**
- **Lobby:** Replace the `Word set` (`Legacy`/`New`) toggle (`app.js:932-936`) with toggleable **Category Pack** pills (`Everyday`, `Tech & Code`, `AI & Sci-Fi`, `Memes`, `Desi`, `Thought Experiments`). Default to `Everyday` + `Tech & Code` + `Memes` on.
- **In-turn:** Don’t add a pre-turn category vote (adds dead time). Instead, `pickWords()` pulls each of the `wordChoices` from a **different enabled pack** when possible, shows a category badge (`💻 Tech`, `🧠 Thought`) on each choice button (`app.js:851`), and displays the chosen word’s category pill above the board during `drawing`—giving guessers vital context without spoiling the word.

### 2.3 Word Randomization (`game.js:86, 401, 464-492`)
**Why it feels predictable & repetitive (verified in code):**
1. **`this.used.clear()` on every `start()` (`game.js:401`):** Playing "Back to lobby → Start" wipes room memory completely.
2. **Ephemeral rooms (`game.js:32, 712`):** New rooms and server restarts start with zero history.
3. **Rigid slot pattern (`game.js:483-491`):** Under `difficulty === 'mix'` and `wordChoices === 3`, `pickWords()` always draws `[easy, medium, hard]` and sorts them `easy → medium → hard` (`game.js:491`). Players always know button 1 is Easy and button 3 is Hard.
4. **Smaller `new` pool + greedy custom draw:** `NEW_WORDS` has 289 / 309 / 326 words (`easy`/`medium`/`hard`) vs `WORDS` 642 / 1018 / 589, and `pickWords()` (`game.js:487`) consumes `freshCustom()` at `'medium'` on a 50% coin flip before sampling the bank. Zero per-player tracking means the same person repeatedly gets offered words they already drew or guessed earlier that night.

**Better selection algorithm:**
1. **Persistent Shuffle-Bag + Recency Decay:** Maintain an in-memory + disk-persisted (`data/word-history.json`, debounced flush) table of `canonKey -> { lastPlayedAt, plays }`. Never clear `room.sessionUsed` on `start()`.
2. **Per-Player Cooldown (keyed by `token`):** Track the last ~100 words each player token *drew* or *solved*. When picking for `drawerId`, exclude words in `room.sessionUsed` and strongly down-weight words `drawerId` recently drew or any connected player recently saw (`weight = 1 / (1 + recentHits * 8)` with exponential time decay, e.g. 48h half-life).
3. **Jittered Difficulty & Unsorted Display:** Sample tiers/categories with weighted random without replacement (ensuring variety, not a fixed `E/M/H` order) and keep choice order shuffled rather than `sort()`ing by `DIFFS` (`game.js:491`).

### 2.4 Chaos Audit (`public/shared.js:20-60`)
**Verified overlaps to cut or merge:**
1. **`Laggy Stream` (`laggy`) vs `Ink in Batches` (`batches`):** Both delay stroke visibility and catch up later (`board.js:128` vs `game.js:128-147, 250-281`). **Cut `laggy`**, keep `batches` (server-authoritative, handles `fill` cleanly), and consider renaming `batches` to `📡 Laggy WiFi` at a 2.5–3s cadence.
2. **`Tiny Pen` (`tiny`) vs `Shrinking Brush` (`shrinking`):** `tiny` is static annoyance (`shared.js:339`); `shrinking` (`shared.js:105`) creates a fun rush-then-refine arc. **Cut `tiny`.**
3. **`Mirror Mirror` (`mirror`) vs `Kaleidoscope` (`kaleido`):** `kaleido` is literally `mirror` + vertical flip (`board.js:84-85`). **Cut `mirror`**, keep `kaleido` and `upside`.
4. **`One Color` (`onecolor`) vs `Mystery Ink` (`randomink`) / `Rainbow Ink` (`rainbow`):** Most players already draw fine in 1 color, making `onecolor` (`shared.js:341`) a non-event. **Cut `onecolor`.**
5. **`Foggy Glasses` (`fog`) vs `8-Bit` (`pixel`):** Both degrade resolution from 40%→85% (`app.js:443-452, 1222`); `pixel` is charming, `fog` is eye strain. **Cut `fog`.**
6. **`Earthquake` (`quake`) vs `Merry-Go-Round` (`spin`):** Both shake/rotate CSS (`app.js:1225-1228`); `quake` mostly makes lines jitter annoyingly. **Cut `quake`.**
7. **`Permanent Marker` (`permanent`) vs `Five Strokes` / `Ink Budget`:** 4 separate lock/budget artist modes is heavy; `permanent` is passive compared to `fivestrokes` and `inkbudget`. **Cut `permanent`** (keep no-undo inside `onestroke`).
8. **`No Hints` (`nohints`) vs `Mystery Length` (`mystery`):** Passive overlap (`game.js:183, 516`). **Merge** into one guesser challenge: hidden length until 50%, zero revealed letters.

*(Optional)* **3 genuinely distinct new chaos ideas:**
- **🔍 Macro Cam (Guesser):** Canvas zooms 2.5× onto the artist’s latest stroke area, zooming out smoothly from 40%→85%. Funny and suspenseful.
- **✏️ Decoy Doodle (Artist):** Canvas starts with 1–2 pre-seeded shapes (e.g. an ugly squiggle or circle) that cannot be erased—artist has to incorporate it.
- **💧 Gravity Ink (Artist/Canvas):** Every stroke slowly slides downward by a few px/sec (`t`-based offset in `board.js`), turning portraits into melting Dali paintings.

---

## 3. Bold Ideas Beyond Raja’s List
1. **2× Stakes Finale:** The very last turn of every match automatically triggers a `🔥 FINALE · 2× POINTS` banner—gives trailing players a dramatic shot at stealing the podium (`endData` in `game.js:662`).
2. **Streak Bounty (`🔥3+`):** When someone hits a 3+ guess streak (`game.js:594`), mark them as `🎯 Bounty`—the first player to out-guess them steals a `+30` Streak-Breaker bonus. Pure table rivalry, zero new UI chrome.
3. **Co-op Split-Canvas Turn (Rare Event):** Two players share a drawing turn—Player A draws the left half (`x < 500`), Player B draws the right half (`x >= 500`)—creating hilarious Frankenstein art.
4. **Solver Lounge Teaser + Reveal Quote:** While solvers chat privately (`game.js:929`), show non-solvers a silent `"💬 2 solvers are laughing…"` pulse, and surface the wildest wrong guess on the `reveal-summary` banner (`app.js:864-885`).
5. **1-Click Discord/Group Share Card Upgrade:** `renderShareCard` (`app.js:6, 1139`) already exports a results PNG—add the **MVP Vote winner badge** and **Wildest Wrong Guess** subtitle directly onto that share image so it gets posted in the group chat after every session.

---

## 4. What NOT to Do
- **Do NOT add a pre-turn category voting UI.** Choosing already takes up to `CHOOSE_MS` (`25000ms`, `shared.js:5`); another vote kills pacing.
- **Do NOT accept arbitrary sentences containing the answer.** Without a strict wrapper whitelist, players can spam multi-word guesses (`"cat dog car tree"`), breaking `Limited Guesses` and normal turns.
- **Do NOT add abstract concepts/startup names without category context.** Words like `"crusoe"` or `"epistemology"` force artists to write text/letters, which ruins drawing games.
- **Do NOT add voice chat or heavy per-mode lobby sliders.** Friends already use Discord/calls, and `buildLobby()` (`app.js:920-959`) is already at its complexity ceiling.
- **Do NOT let guessers grief/erase the artist’s canvas mid-turn.** Squiggle’s chaos works because `RELIEF_AT = 0.85` (`shared.js:89`) guarantees every round stays solvable; pure sabotage turns fun into frustration.

