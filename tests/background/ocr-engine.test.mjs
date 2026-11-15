/**
 * OCR engine (extension/src/offscreen/ocr-engine.js): pure helpers + input validation. The Tesseract worker itself
 * needs a browser (Worker + WASM) — it is exercised by the dev harness, dev/ocr-test.html.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CORE_FILES,
  OCR_LIMITS,
  PSM,
  buildOcrResult,
  choosePsm,
  detectCoreVariant,
  fallbackPsm,
  getStatus,
  imageSize,
  normalizeOcrText,
  recognize,
  sniffImageType,
  toOcrError,
  vendorBaseUrl,
} from '../../extension/src/offscreen/ocr-engine.js';

const line = (text, confidence, bbox = { x0: 1.4, y0: 2.6, x1: 100, y1: 20 }) => ({ text: `${text}\n`, confidence, bbox });
const page = (...lines) => ({ text: lines.map((l) => l.text).join(''), confidence: 90, blocks: [{ paragraphs: [{ lines }] }] });

test('normalizeOcrText: whitespace, NFC, CJK gaps, border pipes', () => {
  assert.equal(normalizeOcrText('  Hello \t  world \n'), 'Hello world');
  assert.equal(normalizeOcrText('今日 は と て も 良い 天気 で すね 。'), '今日はとても良い天気ですね。');
  assert.equal(normalizeOcrText('我 爱 北京 天安门 ！'), '我爱北京天安门！');
  assert.equal(normalizeOcrText('Apple の iPhone 15 を 買っ た'), 'Apple の iPhone 15 を買った', 'Latin ↔ CJK spaces kept');
  assert.equal(normalizeOcrText('안녕 하세요 세계'), '안녕 하세요 세계', 'Korean word spaces kept');
  const decomposed = 'Tiếng Việt';
  assert.equal(normalizeOcrText(decomposed), 'Tiếng Việt');
  assert.equal(normalizeOcrText('| Name | Age |'), 'Name | Age');
  assert.equal(normalizeOcrText(null), '');
});

test('buildOcrResult: lines joined with \\n, weighted confidence, bbox, lang hint for a single language', () => {
  const data = page(line('Tiếng Việt có sáu thanh điệu', 96), line('hỏi, ngã và nặng.', 90));
  const r = buildOcrResult(data, ['vie']);
  assert.equal(r.text, 'Tiếng Việt có sáu thanh điệu\nhỏi, ngã và nặng.');
  assert.equal(r.lang, 'vi');
  assert.deepEqual(r.langs, ['vie']);
  assert.equal(r.confidence, 94, 'weighted by characters (24×96 + 14×90) / 38');
  assert.deepEqual(r.lines[0], { text: 'Tiếng Việt có sáu thanh điệu', confidence: 96, bbox: { x0: 1, y0: 3, x1: 100, y1: 20 } });

  const multi = buildOcrResult(page(line('今日 は 天気 。', 95)), ['jpn', 'eng']);
  assert.equal(multi.text, '今日は天気。');
  assert.equal('lang' in multi, false, 'no hint when several languages were used');
  assert.equal(buildOcrResult(page(line('今日', 95)), ['jpn']).lang, 'ja');
});

test('buildOcrResult: drops symbol-only and very low-confidence lines; null when nothing readable', () => {
  const r = buildOcrResult(page(line('—', 0), line('Submit your order', 92), line('~ ~', 50), line('x4 #', 12)), ['eng']);
  assert.equal(r.text, 'Submit your order');
  assert.equal(r.lines.length, 1);

  assert.equal(buildOcrResult(page(line('—', 0), line('|', 30)), ['eng']), null, 'no letters or digits');
  assert.equal(buildOcrResult({ text: '', confidence: 95, blocks: [] }, ['eng']), null, 'empty page (Tesseract reports 95 for nothing)');
  assert.equal(buildOcrResult(undefined, ['eng']), null);
  // Garbage Tesseract produced on a noise texture (real values from calibration)
  const noise = page(
    line('HL Ý na Ÿ TA 0', 9),
    line('£7 Wg Foie? nu', 31),
    line('Aah Ba 6 3 2 3', 45),
    line('os 3 ˆ on', 20),
    line('Si 27: : ye & ;', 43),
    line('5} LY Era ba SX vn,', 19),
    line('8 en I Te, $y', 0),
  );
  assert.equal(buildOcrResult(noise, ['eng', 'vie']), null);
  assert.ok(OCR_LIMITS.MIN_CONFIDENCE > 30 && OCR_LIMITS.MIN_CONFIDENCE < 60);
});

test('buildOcrResult: falls back to plain text when blocks are missing; clamps confidence', () => {
  const r = buildOcrResult({ text: 'Hello\n\nworld  again\n', confidence: 140 }, ['eng']);
  assert.equal(r.text, 'Hello\nworld again');
  assert.equal(r.confidence, 100);
  assert.equal(r.lines[0].bbox, undefined);
});

test('choosePsm / fallbackPsm', () => {
  assert.equal(choosePsm(null), PSM.AUTO);
  assert.equal(choosePsm({ width: 800, height: 600 }), PSM.AUTO);
  assert.equal(choosePsm({ width: 1400, height: 350 }), PSM.SINGLE_BLOCK, 'ratio 4 = strip');
  assert.equal(choosePsm({ width: 1400, height: 120 }), PSM.SINGLE_BLOCK);
  assert.equal(choosePsm({ width: 0, height: 10 }), PSM.AUTO);
  assert.equal(fallbackPsm(PSM.AUTO), PSM.SINGLE_BLOCK);
  assert.equal(fallbackPsm(PSM.SINGLE_BLOCK), PSM.SPARSE_TEXT);
  assert.equal(fallbackPsm(PSM.SPARSE_TEXT), null);
});

test('sniffImageType / imageSize', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 5, 0, 0, 0, 0, 72]);
  assert.equal(sniffImageType(png), 'png');
  assert.deepEqual(imageSize(png), { width: 1280, height: 72 });
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02, 0, 0]);
  assert.equal(sniffImageType(gif), 'gif');
  assert.deepEqual(imageSize(gif), { width: 800, height: 600 });
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'jpeg');
  assert.equal(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'webp');
  assert.equal(sniffImageType(new Uint8Array([0x42, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'bmp');
  assert.equal(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), null);
});

test('toOcrError: download failures → NETWORK, everything else → OCR_FAILED, coded errors pass through', () => {
  assert.equal(toOcrError('Error: Network error while fetching https://cdn.jsdelivr.net/x.gz. Response code: 404').code, 'NETWORK');
  assert.equal(toOcrError('TypeError: Failed to fetch').code, 'NETWORK');
  assert.equal(toOcrError('initialization failed').code, 'OCR_FAILED');
  assert.equal(toOcrError(new Error('RuntimeError: Aborted(OOM)')).code, 'OCR_FAILED');
  const coded = Object.assign(new Error('nothing'), { code: 'OCR_NO_TEXT' });
  assert.equal(toOcrError(coded), coded);
});

test('vendored files the engine loads exist; core variant detection', () => {
  const base = vendorBaseUrl();
  assert.match(base, /\/extension\/vendor\/tesseract\/$/);
  for (const file of ['worker.min.js', 'tesseract.esm.min.js', ...Object.values(CORE_FILES)]) {
    assert.ok(existsSync(fileURLToPath(new URL(file, base))), `${file} is vendored`);
    if (file.startsWith('tesseract-core-')) assert.ok(existsSync(fileURLToPath(new URL(file.replace(/\.js$/, '.wasm'), base))));
  }
  assert.ok(Object.keys(CORE_FILES).includes(detectCoreVariant()));
});

test('vendorBaseUrl: chrome.runtime.getURL on the extension origin', () => {
  const saved = { chrome: globalThis.chrome, location: globalThis.location };
  try {
    globalThis.chrome = { runtime: { id: 'abc', getURL: (p) => `chrome-extension://abc/${p}` } };
    Object.defineProperty(globalThis, 'location', { value: { protocol: 'chrome-extension:' }, configurable: true });
    assert.equal(vendorBaseUrl(), 'chrome-extension://abc/vendor/tesseract/');
    Object.defineProperty(globalThis, 'location', { value: { protocol: 'http:' }, configurable: true });
    assert.match(vendorBaseUrl(), /^file:.*\/extension\/vendor\/tesseract\/$/, 'dev pages: relative to the module');
  } finally {
    globalThis.chrome = saved.chrome;
    if (saved.location === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, 'location', { value: saved.location, configurable: true });
  }
});

test('recognize: invalid input and missing Worker support reject with OCR_FAILED (queue keeps working)', async () => {
  await assert.rejects(recognize('hello', ['eng']), (err) => err.code === 'OCR_FAILED' && /Not an image/.test(err.message));
  await assert.rejects(recognize('data:image/svg+xml;base64,PHN2Zy8+', ['eng']), { code: 'OCR_FAILED' });
  const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10]).toString('base64')}`;
  await assert.rejects(recognize(png, ['eng']), (err) => err.code === 'OCR_FAILED' && /Worker/.test(err.message));
  const huge = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x27, 0x10, 0, 0, 0x27, 0x10]).toString('base64')}`;
  await assert.rejects(recognize(huge), (err) => err.code === 'OCR_FAILED' && /too large/.test(err.message));
  assert.deepEqual(getStatus(), { busy: false, ready: false, langs: [], core: null });
});
