import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTtsUrls, chunkText, clampRate, toBcp47, ttsLang } from '../../extension/src/background/tts.js';

const words = (s) => s.split(/\s+/).filter(Boolean);

test('chunkText: short text is a single normalized chunk', () => {
  assert.deepEqual(chunkText('  Hello   world \n '), ['Hello world']);
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText(null), []);
});

test('chunkText: long text splits at sentence boundaries, every chunk ≤ max, no words lost', () => {
  const sentence = 'The quick brown fox jumps over the lazy dog near the river bank. ';
  const text = sentence.repeat(12);
  const chunks = chunkText(text, 200);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 200));
  assert.ok(chunks.every((c) => c.endsWith('.')), 'cut after full stops');
  assert.deepEqual(words(chunks.join(' ')), words(text));
});

test('chunkText: falls back to clause, then word boundaries, then a hard cut', () => {
  const clauses = Array.from({ length: 30 }, (_, i) => `clause number ${i}`).join(', ');
  const c1 = chunkText(clauses, 100);
  assert.ok(c1.every((c) => c.length <= 100));
  assert.ok(c1.slice(0, -1).every((c) => c.endsWith(',')));

  const plain = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
  const c2 = chunkText(plain, 50);
  assert.ok(c2.every((c) => c.length <= 50));
  assert.deepEqual(words(c2.join(' ')), words(plain));

  const blob = 'x'.repeat(450);
  assert.deepEqual(
    chunkText(blob, 200).map((c) => c.length),
    [200, 200, 50],
  );
});

test('chunkText: CJK punctuation and surrogate pairs', () => {
  const zh = '今天天气很好。'.repeat(40);
  const chunks = chunkText(zh, 200);
  assert.ok(chunks.every((c) => c.length <= 200 && c.endsWith('。')));
  assert.equal(chunks.join(''), zh);

  const emoji = '😀'.repeat(150); // 300 UTF-16 code units, no boundaries
  const e = chunkText(emoji, 101);
  assert.ok(e.every((c) => c.length <= 101));
  assert.equal(e.join(''), emoji);
  assert.ok(e.every((c) => !/[\uD800-\uDBFF]$/.test(c)), 'never ends with a lone high surrogate');
});

test('buildTtsUrls: translate_tts URLs with tw-ob client, normalized language', () => {
  const urls = buildTtsUrls('Xin chào thế giới', 'vi');
  assert.equal(urls.length, 1);
  const u = new URL(urls[0]);
  assert.equal(u.origin + u.pathname, 'https://translate.google.com/translate_tts');
  assert.equal(u.searchParams.get('client'), 'tw-ob');
  assert.equal(u.searchParams.get('ie'), 'UTF-8');
  assert.equal(u.searchParams.get('tl'), 'vi');
  assert.equal(u.searchParams.get('q'), 'Xin chào thế giới');

  assert.equal(new URL(buildTtsUrls('hi', 'auto')[0]).searchParams.get('tl'), 'en');
  assert.equal(new URL(buildTtsUrls('shalom', 'he')[0]).searchParams.get('tl'), 'iw');
  assert.equal(buildTtsUrls('a. '.repeat(300), 'en').length > 1, true);
  assert.deepEqual(buildTtsUrls('   ', 'en'), []);
});

test('ttsLang / toBcp47 / clampRate', () => {
  assert.equal(ttsLang('zh-cn'), 'zh-CN');
  assert.equal(ttsLang(undefined), 'en');
  assert.equal(toBcp47('iw'), 'he');
  assert.equal(toBcp47('vi'), 'vi');
  assert.equal(clampRate(3), 1.5);
  assert.equal(clampRate(0.1), 0.5);
  assert.equal(clampRate('x'), 1);
});
