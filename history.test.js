import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WordHistory } from './history.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'squiggle-history-'));

test('history round-trips through disk, prunes unknown keys and writes atomically', async () => {
  const dir = tmp(), path = join(dir, 'nested', 'word-history.json');
  const valid = new Set(['cat', 'dog', 'robot dog']);
  const h = new WordHistory({ path, valid, delay: 5 });
  expect(h.get('cat')).toBe(0);
  h.mark(['cat', 'robot dog'], 1000);
  h.mark(['cat'], 2000);
  await Bun.sleep(40); // debounced write
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ cat: 2000, 'robot dog': 1000 });
  expect(readdirSync(join(dir, 'nested'))).toEqual(['word-history.json']);
  writeFileSync(path, JSON.stringify({ cat: 2000, gone: 5, dog: 'x' }));
  const back = new WordHistory({ path, valid });
  expect([...back.seen]).toEqual([['cat', 2000]]);
});

test('a missing or corrupt file starts empty; no path means memory only', () => {
  const dir = tmp();
  expect(new WordHistory({ path: join(dir, 'none.json') }).seen.size).toBe(0);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{not json');
  const h = new WordHistory({ path: bad });
  expect(h.seen.size).toBe(0);
  h.mark(['cat'], 1); h.flush();
  expect(JSON.parse(readFileSync(bad, 'utf8'))).toEqual({ cat: 1 });
  const mem = new WordHistory();
  mem.mark(['cat'], 1); mem.flush();
  expect(mem.get('cat')).toBe(1);
  expect(existsSync(join(dir, 'data'))).toBe(false);
});
