/**
 * Service worker integration test: loads service-worker.js against an in-memory chrome.* mock and a mocked fetch,
 * then exercises the messaging contract (ARCHITECTURE §5), menus, commands, badge and TTS fallback.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createChromeMock, flush } from './chrome-mock.mjs';
import { GOOGLE_HOST, googleBody, jsonResponse, mockFetch } from './helpers.mjs';

const mock = createChromeMock({ uiLanguage: 'vi' });
const { chrome, log, areas, behaviour, sendToBackground: send } = mock;

// Google mock: "rõ ràng"/"xin chào" are Vietnamese (detected vi), everything else English.
const fetchMock = mockFetch([
  [
    GOOGLE_HOST,
    (url, init) => {
      const text = decodeURIComponent(String(init.body).slice(2));
      const tl = new URL(url).searchParams.get('tl');
      const src = /rõ ràng|xin chào/.test(text) ? 'vi' : 'en';
      return jsonResponse(googleBody(`[${tl}] ${text}`, src));
    },
  ],
]);

before(async () => {
  globalThis.chrome = chrome;
  globalThis.fetch = fetchMock;
  await import('../../extension/src/background/service-worker.js');
  await flush(5);
});

test('registers all listeners synchronously at load', () => {
  for (const ev of [
    chrome.runtime.onMessage,
    chrome.runtime.onInstalled,
    chrome.runtime.onStartup,
    chrome.contextMenus.onClicked,
    chrome.commands.onCommand,
    chrome.tabs.onActivated,
    chrome.tabs.onUpdated,
    chrome.windows.onFocusChanged,
    chrome.storage.onChanged,
  ]) {
    assert.ok(ev.hasListeners());
  }
});

test('onInstalled(install): persists normalized settings, opens welcome, creates menus, clears badge', async () => {
  chrome.runtime.onInstalled.dispatch({ reason: 'install' });
  await flush(20);
  assert.equal(areas.sync.settings.targetLang, 'vi', 'targetLang resolved from the UI language');
  assert.equal(areas.sync.settings.secondaryLang, 'en');
  assert.ok(log.tabsCreated.includes('chrome-extension://transpop-test/src/welcome/welcome.html'));
  assert.deepEqual(
    [...log.menus.keys()].sort(),
    ['transpop-area', 'transpop-image', 'transpop-toggle-enabled', 'transpop-toggle-site', 'transpop-translate'],
  );
  assert.equal(log.menus.get('transpop-translate').title, 'Translate “%s”');
  assert.deepEqual(log.menus.get('transpop-translate').contexts, ['selection']);
  assert.equal(log.menus.get('transpop-image').title, 'Translate text in image');
  assert.deepEqual(log.menus.get('transpop-image').contexts, ['image']);
  assert.equal(log.menus.get('transpop-area').title, 'Translate screen area…');
  assert.deepEqual(log.menus.get('transpop-area').contexts, ['page', 'frame']);
  assert.equal(log.menus.get('transpop-toggle-site').enabled, false, 'no hostname known (no content script)');
  assert.equal(log.badge.text, '');

  chrome.runtime.onInstalled.dispatch({ reason: 'update' }); // re-creating must not hit duplicate ids
  await flush(20);
  assert.equal(log.menus.size, 5);
});

test('translate: settings-aware target, cache, history', async () => {
  const r1 = await send({ type: 'translate', text: '  hello  ', source: 'bubble' });
  assert.equal(r1.ok, true);
  assert.equal(r1.result.to, 'vi');
  assert.equal(r1.result.text, 'hello');
  assert.equal(r1.result.translation, '[vi] hello');
  assert.equal(r1.result.cached, undefined);
  assert.equal(fetchMock.count(GOOGLE_HOST), 1);
  assert.equal(areas.local.history.length, 1);
  assert.equal(areas.local.history[0].key, 'vi|hello');

  const r2 = await send({ type: 'translate', text: 'hello', source: 'popup' });
  assert.equal(r2.result.cached, true);
  assert.equal(fetchMock.count(GOOGLE_HOST), 1, 'served from cache');

  await send({ type: 'translate', text: 'not recorded', record: false });
  await send({ type: 'translate', text: 'welcome sample', source: 'welcome' });
  assert.equal(areas.local.history.length, 1, 'record:false and source:welcome are not saved');

  const explicit = await send({ type: 'translate', text: 'hello', to: 'ja' });
  assert.equal(explicit.result.to, 'ja');
});

test('translate: smart swap only when `to` is omitted', async () => {
  const swapped = await send({ type: 'translate', text: 'rõ ràng' });
  assert.equal(swapped.result.from, 'vi');
  assert.equal(swapped.result.to, 'en');
  assert.equal(swapped.result.translation, '[en] rõ ràng');

  const fixed = await send({ type: 'translate', text: 'xin chào', to: 'vi' });
  assert.equal(fixed.result.to, 'vi');
});

test('translate: error envelopes', async () => {
  assert.deepEqual((await send({ type: 'translate', text: '   ' })).error.code, 'EMPTY');
  assert.deepEqual((await send({ type: 'translate', text: 'x'.repeat(5001) })).error.code, 'TOO_LONG');
  assert.deepEqual((await send({ type: 'translate', text: 'hi', to: 'zz-unknown' })).error.code, 'UNSUPPORTED_LANG');
});

test('get-settings, favorites, disable-site, unknown / offscreen messages', async () => {
  const s = await send({ type: 'get-settings' });
  assert.equal(s.ok, true);
  assert.equal(s.settings.targetLang, 'vi');

  const { result } = await send({ type: 'translate', text: 'hello' });
  assert.equal((await send({ type: 'check-favorite', text: 'hello', to: 'vi' })).favorited, false);
  assert.equal((await send({ type: 'toggle-favorite', result })).favorited, true);
  assert.equal((await send({ type: 'check-favorite', text: 'Hello ', to: 'vi' })).favorited, true);
  assert.equal((await send({ type: 'toggle-favorite', result })).favorited, false);
  assert.equal((await send({ type: 'toggle-favorite', result: {} })).ok, false);

  const d = await send({ type: 'disable-site', hostname: 'https://www.Example.com/path' });
  assert.deepEqual(d.settings.disabledSites, ['example.com']);
  const d2 = await send({ type: 'disable-site' }, { id: 'transpop-test', url: 'https://news.ycombinator.com/item?id=1' });
  assert.deepEqual(d2.settings.disabledSites, ['example.com', 'news.ycombinator.com'], 'falls back to sender URL');

  assert.equal(await send({ type: 'nope' }), undefined);
  assert.equal(await send({ target: 'offscreen', type: 'offscreen-play', urls: [] }), undefined);
});

test('open-options: plain and with #section', async () => {
  await send({ type: 'open-options' });
  await send({ type: 'open-options', section: 'history' });
  assert.ok(log.tabsCreated.includes('options'));
  assert.ok(log.tabsCreated.includes('chrome-extension://transpop-test/src/options/options.html#history'));
});

test('context menu "Translate": content script first, popup window fallback', async () => {
  behaviour.tabSendMessage = async () => ({ ok: true, shown: true });
  chrome.contextMenus.onClicked.dispatch({ menuItemId: 'transpop-translate', selectionText: 'bonjour', frameId: 3 }, { id: 7 });
  await flush(5);
  const last = log.tabMessages.at(-1);
  assert.deepEqual(last.msg, { type: 'show-translation', text: 'bonjour' });
  assert.deepEqual(last.opts, { frameId: 3 });
  assert.equal(log.windowsCreated.length, 0);

  behaviour.tabSendMessage = async () => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };
  chrome.contextMenus.onClicked.dispatch({ menuItemId: 'transpop-translate', selectionText: 'a & b', frameId: 0 }, { id: 7 });
  await flush(5);
  const w = log.windowsCreated.at(-1);
  assert.equal(w.url, 'chrome-extension://transpop-test/src/popup/popup.html?view=window&text=a%20%26%20b');
  assert.equal(w.type, 'popup');
  assert.equal(w.width, 460);
  assert.equal(w.height, 640);
});

test('action menu: site toggle uses the content script hostname and keeps titles in sync', async () => {
  behaviour.tabSendMessage = async (tabId, msg) => (msg.type === 'get-selection' ? { ok: true, text: '', hostname: 'docs.github.com' } : { ok: true });
  chrome.tabs.onActivated.dispatch({ tabId: 7, windowId: 1 });
  await flush(200);
  assert.equal(log.menus.get('transpop-toggle-site').enabled, true);
  assert.equal(log.menus.get('transpop-toggle-site').title, 'Turn off on docs.github.com');

  chrome.contextMenus.onClicked.dispatch({ menuItemId: 'transpop-toggle-site' }, { id: 7 });
  await flush(30);
  assert.ok(areas.sync.settings.disabledSites.includes('docs.github.com'));
  assert.equal(log.menus.get('transpop-toggle-site').title, 'Turn on on docs.github.com');

  chrome.contextMenus.onClicked.dispatch({ menuItemId: 'transpop-toggle-site', pageUrl: 'https://docs.github.com/en' }, { id: 7 });
  await flush(30);
  assert.ok(!areas.sync.settings.disabledSites.includes('docs.github.com'));
});

test('commands + badge: toggle-enabled flips settings, badge shows OFF; translate-selection messages all frames', async () => {
  chrome.commands.onCommand.dispatch('toggle-enabled', { id: 7 });
  await flush(30);
  assert.equal(areas.sync.settings.enabled, false);
  assert.equal(log.badge.text, 'OFF');
  assert.equal(log.badge.color, '#6B7280');
  assert.equal(log.menus.get('transpop-toggle-enabled').title, 'Resume TransPop everywhere');

  chrome.contextMenus.onClicked.dispatch({ menuItemId: 'transpop-toggle-enabled' }, { id: 7 });
  await flush(30);
  assert.equal(areas.sync.settings.enabled, true);
  assert.equal(log.badge.text, '');
  assert.equal(log.menus.get('transpop-toggle-enabled').title, 'Pause TransPop everywhere');

  behaviour.tabSendMessage = async () => ({ ok: true, shown: true });
  const before = log.windowsCreated.length;
  chrome.commands.onCommand.dispatch('translate-selection', { id: 7 });
  await flush(5);
  const last = log.tabMessages.at(-1);
  assert.deepEqual(last.msg, { type: 'show-translation' });
  assert.deepEqual(last.opts, {}, 'no frameId → all frames');
  assert.equal(log.windowsCreated.length, before);
});

test('speak: offscreen document created once; falls back to chrome.tts when audio fails', async () => {
  const r = await send({ type: 'speak', text: 'hello world', lang: 'en' });
  assert.equal(r.ok, true);
  assert.equal(log.offscreenCreated, 1);
  const play = log.runtimeMessages.at(-1);
  assert.equal(play.target, 'offscreen');
  assert.equal(play.type, 'offscreen-play');
  assert.match(play.urls[0], /^https:\/\/translate\.google\.com\/translate_tts\?ie=UTF-8&client=tw-ob&tl=en&q=hello\+world$/);
  assert.equal(play.rate, 1);

  await send({ type: 'speak', text: 'again', lang: 'en' });
  assert.equal(log.offscreenCreated, 1, 'existing document reused');

  behaviour.offscreenResponse = { ok: false, error: { code: 'NETWORK', message: 'blocked' } };
  const r2 = await send({ type: 'speak', text: 'shalom', lang: 'iw', rate: 0.8 });
  assert.equal(r2.ok, true);
  assert.deepEqual(log.ttsSpoken.at(-1), { text: 'shalom', lang: 'he', rate: 0.8, enqueue: false });

  const stop = await send({ type: 'stop-speak' });
  assert.equal(stop.ok, true);
  assert.equal(log.runtimeMessages.at(-1).type, 'offscreen-stop');

  assert.equal((await send({ type: 'speak', text: '  ' })).error.code, 'EMPTY');
});

/* ------------------------------------------------------------------ */
/* Image translation (ARCHITECTURE §11)                                */
/* ------------------------------------------------------------------ */

/** A data: URL whose bytes are just a PNG signature + IHDR (enough for capture.js to read the size). */
function pngDataUrl(w, h) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return `data:image/png;base64,${Buffer.from(b).toString('base64')}`;
}
const EXT_SENDER = { id: 'transpop-test', url: 'chrome-extension://transpop-test/src/capture/capture.html?id=x' };
const cropMessages = () => log.tabMessages.filter((m) => m.msg.type === 'start-crop');

test('crop-translate command: prepare → capture → start-crop to frame 0 (content script present)', async () => {
  behaviour.captureVisibleTab = async () => pngDataUrl(2560, 1600);
  behaviour.tabSendMessage = async (tabId, msg) => (msg.prepare ? { ok: true, ready: true } : { ok: true, started: true });
  const before = cropMessages().length;
  const windows = log.windowsCreated.length;
  chrome.commands.onCommand.dispatch('crop-translate', { id: 7, windowId: 1 });
  await flush(10);
  const sent = cropMessages().slice(before);
  assert.deepEqual(sent.map((m) => m.msg), [{ type: 'start-crop', prepare: true }, { type: 'start-crop', mode: 'region' }]);
  assert.ok(sent.every((m) => m.opts.frameId === 0));
  assert.equal(log.windowsCreated.length, windows, 'no fallback window');
});

test('image context menu: start-crop carries srcUrl; no receiver (and injection impossible) → capture page tab', async () => {
  behaviour.captureVisibleTab = async () => pngDataUrl(2560, 1600);
  behaviour.tabSendMessage = async () => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };
  chrome.contextMenus.onClicked.dispatch({ menuItemId: 'transpop-image', srcUrl: 'https://example.com/a.png' }, { id: 7, windowId: 1 });
  await flush(10);
  const url = log.tabsCreated.at(-1);
  assert.match(url, /^chrome-extension:\/\/transpop-test\/src\/capture\/capture\.html\?id=[\w-]+&from=7$/, 'a tab next to the source, not a window');

  const id = decodeURIComponent(url.split('id=')[1].split('&')[0]);
  const shot = await send({ type: 'get-capture', id }, EXT_SENDER);
  assert.equal(shot.ok, true);
  assert.equal(shot.width, 2560);
  assert.equal(shot.height, 1600);
  assert.match(shot.dataUrl, /^data:image\/png;base64,/);
  assert.equal((await send({ type: 'get-capture', id })).error.code, 'CAPTURE_FAILED', 'content scripts may not read screenshots');
  assert.equal((await send({ type: 'get-capture', id: 'nope' }, EXT_SENDER)).error.code, 'CAPTURE_FAILED');

  behaviour.tabSendMessage = async (tabId, msg) => (msg.prepare ? { ok: true, ready: true } : { ok: true, started: true });
  chrome.contextMenus.onClicked.dispatch({ menuItemId: 'transpop-image', srcUrl: 'https://example.com/a.png' }, { id: 7, windowId: 1 });
  await flush(10);
  assert.deepEqual(cropMessages().at(-1).msg, { type: 'start-crop', mode: 'image', srcUrl: 'https://example.com/a.png' });
});

test('capture failure: error bubble through start-crop, or the error page when no content script', async () => {
  behaviour.captureVisibleTab = async () => {
    throw new Error('Cannot access a chrome:// URL');
  };
  behaviour.tabSendMessage = async (tabId, msg) => (msg.prepare ? { ok: true, ready: true } : { ok: true, started: true });
  const r = await send({ type: 'start-capture', tabId: 7 }, { id: 'transpop-test', url: 'chrome-extension://transpop-test/src/popup/popup.html' });
  assert.equal(r.error.code, 'CAPTURE_FAILED');
  assert.deepEqual(cropMessages().at(-1).msg, { type: 'start-crop', mode: 'region', error: 'CAPTURE_FAILED' });

  behaviour.tabSendMessage = async () => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };
  const windows = log.windowsCreated.length;
  const tabs = log.tabsCreated.length;
  chrome.contextMenus.onClicked.dispatch({ menuItemId: 'transpop-area' }, { id: 7, windowId: 1 });
  await flush(10);
  assert.equal(log.windowsCreated.length, windows, 'no separate window');
  assert.equal(log.tabsCreated.length, tabs + 1);
  assert.equal(log.tabsCreated.at(-1), 'chrome-extension://transpop-test/src/capture/capture.html?error=CAPTURE_FAILED&from=7');
});

test('ocr-region: needs the tab capture; ocr-image runs OCR and remembers changed languages', async () => {
  const fromTab = { id: 'transpop-test', url: 'https://example.com/page', tab: { id: 42, windowId: 1 } };
  const noCapture = await send({ type: 'ocr-region', rect: { x: 0, y: 0, width: 50, height: 20 }, viewport: { width: 1280, height: 800 } }, fromTab);
  assert.equal(noCapture.error.code, 'CAPTURE_FAILED');

  behaviour.offscreenResponse = { ok: true, ocr: { text: 'Hello', confidence: 91, langs: ['eng', 'vie'] } };
  const r = await send({ type: 'ocr-image', dataUrl: pngDataUrl(10, 10), langs: ['vie', 'eng', 'zzz'] }, EXT_SENDER);
  assert.equal(r.ok, true);
  assert.equal(r.ocr.text, 'Hello');
  const msg = log.runtimeMessages.at(-1);
  assert.equal(msg.type, 'offscreen-ocr');
  assert.deepEqual(msg.langs, ['vie', 'eng']);
  await flush(10);
  assert.deepEqual(areas.sync.settings.ocrLanguages, ['vie', 'eng'], 'toolbar choice saved as the new default');

  await send({ type: 'ocr-image', dataUrl: pngDataUrl(10, 10) }, EXT_SENDER);
  assert.deepEqual(log.runtimeMessages.at(-1).langs, ['vie', 'eng'], 'no langs → settings.ocrLanguages');
  assert.equal((await send({ type: 'ocr-image', dataUrl: 'nope' }, EXT_SENDER)).error.code, 'OCR_FAILED');
});

test('ocr-clear-cache: extension pages only', async () => {
  behaviour.offscreenResponse = { ok: true };
  assert.equal((await send({ type: 'ocr-clear-cache' }, EXT_SENDER)).ok, true);
  assert.equal(log.runtimeMessages.at(-1).type, 'offscreen-ocr-clear');
  assert.equal((await send({ type: 'ocr-clear-cache' })).ok, false);
});
