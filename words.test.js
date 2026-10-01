import { expect, test } from 'bun:test';
import { WORDS, ALIASES, allDefaultWords, canonKey, matchesAnswer, mentionsAnswer, dedupeCustom } from './words.js';
import { norm } from './public/shared.js';

const ABSTRACT = ['procrastination', 'deja vu', 'nostalgia', 'sarcasm', 'homework', 'recycling', 'meditation', 'airplane mode', 'monday'];

test('word bank is unique, sized, and drawable-only', () => {
  const all = allDefaultWords();
  const keys = all.map((w) => canonKey(w).replace(/ /g, ''));
  expect(new Set(keys).size).toBe(all.length);
  expect(all.length).toBeGreaterThanOrEqual(600);
  expect(WORDS.easy.length).toBeGreaterThan(250);
  expect(WORDS.medium.length).toBeGreaterThan(200);
  expect(WORDS.hard.length).toBeGreaterThan(120);
  for (const w of ABSTRACT) expect(keys).not.toContain(canonKey(w).replace(/ /g, ''));
  expect(all.some((w) => canonKey(w) === 'burger')).toBe(false);
  expect(all).toContain('hamburger');
});

test('aliases match curated variants without loosening unrelated guesses', () => {
  expect(matchesAnswer('mustache', 'moustache')).toBe(true);
  expect(matchesAnswer('doughnut', 'donut')).toBe(true);
  expect(matchesAnswer('burger', 'hamburger')).toBe(true);
  expect(matchesAnswer('bunny', 'rabbit')).toBe(true);
  expect(matchesAnswer('ladybird', 'ladybug')).toBe(true);
  expect(matchesAnswer('rhino', 'rhinoceros')).toBe(true);
  expect(matchesAnswer('MUSTACHE', 'moustache')).toBe(true);
  expect(matchesAnswer('cat', 'dog')).toBe(false);
  expect(matchesAnswer('house', 'horse')).toBe(false);
  expect(matchesAnswer('car', 'cat')).toBe(false);
  expect(matchesAnswer('ice-cream', 'ice cream')).toBe(true);
  expect(matchesAnswer('icecream', 'ice cream')).toBe(true);
  // Related concepts are not answers.
  for (const [guess, word] of [
    ['wedding', 'bride and groom'], ['birthday', 'birthday cake'], ['electricity', 'light bulb'],
    ['video game', 'game controller'], ['satellite', 'satellite dish'], ['cuckoo', 'cuckoo clock'],
  ]) expect(matchesAnswer(guess, word)).toBe(false);
  for (const [alias, canon] of Object.entries(ALIASES)) {
    expect(canonKey(alias)).toBe(canonKey(canon));
  }
});

test('no alias collides with a different DEFAULT prompt', () => {
  const prompts = new Map(allDefaultWords().map((w) => [canonKey(w), w]));
  for (const [alias, canon] of Object.entries(ALIASES)) {
    const target = prompts.get(canonKey(canon));
    expect(target).toBeTruthy();
    const hit = prompts.get(norm(alias));
    if (hit) expect(canonKey(hit)).toBe(canonKey(canon));
  }
});

test('answer mentions use whole words, aliases and plurals', () => {
  expect(mentionsAnswer('lol bunnies', 'rabbit')).toBe(true);
  expect(mentionsAnswer('lol bunny', 'rabbit')).toBe(true);
  expect(mentionsAnswer('so many ELEPHANTS', 'elephant')).toBe(true);
  expect(mentionsAnswer('big ice cream cone', 'ice cream')).toBe(true);
  expect(mentionsAnswer('a giant', 'ant')).toBe(false);
  expect(mentionsAnswer('that hat', 'cat')).toBe(false);
});

test('custom words dedupe by canonical answer and keep the first label', () => {
  expect(dedupeCustom('burger, hamburger, Hamburger ,ham burger')).toEqual(['burger']);
  expect(dedupeCustom('Ice Cream\nicecream, x, my friend Sam')).toEqual(['ice cream', 'my friend sam']);
  expect(dedupeCustom(['wedding', 'bride and groom'])).toEqual(['wedding', 'bride and groom']);
  expect(dedupeCustom(Array.from({ length: 900 }, (_, i) => `w${i}`))).toHaveLength(500);
});
