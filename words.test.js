import { expect, test } from 'bun:test';
import { WORDS, ALIASES, allDefaultWords, canonKey, matchesAnswer, mentionsAnswer, dedupeCustom, singulars, stripWrapper } from './words.js';
import { NEW_WORDS } from './words-new.js';
import { norm } from './public/shared.js';

const ABSTRACT = ['procrastination', 'deja vu', 'nostalgia', 'sarcasm', 'homework', 'recycling', 'meditation', 'airplane mode', 'monday'];

test('curated bank has variety, unique answers and labels supported by the word protocol', () => {
  const all = allDefaultWords();
  const keys = all.map((w) => canonKey(w).replace(/ /g, ''));
  expect(new Set(keys).size).toBe(all.length);
  // Editorial curation may remove weak clues; never require padding each tier.
  expect(all.length).toBeGreaterThanOrEqual(2000);
  expect(WORDS.easy.length).toBeGreaterThanOrEqual(500);
  expect(WORDS.medium.length).toBeGreaterThanOrEqual(700);
  expect(WORDS.hard.length).toBeGreaterThanOrEqual(500);
  for (const w of all) {
    expect(w.length).toBeLessThanOrEqual(40);
    expect(norm(w).split(' ').length).toBeLessThanOrEqual(5);
    expect(mentionsAnswer(`hint: ${w}`, w)).toBe(true);
  }
  for (const w of ABSTRACT) expect(keys).not.toContain(canonKey(w).replace(/ /g, ''));
  expect(all.some((w) => canonKey(w) === 'burger')).toBe(false);
  expect(all).toContain('hamburger');
});

test('difficulty follows visual detail and removed clues do not return', () => {
  for (const w of ['cat', 'refrigerator', 'flamingo', 'rocking chair']) expect(WORDS.easy).toContain(w);
  for (const w of ['ferris wheel', 'brushing teeth', 'dinosaur skeleton']) expect(WORDS.medium).toContain(w);
  for (const w of ['solar eclipse', 'dinosaur chasing a car', 'astronaut riding a horse']) expect(WORDS.hard).toContain(w);
  const all = allDefaultWords();
  for (const w of [
    'jaguar', 'salmon', 'architect', 'time traveler', 'cinderella', 'hiccups',
    'barking up the wrong tree', 'let the cat out of the bag', 'skipping rope', 'popsicle',
    'juggler', 'dog walker',
  ]) expect(all).not.toContain(w);
});

test('equivalent names, regional vocabulary, plurals and action phrasings are accepted', () => {
  for (const [guess, word] of [
    ['fridge', 'refrigerator'], ['sofa', 'couch'], ['orca', 'killer whale'],
    ['postman', 'mailman'], ['fireman', 'firefighter'], ['fire engine', 'fire truck'],
    ['paper airplane', 'paper plane'], ['skipping rope', 'jump rope'], ['popsicle', 'ice pop'],
    ['ping pong', 'table tennis'], ['table tennis paddle', 'ping pong paddle'],
    ['spanner', 'wrench'], ['torch', 'flashlight'], ['aubergine', 'eggplant'],
    ['capsicum', 'bell pepper'], ['rubbish bin', 'trash can'], ['remote', 'remote control'],
    ['cotton bud', 'cotton swab'], ['mice', 'mouse'], ['teeth', 'tooth'],
    ['knives', 'knife'], ['apples', 'apple'], ['snowmen', 'snowman'],
    ['brushing your teeth', 'brushing teeth'], ['riding a bicycle', 'riding a bike'],
    ['penguin on a bike', 'penguin riding a bicycle'],
  ]) expect(matchesAnswer(guess, word)).toBe(true);
  for (const [guess, word] of [
    ['alligator', 'crocodile'], ['rugby ball', 'american football'],
    ['fir tree', 'pine tree'], ['pteranodon', 'pterodactyl'],
    ['tissue', 'tissue box'], ['computer monitor', 'computer'],
  ]) expect(matchesAnswer(guess, word)).toBe(false);
  expect(dedupeCustom('fridge,refrigerator,sofa,couch')).toEqual(['fridge', 'sofa']);
});

test('review corrections accept familiar answers and keep distinct drawings separate', () => {
  for (const [guess, word] of [
    ['geese', 'goose'], ['scarves', 'scarf'], ['shelves', 'shelf'],
    ['bookshelves', 'bookshelf'], ['potatoes', 'potato'], ['tomatoes', 'tomato'],
    ['brinjal', 'eggplant'], ['nappy', 'diaper'], ['tap', 'faucet'],
    ['drum kit', 'drum set'], ['crane', 'construction crane'],
    ['spring', 'coil spring'], ['tank', 'army tank'], ['match', 'matchstick'],
    ['aquarium', 'fish tank'], ['jeans', 'pants'], ['jumping rope', 'jump rope'],
    ['debit card', 'bank card'], ['rupee note', 'banknote'],
  ]) expect(matchesAnswer(guess, word)).toBe(true);
  for (const [guess, word] of [
    ['sea lion balancing ball', 'seal balancing a ball'],
    ['football', 'american football'], ['football', 'soccer ball'],
    ['brush', 'hairbrush'], ['brush', 'paintbrush'],
    ['motor scooter', 'kick scooter'], ['fish tank', 'army tank'],
    ['comet', 'shooting star'], ['rocket', 'spaceship'], ['boat', 'ship'],
  ]) expect(matchesAnswer(guess, word)).toBe(false);
  for (const alias of ['handcuffses', 'earmuffses', 'sunglasseses', 'test tubeses']) {
    expect(ALIASES).not.toHaveProperty(alias);
  }
  const all = allDefaultWords();
  for (const word of ['aquarium', 'jeans', 'jumping rope', 'time machine', 'power outage']) {
    expect(all).not.toContain(word);
  }
  expect(WORDS.easy).toContain('binoculars');
  expect(WORDS.medium).toContain('anvil');
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
    expect(mentionsAnswer(`hint: ${alias}`, canon)).toBe(true);
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

test('new word set: full tiers, drawable labels, no overlap with the legacy bank', () => {
  const legacy = new Set(allDefaultWords().map((w) => canonKey(w).replace(/[ -]/g, '')));
  const all = [...NEW_WORDS.easy, ...NEW_WORDS.medium, ...NEW_WORDS.hard];
  expect(NEW_WORDS.easy.length).toBeGreaterThanOrEqual(250);
  expect(NEW_WORDS.medium.length).toBeGreaterThanOrEqual(250);
  expect(NEW_WORDS.hard.length).toBeGreaterThanOrEqual(250);
  expect(new Set(all.map((w) => canonKey(w).replace(/[ -]/g, ''))).size).toBe(all.length);
  for (const w of all) {
    expect(w).toMatch(/^[a-z]+(?:[ -][a-z]+)*$/);
    expect(w.length).toBeLessThanOrEqual(40);
    expect(w.split(' ').length).toBeLessThanOrEqual(5);
    expect(mentionsAnswer(`hint: ${w}`, w)).toBe(true);
    expect(ALIASES).not.toHaveProperty(norm(w));
    expect(legacy.has(canonKey(w).replace(/[ -]/g, ''))).toBe(false);
    expect(ABSTRACT).not.toContain(w);
  }
});

test('one sentence wrapper around a single answer scores; lists and junk do not', () => {
  for (const [guess, word] of [
    ['is it a cat?', 'cat'], ['its the cat', 'cat'], ["it's a cat lol", 'cat'], ['i think its an apple', 'apple'],
    ['maybe cat', 'cat'], ['probably the fire truck pls', 'fire truck'], ['must be a rabbit bro', 'rabbit'],
    ['looks like bunnies', 'rabbit'], ['the cat', 'cat'], ['cat right', 'cat'], ['IS IT A FRIDGE', 'refrigerator'],
    ['Is it the floss?', 'the floss'], ['Is it swipe right?', 'swipe right'], ['maybe swipe right lol', 'swipe right'],
  ]) expect(matchesAnswer(guess, word)).toBe(true);
  for (const [guess, word] of [
    ['cat dog car', 'cat'], ['cat or dog', 'cat'], ['is it not a cat', 'cat'], ['maybe maybe cat', 'cat'],
    ['is it', 'its'], ['a', 'cat'], ['lol', 'cat'], ['is it swipe right', 'swipe left'],
  ]) expect(matchesAnswer(guess, word)).toBe(false);
  // A list still mentions the answer, so it is held back as a spoiler.
  expect(mentionsAnswer('cat dog car', 'cat')).toBe(true);
  expect(stripWrapper('Is it a big cat, please?')).toBe('big cat');
});

test('regular plurals match in both directions for any word, without fuzzy wins', () => {
  for (const [guess, word] of [
    ['flash drives', 'flash drive'], ['berries', 'berry'], ['wolves', 'wolf'], ['knives', 'knife'],
    ['glasses', 'glass'], ['glass', 'glasses'], ['buses', 'bus'], ['boxes', 'box'], ['shoes', 'shoe'],
    ['heroes', 'hero'], ['my friend sams', 'my friend sam'], ['memes', 'meme'], ['is it wolves', 'wolf'],
    ['cds', 'cd'], ['CDs', 'cd'], ['tvs', 'tv'], ['oxes', 'ox'], ['big pcs', 'big pc'],
  ]) expect(matchesAnswer(guess, word)).toBe(true);
  for (const [guess, word] of [
    ['catz', 'cat'], ['ca', 'cat'], ['bu', 'bus'], ['octopu', 'octopus'], ['iri', 'iris'], ['glas', 'glass'],
    ['berri', 'berry'], ['wolfs', 'wolves'], ['glasse', 'glasses'], ['glasse', 'glass'], ['as', 'a'], ['is', 'i'], ['ga', 'gas'], ['cd', 'cds'],
    ['vitamin cs', 'vitamin c'], ['pies', 'pi'],
  ]) expect(matchesAnswer(guess, word)).toBe(false);
  // Stubs are never stripped: short words and -ss/-us/-is endings.
  for (const w of ['as', 'is', 'gas', 'bus', 'iris', 'glass', 'cactus']) expect(singulars(w)).toEqual([]);
  expect(mentionsAnswer('so many flash drives here', 'flash drive')).toBe(true);
  expect(mentionsAnswer('wolves everywhere', 'wolf')).toBe(true);
  expect(mentionsAnswer('CDs or DVDs', 'cd')).toBe(true);
  expect(mentionsAnswer('is it the cd', 'cd')).toBe(true);
  expect(mentionsAnswer('this is a gas', 'as')).toBe(false);
});

test('generated plurals never resolve through aliases; split spellings and article answers still match', () => {
  expect(matchesAnswer('slacks', 'slack')).toBe(true);
  expect(matchesAnswer('pants', 'slack')).toBe(false);
  expect(mentionsAnswer('my pants got wet', 'slack')).toBe(false);
  expect(mentionsAnswer('r ab bit or dog', 'rabbit')).toBe(true);
  expect(matchesAnswer('is it the floss please', 'the floss')).toBe(true);
  expect(matchesAnswer('the floss pls', 'the floss')).toBe(true);
  expect(matchesAnswer('is it a cat lol', 'cat')).toBe(true);
});

test('answer mentions find long answers and aliases inside longer lists', () => {
  expect(mentionsAnswer('a dog with a red hat or cat', 'a dog with a red hat')).toBe(true);
  expect(mentionsAnswer('maybe a dog with a red hat', 'a dog with a red hat')).toBe(true);
  expect(mentionsAnswer('a dog with a blue hat or cat', 'a dog with a red hat')).toBe(false);
  expect(mentionsAnswer('cup cake or pie', 'cupcake')).toBe(true);
  expect(mentionsAnswer('lol x marks the spot or gold', 'treasure map')).toBe(true);
  const long = 'my grandmas famous lemon pie recipe';
  expect(mentionsAnswer(`lol ${long}s or toast`, long)).toBe(true);
});
