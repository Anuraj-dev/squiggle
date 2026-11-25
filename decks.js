// Word decks the host toggles in the lobby. Everyday is the legacy + New banks
// merged; every other deck is `decks/<id>.json`:
//   { id, name, icon, easy: [], medium: [], hard: [], aliases: { variant: answer } }
// Invariants, enforced here at load (bad entries are skipped with a warning):
// - answers are lowercase, trimmed, 2–40 chars;
// - an answer's canonical key (and its plural/singular forms) belongs to one
//   deck only; the first deck in DECK_ORDER wins;
// - aliases fold into answer matching via words.js `registerAlias`, and may
//   never redirect an existing answer or alias.
import { readFileSync } from 'node:fs';
import { WORDS, ALIASES, canonKey, singulars, registerAlias } from './words.js';
import { norm } from './public/shared.js';
import { NEW_WORDS } from './words-new.js';

export const TIERS = ['easy', 'medium', 'hard'];
const DECK_ORDER = ['tech', 'memes', 'dev', 'science', 'desi', 'philosophy', 'double'];
export const DEFAULT_DECKS = ['everyday', 'tech', 'memes'];
export const CUSTOM_DECK = { id: 'custom', name: 'Your words', icon: '✍️' };

const flat = (k) => k.replace(/ /g, '');
// Keys that would make two answers indistinguishable to matchesAnswer.
const answerKeys = (w) => [w, ...singulars(w)].map((x) => flat(canonKey(x)));

export function buildDecks(specs, warn = (m) => console.warn(`[decks] ${m}`)) {
  const owner = new Map(); // answer key -> deck id
  const decks = [];
  for (const spec of specs) {
    const deck = { id: spec.id, name: spec.name, icon: spec.icon, easy: [], medium: [], hard: [] };
    for (const tier of TIERS) {
      for (const raw of spec[tier] || []) {
        const w = typeof raw === 'string' ? raw : '';
        if (w !== w.trim().toLowerCase() || w.length < 2 || w.length > 40 || !norm(w)) {
          warn(`${spec.id}: skipped invalid answer ${JSON.stringify(raw)}`);
          continue;
        }
        // Everyday is the curated legacy bank: dedupe it by exact key only.
        const keys = spec.id === 'everyday' ? [flat(canonKey(w))] : answerKeys(w);
        const taken = keys.map((k) => owner.get(k)).find(Boolean);
        if (taken) {
          if (spec.id !== 'everyday') warn(`${spec.id}: "${w}" already belongs to ${taken}`);
          continue;
        }
        for (const k of keys) owner.set(k, spec.id);
        deck[tier].push(w);
      }
    }
    for (const [variant, answer] of Object.entries(spec.aliases || {})) {
      const v = norm(variant), a = flat(canonKey(answer));
      if (flat(v) === a) continue; // spacing variants already match
      if (owner.get(a) !== spec.id) { warn(`${spec.id}: alias "${variant}" points at "${answer}", not one of its answers`); continue; }
      if (!v || Object.hasOwn(ALIASES, v) || answerKeys(v).some((k) => owner.has(k))) { warn(`${spec.id}: alias "${variant}" would hijack an existing answer`); continue; }
      registerAlias(v, answer);
      owner.set(flat(v), spec.id);
    }
    decks.push(deck);
  }
  return decks;
}

function readSpec(id) {
  const spec = JSON.parse(readFileSync(new URL(`./decks/${id}.json`, import.meta.url), 'utf8'));
  if (spec.id !== id) throw new Error(`decks/${id}.json declares id "${spec.id}"`);
  return spec;
}

export const DECK_WARNINGS = [];
export const DECKS = buildDecks([
  { id: 'everyday', name: 'Everyday', icon: '🏠', ...Object.fromEntries(TIERS.map((t) => [t, [...WORDS[t], ...NEW_WORDS[t]]])) },
  ...DECK_ORDER.map(readSpec),
], (m) => { DECK_WARNINGS.push(m); console.warn(`[decks] ${m}`); });
export const DECK_BY_ID = new Map(DECKS.map((d) => [d.id, d]));
export const DECK_IDS = DECKS.map((d) => d.id);

export const deckInfo = (d) => d && { id: d.id, name: d.name, icon: d.icon };
// Lobby catalog: display fields plus a word count for the chip tooltip.
export const DECK_CATALOG = DECKS.map((d) => ({ ...deckInfo(d), count: TIERS.reduce((n, t) => n + d[t].length, 0) }));

// History keys of every deck answer; anything else is pruned from disk.
export const ALL_DECK_KEYS = new Set(DECKS.flatMap((d) => TIERS.flatMap((t) => d[t].map(canonKey))));

// Host input -> known ids in catalog order; empty or invalid -> defaults.
export function cleanDeckIds(list) {
  if (!Array.isArray(list)) return DEFAULT_DECKS;
  const want = new Set(list);
  const out = DECK_IDS.filter((id) => want.has(id));
  return out.length ? out : DEFAULT_DECKS;
}
