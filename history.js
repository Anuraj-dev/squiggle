// Server-wide "last shown on a card" memory: { canonKey: lastSeenMs }.
// One entry per deck answer, overwritten on every deal, so the file never
// grows past the bank. Writes are debounced and atomic (tmp + rename); a
// missing or corrupt file starts empty. Without a path it is in-memory only
// (tests). Custom words never come through here: rooms keep those themselves.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class WordHistory {
  // `valid`: keys worth keeping; anything else in the file is pruned at load.
  constructor({ path = null, valid = null, delay = 1000 } = {}) {
    this.path = path;
    this.delay = delay;
    this.seen = new Map();
    this.timer = null;
    this.failed = false;
    if (!path) return;
    let data = null;
    try { data = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
      if (e.code !== 'ENOENT') console.warn(`[history] ignoring unreadable ${path}: ${e.message}`);
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [k, v] of Object.entries(data)) {
        if (Number.isFinite(v) && (!valid || valid.has(k))) this.seen.set(k, v);
      }
    }
  }

  get(key) { return this.seen.get(key) || 0; }

  mark(keys, ms) {
    for (const k of keys) this.seen.set(k, ms);
    if (this.path && !this.timer) {
      this.timer = setTimeout(() => this.flush(), this.delay);
      this.timer.unref?.();
    }
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.path) return;
    const tmp = `${this.path}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.seen)));
      renameSync(tmp, this.path);
    } catch (e) {
      if (!this.failed) console.warn(`[history] could not save ${this.path}: ${e.message}`);
      this.failed = true;
    }
  }
}
