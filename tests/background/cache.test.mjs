import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LRUCache, makeCacheKey } from '../../extension/src/background/cache.js';
import { LIMITS } from '../../extension/src/shared/constants.js';

test('LRUCache: evicts the least recently used entry', () => {
  const c = new LRUCache(3);
  c.set('a', 1).set('b', 2).set('c', 3);
  c.set('d', 4);
  assert.equal(c.has('a'), false);
  assert.deepEqual(c.keys(), ['b', 'c', 'd']);
  assert.equal(c.size, 3);
});

test('LRUCache: get() refreshes recency, set() on an existing key updates and refreshes', () => {
  const c = new LRUCache(3);
  c.set('a', 1).set('b', 2).set('c', 3);
  assert.equal(c.get('a'), 1);
  c.set('d', 4); // evicts b (a was refreshed)
  assert.deepEqual(c.keys(), ['c', 'a', 'd']);
  c.set('c', 30);
  c.set('e', 5); // evicts a
  assert.deepEqual(c.keys(), ['d', 'c', 'e']);
  assert.equal(c.get('c'), 30);
  assert.equal(c.get('missing'), undefined);
});

test('LRUCache: delete / clear / defaults', () => {
  const c = new LRUCache();
  assert.equal(c.max, LIMITS.CACHE_MAX);
  for (let i = 0; i < LIMITS.CACHE_MAX + 25; i++) c.set(`k${i}`, i);
  assert.equal(c.size, LIMITS.CACHE_MAX);
  assert.equal(c.has('k0'), false);
  assert.equal(c.has(`k${LIMITS.CACHE_MAX + 24}`), true);
  assert.equal(c.delete(`k${LIMITS.CACHE_MAX + 24}`), true);
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(new LRUCache(0).max, 1);
});

test('makeCacheKey: provider|from|to|text, swap folded into `to`', () => {
  assert.equal(makeCacheKey({ provider: 'google', from: 'auto', to: 'vi', text: '  hello ' }), 'google|auto|vi|hello');
  assert.equal(makeCacheKey({ provider: 'google', to: 'vi', swapTo: 'en', text: 'hello' }), 'google|auto|vi>en|hello');
  assert.notEqual(
    makeCacheKey({ provider: 'google', to: 'vi', text: 'Hello' }),
    makeCacheKey({ provider: 'microsoft', to: 'vi', text: 'Hello' }),
  );
});
