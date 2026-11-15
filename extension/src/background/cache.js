/**
 * TransPop — tiny in-memory LRU cache for translation results (pure, Node-testable).
 * Lives in the service worker's memory, so it is naturally cleared when the worker is suspended.
 */
import { LIMITS } from '../shared/constants.js';

export class LRUCache {
  /** @param {number} [max=LIMITS.CACHE_MAX] maximum number of entries */
  constructor(max = LIMITS.CACHE_MAX) {
    this.max = Math.max(1, Math.floor(max) || 1);
    this.map = new Map();
  }

  get size() {
    return this.map.size;
  }

  has(key) {
    return this.map.has(key);
  }

  /** Get a value and mark it as most recently used. */
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /** Insert/replace a value as most recently used, evicting the least recently used entries. */
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return this;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  keys() {
    return [...this.map.keys()];
  }
}

/**
 * Cache key `provider|from|to|text` (ARCHITECTURE §5). When smart swap is active the `to` part is
 * `target>swapTo`, so changing the secondary language never serves a stale swapped result.
 */
export function makeCacheKey({ provider, from = 'auto', to, swapTo, text }) {
  const target = swapTo ? `${to}>${swapTo}` : to;
  return `${provider}|${from || 'auto'}|${target}|${String(text ?? '').trim()}`;
}
