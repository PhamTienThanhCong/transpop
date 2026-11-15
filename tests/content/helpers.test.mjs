/**
 * Unit tests for the content script's pure helpers (extension/src/content/core.js + languages.js).
 * The content scripts are classic scripts sharing `globalThis.__transpopContent`, so we evaluate them
 * in a fresh vm context (no DOM needed) and read the namespace back.
 *
 *   node --test tests/content/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(ROOT, 'extension/src/content', f), 'utf8');

function load({ uiLang = 'en', files = ['core.js', 'languages.js'] } = {}) {
  const ctx = vm.createContext({
    chrome: { runtime: { id: 'test-extension' }, i18n: { getUILanguage: () => uiLang, getMessage: () => '' } },
  });
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  return { ctx, G: ctx.__transpopContent };
}

const { G } = load();
const U = G.util;
const VP = { width: 1000, height: 800 };
/** Objects created inside the vm context have a foreign Object.prototype → compare as plain data. */
const plain = (x) => JSON.parse(JSON.stringify(x));

test('cleanText normalizes whitespace and invisible characters', () => {
  assert.equal(U.cleanText('  hello   world \t'), 'hello world');
  assert.equal(U.cleanText('a\r\nb'), 'a\nb');
  assert.equal(U.cleanText('p1\n\n\n\n p2 '), 'p1\n\np2');
  assert.equal(U.cleanText('co­op​eration'), 'cooperation');
  assert.equal(U.cleanText(null), '');
  assert.equal(U.cleanText('   '), '');
});

test('isTranslatable accepts words and rejects numbers, URLs, e-mails, too long', () => {
  assert.equal(U.isTranslatable('obvious'), true);
  assert.equal(U.isTranslatable('Xin chào'), true);
  assert.equal(U.isTranslatable('你好'), true);
  assert.equal(U.isTranslatable('a'), true);
  assert.equal(U.isTranslatable('10km'), true);
  assert.equal(U.isTranslatable(''), false);
  assert.equal(U.isTranslatable('12,345.67'), false);
  assert.equal(U.isTranslatable('— … !!'), false);
  assert.equal(U.isTranslatable('https://example.com/path?q=1'), false);
  assert.equal(U.isTranslatable('www.example.com'), false);
  assert.equal(U.isTranslatable('someone@example.com'), false);
  assert.equal(U.isTranslatable('x'.repeat(2000)), true);
  assert.equal(U.isTranslatable('x'.repeat(2001)), false);
  assert.equal(U.isTranslatable('x'.repeat(4000), 5000), true);
});

test('sameText ignores case and whitespace', () => {
  assert.equal(U.sameText('Hello  World', 'hello world'), true);
  assert.equal(U.sameText('a\nb', 'a b'), true);
  assert.equal(U.sameText('', ''), false);
  assert.equal(U.sameText('a', 'b'), false);
});

test('isHostDisabled matches exact host and subdomains (www-insensitive)', () => {
  const sites = ['example.com', 'news.site.org'];
  assert.equal(U.isHostDisabled(['example.com'], sites), true);
  assert.equal(U.isHostDisabled(['www.example.com'], sites), true);
  assert.equal(U.isHostDisabled(['docs.example.com'], sites), true);
  assert.equal(U.isHostDisabled(['badexample.com'], sites), false);
  assert.equal(U.isHostDisabled(['site.org'], sites), false);
  assert.equal(U.isHostDisabled(['a.news.site.org'], sites), true);
  assert.equal(U.isHostDisabled(['', 'https://example.com'], sites), true, 'top-level origin of an about:blank frame');
  assert.equal(U.isHostDisabled(['example.com'], []), false);
  assert.equal(U.isHostDisabled(['example.com'], undefined), false);
});

test('splitBold renders only <b> as bold, strips other tags, decodes entities', () => {
  assert.deepEqual(plain(U.splitBold('it was <b>obvious</b> that')), [
    { text: 'it was ', bold: false },
    { text: 'obvious', bold: true },
    { text: ' that', bold: false },
  ]);
  assert.deepEqual(plain(U.splitBold('<B>Big</B> &amp; <i>small</i> &#39;x&#x27;')), [
    { text: 'Big', bold: true },
    { text: " & small 'x'", bold: false },
  ]);
  assert.deepEqual(plain(U.splitBold('<img src=x onerror=alert(1)>safe')), [{ text: 'safe', bold: false }]);
  assert.deepEqual(plain(U.splitBold('&lt;b&gt;literal&lt;/b&gt;')), [{ text: '<b>literal</b>', bold: false }]);
  assert.deepEqual(plain(U.splitBold('')), []);
});

test('placeBubble: below the selection when there is room', () => {
  const anchor = { left: 100, right: 160, top: 100, bottom: 120 };
  const p = U.placeBubble(anchor, { width: 320, height: 200 }, VP);
  assert.equal(p.placement, 'below');
  assert.equal(p.top, 128);
  assert.equal(p.left, 8, 'clamped to the left edge');
  assert.equal(p.maxHeight, null);
});

test('placeBubble: flips above when there is no room below', () => {
  const anchor = { left: 500, right: 540, top: 700, bottom: 720 };
  const p = U.placeBubble(anchor, { width: 320, height: 300 }, VP);
  assert.equal(p.placement, 'above');
  assert.equal(p.top, 700 - 8 - 300);
  assert.equal(p.left, Math.round(520 - 160));
});

test('placeBubble: constrained height on the roomier side', () => {
  const anchor = { left: 500, right: 540, top: 300, bottom: 320 };
  const p = U.placeBubble(anchor, { width: 320, height: 600 }, VP);
  assert.equal(p.placement, 'below');
  assert.equal(p.top, 328);
  assert.equal(p.maxHeight, 800 - 8 - 328);
});

test('placeBubble: overlay for huge selections, always on-screen', () => {
  const anchor = { left: 0, right: 1000, top: 20, bottom: 780 };
  const p = U.placeBubble(anchor, { width: 380, height: 400 }, VP);
  assert.equal(p.placement, 'overlay');
  assert.ok(p.top >= 8 && p.top + Math.min(400, p.maxHeight) <= 792);
});

test('placeBubble: off-screen anchors and right edge are clamped', () => {
  const above = U.placeBubble({ left: 990, right: 995, top: -300, bottom: -280 }, { width: 400, height: 200 }, VP);
  assert.equal(above.top, 8);
  assert.equal(above.left, 1000 - 8 - 400);
  const below = U.placeBubble({ left: 10, right: 20, top: 2000, bottom: 2020 }, { width: 300, height: 200 }, VP);
  assert.equal(below.top, 800 - 8 - 200);
});

test('placeBubble: tiny viewport (small iframe) never goes negative', () => {
  const p = U.placeBubble({ left: 10, right: 50, top: 10, bottom: 30 }, { width: 300, height: 400 }, { width: 250, height: 150 });
  assert.ok(p.left >= 8 && p.top >= 8);
  assert.ok(p.maxHeight <= 150 - 16);
});

test('placeBubble: prefers the mouse x as horizontal centre', () => {
  const p = U.placeBubble({ left: 100, right: 900, top: 100, bottom: 160 }, { width: 300, height: 200 }, VP, { prefX: 700 });
  assert.equal(p.left, 550);
});

test('placeTrigger: below-right of the cursor, under the selected line', () => {
  const p = U.placeTrigger({ point: { x: 300, y: 110 }, line: { left: 200, right: 300, top: 100, bottom: 120 } }, VP);
  assert.deepEqual(plain(p), { left: 306, top: 126 });
});

test('placeTrigger: above the line for upward drags and at the bottom edge', () => {
  const line = { left: 200, right: 300, top: 100, bottom: 120 };
  assert.equal(U.placeTrigger({ point: { x: 300, y: 110 }, line, upward: true }, VP).top, 100 - 6 - 30);
  const bottom = { left: 200, right: 300, top: 770, bottom: 790 };
  assert.equal(U.placeTrigger({ point: { x: 300, y: 780 }, line: bottom }, VP).top, 770 - 6 - 30);
});

test('placeTrigger: flips to the left of the cursor at the right edge', () => {
  const p = U.placeTrigger({ point: { x: 990, y: 110 }, line: { left: 900, right: 990, top: 100, bottom: 120 } }, VP);
  assert.equal(p.left, 990 - 6 - 30);
});

test('pickLineRect picks the line under the pointer, or the last line', () => {
  const rects = [
    { left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 },
    { left: 0, right: 0, top: 20, bottom: 20, width: 0, height: 0 },
    { left: 0, right: 80, top: 20, bottom: 40, width: 80, height: 20 },
  ];
  assert.equal(U.pickLineRect(rects, 30), rects[2]);
  assert.equal(U.pickLineRect(rects, 5), rects[0]);
  assert.equal(U.pickLineRect(rects, 500), rects[2]);
  assert.equal(U.pickLineRect(rects, null), rects[2]);
  assert.equal(U.pickLineRect([], 10), null);
});

test('countWords handles spaced and CJK text', () => {
  assert.equal(U.countWords('obvious'), 1);
  assert.equal(U.countWords('take it easy'), 3);
  assert.equal(U.countWords('a quick brown fox'), 4);
  assert.ok(U.countWords('你好') <= 2);
  assert.equal(U.countWords('   '), 0);
});

test('language names follow the UI locale with Google→BCP-47 display codes', () => {
  const vi = load({ uiLang: 'vi' }).G.lang;
  assert.equal(vi.name('en'), 'Tiếng Anh');
  const en = G.lang;
  assert.equal(en.name('vi'), 'Vietnamese');
  assert.equal(en.name('iw'), 'Hebrew');
  assert.equal(en.name('zh-TW'), 'Traditional Chinese');
  assert.equal(en.name('jw'), 'Javanese');
  assert.equal(en.name('auto'), '');
  assert.equal(en.name('xx-unknown'), 'xx-unknown');
  assert.equal(en.normalize('he'), 'iw');
  assert.equal(en.normalize('pt-BR'), 'pt');
  assert.equal(en.normalize('zh-tw'), 'zh-TW');
  assert.equal(en.bcp47('zh-CN'), 'zh-Hans');
  assert.equal(en.options().length, 133);
});

test('double-injection guard keeps a healthy instance and replaces an orphaned one', () => {
  const { ctx, G: first } = load();
  first.started = true;
  vm.runInContext(read('core.js'), ctx);
  assert.equal(ctx.__transpopContent, first, 'healthy instance kept');

  let destroyed = false;
  first.destroy = () => {
    destroyed = true;
  };
  ctx.chrome.runtime.id = undefined; // extension reloaded → context invalidated
  vm.runInContext(read('core.js'), ctx);
  assert.equal(destroyed, true);
  assert.notEqual(ctx.__transpopContent, first, 'orphan replaced');
  assert.equal(ctx.__transpopContent.started, false);
});
