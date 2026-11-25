import { expect, test } from 'bun:test';
import { DECKS, DECK_WARNINGS, DECK_IDS, DEFAULT_DECKS, ALL_DECK_KEYS, TIERS, buildDecks, cleanDeckIds } from './decks.js';
import { WORDS, canonKey, matchesAnswer, singulars, stripWrapper } from './words.js';
import { NEW_WORDS } from './words-new.js';

const flat = (k) => k.replace(/ /g, '');

test('shipped decks load clean: valid answers, one owner per answer, Everyday = legacy + New', () => {
  expect(DECK_WARNINGS).toEqual([]);
  expect(DECK_IDS).toEqual(['everyday', 'tech', 'memes', 'dev', 'science', 'desi', 'philosophy', 'double']);
  expect(DEFAULT_DECKS).toEqual(['everyday', 'tech', 'memes']);
  const owners = new Map();
  for (const d of DECKS) {
    expect(d.name && d.icon).toBeTruthy();
    for (const t of TIERS) for (const w of d[t]) {
      expect(w).toBe(w.trim().toLowerCase());
      expect(w.length).toBeGreaterThanOrEqual(2);
      expect(w.length).toBeLessThanOrEqual(40);
      const k = flat(canonKey(w));
      expect(owners.get(k)).toBeUndefined();
      owners.set(k, d.id);
    }
  }
  // No answer in another deck is a plural/alias/wrapper variant of this one.
  // matchesAnswer(u, w) needs a shared flat key between u (or its unwrapped form)
  // and w, plural forms included, so only those pairs are checked: O(n), not O(n²).
  const keysOf = (x) => [x, ...singulars(x)].map((y) => flat(canonKey(y))).filter(Boolean);
  const byKey = new Map();
  for (const d of DECKS) for (const w of TIERS.flatMap((t) => d[t])) {
    for (const k of keysOf(w)) byKey.set(k, [...(byKey.get(k) || []), [d.id, w]]);
  }
  for (const d of DECKS) for (const u of TIERS.flatMap((t) => d[t])) {
    for (const k of new Set([...keysOf(u), ...keysOf(stripWrapper(u))])) {
      for (const [id, w] of byKey.get(k) || []) {
        if (id !== d.id && matchesAnswer(u, w)) throw new Error(`${d.id} "${u}" matches ${id} "${w}"`);
      }
    }
  }
  const everyday = DECKS[0];
  for (const t of TIERS) {
    expect(everyday[t]).toEqual(expect.arrayContaining(WORDS[t]));
    expect(everyday[t]).toEqual(expect.arrayContaining(NEW_WORDS[t]));
  }
  expect(ALL_DECK_KEYS.has(canonKey('refrigerator'))).toBe(true);
});

test('deck aliases fold into matching and cannot hijack existing answers', () => {
  const warnings = [];
  const [a, b] = buildDecks([
    { id: 'zz1', name: 'One', icon: '1', easy: ['zorbling', 'Bad Case', ' x', 'a'], medium: ['cat'], hard: [], aliases: { 'zorb thing': 'zorbling', 'zorbo': 'not here' } },
    { id: 'zz2', name: 'Two', icon: '2', easy: ['zorblings', 'quuxle'], aliases: { 'cat': 'quuxle', 'fridge': 'quuxle', 'zorb thing': 'quuxle', 'quuxie': 'quuxle' } },
  ], (m) => warnings.push(m));
  // Invalid labels are skipped; legacy-colliding and plural-colliding answers stay with their first owner.
  expect(a.easy).toEqual(['zorbling']);
  expect(a.medium).toEqual(['cat']);
  expect(b.easy).toEqual(['quuxle']);
  expect(canonKey('zorb thing')).toBe(canonKey('zorbling'));
  expect(matchesAnswer('is it a zorb thing', 'zorbling')).toBe(true);
  expect(canonKey('quuxie')).toBe(canonKey('quuxle'));
  // "cat" (an answer), "fridge" (a legacy alias) and "zorb thing" (another deck's alias) are refused.
  expect(canonKey('cat')).toBe('cat');
  expect(canonKey('fridge')).toBe('refrigerator');
  expect(warnings.filter((m) => /hijack/.test(m))).toHaveLength(3);
  expect(warnings.some((m) => /zorblings.*zz1/.test(m))).toBe(true);
  expect(warnings.some((m) => /not one of its answers/.test(m))).toBe(true);
  expect(warnings.filter((m) => /invalid/.test(m))).toHaveLength(3);
});

test('deck ids are sanitised to known ids with a default', () => {
  expect(cleanDeckIds(['dev', 'nope', 'tech', 'dev'])).toEqual(['tech', 'dev']);
  expect(cleanDeckIds([])).toEqual(DEFAULT_DECKS);
  expect(cleanDeckIds('tech')).toEqual(DEFAULT_DECKS);
});
