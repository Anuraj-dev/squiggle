import { expect, test } from 'bun:test';
import { shareMetrics, galleryCols } from './public/share.js';

test('gallery columns grow with the number of drawings', () => {
  expect([1, 4, 5, 9, 10, 20, 21].map(galleryCols)).toEqual([2, 2, 3, 3, 4, 4, 5]);
});

test('layout stacks sections top to bottom without overlap', () => {
  const m = shareMetrics(6, 4, 12);
  expect(m.lb.cols).toBe(2);
  expect(m.aw.y).toBeGreaterThan(m.lb.y + m.lb.h);
  expect(m.gal.headY).toBeGreaterThan(m.aw.y + m.aw.h);
  expect(m.gal.y).toBeGreaterThan(m.gal.headY);
  expect(m.height).toBeGreaterThan(m.gal.y + 3 * m.gal.rowH);
  expect(m.scale).toBe(1);
  expect(m.gal.tileH).toBe(Math.round((m.gal.tileW * 3) / 4));
});

test('sections that have no content take no space', () => {
  const none = shareMetrics(2, 0, 0);
  expect(none.aw.h).toBe(0);
  expect(none.height).toBeLessThan(shareMetrics(2, 3, 0).height);
  expect(shareMetrics(2, 0, 4).height).toBeGreaterThan(none.height);
});

test('a very long game is scaled down to stay inside canvas limits', () => {
  const m = shareMetrics(20, 6, 200);
  expect(m.scale).toBeLessThan(1);
  expect(m.width * m.scale * m.height * m.scale).toBeLessThanOrEqual(16e6 + 1);
  expect(m.height * m.scale).toBeLessThanOrEqual(16000);
});

test('gallery MVPs get their own section between awards and the gallery', () => {
  const without = shareMetrics(4, 3, 6);
  const one = shareMetrics(4, 3, 6, 1);
  expect(without.mvp.cols).toBe(0);
  expect(without.gal.headY).toBe(one.mvp.headY);
  expect(one.mvp.headY).toBeGreaterThan(one.aw.y + one.aw.h);
  expect(one.gal.headY).toBeGreaterThan(one.mvp.y + one.mvp.rowH);
  expect(one.height).toBeGreaterThan(without.height);
  const tie = shareMetrics(4, 3, 6, 4); // ties wrap three per row
  expect(tie.mvp.cols).toBe(3);
  expect(tie.gal.headY).toBeGreaterThan(tie.mvp.y + 2 * tie.mvp.rowH);
  expect(tie.mvp.tileW).toBeLessThanOrEqual(560);
});
