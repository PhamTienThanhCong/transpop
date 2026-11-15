/**
 * TransPop — background service worker (module). All listeners are registered synchronously at top level
 * so that events which wake the worker are never missed. See docs/ARCHITECTURE.md §5.
 */
import { ERROR_CODES, LIMITS, MSG } from '../shared/constants.js';
import { createHandler, makeError } from '../shared/messaging.js';
import { getUiLocale, normalizeLangCode } from '../shared/languages.js';
import {
  addHistoryEntry,
  getSettings,
  isFavorite,
  isSiteDisabled,
  normalizeHostname,
  onSettingsChanged,
  saveSettings,
  toggleFavorite,
} from '../shared/storage.js';
import { translate } from './translator.js';
import { LRUCache, makeCacheKey } from './cache.js';
import * as tts from './tts.js';
import { updateBadge } from './badge.js';
import { handleCommand, handleMenuClick, refreshActionMenus, scheduleRefresh, setupContextMenus } from './context-menus.js';

const WELCOME_PAGE = 'src/welcome/welcome.html';
const OPTIONS_PAGE = 'src/options/options.html';

const logError = (label) => (err) => console.warn(`[TransPop] ${label}:`, err?.message || err);

/* ------------------------------------------------------------------ */
/* Translate (settings-aware, cached, history)                         */
/* ------------------------------------------------------------------ */

const cache = new LRUCache(LIMITS.CACHE_MAX);
const inflight = new Map(); // cache key → Promise<TranslationResult> (de-duplicates concurrent requests)
let historyChain = Promise.resolve();

const uiLang = () => normalizeLangCode(getUiLocale()) || 'en';

/** Serialize history writes so quick successive translations don't race (read-modify-write). */
function recordHistory(result) {
  historyChain = historyChain.then(() => addHistoryEntry(result)).catch(logError('history'));
  return historyChain;
}

async function handleTranslate(msg) {
  const settings = await getSettings();
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  if (!text) throw makeError(ERROR_CODES.EMPTY, 'Nothing to translate');
  if (text.length > LIMITS.MAX_TEXT_LENGTH) throw makeError(ERROR_CODES.TOO_LONG, 'Text is too long');

  const from = normalizeLangCode(msg.from || 'auto');
  if (!from) throw makeError(ERROR_CODES.UNSUPPORTED_LANG, `Unsupported source language: ${msg.from}`);
  const explicitTo = msg.to && msg.to !== 'auto' ? normalizeLangCode(msg.to) : null;
  if (msg.to && msg.to !== 'auto' && !explicitTo) throw makeError(ERROR_CODES.UNSUPPORTED_LANG, `Unsupported target language: ${msg.to}`);

  const to = explicitTo || settings.targetLang;
  const swapTo = explicitTo ? undefined : settings.secondaryLang; // smart swap only when `to` is omitted
  const provider = settings.provider;
  const key = makeCacheKey({ provider, from, to, swapTo, text });

  let result;
  const hit = cache.get(key);
  if (hit) {
    result = { ...hit, cached: true };
  } else {
    let pending = inflight.get(key);
    if (!pending) {
      pending = translate({ text, from, to, swapTo, provider, uiLang: uiLang() }).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    const fresh = await pending;
    cache.set(key, fresh);
    result = { ...fresh };
  }

  if (settings.saveHistory && msg.record !== false && msg.source !== 'welcome') await recordHistory(result);
  return { result };
}

/* ------------------------------------------------------------------ */
/* Other handlers                                                      */
/* ------------------------------------------------------------------ */

function hostFromSender(sender) {
  for (const url of [sender?.tab?.url, sender?.url, sender?.origin]) {
    if (!url) continue;
    try {
      const host = normalizeHostname(new URL(url).hostname);
      if (host) return host;
    } catch {
      /* ignore */
    }
  }
  return '';
}

async function disableSite(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) throw makeError(ERROR_CODES.UNKNOWN, 'Invalid hostname');
  const settings = await getSettings();
  if (isSiteDisabled(settings, host)) return settings;
  return saveSettings({ disabledSites: [...settings.disabledSites, host] });
}

async function openOptions(section) {
  const clean = typeof section === 'string' ? section.replace(/[^\w-]/g, '') : '';
  if (!clean) {
    await chrome.runtime.openOptionsPage();
    return;
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL(`${OPTIONS_PAGE}#${clean}`) });
}

function assertResult(result) {
  if (!result || typeof result.text !== 'string' || !result.text.trim() || typeof result.translation !== 'string' || !result.to) {
    throw makeError(ERROR_CODES.UNKNOWN, 'Invalid translation result');
  }
  return result;
}

const handleMessage = createHandler({
  [MSG.TRANSLATE]: handleTranslate,
  [MSG.SPEAK]: async (msg) => {
    const rate = msg.rate ?? (await getSettings()).speechRate;
    await tts.speak(msg.text, msg.lang, rate);
    return {};
  },
  [MSG.STOP_SPEAK]: async () => {
    await tts.stop();
    return {};
  },
  [MSG.GET_SETTINGS]: async () => ({ settings: await getSettings() }),
  [MSG.OPEN_OPTIONS]: async (msg) => {
    await openOptions(msg.section);
    return {};
  },
  [MSG.TOGGLE_FAVORITE]: async (msg) => ({ favorited: await toggleFavorite(assertResult(msg.result)) }),
  [MSG.CHECK_FAVORITE]: async (msg) => ({
    favorited: typeof msg.text === 'string' && msg.text.trim() && msg.to ? await isFavorite(msg.text, msg.to) : false,
  }),
  [MSG.DISABLE_SITE]: async (msg, sender) => ({ settings: await disableSite(msg.hostname || hostFromSender(sender)) }),
});

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

async function onInstalled({ reason }) {
  let settings;
  if (reason === 'install') {
    settings = await saveSettings({}); // persist normalized defaults (targetLang resolved from the UI language)
    chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PAGE) }).catch(logError('open welcome'));
  } else {
    settings = await getSettings();
  }
  await setupContextMenus();
  await updateBadge(settings);
}

async function syncUi() {
  const settings = await getSettings();
  await updateBadge(settings);
  return settings;
}

/* ------------------------------------------------------------------ */
/* Listener registration (synchronous, top level)                      */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || message.target === 'offscreen') return false;
  return handleMessage(message, sender, sendResponse);
});

chrome.runtime.onInstalled.addListener((details) => {
  onInstalled(details).catch(logError('onInstalled'));
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus().catch(logError('menus'));
  syncUi().catch(logError('startup'));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleMenuClick(info, tab).catch(logError('context menu'));
});

chrome.commands.onCommand.addListener((command, tab) => {
  handleCommand(command, tab).catch(logError(`command ${command}`));
});

chrome.tabs.onActivated.addListener(() => scheduleRefresh());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab?.active && (changeInfo.status === 'complete' || changeInfo.url)) scheduleRefresh();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) scheduleRefresh();
});

onSettingsChanged((settings) => {
  updateBadge(settings);
  refreshActionMenus(settings);
});

// Every time the worker starts (also after disable → enable, where neither onInstalled nor onStartup fire).
syncUi().catch(logError('init'));
