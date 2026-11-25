# Fun pass — build benchmark (2026-11-25)

Each builder worked in its own worktree from the same plan (`PLAN.md`). The driver merged the branches.
GPT 6.2 Sol (high) then reviewed the integrated branch (b88c652). Its findings are listed below by the
branch that introduced them.

| Track | Builder | Scope | Output | Sol findings |
|---|---|---|---|---|
| §4 chaos | Gemini 4 Hydrogen high (`agy`), ≈30% of the work | 6 chaos changes | 1 commit (bf05692), +443/−81, 9 files, 8.3 min; tests 108 → 117 | 3 Medium |
| §5 reveal + end | Opus 5.5 high | recap, finale, MVP, wins, replay, video | 5 commits, +997/−49 | 1 High, 3 Medium, 1 Low, ½ Low |
| §1–§3 words | Opus 5.5 medium | guessing, history, deck system | 2 commits, +687/−94 | 1 Medium, 3 Low, ½ Low |
| deck words | Haiku 5.5 × 7 researchers + 7 curators | 7 themed decks | 1,200 raw → 1,011 shipped words after curation and the driver's cuts | none |

## Sol findings by origin

**Hydrogen (chaos)**
- **Medium:** Gravity Ink — fill seeds and eraser strokes slide separately from the ink they target, so fills spill and erased ink comes back.
- **Medium:** Opposite Colors — rotating each stroke's hue changes colour distances, which moves flood-fill boundaries for guessers.
- **Medium:** Decoy Doodle — when drawn live, an eraser or white line covers the decoy. A full repaint draws the decoy on top, so the two disagree.
- **Process:** one commit instead of one per concern. It also edited `share.js`, which another track owned, and that caused a merge conflict.

**Opus high (reveal)**
- **High:** more than one turn could score as the finale, through a reconnect or a fresh join.
- **Medium:** a finale that turned on during the reveal awarded an all-solved bonus nobody earned.
- **Medium:** leaving and rejoining got around the MVP vote limits, including voting for your own drawing.
- **Medium:** closing the replay lightbox left a clip recording running.
- **Low:** MVP thumbnails ignored `endMs`.
- **Low (half):** long recap guesses overflowed at 390 px.

**Opus medium (words)**
- **Medium:** lists containing the answer could reach public chat (short-answer plurals such as "CDs"; long custom answers).
- **Low:** wrapper stripping ate parts of answers ("is it the floss"); "glasse" matched "glasses".
- **Low:** deck validation ignored Everyday's plural forms.
- **Low:** history was lost on SIGINT and SIGTERM.
- **Low (half):** choice cards and deck badges were too narrow at 390 px.
- **Test gap:** the history test compared display words with canonical keys.

## Integration cost (driver)

- **Hydrogen chaos:** merged with no source conflicts.
  - The replay and gallery did not yet pass `endMs` to Gravity/Decoy rendering (260c905). This was a cross-track gap, not a bug in either branch alone.
- **Reveal:** the merge conflicted in `share.js` and `game.js`. I resolved it hunk by hunk, keeping word memory across rematches.
- **Decks:** the curated JSON produced 63 loader warnings (words that duplicated Everyday and aliases that hijacked other answers). I stripped them to 0.
  - The first deck commit landed with a failing O(n²) collision test. It was fixed in e9aaea1.

## Fix round

Two Opus 5.5 medium workers, one server-side and one client-side, fixed all 13 findings in parallel worktrees.

| Worker | Findings fixed | Commits | `bun test` |
|---|---|---|---|
| server | 8 | 7 | 153 pass |
| client | 6 | 6 | 149 pass |

After the merge, the suite is 156 pass, 0 fail.

## Takeaways

- Hydrogen was fast and its report was accurate. Its bugs were all subtle rendering-consistency issues in the new chaos modes, not crashes, but per unit of work it had about as many Medium findings as the Opus tracks.
- The Opus-high reveal track had the only High finding: a state-machine edge case across disconnects.
- Cheap Haiku research needed a strong curation and dedupe pass. Expect about 15% of the words to be cut.
