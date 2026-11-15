/**
 * Unit tests for extension/src/background/image-translate.js — pure helpers + handlers with injected fakes
 * (capture / OCR / storage / messaging), no real chrome.* needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_WINDOW,
  capturePagePath,
  computeCaptureWindow,
  computeErrorWindow,
  createImageTranslation,
  finishOcrResult,
  isExtensionPage,
  noTextDetails,
  pickOcrLanguages,
  resolveOcrLanguages,
  sanitizeRect,
  sanitizeViewport,
} from '../../extension/src/background/image-translate.js';
import { makeError, serializeError } from '../../extension/src/shared/messaging.js';
import { DEFAULT_SETTINGS } from '../../extension/src/shared/constants.js';
import { normalizeSettings } from '../../extension/src/shared/storage.js';

const ORIGIN = 'chrome-extension://abc/';
const NO_RECEIVER = new Error('Could not establish connection. Receiving end does not exist.');

/* ---------------- pure helpers ---------------- */

test('sanitizeRect: finite numbers, normalized drag direction, at least 1×1', () => {
  assert.deepEqual(sanitizeRect({ x: 10, y: 20, width: 30, height: 40 }), { x: 10, y: 20, width: 30, height: 40 });
  assert.deepEqual(sanitizeRect({ x: 50, y: 60, width: -30, height: -40 }), { x: 20, y: 20, width: 30, height: 40 });
  assert.deepEqual(sanitizeRect({ x: '1', y: '2', width: '3', height: '4' }), { x: 1, y: 2, width: 3, height: 4 });
  assert.equal(sanitizeRect({ x: 0, y: 0, width: 0.5, height: 10 }), null);
  assert.equal(sanitizeRect({ x: NaN, y: 0, width: 10, height: 10 }), null);
  assert.equal(sanitizeRect({ x: 0, y: 0, width: 10 }), null);
  assert.equal(sanitizeRect(null), null);
});

test('sanitizeViewport: positive finite size only', () => {
  assert.deepEqual(sanitizeViewport({ width: 1280, height: 720 }), { width: 1280, height: 720 });
  assert.equal(sanitizeViewport({ width: 0, height: 720 }), null);
  assert.equal(sanitizeViewport({ width: 'x', height: 720 }), null);
  assert.equal(sanitizeViewport(undefined), null);
});

test('pickOcrLanguages: explicit list (normalized) vs settings; `changed` only when it differs', () => {
  const settings = { ocrLanguages: ['eng'] };
  assert.deepEqual(pickOcrLanguages(undefined, settings), { langs: ['eng'], changed: false });
  assert.deepEqual(pickOcrLanguages([], settings), { langs: ['eng'], changed: false });
  assert.deepEqual(pickOcrLanguages(['eng'], settings), { langs: ['eng'], changed: false });
  assert.deepEqual(pickOcrLanguages(['jpn', 'eng', 'jpn', 'xx'], settings), { langs: ['jpn', 'eng'], changed: true });
  assert.deepEqual(pickOcrLanguages(['a', 'b'], settings), { langs: ['eng'], changed: false }, 'unknown codes → default');
  assert.deepEqual(pickOcrLanguages(['vie', 'eng', 'jpn', 'kor'], null).langs, ['vie', 'eng', 'jpn'], 'max 3');
});

const ZH_HINTS = { text: '机器翻译在过去十年里取得了巨大的进步。', pageLang: 'zh-CN' };

test('resolveOcrLanguages: the user pick (langsSource "user") is used and saved when it differs', () => {
  const settings = { ocrLanguages: ['eng'], ocrAutoDetect: true };
  const r = resolveOcrLanguages({ langs: ['jpn', 'eng'], langsSource: 'user', hints: ZH_HINTS }, settings);
  assert.deepEqual(r, { langs: ['jpn', 'eng'], guessed: ['chi_sim'], autoDetected: false, source: 'user', save: true });
  assert.equal(resolveOcrLanguages({ langs: ['eng'], langsSource: 'user' }, settings).save, false, 'same as saved → no write');
  // Unknown codes only → not a usable pick: falls through to auto-detection.
  assert.equal(resolveOcrLanguages({ langs: ['xx'], langsSource: 'user', hints: ZH_HINTS }, settings).source, 'auto');
});

test('resolveOcrLanguages: auto-detected languages go first, then the saved ones — never saved', () => {
  const r = resolveOcrLanguages({ hints: ZH_HINTS }, { ocrLanguages: ['eng'], ocrAutoDetect: true });
  assert.deepEqual(r, { langs: ['chi_sim', 'eng'], guessed: ['chi_sim'], autoDetected: true, source: 'auto', save: false });
  // `langs` without langsSource 'user' can't change anything (nor be saved).
  const sneaky = resolveOcrLanguages({ langs: ['kor'], hints: ZH_HINTS }, { ocrLanguages: ['eng'] });
  assert.deepEqual(sneaky.langs, ['chi_sim', 'eng']);
  assert.equal(sneaky.save, false);
  // Unique + capped at 3, guess first.
  assert.deepEqual(resolveOcrLanguages({ hints: ZH_HINTS }, { ocrLanguages: ['vie', 'eng', 'jpn'] }).langs, ['chi_sim', 'vie', 'eng']);
  assert.deepEqual(resolveOcrLanguages({ hints: { text: 'Hello world' } }, { ocrLanguages: ['eng', 'vie'] }).langs, ['eng', 'vie']);
  // Default settings (and unreadable settings) have auto-detection on.
  assert.equal(DEFAULT_SETTINGS.ocrAutoDetect, true);
  assert.deepEqual(resolveOcrLanguages({ hints: ZH_HINTS }, normalizeSettings({})).langs, ['chi_sim', 'eng']);
  assert.deepEqual(resolveOcrLanguages({ hints: ZH_HINTS }, null).langs, ['chi_sim', 'eng']);
});

test('resolveOcrLanguages: no guess, or auto-detection off → settings.ocrLanguages (guess still reported)', () => {
  assert.deepEqual(resolveOcrLanguages({}, { ocrLanguages: ['vie'] }), { langs: ['vie'], guessed: [], autoDetected: false, source: 'settings', save: false });
  const off = resolveOcrLanguages({ hints: ZH_HINTS }, { ocrLanguages: ['eng'], ocrAutoDetect: false });
  assert.deepEqual(off, { langs: ['eng'], guessed: ['chi_sim'], autoDetected: false, source: 'settings', save: false });
  assert.deepEqual(resolveOcrLanguages({ hints: 'nope' }, { ocrLanguages: ['eng'] }).langs, ['eng'], 'garbage hints');
});

test('normalizeSettings: ocrAutoDetect is a boolean, default true', () => {
  assert.equal(normalizeSettings({}).ocrAutoDetect, true);
  assert.equal(normalizeSettings({ ocrAutoDetect: false }).ocrAutoDetect, false);
  assert.equal(normalizeSettings({ ocrAutoDetect: 'no' }).ocrAutoDetect, true);
});

test('finishOcrResult / noTextDetails / serializeError carry the languages for the UI', () => {
  const resolved = { langs: ['chi_sim', 'eng'], guessed: ['chi_sim'], autoDetected: true };
  const ocr = finishOcrResult({ text: '机器\n翻译', confidence: 80, langs: ['chi_sim', 'eng'] }, resolved);
  assert.deepEqual(ocr.langs, ['chi_sim', 'eng']);
  assert.equal(ocr.autoDetected, true);
  assert.deepEqual(ocr.guessed, ['chi_sim']);
  assert.equal(ocr.rawText, '机器\n翻译');
  assert.equal(finishOcrResult({ text: 'x', confidence: 1 }, resolved).langs.join('+'), 'chi_sim+eng', 'engine without langs');
  assert.deepEqual(noTextDetails(resolved), { langs: ['chi_sim', 'eng'], guessed: ['chi_sim'], autoDetected: true });
  const err = Object.assign(makeError('OCR_NO_TEXT', 'none'), { details: noTextDetails(resolved) });
  assert.deepEqual(serializeError(err), { code: 'OCR_NO_TEXT', message: 'none', details: noTextDetails(resolved) });
  assert.deepEqual(serializeError(makeError('OCR_FAILED', 'x')), { code: 'OCR_FAILED', message: 'x' }, 'no details');
});

test('computeCaptureWindow: screenshot CSS size + panel, capped to the source window, centered', () => {
  // 2× screenshot of a 1280×800 window: the shot alone is 1280 CSS px wide → capped to the window minus margin.
  const big = computeCaptureWindow({ image: { width: 2560, height: 1500 }, source: { left: 100, top: 50, width: 1280, height: 800 } });
  assert.equal(big.width, 1280 - CAPTURE_WINDOW.margin);
  assert.equal(big.height, 800 - CAPTURE_WINDOW.margin);
  assert.equal(big.left, 100 + 20);
  assert.equal(big.top, 50 + 20);

  // Small screenshot in a big window: fits the screenshot + panel.
  const small = computeCaptureWindow({ image: { width: 400, height: 300 }, source: { left: 0, top: 0, width: 1600, height: 1000 } });
  assert.equal(small.width, Math.max(CAPTURE_WINDOW.minWidth, 400 + CAPTURE_WINDOW.panel));
  assert.equal(small.height, Math.max(CAPTURE_WINDOW.minHeight, 300 + CAPTURE_WINDOW.chrome));

  // Unknown source window: default caps, no position.
  const unknown = computeCaptureWindow({ image: { width: 5000, height: 4000 }, source: null });
  assert.deepEqual(unknown, { width: CAPTURE_WINDOW.defaultMaxWidth, height: CAPTURE_WINDOW.defaultMaxHeight });
});

test('computeErrorWindow / capturePagePath / isExtensionPage', () => {
  assert.deepEqual(computeErrorWindow(null), { width: CAPTURE_WINDOW.errorWidth, height: CAPTURE_WINDOW.errorHeight });
  const e = computeErrorWindow({ left: 0, top: 0, width: 1460, height: 1000 });
  assert.equal(e.left, 500);
  assert.ok(e.top >= 0);

  assert.equal(capturePagePath({ id: 'a b' }), 'src/capture/capture.html?id=a%20b');
  assert.equal(capturePagePath({ error: 'CAPTURE_FAILED' }), 'src/capture/capture.html?error=CAPTURE_FAILED');
  assert.equal(capturePagePath({ error: '<script>' }), 'src/capture/capture.html?error=CAPTURE_FAILED');

  assert.equal(isExtensionPage({ url: 'chrome-extension://abc/src/popup/popup.html' }, ORIGIN), true);
  assert.equal(isExtensionPage({ origin: 'chrome-extension://abc' }, ORIGIN), true);
  assert.equal(isExtensionPage({ url: 'chrome-extension://abcd/x.html' }, ORIGIN), false);
  assert.equal(isExtensionPage({ url: 'https://example.com/' }, ORIGIN), false);
  assert.equal(isExtensionPage({}, ''), false);
});

/* ---------------- handlers with fakes ---------------- */

function setup({ capture = null, sendToTab, captureTab, inject, runOcr, settings = { ocrLanguages: ['eng'] } } = {}) {
  const calls = { crop: [], ocr: [], saved: [], tab: [], windows: [], tabsCreated: [], captureTab: 0, injected: [] };
  const fakeChrome = {
    runtime: { getURL: (p) => `${ORIGIN}${p}` },
    tabs: {
      get: async (id) => ({ id, windowId: 3 }),
      query: async (q) => (q.windowId === 9 ? [{ id: 90, windowId: 9 }] : [{ id: 11, windowId: 1 }]),
      create: async (p) => calls.tabsCreated.push(p),
    },
    windows: {
      get: async () => ({ left: 0, top: 0, width: 1200, height: 900 }),
      getLastFocused: async () => ({ id: 9 }),
      create: async (p) => {
        calls.windows.push(p);
        return { id: 1 };
      },
    },
  };
  const it = createImageTranslation({
    chrome: () => fakeChrome,
    getSettings: async () => settings,
    saveSettings: async (patch) => calls.saved.push(patch),
    getCaptureForTab: (tabId) => (capture && capture.tabId === tabId ? capture : null),
    getCapture: (id) => (capture && capture.id === id ? capture : null),
    cropForOcr: async (...args) => {
      calls.crop.push(args);
      return 'data:image/png;base64,CROP';
    },
    runOcr: async (dataUrl, langs) => {
      calls.ocr.push({ dataUrl, langs });
      return runOcr ? runOcr(dataUrl, langs) : { text: 'Hi', confidence: 90, langs };
    },
    clearOcrCache: async () => ({}),
    captureTab:
      captureTab ||
      (async (tab) => {
        calls.captureTab++;
        return { id: `cap-${tab.id}`, dataUrl: 'data:image/png;base64,SHOT', width: 2400, height: 1600 };
      }),
    sendToTab: async (tabId, type, payload, opts) => {
      calls.tab.push({ tabId, type, payload, opts });
      return sendToTab ? sendToTab(payload, calls) : null;
    },
    injectContentScripts: async (tabId) => {
      calls.injected.push(tabId);
      return inject ? inject(tabId) : false;
    },
  });
  return { it, calls };
}

const CAPTURE = { id: 'c1', tabId: 5, dataUrl: 'data:image/png;base64,SHOT', width: 2560, height: 1600, tabTitle: 'Page' };
const fromTab = (id) => ({ url: 'https://example.com/', tab: { id, windowId: 1 } });

test('ocr-region: crops the sender tab screenshot with the given rect/viewport, OCR with settings languages', async () => {
  const { it, calls } = setup({ capture: CAPTURE });
  const res = await it.handleOcrRegion({ rect: { x: 10, y: 20, width: 100, height: 40 }, viewport: { width: 1280, height: 800 } }, fromTab(5));
  assert.deepEqual(res.ocr.langs, ['eng']);
  assert.deepEqual(calls.crop[0], ['data:image/png;base64,SHOT', { x: 10, y: 20, width: 100, height: 40 }, { width: 1280, height: 800 }]);
  assert.deepEqual(calls.ocr[0], { dataUrl: 'data:image/png;base64,CROP', langs: ['eng'] });
  assert.equal(calls.saved.length, 0);
});

test('ocr-region: toolbar languages are used and remembered; errors are coded', async () => {
  const { it, calls } = setup({ capture: CAPTURE });
  await it.handleOcrRegion(
    { rect: { x: 0, y: 0, width: 50, height: 50 }, viewport: { width: 800, height: 600 }, langs: ['jpn', 'eng'], langsSource: 'user' },
    fromTab(5),
  );
  assert.deepEqual(calls.ocr[0].langs, ['jpn', 'eng']);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.saved, [{ ocrLanguages: ['jpn', 'eng'] }]);

  await assert.rejects(it.handleOcrRegion({ rect: { x: 0, y: 0, width: 5, height: 5 }, viewport: { width: 1, height: 1 } }, fromTab(6)), {
    code: 'CAPTURE_FAILED',
  });
  await assert.rejects(it.handleOcrRegion({ rect: {}, viewport: { width: 1, height: 1 } }, fromTab(5)), { code: 'OCR_FAILED' });
  await assert.rejects(it.handleOcrRegion({ rect: { x: 0, y: 0, width: 5, height: 5 }, viewport: {} }, fromTab(5)), { code: 'OCR_FAILED' });
  await assert.rejects(it.handleOcrRegion({}, { url: 'chrome-extension://abc/x' }), { code: 'CAPTURE_FAILED' });
});

const AREA = { rect: { x: 0, y: 0, width: 300, height: 90 }, viewport: { width: 1280, height: 800 } };

test('ocr-region: Chinese hints with default settings → chi_sim first, reported as auto-detected, nothing saved', async () => {
  const { it, calls } = setup({ capture: CAPTURE, settings: normalizeSettings({}) });
  const res = await it.handleOcrRegion({ ...AREA, hints: ZH_HINTS }, fromTab(5));
  assert.deepEqual(calls.ocr[0].langs, ['chi_sim', 'eng']);
  assert.deepEqual(res.ocr.langs, ['chi_sim', 'eng'], 'the UI chips show what was used');
  assert.equal(res.ocr.autoDetected, true);
  assert.deepEqual(res.ocr.guessed, ['chi_sim']);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.saved, [], 'auto-detected languages never overwrite settings.ocrLanguages');
});

test('ocr-region / ocr-image: auto-detection off → settings languages; OCR_NO_TEXT carries details for retries', async () => {
  const noText = async () => {
    throw makeError('OCR_NO_TEXT', 'No text found in the image');
  };
  const off = setup({ capture: CAPTURE, settings: { ocrLanguages: ['eng'], ocrAutoDetect: false }, runOcr: noText });
  await assert.rejects(off.it.handleOcrRegion({ ...AREA, hints: ZH_HINTS }, fromTab(5)), (err) => {
    assert.equal(err.code, 'OCR_NO_TEXT');
    assert.deepEqual(err.details, { langs: ['eng'], guessed: ['chi_sim'], autoDetected: false });
    return true;
  });
  assert.deepEqual(off.calls.ocr[0].langs, ['eng']);

  const auto = setup({ settings: { ocrLanguages: ['eng'] }, runOcr: noText });
  await assert.rejects(auto.it.handleOcrImage({ dataUrl: 'data:image/png;base64,AAAA', hints: { pageText: 'Привет мир, это пример' } }), (err) => {
    assert.deepEqual(err.details, { langs: ['rus', 'eng'], guessed: ['rus'], autoDetected: true });
    return true;
  });

  // Other errors pass through untouched.
  const failing = setup({ runOcr: async () => Promise.reject(makeError('NETWORK', 'offline')) });
  await assert.rejects(failing.it.handleOcrImage({ dataUrl: 'data:image/png;base64,AAAA' }), (err) => err.code === 'NETWORK' && !err.details);
});

test('ocr-image: a recovery chip (user pick) is used as-is and becomes the new default', async () => {
  const { it, calls } = setup({ settings: { ocrLanguages: ['eng'], ocrAutoDetect: true } });
  const res = await it.handleOcrImage({ dataUrl: 'data:image/png;base64,AAAA', langs: ['chi_sim', 'eng'], langsSource: 'user', hints: { pageText: 'Hello' } });
  assert.deepEqual(calls.ocr[0].langs, ['chi_sim', 'eng']);
  assert.equal(res.ocr.autoDetected, false);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.saved, [{ ocrLanguages: ['chi_sim', 'eng'] }]);
});

test('get-capture / ocr-clear-cache are for extension pages only', async () => {
  const { it } = setup({ capture: CAPTURE });
  const page = { url: `${ORIGIN}src/capture/capture.html?id=c1`, tab: { id: 77 } };
  assert.deepEqual(await it.handleGetCapture({ id: 'c1' }, page), { dataUrl: CAPTURE.dataUrl, width: 2560, height: 1600, tabTitle: 'Page' });
  await assert.rejects(it.handleGetCapture({ id: 'c1' }, fromTab(5)), { code: 'CAPTURE_FAILED' });
  await assert.rejects(it.handleGetCapture({ id: 'zz' }, page), { code: 'CAPTURE_FAILED' });
  assert.deepEqual(await it.handleClearCache({}, page), {});
  await assert.rejects(it.handleClearCache({}, fromTab(5)));
});

test('startCapture: content script started → no window; started:false (e.g. XML page) → capture page', async () => {
  let started = true;
  const { it, calls } = setup({ sendToTab: (p) => (p.prepare ? { ready: true } : { started }) });
  assert.deepEqual(await it.startCapture({ id: 4, windowId: 1 }), { started: true, fallback: false });
  assert.deepEqual(
    calls.tab.map((c) => [c.type, c.payload, c.opts]),
    [
      ['start-crop', { prepare: true }, { frameId: 0 }],
      ['start-crop', { mode: 'region' }, { frameId: 0 }],
    ],
  );
  assert.equal(calls.windows.length, 0);

  started = false;
  assert.deepEqual(await it.startCapture({ id: 4, index: 2, windowId: 1 }, { mode: 'image', srcUrl: 'https://x/y.png' }), { started: true, fallback: true });
  assert.deepEqual(calls.tab.at(-1).payload, { mode: 'image', srcUrl: 'https://x/y.png' });
  assert.equal(calls.windows.length, 0, 'never a separate window');
  assert.deepEqual(calls.tabsCreated.at(-1), { url: `${ORIGIN}src/capture/capture.html?id=cap-4&from=4`, active: true, index: 3, openerTabId: 4, windowId: 1 });
});

test('startCapture: no content script → inject it (activeTab) and use the in-page overlay', async () => {
  let injected = false;
  const { it, calls } = setup({
    inject: () => (injected = true),
    sendToTab: (p) => {
      if (!injected) throw NO_RECEIVER;
      return p.prepare ? { ready: true } : { started: true };
    },
  });
  assert.deepEqual(await it.startCapture({ id: 8, index: 0, windowId: 1 }), { started: true, fallback: false });
  assert.deepEqual(calls.injected, [8]);
  assert.equal(calls.tabsCreated.length, 0);
  assert.equal(calls.windows.length, 0);
});

test('startCapture: injection impossible (PDF viewer, chrome://) → capture page in a tab next to the source', async () => {
  const { it, calls } = setup({
    inject: () => false,
    sendToTab: () => {
      throw NO_RECEIVER;
    },
  });
  assert.deepEqual(await it.startCapture({ id: 9, index: 5, windowId: 2 }), { started: true, fallback: true });
  assert.deepEqual(calls.injected, [9]);
  assert.equal(calls.tabsCreated.at(-1).url, `${ORIGIN}src/capture/capture.html?id=cap-9&from=9`);
  assert.equal(calls.tabsCreated.at(-1).index, 6);
});

test('startCapture: the screenshot happens after "prepare" (our UI is hidden first)', async () => {
  const order = [];
  const { it } = setup({
    sendToTab: (p) => {
      order.push(p.prepare ? 'prepare' : 'start');
      return p.prepare ? { ready: true } : { started: true };
    },
    captureTab: async (tab) => {
      order.push('capture');
      return { id: 'x', dataUrl: 'data:image/png;base64,A', width: 10, height: 10, tabId: tab.id };
    },
  });
  await it.startCapture({ id: 1, windowId: 1 });
  assert.deepEqual(order, ['prepare', 'capture', 'start']);
});

test('startCapture: capture failure → error bubble, else the error page; rejects with CAPTURE_FAILED', async () => {
  const failing = async () => {
    throw new Error('boom');
  };
  const withReceiver = setup({ captureTab: failing, sendToTab: (p) => (p.prepare ? { ready: true } : { started: true }) });
  await assert.rejects(withReceiver.it.startCapture({ id: 2, windowId: 1 }), { code: 'CAPTURE_FAILED' });
  assert.deepEqual(withReceiver.calls.tab.at(-1).payload, { mode: 'region', error: 'CAPTURE_FAILED' });
  assert.equal(withReceiver.calls.windows.length, 0);

  const noReceiver = setup({
    captureTab: failing,
    sendToTab: () => {
      throw NO_RECEIVER;
    },
  });
  await assert.rejects(noReceiver.it.startCapture({ id: 2, windowId: 1 }), { code: 'CAPTURE_FAILED' });
  assert.equal(noReceiver.calls.tabsCreated.at(-1).url, `${ORIGIN}src/capture/capture.html?error=CAPTURE_FAILED&from=2`);
  assert.equal(noReceiver.calls.windows.length, 0);

  await assert.rejects(noReceiver.it.startCapture(null), { code: 'CAPTURE_FAILED' });
});

test('start-capture: content script → its tab; popup → tabId or the last focused normal window', async () => {
  const { it, calls } = setup({ sendToTab: (p) => (p.prepare ? { ready: true } : { started: true }) });
  await it.handleStartCapture({ mode: 'region' }, fromTab(21));
  assert.equal(calls.tab.at(-1).tabId, 21);

  await it.handleStartCapture({ tabId: 33 }, { url: `${ORIGIN}src/popup/popup.html` });
  assert.equal(calls.tab.at(-1).tabId, 33);

  // From the capture page (an extension page inside a tab): never capture that tab itself.
  await it.handleStartCapture({}, { url: `${ORIGIN}src/capture/capture.html`, tab: { id: 77, windowId: 4 } });
  assert.equal(calls.tab.at(-1).tabId, 90, 'active tab of the last focused normal window');
});

test('reflowOcrText joins wrapped lines, keeps paragraphs and list items', async () => {
  const { reflowOcrText } = await import('../../extension/src/background/image-translate.js');
  assert.equal(
    reflowOcrText('Unemployment has been the most obvious cost of the recession,\nbut economists warn that the long-\nterm consequences may be\nfar more subtle.', 'en'),
    'Unemployment has been the most obvious cost of the recession, but economists warn that the long-term consequences may be far more subtle.',
  );
  assert.equal(reflowOcrText('First paragraph\nline two\n\nSecond paragraph', 'en'), 'First paragraph line two\n\nSecond paragraph');
  assert.equal(reflowOcrText('Shopping list:\n- milk\n- eggs', 'en'), 'Shopping list:\n- milk\n- eggs');
  assert.equal(reflowOcrText('今日はとても\n良い天気ですね。', 'ja'), '今日はとても良い天気ですね。');
  assert.equal(reflowOcrText('', 'en'), '');
});

test('reflowOcrText joins CJK lines without spaces even without a language hint', async () => {
  const { reflowOcrText } = await import('../../extension/src/background/image-translate.js');
  assert.equal(
    reflowOcrText('机器翻译在过去十年里取得了巨大的进步。\n然而，在文学、法律和市场营销等领域，\n人工翻译仍然是不可或缺的。'),
    '机器翻译在过去十年里取得了巨大的进步。然而，在文学、法律和市场营销等领域，人工翻译仍然是不可或缺的。',
  );
  assert.equal(reflowOcrText('Hello world\nagain'), 'Hello world again');
});

test('reflowOcrText keeps line breaks of centred / short lines (signs) but joins left-aligned wrapped paragraphs', async () => {
  const { reflowOcrText } = await import('../../extension/src/background/image-translate.js');
  const sign = '欢迎光临\n营业时间：每天上午九点到晚上十点\n今日推荐：抹茶拿铁和手工蛋糕\n店内禁止吸烟，谢谢您的合作！';
  const signLines = [
    { text: '欢迎光临', bbox: { x0: 400, y0: 0, x1: 700, y1: 60 } },
    { text: '营业时间：每天上午九点到晚上十点', bbox: { x0: 100, y0: 80, x1: 1000, y1: 130 } },
    { text: '今日推荐：抹茶拿铁和手工蛋糕', bbox: { x0: 160, y0: 150, x1: 940, y1: 200 } },
    { text: '店内禁止吸烟，谢谢您的合作！', bbox: { x0: 160, y0: 220, x1: 940, y1: 270 } },
  ];
  assert.equal(reflowOcrText(sign, 'zh-CN', signLines), sign, 'centred sign lines stay separate');

  const para = 'Unemployment has been the most obvious cost of the recession,\nbut economists warn that the long-term\nconsequences may be subtle.';
  const paraLines = [
    { text: 'a', bbox: { x0: 20, y0: 0, x1: 980, y1: 30 } },
    { text: 'b', bbox: { x0: 21, y0: 40, x1: 900, y1: 70 } },
    { text: 'c', bbox: { x0: 20, y0: 80, x1: 500, y1: 110 } },
  ];
  assert.equal(
    reflowOcrText(para, 'en', paraLines),
    'Unemployment has been the most obvious cost of the recession, but economists warn that the long-term consequences may be subtle.',
  );
  assert.equal(reflowOcrText('one\ntwo', 'en', [{ text: 'x', bbox: { x0: 0, x1: 10 } }]), 'one two', 'mismatched layout → text-only rules');
});

test('dropNoiseLines removes low-confidence specks, keeps real short lines', async () => {
  const { dropNoiseLines } = await import('../../extension/src/background/image-translate.js');
  const text = '、 lc\n欢迎光临\n营业时间：每天上午九点到晚上十点';
  const lines = [
    { text: '、 lc', confidence: 22, bbox: { x0: 0, y0: 0, x1: 900, y1: 10 } },
    { text: '欢迎光临', confidence: 93, bbox: { x0: 300, y0: 20, x1: 600, y1: 80 } },
    { text: '营业时间：每天上午九点到晚上十点', confidence: 91, bbox: { x0: 40, y0: 100, x1: 860, y1: 150 } },
  ];
  const r = dropNoiseLines(text, lines);
  assert.equal(r.text, '欢迎光临\n营业时间：每天上午九点到晚上十点');
  assert.equal(r.lines.length, 2);
  const ok = dropNoiseLines('OK\nGo', [{ text: 'OK', confidence: 90 }, { text: 'Go', confidence: 88 }]);
  assert.equal(ok.text, 'OK\nGo', 'confident short lines stay');
});
