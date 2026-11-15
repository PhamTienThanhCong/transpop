/**
 * TransPop — storage helpers (ES module). Settings live in chrome.storage.sync,
 * history / favorites / popup state in chrome.storage.local. See docs/ARCHITECTURE.md §4.
 */
import {
  DEFAULT_SETTINGS,
  LIMITS,
  MODIFIER_KEYS,
  PROVIDERS,
  STORAGE_KEYS,
  THEMES,
  TRIGGER_MODES,
  UI_LANGUAGES,
} from './constants.js';
import { normalizeOcrLanguages } from './ocr-languages.js';
import { getUiLocale, isSupportedLang, normalizeLangCode, uiLangToTarget } from './languages.js';

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const pickEnum = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const pickBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

/** Normalize a hostname for the disabled-sites list ("https://www.Example.com/x" → "example.com"). */
export function normalizeHostname(input) {
  if (!input || typeof input !== 'string') return '';
  let host = input.trim().toLowerCase();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) host = new URL(host).hostname;
  } catch {
    /* keep raw */
  }
  host = host.replace(/^\*\./, '').replace(/^www\./, '').split('/')[0].split(':')[0];
  return /^[a-z0-9.-]+$/.test(host) ? host : '';
}

/** Merge raw stored settings with defaults and validate every field. Pure (except UI-language lookup). */
export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  const d = DEFAULT_SETTINGS;

  const target = normalizeLangCode(s.targetLang);
  const targetLang = target && target !== 'auto' && isSupportedLang(target) ? target : uiLangToTarget(getUiLocale());
  const secondary = normalizeLangCode(s.secondaryLang);
  let secondaryLang = secondary && secondary !== 'auto' && isSupportedLang(secondary) ? secondary : 'en';
  if (secondaryLang === targetLang) secondaryLang = targetLang === 'en' ? 'vi' : 'en';

  const fontSize = Number.isFinite(+s.fontSize) ? Math.round(+s.fontSize) : d.fontSize;
  const speechRate = Number.isFinite(+s.speechRate) ? +s.speechRate : d.speechRate;

  return {
    enabled: pickBool(s.enabled, d.enabled),
    targetLang,
    secondaryLang,
    triggerMode: pickEnum(s.triggerMode, TRIGGER_MODES, d.triggerMode),
    modifierKey: pickEnum(s.modifierKey, MODIFIER_KEYS, d.modifierKey),
    doubleClickOnly: pickBool(s.doubleClickOnly, d.doubleClickOnly),
    provider: pickEnum(s.provider, PROVIDERS, d.provider),
    showPhonetic: pickBool(s.showPhonetic, d.showPhonetic),
    showDictionary: pickBool(s.showDictionary, d.showDictionary),
    showDefinitions: pickBool(s.showDefinitions, d.showDefinitions),
    showExamples: pickBool(s.showExamples, d.showExamples),
    autoSpeak: pickBool(s.autoSpeak, d.autoSpeak),
    speechRate: clamp(Math.round(speechRate * 10) / 10, LIMITS.SPEECH_RATE_MIN, LIMITS.SPEECH_RATE_MAX),
    theme: pickEnum(s.theme, THEMES, d.theme),
    fontSize: clamp(fontSize, LIMITS.FONT_SIZE_MIN, LIMITS.FONT_SIZE_MAX),
    disableInInputs: pickBool(s.disableInInputs, d.disableInInputs),
    disabledSites: Array.isArray(s.disabledSites)
      ? [...new Set(s.disabledSites.map(normalizeHostname).filter(Boolean))].slice(0, 500)
      : [],
    saveHistory: pickBool(s.saveHistory, d.saveHistory),
    closeOnClickOutside: pickBool(s.closeOnClickOutside, d.closeOnClickOutside),
    uiLanguage: pickEnum(s.uiLanguage, UI_LANGUAGES, d.uiLanguage),
    ocrLanguages: normalizeOcrLanguages(s.ocrLanguages),
  };
}

export async function getSettings() {
  const data = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  return normalizeSettings(data[STORAGE_KEYS.SETTINGS]);
}

/** Shallow-merge `patch` into the current settings, validate, persist, and return the new settings. */
export async function saveSettings(patch) {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...(patch || {}) });
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

export async function resetSettings() {
  const next = normalizeSettings({});
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

/** Subscribe to settings changes. Returns an unsubscribe function. */
export function onSettingsChanged(callback) {
  const listener = (changes, area) => {
    if (area === 'sync' && changes[STORAGE_KEYS.SETTINGS]) {
      callback(normalizeSettings(changes[STORAGE_KEYS.SETTINGS].newValue));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** True if in-page translation is disabled on `hostname` (exact host or any subdomain of a listed host). */
export function isSiteDisabled(settings, hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return false;
  return (settings?.disabledSites || []).some((site) => host === site || host.endsWith(`.${site}`));
}

/* ------------------------------------------------------------------ */
/* Entries (history / favorites)                                       */
/* ------------------------------------------------------------------ */

export function makeEntryKey(text, to) {
  return `${to}|${String(text || '').trim().toLowerCase()}`;
}

const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Build an Entry from a TranslationResult. */
export function entryFromResult(result) {
  const text = String(result?.text || '').trim();
  return {
    id: uuid(),
    key: makeEntryKey(text, result?.to),
    text,
    translation: String(result?.translation || ''),
    from: result?.from || 'auto',
    to: result?.to || '',
    ...(result?.phonetic ? { phonetic: result.phonetic } : {}),
    ts: Date.now(),
  };
}

async function readList(key) {
  const data = await chrome.storage.local.get(key);
  return Array.isArray(data[key]) ? data[key] : [];
}

async function writeList(key, list) {
  await chrome.storage.local.set({ [key]: list });
  return list;
}

function onListChanged(key, callback) {
  const listener = (changes, area) => {
    if (area === 'local' && changes[key]) callback(Array.isArray(changes[key].newValue) ? changes[key].newValue : []);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/* History */

export const getHistory = () => readList(STORAGE_KEYS.HISTORY);

/** Add (or move to top) an entry. Accepts an Entry or a TranslationResult. */
export async function addHistoryEntry(entryOrResult) {
  const entry = entryOrResult?.key ? entryOrResult : entryFromResult(entryOrResult);
  if (!entry.text || !entry.translation) return getHistory();
  const list = (await getHistory()).filter((e) => e.key !== entry.key);
  list.unshift(entry);
  return writeList(STORAGE_KEYS.HISTORY, list.slice(0, LIMITS.HISTORY_MAX));
}

export async function removeHistoryEntry(id) {
  return writeList(
    STORAGE_KEYS.HISTORY,
    (await getHistory()).filter((e) => e.id !== id),
  );
}

export const clearHistory = () => writeList(STORAGE_KEYS.HISTORY, []);
export const onHistoryChanged = (cb) => onListChanged(STORAGE_KEYS.HISTORY, cb);

/* Favorites */

export const getFavorites = () => readList(STORAGE_KEYS.FAVORITES);

export async function isFavorite(text, to) {
  const key = makeEntryKey(text, to);
  return (await getFavorites()).some((e) => e.key === key);
}

/** Toggle favorite for an Entry or TranslationResult. Returns true if it is now a favorite. */
export async function toggleFavorite(entryOrResult) {
  const entry = entryOrResult?.key ? entryOrResult : entryFromResult(entryOrResult);
  const list = await getFavorites();
  const exists = list.some((e) => e.key === entry.key);
  if (exists) {
    await writeList(
      STORAGE_KEYS.FAVORITES,
      list.filter((e) => e.key !== entry.key),
    );
    return false;
  }
  list.unshift({ ...entry, ts: Date.now() });
  await writeList(STORAGE_KEYS.FAVORITES, list.slice(0, LIMITS.FAVORITES_MAX));
  return true;
}

export async function removeFavorite(id) {
  return writeList(
    STORAGE_KEYS.FAVORITES,
    (await getFavorites()).filter((e) => e.id !== id),
  );
}

export const clearFavorites = () => writeList(STORAGE_KEYS.FAVORITES, []);
export const onFavoritesChanged = (cb) => onListChanged(STORAGE_KEYS.FAVORITES, cb);

/* ------------------------------------------------------------------ */
/* Popup state                                                         */
/* ------------------------------------------------------------------ */

export async function getPopupState() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.POPUP_STATE);
  return data[STORAGE_KEYS.POPUP_STATE] || { text: '', from: 'auto', to: null };
}

export async function savePopupState(state) {
  await chrome.storage.local.set({ [STORAGE_KEYS.POPUP_STATE]: state });
}

/* ------------------------------------------------------------------ */
/* Export / import                                                     */
/* ------------------------------------------------------------------ */

export async function exportData() {
  const [settings, history, favorites] = await Promise.all([getSettings(), getHistory(), getFavorites()]);
  return {
    app: 'transpop',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    history,
    favorites,
  };
}

const isValidEntry = (e) => e && typeof e.text === 'string' && typeof e.translation === 'string' && typeof e.to === 'string';

/** Import a previously exported object. Merges favorites/history (de-duplicated by key). Returns counts. */
export async function importData(data) {
  if (!data || data.app !== 'transpop') throw new Error('INVALID_FILE');
  const result = { settings: false, history: 0, favorites: 0 };
  if (data.settings && typeof data.settings === 'object') {
    await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: normalizeSettings(data.settings) });
    result.settings = true;
  }
  const merge = async (key, incoming, max) => {
    if (!Array.isArray(incoming)) return 0;
    const current = await readList(key);
    const seen = new Set(current.map((e) => e.key));
    const fresh = incoming
      .filter(isValidEntry)
      .map((e) => ({ ...e, id: e.id || uuid(), key: e.key || makeEntryKey(e.text, e.to), ts: Number(e.ts) || Date.now() }))
      .filter((e) => !seen.has(e.key) && seen.add(e.key));
    await writeList(key, [...current, ...fresh].sort((a, b) => b.ts - a.ts).slice(0, max));
    return fresh.length;
  };
  result.history = await merge(STORAGE_KEYS.HISTORY, data.history, LIMITS.HISTORY_MAX);
  result.favorites = await merge(STORAGE_KEYS.FAVORITES, data.favorites, LIMITS.FAVORITES_MAX);
  return result;
}
