/**
 * TransPop — i18n helpers for extension pages (ES module).
 * Strings come from extension/_locales/<lang>/messages.json, generated from i18n/*.json.
 *
 * Display language (docs/ARCHITECTURE.md §10): `settings.uiLanguage` is 'auto' (follow the browser, i.e. plain
 * chrome.i18n) or a locale we ship ('en', 'vi'). Every extension page boots like this:
 *
 *   import { initI18n, localizeDocument, reloadOnUiLanguageChange, t } from '../shared/i18n.js';
 *   await initI18n();            // BEFORE localizeDocument(), t(), language lists, Intl formatters
 *   localizeDocument();
 *   reloadOnUiLanguageChange();  // the page reloads itself when the user picks another display language
 *
 * After initI18n(), t() reads the chosen locale's messages.json and getUiLocale() (languages.js) returns that
 * locale, so language names, relative times and `<html lang/dir>` follow it too.
 */
import { UI_LANGUAGES } from './constants.js';
import { getUiLocale, isRtl, normalizeLangCode, setUiLocaleOverride } from './languages.js';
import { getSettings, onSettingsChanged } from './storage.js';

/* ------------------------------------------------------------------ */
/* Chrome message format                                               */
/* ------------------------------------------------------------------ */

const NAMED_PLACEHOLDER_RE = /\$([A-Za-z0-9_@]+)\$/g;

/**
 * Format one messages.json entry exactly like chrome.i18n.getMessage() does — PURE, unit-tested.
 * (The content script has a copy in src/content/core.js — keep the two in sync.)
 *
 *  1. `$name$` → `placeholders[name].content` (names are case-insensitive; Chrome refuses to load a file using an
 *     undefined name, so those are simply left to step 2).
 *  2. Then, in one pass over the result: `$1`…`$9` → substitution n (missing → ''), `$$` → `$`; any other `$x`
 *     pair and a trailing `$` are dropped. Substituted values are never re-scanned.
 *
 * @param {{message: string, placeholders?: Record<string, {content: string}>} | string} entry
 * @param {string | number | Array<string | number>} [subs]  up to 9 substitutions
 * @returns {string}
 */
export function formatMessage(entry, subs) {
  const raw = typeof entry === 'string' ? entry : entry && typeof entry.message === 'string' ? entry.message : '';
  if (!raw) return '';
  const placeholders = {};
  if (entry && typeof entry === 'object' && entry.placeholders && typeof entry.placeholders === 'object') {
    for (const [name, ph] of Object.entries(entry.placeholders)) {
      if (ph && typeof ph.content === 'string') placeholders[name.toLowerCase()] = ph.content;
    }
  }
  const message = raw.replace(NAMED_PLACEHOLDER_RE, (match, name) => placeholders[name.toLowerCase()] ?? match);
  const values = subs === undefined || subs === null ? [] : [].concat(subs).slice(0, 9).map(String);
  if (!message.includes('$')) return message;
  let out = '';
  for (let i = 0; i < message.length; i++) {
    const ch = message[i];
    if (ch !== '$') {
      out += ch;
      continue;
    }
    const next = message[++i];
    if (next === undefined) break; // trailing '$'
    if (next === '$') {
      while (message[i] === '$') {
        out += '$'; // "$$" → "$", "$$$" → "$$" (Chrome's ReplaceStringPlaceholders)
        i++;
      }
      i--;
    } else if (next >= '1' && next <= '9') {
      out += values[next.charCodeAt(0) - 49] ?? '';
    }
  }
  return out;
}

/** messages.json object → Map(lower-cased key → entry). Chrome treats message names case-insensitively. */
export function createDictionary(messages) {
  const dict = new Map();
  if (!messages || typeof messages !== 'object') return dict;
  for (const [key, entry] of Object.entries(messages)) {
    if (entry && typeof entry.message === 'string') dict.set(key.toLowerCase(), entry);
  }
  return dict;
}

/** Look `key` up in a dictionary built by createDictionary() and format it. '' when missing. */
export function lookupMessage(dict, key, subs) {
  if (!dict || typeof key !== 'string') return '';
  const entry = dict.get(key.toLowerCase());
  return entry ? formatMessage(entry, subs) : '';
}

/** Fetch a packaged extension/_locales/<code>/messages.json (raw Chrome format). Throws on failure. */
export async function fetchLocaleMessages(code) {
  if (!UI_LANGUAGES.includes(code) || code === 'auto') throw new Error(`Unsupported UI language: ${code}`);
  const res = await fetch(chrome.runtime.getURL(`_locales/${code}/messages.json`));
  if (!res.ok) throw new Error(`HTTP ${res.status} for _locales/${code}/messages.json`);
  const json = await res.json();
  if (!json || typeof json !== 'object') throw new Error(`Invalid _locales/${code}/messages.json`);
  return json;
}

/* ------------------------------------------------------------------ */
/* Page state                                                          */
/* ------------------------------------------------------------------ */

const pickUiLanguage = (value) => (UI_LANGUAGES.includes(value) ? value : 'auto');

const state = {
  requested: 'auto', // settings.uiLanguage this page was initialised with (even if loading it failed)
  locale: null, // override locale whose dictionary is active, null = chrome.i18n
  dict: null,
  promise: null,
};

/** Activate (or, with `messages` null, clear) the override dictionary. Mostly for initI18n() and tests. */
export function setUiMessages(locale, messages) {
  const active = Boolean(locale && messages && typeof messages === 'object');
  state.locale = active ? locale : null;
  state.dict = active ? createDictionary(messages) : null;
  setUiLocaleOverride(state.locale);
}

async function load(uiLanguage) {
  let lang = 'auto';
  try {
    lang = pickUiLanguage(uiLanguage === undefined ? (await getSettings()).uiLanguage : uiLanguage);
  } catch (err) {
    console.warn('[TransPop] i18n: could not read settings, following the browser language', err?.message || err);
  }
  state.requested = lang;
  if (lang === 'auto') {
    setUiMessages(null, null);
  } else {
    try {
      setUiMessages(lang, await fetchLocaleMessages(lang));
    } catch (err) {
      console.warn(`[TransPop] i18n: could not load "${lang}", following the browser language`, err?.message || err);
      setUiMessages(null, null);
    }
  }
  return getCurrentUiLocale();
}

/**
 * Apply the Display-language setting to this page. Await it once at start-up, before localizeDocument(),
 * t(), language lists or Intl formatters are used. Resolves with the effective UI locale (e.g. 'vi', or the
 * browser's 'en-US' for 'auto'); never rejects — on any failure the page keeps following the browser language.
 * Repeated calls share the first load, unless `force` or an explicit `uiLanguage` is passed.
 *
 * @param {{uiLanguage?: 'auto'|'en'|'vi', force?: boolean}} [options]  `uiLanguage` skips reading the settings
 * @returns {Promise<string>}
 */
export function initI18n({ uiLanguage, force = false } = {}) {
  if (!state.promise || force || uiLanguage !== undefined) state.promise = load(uiLanguage);
  return state.promise;
}

/** The `settings.uiLanguage` value the page was initialised with ('auto' before initI18n()). */
export function getUiLanguageSetting() {
  return state.requested;
}

/** Effective UI locale: the Display-language override once initI18n() loaded it, else the browser locale. */
export function getCurrentUiLocale() {
  return state.locale || getUiLocale();
}

/**
 * Reload the page when `settings.uiLanguage` changes (from this page or any other). Call after initI18n().
 * `beforeReload()` may flush pending work first. Returns an unsubscribe function.
 */
export function reloadOnUiLanguageChange(beforeReload) {
  return onSettingsChanged((settings) => {
    if (pickUiLanguage(settings.uiLanguage) === state.requested) return;
    try {
      beforeReload?.();
    } catch {
      /* ignore */
    }
    location.reload();
  });
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

/** Chrome's predefined @@ messages for the override locale. */
function predefined(key) {
  const rtl = uiDir() === 'rtl';
  switch (key.toLowerCase()) {
    case '@@ui_locale':
      return state.locale.replace(/-/g, '_');
    case '@@bidi_dir':
      return rtl ? 'rtl' : 'ltr';
    case '@@bidi_reversed_dir':
      return rtl ? 'ltr' : 'rtl';
    case '@@bidi_start_edge':
      return rtl ? 'right' : 'left';
    case '@@bidi_end_edge':
      return rtl ? 'left' : 'right';
    default:
      return '';
  }
}

/**
 * Translate a message key. `subs` may be a string or an array of up to 9 substitutions ($1..$9).
 * Fallback chain: Display-language dictionary (after initI18n) → chrome.i18n.getMessage → the key itself.
 */
export function t(key, subs) {
  if (state.dict && typeof key === 'string') {
    const msg = key.startsWith('@@') ? predefined(key) : lookupMessage(state.dict, key, subs);
    if (msg) return msg;
  }
  try {
    const msg = chrome.i18n.getMessage(key, subs === undefined ? undefined : [].concat(subs).map(String));
    return msg || key;
  } catch {
    return key;
  }
}

/** UI language direction ('ltr' | 'rtl') for the effective UI locale. */
export function uiDir() {
  if (state.locale) return isRtl(normalizeLangCode(state.locale)) ? 'rtl' : 'ltr';
  try {
    return chrome.i18n.getMessage('@@bidi_dir') || 'ltr';
  } catch {
    return 'ltr';
  }
}

/**
 * Localize a DOM subtree:
 *   data-i18n="key"             → textContent
 *   data-i18n-placeholder="key" → placeholder
 *   data-i18n-title="key"       → title
 *   data-i18n-aria-label="key"  → aria-label
 * Also sets <html lang/dir> (effective UI locale) when called on the whole document.
 */
export function localizeDocument(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
  if (root === document) {
    document.documentElement.lang = getCurrentUiLocale();
    document.documentElement.dir = uiDir();
    const titleKey = document.documentElement.dataset.i18nDocTitle;
    if (titleKey) document.title = t(titleKey);
  }
}

/** Relative time like "3 min ago" using Intl.RelativeTimeFormat in the effective UI locale. */
export function formatRelativeTime(ts, now = Date.now()) {
  let locale = getCurrentUiLocale();
  let rtf;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  } catch {
    locale = 'en';
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  }
  const diff = Math.round((ts - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ts).toLocaleDateString(locale);
}
