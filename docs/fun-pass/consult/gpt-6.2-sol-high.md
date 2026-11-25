# Squiggle consultation

**Fix guessing first, then make rematches remember what the room has seen.** Those changes improve ordinary turns. The biggest opportunity for a more memorable night is a curated Campus & Internet mix and a recap friends actually want to share.

## Top five by fun per effort

| Rank | What players get | Mechanic | Files and size | Main risk |
|---|---|---|---|---|
| 1 | “Is it a cat?” scores. Players can guess naturally under pressure. | Score one answer inside a short, recognized phrase. Accept reviewed plurals and aliases. Keep the submitted answer private. | `words.js`, `game.js`, `public/app.js` · **M** | Ambiguous phrases score or leak an answer. |
| 2 | The rematch deals genuinely fresh cards. | Remember recent answers and offers for the life of the room. Shuffle the card positions once per deal. | `game.js`, `room.test.js` · **M** | Small custom decks need a graceful repeat rule. |
| 3 | Chaos rolls feel more distinct. | Keep Ink in Batches, retire Laggy Stream, and trim effects that ask players to do much the same thing. Give Batches a visible delivery tick. | `public/shared.js`, `public/app.js`, `public/board.js` · **S** for the first cut | Removing an ID can change a host’s saved selection or the odds of paired chaos. |
| 4 | The night ends with a drawing worth sending to the group chat. | Add one anonymous **Gallery MVP** vote per player. Feature the winner and its prompt on a compact, exportable card. Keep the vote optional and outside the scoreboard. | `game.js`, `public/app.js`, `public/style.css` · **M** | Popularity bias. Disable self-votes and show tied winners. |
| 5 | Turns feel like this group’s game. | Default themed play to a rotating mix. Let the host pin one theme. Show the turn’s category on the existing word picker and drawing header. | `words-new.js` or a new server-side deck module, `words.js`, `game.js`, `public/app.js` · **M** | Narrow themes turn into trivia and exhaust quickly. |

## 1. Guess input

**Verified.** In this checkout, `cats` already scores for `cat`. `is it a cat?` and `power banks` for `power bank` both trigger the private rejection. Exact aliases and spaces-removed equality can score. The spoiler filter recognizes additional whole-word mentions and `s`/`es` forms. [words.js:542](/home/raja/Projects/active/squiggle/words.js:542), [words.js:1717](/home/raja/Projects/active/squiggle/words.js:1717), [game.js:541](/home/raja/Projects/active/squiggle/game.js:541)

**Recommendation.** Match the complete input first. Then strip one recognized opening such as `is it`, `I think it’s`, or `maybe`, plus an optional article, and match the entire remainder. Add approved inflections for concrete nouns, including compound nouns and irregulars. A full authored answer such as `fish and chips` still works. For `cat or dog`, `not a cat`, or a sentence that merely mentions the answer, withhold the text and say **“Try one guess.”** Keep spoiler detection broader than scoring and skip automatic edit-distance wins.

Route accepted variants through the existing correct-guess path. Keep the server’s phase, pause, turn-token, eligibility, and rate checks. Broadcast the existing “guessed it” event without the input. Under Limited Guesses, correct answers, near typos, and repeats stay free. A new answer-bearing list spends one attempt. Reuse the client acknowledgment so an input blocked by pause or budget stays in the box. [game.js:563](/home/raja/Projects/active/squiggle/game.js:563), [game.js:591](/home/raja/Projects/active/squiggle/game.js:591), [game.js:913](/home/raja/Projects/active/squiggle/game.js:913), [public/app.js:1077](/home/raja/Projects/active/squiggle/public/app.js:1077)

## 2. Categories

**Verified.** The New bank already supplies useful visual prompts such as Wi-Fi router, graphics card, self-driving car, and lunar rover. The 502-entry seed also includes strong images alongside dense clusters of vendor names and terms like `latent space`. [words-new.js:19](/home/raja/Projects/active/squiggle/words-new.js:19), [words-new.js:75](/home/raja/Projects/active/squiggle/words-new.js:75), [squiggle-words.txt:3](/home/raja/Projects/active/squiggle/squiggle-words.txt:3)

**Recommendation.** Launch four broad decks plus a small Philosophy guest deck.

- **Tech & AI** — tangled charging cables, graphics card (`GPU`), robot dog, self-driving car. Cut model-version names. Use visible scenes for AI concepts.
- **Science & Space** — solar eclipse, periscope, lunar rover. Use Chandrayaan’s rover as a visual reference and accept `lunar rover` as the answer. [ISRO’s Chandrayaan-3 mission recap](https://www.isro.gov.in/Release_of_Chandrayaan-3_science_data_to_the_Scientific_Community.html)
- **Campus India** — hostel mess tray, chai stall, cricket in the corridor, scanning a payment QR. Accept familiar Romanized spellings and regional names. [NPCI’s UPI QR guidance](https://www.npci.org.in/uploads/UPI_OC_190_FY_23_24_Reiteration_of_compliance_to_OC_163_OC_163_A_and_OC_100_f3f20e12b6.pdf)
- **Internet** — cat loaf, keyboard cat, touching grass. Pick memes with recognizable silhouettes or actions. Put friend-group in-jokes in custom words.
- **Light Philosophy** — occasionally deal a scene like `trolley at a fork` or `two people arguing over a shadow`. Score the visible scene. The reveal can name the philosophical reference.

Give all choices on a turn the same broad theme. Keep choices private and show the public theme after lock-in, with the length hint if Mystery Length is active. Keep difficulty as a separate scoring attribute and skip turn-by-turn voting. Start with 25–40 vetted prompts per core deck. Give two friends 20 seconds each to sketch a candidate without text or logos, then see whether a third friend names the scene from the category and drawing. Rewrite prompts that repeatedly elicit the same plausible wrong answer.

## 3. Why words repeat

**Verified.** The shuffle is real. The room ranks chosen words lower until `start()` clears that history. Unchosen cards can return immediately. Default three-card Mixed normally deals one of each tier in fixed order, with custom words able to displace slots. That gives a familiar rhythm even when the words differ. The checkout has **2,249 Legacy and 924 New prompts**. There’s no session evidence identifying the reported repeat. [game.js:393](/home/raja/Projects/active/squiggle/game.js:393), [game.js:464](/home/raja/Projects/active/squiggle/game.js:464), [game.js:507](/home/raja/Projects/active/squiggle/game.js:507)

**Recommendation.** Keep two room-wide cooldowns across rematches, keyed by canonical answer. Avoid the last **30 chosen answers** and **six turns of offers**, including rerolls. Draw uniformly from eligible words. When a pool runs short, relax the oldest offer exclusions first, then reuse the least recently played answer. Keep cards distinct within a deal and custom-only inside its own list. Tag close variants such as `cat on keyboard` and `keyboard cat` as one family for cooldowns. Shuffle eligible categories in cycles and shuffle card positions. Start with room memory. Consider persistence only if fresh-room repeats still bother this group.

## 4. Chaos audit

**Verified.** Laggy Stream delivers strokes to the client and hides young strokes locally. Ink in Batches freezes the guesser’s server snapshot for two unpaused seconds, including undo and clear. They differ under the hood. Both make guessers wait for ink. [public/board.js:118](/home/raja/Projects/active/squiggle/public/board.js:118), [game.js:128](/home/raja/Projects/active/squiggle/game.js:128), [game.js:250](/home/raja/Projects/active/squiggle/game.js:250)

| All 38, grouped by player experience | Recommendation |
|---|---|
| Laggy Stream, Ink in Batches | Keep Batches. The synchronized reveal can land as a group moment. |
| Ghost Ink, Goldfish Memory | Keep Ghost. Both erase context, and fading gives the artist a visible deadline. |
| One Line, Five Strokes, Ink Budget, Shapes Only, Straight Lines Only, Stamp Artist, Permanent Marker, Forbidden Zone, Speedrun | Keep Five Strokes and Ink Budget for different decisions. Retire One Line and Shapes Only first. |
| Tiny Pen, Fat Marker, Shrinking Brush, Too Much Coffee, Slippery Pen | Keep Shrinking, Fat Marker, and Slippery. Bench Tiny and Coffee. |
| Rainbow Ink, Mystery Ink, One Color, Morse Code, Negative | Keep Rainbow and One Color. Bench the other three. |
| Mirror Mirror, Kaleidoscope, Upside Down, Pancake, Double Vision | Keep Mirror and Upside Down. Bench the extra copies and squish. |
| Blindfold, Foggy Glasses, 8-Bit, Puzzle Board, Moving Spotlight, Earthquake, Merry-Go-Round | Keep Blindfold, Puzzle, Spotlight, and 8-Bit. Bench blur and continuous motion. |
| No Hints, Mystery Length, Limited Guesses | Keep Mystery Length and Limited Guesses. No Hints adds little when the host already sets hints to zero. |

These cuts are editorial judgments. Start with Laggy Stream and watch which remaining challenges the group asks to reroll. [public/shared.js:20](/home/raja/Projects/active/squiggle/public/shared.js:20)

## Three more ideas worth trying

- **How did you get that?** At reveal, replay the drawing up to the first solve, then show the finished picture. Make it tap-to-play inside the existing gallery.
- **The rematch receipt.** After game two, show one room-local rivalry stat: “You solved all three of Neha’s drawings. Neha solved none of yours.” No points attached.
- **Caption this disaster.** After a zero-solve turn, let friends optionally caption the finished drawing. The artist can pick one for the recap. Keep the original reveal timer.

## What to avoid

- Arbitrary substring wins, fuzzy auto-scoring, and public echoes of rejected guesses. They reward spam and spoil turns.
- Bulk-importing the seed, narrow brand decks, and a lobby vote before every turn. They trade drawing time for trivia and setup.
- More points for fastest-finger wins, more mandatory animations, or a permanent player history. The best stories should come from what friends drew and guessed together.

*Assessment based on source inspection and read-only matcher checks. Playtest reactions and the reported repeat remain unverified.*