/**
 * Unit tests for the image-translation helpers of the content script (extension/src/content/crop.js → G.cropUtil).
 * Like helpers.test.mjs, the classic scripts are evaluated in a vm context (no DOM: crop.js touches none at load).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OCR_LANGUAGES, normalizeOcrLanguages } from '../../extension/src/shared/ocr-languages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(ROOT, 'extension/src/content', f), 'utf8');

function load() {
  const ctx = vm.createContext({
    chrome: { runtime: { id: 'test-extension' }, i18n: { getUILanguage: () => 'en', getMessage: () => '' } },
  });
  for (const f of ['core.js', 'languages.js', 'crop.js']) vm.runInContext(read(f), ctx, { filename: f });
  return ctx.__transpopContent;
}

const G = load();
const CU = G.cropUtil;
const plain = (x) => JSON.parse(JSON.stringify(x));
const VP = { width: 1000, height: 800 };

test('crop.js registers its API without touching the DOM at load', () => {
  assert.equal(typeof G.crop.start, 'function');
  assert.equal(typeof G.crop.prepare, 'function');
  assert.equal(G.crop.isActive(), false);
  assert.equal(G.MSG.START_CROP, 'start-crop');
  assert.equal(G.MSG.OCR_REGION, 'ocr-region');
  assert.ok(G.ERROR_CODES.includes('OCR_NO_TEXT'));
  assert.deepEqual(plain(G.DEFAULT_SETTINGS.ocrLanguages), ['eng']);
});

test('OCR language list matches src/shared/ocr-languages.js (keep-in-sync guard)', () => {
  assert.deepEqual(
    plain(CU.OCR_LANGUAGES),
    OCR_LANGUAGES.map((l) => [l.ocr, l.lang]),
  );
  for (const list of [undefined, [], ['eng'], ['jpn', 'eng', 'jpn'], ['x', 'vie'], ['vie', 'eng', 'jpn', 'kor'], 'eng']) {
    assert.deepEqual(plain(CU.normalizeOcrLangs(list)), normalizeOcrLanguages(list), JSON.stringify(list));
  }
  assert.equal(CU.ocrToLang('jpn'), 'ja');
  assert.equal(CU.ocrToLang('heb'), 'iw');
  assert.equal(CU.ocrToLang('nope'), null);
});

test('dragRect works in every drag direction', () => {
  assert.deepEqual(plain(CU.dragRect({ x: 10, y: 20 }, { x: 110, y: 70 })), { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(plain(CU.dragRect({ x: 110, y: 70 }, { x: 10, y: 20 })), { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(plain(CU.dragRect({ x: 110, y: 20 }, { x: 10, y: 70 })), { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(plain(CU.dragRect({ x: 5, y: 5 }, { x: 5, y: 5 })), { x: 5, y: 5, width: 0, height: 0 });
});

test('clampRect keeps the visible part only; bigEnough enforces 12×12', () => {
  assert.deepEqual(plain(CU.clampRect({ x: -20, y: 790, width: 100, height: 50 }, VP)), { x: 0, y: 790, width: 80, height: 10 });
  assert.deepEqual(plain(CU.clampRect({ x: 900, y: 10, width: 300, height: 20 }, VP)), { x: 900, y: 10, width: 100, height: 20 });
  assert.deepEqual(plain(CU.clampRect({ x: 50, y: 50, width: -30, height: -20 }, VP)), { x: 20, y: 30, width: 30, height: 20 });
  assert.equal(CU.clampRect({ x: 1200, y: 10, width: 50, height: 50 }, VP), null);
  assert.equal(CU.clampRect({ x: 10, y: 10, width: 0, height: 50 }, VP), null);
  assert.equal(CU.clampRect(null, VP), null);

  assert.equal(CU.MIN_SIZE, 12);
  assert.equal(CU.bigEnough({ width: 12, height: 12 }), true);
  assert.equal(CU.bigEnough({ width: 11.9, height: 40 }), false);
  assert.equal(CU.bigEnough({ width: 5, height: 5 }, 4), true);
  assert.equal(CU.bigEnough(null), false);
  assert.equal(CU.sizeLabel({ width: 320.4, height: 47.6 }), '320 × 48');
});

test('toCaptureGeometry: CSS px rect + innerWidth/innerHeight; pinch-zoom maps to the visual viewport', () => {
  const rect = { x: 100.123, y: 50, width: 200, height: 40 };
  assert.deepEqual(plain(CU.toCaptureGeometry(rect, { innerWidth: 1280, innerHeight: 720, vv: { scale: 1, offsetLeft: 0, offsetTop: 0 } })), {
    rect: { x: 100.12, y: 50, width: 200, height: 40 },
    viewport: { width: 1280, height: 720 },
  });
  assert.deepEqual(plain(CU.toCaptureGeometry(rect, { innerWidth: 1280, innerHeight: 720, vv: null })).viewport, { width: 1280, height: 720 });
  // Pinch-zoomed 2× and panned by (300, 100): the screenshot shows the visual viewport only.
  assert.deepEqual(plain(CU.toCaptureGeometry({ x: 400, y: 150, width: 100, height: 20 }, { innerWidth: 1280, innerHeight: 720, vv: { scale: 2, offsetLeft: 300, offsetTop: 100 } })), {
    rect: { x: 200, y: 100, width: 200, height: 40 },
    viewport: { width: 1280, height: 720 },
  });
});

test('fromClientRect / visibleArea', () => {
  assert.deepEqual(plain(CU.fromClientRect({ left: 10, top: 20, right: 60, bottom: 30 })), { x: 10, y: 20, width: 50, height: 10 });
  assert.equal(CU.fromClientRect(null), null);
  assert.equal(CU.visibleArea({ left: -50, top: 0, right: 50, bottom: 10 }, VP), 500);
  assert.equal(CU.visibleArea({ left: 0, top: 900, right: 50, bottom: 950 }, VP), 0);
});

test('imageMatches: currentSrc or src, tolerant to URI encoding', () => {
  assert.equal(CU.imageMatches({ currentSrc: 'https://x.com/a.png', src: '' }, 'https://x.com/a.png'), true);
  assert.equal(CU.imageMatches({ currentSrc: '', src: 'https://x.com/a b.png' }, 'https://x.com/a%20b.png'), true);
  assert.equal(CU.imageMatches({ currentSrc: 'https://x.com/2x.png', src: 'https://x.com/1x.png' }, 'https://x.com/1x.png'), true);
  assert.equal(CU.imageMatches({ currentSrc: 'https://x.com/a.png' }, 'https://x.com/b.png'), false);
  assert.equal(CU.imageMatches({ currentSrc: 'https://x.com/%E0%A4%A.png' }, 'https://x.com/%E0%A4%A.png'), true, 'malformed URI still compares');
  assert.equal(CU.imageMatches(null, 'x'), false);
  assert.equal(CU.imageMatches({ src: 'x' }, ''), false);
});

test('pickImage: right-clicked image first, then the most visible match, never an off-screen one', () => {
  const img = (name, rect) => ({ node: name, src: `https://x.com/${name}.png`, currentSrc: '', rect });
  const a = img('a', { left: 0, top: 0, right: 100, bottom: 100 });
  const a2 = img('a', { left: 0, top: 600, right: 300, bottom: 1000 }); // same src, bigger visible part (300×200)
  const b = img('b', { left: 200, top: 0, right: 300, bottom: 50 });
  const off = img('a', { left: 0, top: 2000, right: 500, bottom: 2500 });
  const src = 'https://x.com/a.png';

  assert.equal(CU.pickImage({ target: a, images: [a2, b], srcUrl: src, viewport: VP }).node, 'a', 'matching target wins');
  assert.equal(CU.pickImage({ target: b, images: [a, a2, b], srcUrl: src, viewport: VP }), a2, 'target shows another src → best visible match');
  assert.equal(CU.pickImage({ target: null, images: [off, a, a2], srcUrl: src, viewport: VP }), a2);
  assert.equal(CU.pickImage({ target: b, images: [off], srcUrl: src, viewport: VP }), b, 'no visible match → the right-clicked image anyway');
  assert.equal(CU.pickImage({ target: null, images: [off], srcUrl: src, viewport: VP }), null);
  assert.equal(CU.pickImage({ target: off, images: [], srcUrl: '', viewport: VP }), null, 'off-screen target is ignored');
  assert.equal(CU.pickImage({ target: b, images: [], srcUrl: '', viewport: VP }), b, 'no srcUrl → the right-clicked image');
});

test('errorCode keeps our codes, maps UNKNOWN / foreign ones to the fallback', () => {
  assert.equal(CU.errorCode({ code: 'OCR_NO_TEXT' }), 'OCR_NO_TEXT');
  assert.equal(CU.errorCode({ code: 'NETWORK' }, 'OCR_FAILED'), 'NETWORK');
  assert.equal(CU.errorCode({ code: 'UNKNOWN' }, 'OCR_FAILED'), 'OCR_FAILED');
  assert.equal(CU.errorCode({ code: 'CONTEXT_INVALIDATED' }), 'UNKNOWN');
  assert.equal(CU.errorCode(null, 'OCR_FAILED'), 'OCR_FAILED');
});
