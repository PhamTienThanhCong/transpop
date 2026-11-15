/**
 * Display language (docs/ARCHITECTURE.md §10): Chrome-compatible message formatting, the UI-locale override,
 * initI18n() on extension pages, the service worker's `get-ui-messages` payload / bgT(), and the content
 * script's duplicated formatter + dictionary-backed t().
 *
 *   node --test tests/shared/
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDictionary,
  formatMessage,
  getCurrentUiLocale,
  getUiLanguageSetting,
  initI18n,
  lookupMessage,
  setUiMessages,
  t,
  uiDir,
} from '../../extension/src/shared/i18n.js';
import { getLanguageName, getLanguageOptions, getUiLocale, setUiLocaleOverride } from '../../extension/src/shared/languages.js';
import { bgT, ensureUiMessages, getUiMessages, loadedUiLanguage } from '../../extension/src/background/ui-messages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const LOCALES = { en: readJson('extension/_locales/en/messages.json'), vi: readJson('extension/_locales/vi/messages.json') };
const FRAGMENTS = ['background', 'common', 'content', 'meta', 'options', 'popup'].map((f) => readJson(`i18n/${f}.json`));

/* ------------------------------------------------------------------ */
/* chrome.* / fetch stubs                                              */
/* ------------------------------------------------------------------ */

const env = { browserLang: 'en-US', settings: undefined, fetchFails: false, fetches: [] };

/** Minimal chrome.i18n behaving like the browser in `env.browserLang` (en messages, Chrome substitution). */
globalThis.chrome = {
  runtime: { id: 'test', getURL: (p) => `chrome-extension://test/${p.replace(/^\//, '')}` },
  i18n: {
    getUILanguage: () => env.browserLang,
    getMessage: (key, subs) => {
      if (key === '@@bidi_dir') return 'ltr';
      const entry = LOCALES.en[key] || Object.entries(LOCALES.en).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
      return entry ? formatMessage(entry, subs) : '';
    },
  },
  storage: {
    sync: { get: async () => (env.settings ? { settings: env.settings } : {}) },
    onChanged: { addListener() {}, removeListener() {} },
  },
};

globalThis.fetch = async (url) => {
  env.fetches.push(String(url));
  const m = /^chrome-extension:\/\/test\/_locales\/([\w-]+)\/messages\.json$/.exec(String(url));
  if (env.fetchFails || !m || !LOCALES[m[1]]) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => structuredClone(LOCALES[m[1]]) };
};

const realWarn = console.warn;
beforeEach(() => {
  console.warn = (...args) => {
    if (!env.fetchFails) realWarn(...args); // load failures below are expected
  };
  env.browserLang = 'en-US';
  env.settings = undefined;
  env.fetchFails = false;
  env.fetches = [];
});

/* ------------------------------------------------------------------ */
/* formatMessage — Chrome substitution rules                           */
/* ------------------------------------------------------------------ */

const ph = (n) => ({ content: `$${n}` });

test('formatMessage: named placeholders resolve through placeholders[name].content (case-insensitive)', () => {
  assert.equal(formatMessage({ message: 'Turn off on $P1$', placeholders: { p1: ph(1) } }, 'example.com'), 'Turn off on example.com');
  assert.equal(formatMessage({ message: 'Hi $User$!', placeholders: { USER: ph(1) } }, ['Ann']), 'Hi Ann!');
  // Re-ordered placeholders (a translation may swap them).
  const entry = { message: '$P2$ of $P1$', placeholders: { p1: ph(1), p2: ph(2) } };
  assert.equal(formatMessage(entry, ['10', '3']), '3 of 10');
  // Literal placeholder content, and content mixing text + substitution.
  assert.equal(formatMessage({ message: 'by $brand$', placeholders: { brand: { content: 'TransPop' } } }), 'by TransPop');
  assert.equal(formatMessage({ message: '[$x$]', placeholders: { x: { content: '<$1>' } } }, 'a'), '[<a>]');
  assert.equal(formatMessage({ message: '$a b$c$', placeholders: { c: { content: 'C' } } }), ' bC', 'invalid names are not placeholders (then $a is dropped)');
});

test('formatMessage: bare positional $1..$9, numbers and string subs', () => {
  assert.equal(formatMessage({ message: '$1 → $2' }, ['en', 'vi']), 'en → vi');
  assert.equal(formatMessage('$1 items', 3), '3 items', 'string entry + number sub');
  assert.equal(formatMessage({ message: '$1$1' }, 'ab'), 'abab');
  assert.equal(formatMessage({ message: '$9' }, ['1', '2', '3', '4', '5', '6', '7', '8', 'nine']), 'nine');
  assert.equal(formatMessage({ message: 'x' }, 'unused'), 'x');
});

test('formatMessage: missing substitutions become empty strings', () => {
  assert.equal(formatMessage({ message: 'Hello $1!' }), 'Hello !');
  assert.equal(formatMessage({ message: '$P1$ and $P2$', placeholders: { p1: ph(1), p2: ph(2) } }, ['one']), 'one and ');
  assert.equal(formatMessage({ message: '$1' }, null), '');
});

test('formatMessage: $$ → $, other $x pairs and a trailing $ are dropped, values are never re-scanned', () => {
  assert.equal(formatMessage({ message: 'Price: $$5' }), 'Price: $5');
  assert.equal(formatMessage({ message: '$$$' }), '$$', 'Chrome emits one $ per extra $');
  assert.equal(formatMessage({ message: 'a$xb' }), 'ab');
  assert.equal(formatMessage({ message: 'a$0b' }), 'ab');
  assert.equal(formatMessage({ message: 'end$' }), 'end');
  assert.equal(formatMessage({ message: '$1 / $2' }, ['$2', '$$']), '$2 / $$', 'substituted values are inserted verbatim');
  assert.equal(formatMessage({ message: '$P1$', placeholders: { p1: ph(1) } }, '$P1$'), '$P1$');
});

test('formatMessage: empty / malformed entries', () => {
  assert.equal(formatMessage(undefined), '');
  assert.equal(formatMessage(null, ['a']), '');
  assert.equal(formatMessage({}), '');
  assert.equal(formatMessage({ message: 'ok', placeholders: { p1: null } }), 'ok');
});

test('every generated message formats back to its i18n/*.json source text', () => {
  const subs = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'I9'];
  let checked = 0;
  for (const fragment of FRAGMENTS) {
    for (const [key, src] of Object.entries(fragment)) {
      for (const loc of ['en', 'vi']) {
        const expected = src[loc].replace(/\$\$/g, '\u0000').replace(/\$([1-9])/g, (_, n) => subs[n - 1]).replace(/\u0000/g, '$');
        assert.equal(formatMessage(LOCALES[loc][key], subs), expected, `${loc}:${key}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 200);
});

test('createDictionary + lookupMessage: case-insensitive keys, "" when missing', () => {
  const dict = createDictionary({ Hello_World: { message: 'Hi $1' }, broken: { nope: true } });
  assert.equal(lookupMessage(dict, 'hello_world', 'you'), 'Hi you');
  assert.equal(lookupMessage(dict, 'HELLO_WORLD', ['x']), 'Hi x');
  assert.equal(lookupMessage(dict, 'broken'), '');
  assert.equal(lookupMessage(dict, 'missing'), '');
  assert.equal(lookupMessage(null, 'hello_world'), '');
  assert.equal(createDictionary(null).size, 0);
});

/* ------------------------------------------------------------------ */
/* languages.js — UI locale override                                   */
/* ------------------------------------------------------------------ */

test('setUiLocaleOverride: getUiLocale(), language names and option sorting follow the override', () => {
  assert.equal(getUiLocale(), 'en-US');
  assert.equal(getLanguageName('en'), 'English');
  setUiLocaleOverride('vi');
  try {
    assert.equal(getUiLocale(), 'vi');
    assert.equal(getLanguageName('en'), 'Tiếng Anh');
    assert.equal(getLanguageName('vi'), 'Tiếng Việt');
    assert.equal(getLanguageName('en', 'en'), 'English', 'an explicit locale still wins');
    assert.equal(getLanguageOptions().find((o) => o.code === 'fr').name, 'Tiếng Pháp');
  } finally {
    setUiLocaleOverride(null);
  }
  assert.equal(getUiLocale(), 'en-US');
  assert.equal(getLanguageName('en'), 'English', 'cache does not leak the previous locale');
  setUiLocaleOverride('  ');
  assert.equal(getUiLocale(), 'en-US', 'blank override = no override');
});

/* ------------------------------------------------------------------ */
/* i18n.js — initI18n() on extension pages                             */
/* ------------------------------------------------------------------ */

test('initI18n: "auto" keeps chrome.i18n (no fetch)', async () => {
  env.settings = { uiLanguage: 'auto' };
  const locale = await initI18n({ force: true });
  assert.equal(locale, 'en-US');
  assert.equal(env.fetches.length, 0);
  assert.equal(getUiLanguageSetting(), 'auto');
  assert.equal(t('common_close'), 'Close');
  assert.equal(t('options_version', '1.2.3'), LOCALES.en.options_version.message.replace('$P1$', '1.2.3'));
  assert.equal(t('no_such_key'), 'no_such_key');
});

test('initI18n: an explicit display language loads its messages.json; t(), locale, names and dir follow it', async () => {
  env.settings = { uiLanguage: 'vi' };
  const locale = await initI18n({ force: true });
  try {
    assert.equal(locale, 'vi');
    assert.deepEqual(env.fetches, ['chrome-extension://test/_locales/vi/messages.json']);
    assert.equal(getUiLanguageSetting(), 'vi');
    assert.equal(getCurrentUiLocale(), 'vi');
    assert.equal(getUiLocale(), 'vi', 'languages.js override set by initI18n');
    assert.equal(getLanguageName('ja'), 'Tiếng Nhật');
    assert.equal(t('common_close'), LOCALES.vi.common_close.message);
    assert.equal(t('COMMON_CLOSE'), LOCALES.vi.common_close.message, 'keys are case-insensitive like Chrome');
    assert.equal(t('common_detected_language', 'Tiếng Anh'), LOCALES.vi.common_detected_language.message.replace('$P1$', 'Tiếng Anh'));
    assert.equal(t('@@ui_locale'), 'vi');
    assert.equal(t('@@bidi_dir'), 'ltr');
    assert.equal(uiDir(), 'ltr');
    assert.equal(t('no_such_key'), 'no_such_key', 'falls back to chrome.i18n, then the key');
    // Shared promise unless forced.
    assert.equal(await initI18n(), 'vi');
    assert.equal(env.fetches.length, 1);
  } finally {
    await initI18n({ uiLanguage: 'auto' });
  }
  assert.equal(getUiLocale(), 'en-US', 'back to the browser locale');
  assert.equal(t('common_close'), 'Close');
});

test('initI18n: explicit uiLanguage option skips the settings; failures fall back to the browser language', async () => {
  env.settings = { uiLanguage: 'vi' };
  assert.equal(await initI18n({ uiLanguage: 'en' }), 'en');
  assert.equal(t('common_close'), 'Close');
  assert.equal(getUiLocale(), 'en');

  env.fetchFails = true;
  assert.equal(await initI18n({ uiLanguage: 'vi' }), 'en-US');
  assert.equal(getUiLanguageSetting(), 'vi', 'remembers what was requested (no reload loop)');
  assert.equal(getUiLocale(), 'en-US');
  assert.equal(t('common_close'), 'Close');

  assert.equal(await initI18n({ uiLanguage: 'xx' }), 'en-US', 'unknown values are treated as auto');
  assert.equal(getUiLanguageSetting(), 'auto');
  setUiMessages(null, null);
});

test('RTL display languages flip uiDir() (future-proofing)', () => {
  setUiMessages('ar', { hello: { message: 'مرحبا' } });
  try {
    assert.equal(uiDir(), 'rtl');
    assert.equal(t('@@bidi_start_edge'), 'right');
    assert.equal(t('hello'), 'مرحبا');
  } finally {
    setUiMessages(null, null);
  }
  assert.equal(uiDir(), 'ltr');
});

/* ------------------------------------------------------------------ */
/* background/ui-messages.js — get-ui-messages + bgT()                 */
/* ------------------------------------------------------------------ */

test('service worker: get-ui-messages payload and bgT() follow settings.uiLanguage', async () => {
  env.settings = { uiLanguage: 'auto' };
  assert.deepEqual(await getUiMessages(), { locale: 'en-US', messages: null });
  assert.equal(bgT('bg_ctx_pause'), LOCALES.en.bg_ctx_pause.message);

  env.settings = { uiLanguage: 'vi' };
  const res = await getUiMessages();
  assert.equal(res.locale, 'vi');
  assert.equal(res.messages.bubble_trigger_label.message, LOCALES.vi.bubble_trigger_label.message);
  assert.deepEqual(res.messages.common_detected_language.placeholders, { p1: { content: '$1' } });
  assert.ok(Object.keys(res.messages).every((k) => /^(bubble|common)_/.test(k)), 'only the in-page UI subset is sent');
  assert.equal(res.messages.bubble_trigger_label.description, undefined, 'descriptions stripped');
  assert.equal(loadedUiLanguage(), 'vi');
  assert.equal(bgT('bg_ctx_site_off', 'example.com'), LOCALES.vi.bg_ctx_site_off.message.replace('$P1$', 'example.com'));
  assert.equal(bgT('actionTitle'), LOCALES.vi.actionTitle.message);

  await getUiMessages();
  assert.equal(env.fetches.length, 1, 'dictionary cached while the setting is unchanged');

  env.settings = { uiLanguage: 'en' };
  await ensureUiMessages();
  assert.equal(bgT('bg_ctx_pause'), LOCALES.en.bg_ctx_pause.message, 'invalidated when the setting changes');
  assert.equal(env.fetches.length, 2);

  env.fetchFails = true;
  env.settings = { uiLanguage: 'vi' };
  assert.deepEqual(await getUiMessages(), { locale: 'en-US', messages: null }, 'load failure → content keeps chrome.i18n');
  env.fetchFails = false;
  assert.equal((await getUiMessages()).locale, 'vi', 'failures are not cached');
  await ensureUiMessages({ uiLanguage: 'auto' });
  assert.equal(bgT('bg_ctx_pause'), LOCALES.en.bg_ctx_pause.message);
});

/* ------------------------------------------------------------------ */
/* content script — duplicated formatter + dictionary-backed G.t       */
/* ------------------------------------------------------------------ */

function loadContent({ uiLang = 'en' } = {}) {
  const read = (f) => readFileSync(path.join(ROOT, 'extension/src/content', f), 'utf8');
  const ctx = vm.createContext({
    chrome: { runtime: { id: 'test' }, i18n: { getUILanguage: () => uiLang, getMessage: (k) => (k === 'bubble_x' ? 'browser' : '') } },
  });
  for (const f of ['core.js', 'languages.js']) vm.runInContext(read(f), ctx, { filename: f });
  return ctx.__transpopContent;
}

test('content formatMessage matches the shared one (keep-in-sync guard)', () => {
  const G = loadContent();
  const cases = [
    [{ message: 'Turn off on $P1$', placeholders: { p1: ph(1) } }, ['x.com']],
    [{ message: '$P2$ of $P1$', placeholders: { P1: ph(1), p2: ph(2) } }, ['10', '3']],
    [{ message: '$1 → $2 $3' }, ['a', 'b']],
    [{ message: 'Price $$5 $$$ end$' }, undefined],
    [{ message: 'a$xb$0c' }, ['z']],
    [{ message: '$1 / $2' }, ['$2', '$$']],
    [{ message: 'by $brand$ $nope$', placeholders: { brand: { content: 'T' } } }, undefined],
    ['$1 items', 3],
    [null, ['a']],
    ...Object.values(LOCALES.vi).map((e) => [e, ['A', 'B', 'C']]),
  ];
  for (const [entry, subs] of cases) assert.equal(G.formatMessage(entry, subs), formatMessage(entry, subs), JSON.stringify(entry));
});

test('content G.t prefers the get-ui-messages dictionary; uiLocale/uiDir/names follow it', () => {
  const G = loadContent({ uiLang: 'en-US' });
  let calls = 0;
  G.onUiLanguageChange(() => calls++);
  assert.equal(G.t('bubble_x'), 'browser');
  assert.equal(G.t('bubble_y'), '');
  assert.equal(G.uiLocale(), 'en-US');
  assert.equal(G.lang.name('en'), 'English');

  G.setUiMessages('vi', { Bubble_X: { message: 'Xin chào $P1$', placeholders: { p1: ph(1) } } });
  assert.equal(calls, 1);
  assert.equal(G.t('bubble_x', ['Ann']), 'Xin chào Ann');
  assert.equal(G.t('bubble_y'), '', 'missing → chrome.i18n → ""');
  assert.equal(G.uiLocale(), 'vi');
  assert.equal(G.uiDir(), 'ltr');
  assert.equal(G.lang.name('en'), 'Tiếng Anh');
  assert.equal(G.lang.uiTarget(), 'vi');

  G.setUiMessages('vi', { bubble_x: { message: 'same locale' } });
  assert.equal(calls, 1, 'no change notification for the same locale');

  G.setUiMessages('ar', { bubble_x: { message: 'x' } });
  assert.equal(G.uiDir(), 'rtl');

  G.setUiMessages('en-US', null); // 'auto' answer
  assert.equal(calls, 3);
  assert.equal(G.t('bubble_x'), 'browser');
  assert.equal(G.uiLocale(), 'en-US');
  G.setUiMessages(null, null);
  assert.equal(calls, 3, 'already following the browser');
});
