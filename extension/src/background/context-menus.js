/**
 * TransPop — context menus, keyboard commands and the popup-window fallback.
 *
 *  - selection: "Translate “%s”" → asks the content script in that frame to show the bubble; if nothing is
 *    listening (restricted page, tab opened before install, PDF viewer…) opens the popup in a small window.
 *  - image: "Translate text in image" and page: "Translate screen area…" → image translation (image-translate.js),
 *    same flow as the `crop-translate` command (Alt+Shift+A).
 *  - action (toolbar icon): "Turn off/on on <host>" and "Pause/Resume TransPop everywhere", titles kept in sync.
 *
 * Without the `tabs` permission `tab.url` is usually unavailable, so the current hostname comes from
 * `info.pageUrl` when present, else from the content script (`get-selection` → `{ hostname }`).
 */
import { LIMITS, MSG } from '../shared/constants.js';
import { sendToTab } from '../shared/messaging.js';
import { getSettings, isSiteDisabled, normalizeHostname, saveSettings } from '../shared/storage.js';
// Menu titles follow the Display-language setting: t() in this file IS bgT() (await ensureUiMessages() first).
import { bgT as t, ensureUiMessages } from './ui-messages.js';
import { imageTranslation } from './image-translate.js';

export const MENU = Object.freeze({
  TRANSLATE: 'transpop-translate',
  IMAGE: 'transpop-image',
  AREA: 'transpop-area',
  TOGGLE_SITE: 'transpop-toggle-site',
  TOGGLE_ENABLED: 'transpop-toggle-enabled',
});

export const POPUP_WINDOW = Object.freeze({ width: 460, height: 640 });

const warn = (label, err) => console.warn(`[TransPop] ${label}:`, err?.message || err);

/* ------------------------------------------------------------------ */
/* chrome.contextMenus wrappers (callback style + lastError checks)    */
/* ------------------------------------------------------------------ */

function createMenu(props) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(props, () => {
      const err = chrome.runtime.lastError;
      if (err) warn(`contextMenus.create(${props.id})`, err);
      resolve();
    });
  });
}

function removeAllMenus() {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function updateMenu(id, props) {
  return new Promise((resolve) => {
    chrome.contextMenus.update(id, props, () => {
      void chrome.runtime.lastError; // menu may not exist yet (setup in progress) — ignore
      resolve();
    });
  });
}

let setupChain = Promise.resolve();
let menusUiLanguage = null; // settings.uiLanguage the current titles were built with (null = unknown, e.g. worker restarted)

/** (Re)create all menus. Serialized + removeAll first, so it never hits duplicate-id errors. */
export function setupContextMenus() {
  setupChain = setupChain
    .catch(() => {})
    .then(async () => {
      menusUiLanguage = (await ensureUiMessages()).lang;
      await removeAllMenus();
      await createMenu({ id: MENU.TRANSLATE, title: t('bg_ctx_translate'), contexts: ['selection'] });
      await createMenu({ id: MENU.IMAGE, title: t('bg_ctx_image'), contexts: ['image'] });
      // Not on selections / links / images (they have their own items): only a plain right-click on the page.
      await createMenu({ id: MENU.AREA, title: t('bg_ctx_area'), contexts: ['page', 'frame'] });
      await createMenu({ id: MENU.TOGGLE_SITE, title: t('bg_ctx_site_unavailable'), contexts: ['action'], enabled: false });
      await createMenu({ id: MENU.TOGGLE_ENABLED, title: t('bg_ctx_pause'), contexts: ['action'] });
    });
  return setupChain.then(() => refreshActionMenus());
}

/** After a settings change: re-create every menu when the display language changed, else just refresh titles. */
export function syncMenus(settings) {
  return settings && settings.uiLanguage === menusUiLanguage ? refreshActionMenus(settings) : setupContextMenus();
}

/* ------------------------------------------------------------------ */
/* Hostname of the current tab                                         */
/* ------------------------------------------------------------------ */

export async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

/** Hostname from a URL, '' for non-web pages; null when the URL is unknown. */
function hostFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? normalizeHostname(u.hostname) : '';
  } catch {
    return null;
  }
}

/** Best-effort hostname for a tab: known URL first, else ask the content script. '' when unavailable. */
export async function hostnameForTab(tab, pageUrl) {
  for (const url of [pageUrl, tab?.url, tab?.pendingUrl]) {
    const host = hostFromUrl(url);
    if (host !== null) return host;
  }
  if (!tab || typeof tab.id !== 'number' || tab.id < 0) return '';
  try {
    const res = await sendToTab(tab.id, MSG.GET_SELECTION, {}, { frameId: 0 });
    return normalizeHostname(res?.hostname || '');
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* Action menu titles                                                  */
/* ------------------------------------------------------------------ */

let refreshSeq = 0;

/** Sync the action-menu titles with the settings and the active tab's hostname. */
export async function refreshActionMenus(settingsArg) {
  const seq = ++refreshSeq;
  try {
    const settings = settingsArg || (await getSettings());
    await ensureUiMessages(settings);
    const host = await hostnameForTab(await getActiveTab());
    if (seq !== refreshSeq) return; // a newer refresh is running
    await updateMenu(MENU.TOGGLE_ENABLED, { title: t(settings.enabled ? 'bg_ctx_pause' : 'bg_ctx_resume') });
    if (host) {
      const disabled = isSiteDisabled(settings, host);
      await updateMenu(MENU.TOGGLE_SITE, { enabled: true, title: t(disabled ? 'bg_ctx_site_on' : 'bg_ctx_site_off', host) });
    } else {
      await updateMenu(MENU.TOGGLE_SITE, { enabled: false, title: t('bg_ctx_site_unavailable') });
    }
  } catch (err) {
    warn('refresh menus', err);
  }
}

let refreshTimer = null;
/** Debounced refresh for bursts of tab events. */
export function scheduleRefresh(delay = 120) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshActionMenus();
  }, delay);
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/** Toggle in-page translation for `hostname` (removing a matching parent-domain entry when re-enabling). */
export async function toggleSite(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return null;
  const settings = await getSettings();
  const disabledSites = isSiteDisabled(settings, host)
    ? settings.disabledSites.filter((site) => !(host === site || host.endsWith(`.${site}`)))
    : [...settings.disabledSites, host];
  return saveSettings({ disabledSites });
}

export async function toggleEnabled() {
  const settings = await getSettings();
  return saveSettings({ enabled: !settings.enabled });
}

/** Open the translator popup in a small standalone window (fallback when no content script is reachable). */
export async function openPopupWindow(text = '') {
  const clean = String(text || '').trim().slice(0, LIMITS.MAX_TEXT_LENGTH);
  const url = chrome.runtime.getURL(`src/popup/popup.html?view=window${clean ? `&text=${encodeURIComponent(clean)}` : ''}`);
  try {
    await chrome.windows.create({ url, type: 'popup', width: POPUP_WINDOW.width, height: POPUP_WINDOW.height, focused: true });
  } catch (err) {
    warn('windows.create', err);
    try {
      await chrome.tabs.create({ url });
    } catch (err2) {
      warn('tabs.create', err2);
    }
  }
}

/** Ask a frame to show the bubble; true if a content script handled it. */
async function showInFrame(tabId, payload, frameId) {
  try {
    const res = await sendToTab(tabId, MSG.SHOW_TRANSLATION, payload, { frameId });
    return Boolean(res && res.shown !== false);
  } catch (err) {
    warn('show-translation', err);
    return false;
  }
}

async function translateSelectionFromMenu(info, tab) {
  const text = String(info.selectionText || '').trim();
  if (!text) return;
  if (tab && typeof tab.id === 'number' && tab.id >= 0) {
    const frameId = typeof info.frameId === 'number' ? info.frameId : 0;
    if (await showInFrame(tab.id, { text }, frameId)) return;
    if (frameId !== 0 && (await showInFrame(tab.id, { text }, 0))) return; // e.g. sandboxed iframe → top frame
  }
  await openPopupWindow(text);
}

export async function handleMenuClick(info, tab) {
  switch (info.menuItemId) {
    case MENU.TRANSLATE:
      return translateSelectionFromMenu(info, tab);
    case MENU.IMAGE:
      await imageTranslation.startCapture(await tabOrActive(tab), { mode: 'image', srcUrl: info.srcUrl });
      return undefined;
    case MENU.AREA:
      await imageTranslation.startCapture(await tabOrActive(tab), { mode: 'region' });
      return undefined;
    case MENU.TOGGLE_SITE: {
      const host = await hostnameForTab(tab, info.pageUrl);
      if (host) await toggleSite(host);
      else refreshActionMenus();
      return undefined;
    }
    case MENU.TOGGLE_ENABLED:
      await toggleEnabled();
      return undefined;
    default:
      return undefined;
  }
}

const isRealTab = (tab) => !!tab && typeof tab.id === 'number' && tab.id >= 0;
const tabOrActive = async (tab) => (isRealTab(tab) ? tab : getActiveTab());

/** Keyboard commands from the manifest. */
export async function handleCommand(command, tab) {
  if (command === 'toggle-enabled') {
    await toggleEnabled();
    return;
  }
  if (command === 'crop-translate') {
    await imageTranslation.startCapture(await tabOrActive(tab), { mode: 'region' });
    return;
  }
  if (command !== 'translate-selection') return;
  const target = tab && typeof tab.id === 'number' && tab.id >= 0 ? tab : await getActiveTab();
  if (!target || typeof target.id !== 'number' || target.id < 0) {
    await openPopupWindow();
    return;
  }
  let res;
  try {
    res = await sendToTab(target.id, MSG.SHOW_TRANSLATION, {}, {}); // all frames: the one with a selection shows it
  } catch (err) {
    warn('show-translation (command)', err);
    res = null;
  }
  if (res === null) await openPopupWindow(); // no content script (restricted page / not injected yet)
}
