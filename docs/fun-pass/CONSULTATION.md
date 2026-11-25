# Consultation — how to make Squiggle more fun (2026-11-25)

Three independent read-only consultations on the same brief (`consult/brief.md`):

| Model | Route | Report |
|---|---|---|
| GPT 6.2 Sol, high | `codex-run.sh read gpt-6.2-sol high` | `consult/gpt-6.2-sol-high.md` |
| Opus 5.5, medium | `opus-medium` subagent | `consult/opus-5.5-medium.md` |
| Gemini 4 Hydrogen, high | `agy --model gemini-4-hydrogen-high` (130 s) | `consult/gemini-4-hydrogen-high.md` |

## Where they agreed (3/3)

- **Guessing:** accept plurals and natural phrasing; stop lists; never leak. Opus wanted any ≤6-token message;
  Sol and Hydrogen wanted a wrapper whitelist. Chosen: whitelist (lists would beat Limited Guesses).
- **Repeats:** `used.clear()` on every start, unpicked offers untracked, fixed easy/medium/hard card order.
  Opus found the custom-word bug (~87.5% of turns). Chosen: recency on disk + family cooldown + shuffled cards.
- **Categories:** no per-turn vote; guessers see the category; cut undrawable brand names.
  Card model split (one theme per turn vs one deck per card). Chosen: one deck per card.
- **Chaos:** keep Ink in Batches, drop Laggy Stream as a duplicate.
- **Bold:** end-of-game gallery vote, replay of how a drawing was made.

## Raja's decisions

- Chaos: keep Tiny Pen, No Hints, Foggy, Earthquake, Morse, Mystery Ink, Mirror, Kaleidoscope, Goldfish.
  Laggy merges into Batches. Negative rebuilt as ink-only Opposite Colors (fixes the gray flash).
  Upgrade Stamps. Add Gravity Ink, Decoy Doodle, Macro Cam. Narrator dropped.
- Word history saved to disk now, not later.
- Replays: downloadable video made in the browser (no server storage), plus a whole-game reel.

Plan: `PLAN.md`.
