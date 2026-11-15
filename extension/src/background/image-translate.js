/**
 * TransPop — image translation wiring in the service worker (ARCHITECTURE §11).
 *
 *   trigger (command crop-translate, context menus, popup `start-capture`, the bubble's "Select again")
 *     → start-crop {prepare}   to frame 0: the content script hides its UI (never in the screenshot)
 *     → captureTab(tab)        screenshot of the visible area, kept in memory (capture.js)
 *     → start-crop {mode, srcUrl?} to frame 0: the user drags a region / the right-clicked image is used
 *       no receiver (PDF viewer, chrome:// pages, Web Store, tab opened before install) or `started: false`
 *       → src/capture/capture.html?id=<captureId> in a popup window (drag on the screenshot, then `ocr-image`)
 *   ocr-region {rect, viewport, langs?}  → crop the tab's screenshot → OCR (offscreen) → { ocr }
 *   ocr-image  {dataUrl, langs?}         → OCR → { ocr }
 *   get-capture {id}                     → { dataUrl, width, height, tabTitle? }   (extension pages only)
 *   ocr-clear-cache                      → delete downloaded language data       (extension pages only)
 *
 * Capture failures are reported to the user: an error bubble through `start-crop {error: 'CAPTURE_FAILED'}`, or, when
 * no content script can show it, the capture page with `?error=CAPTURE_FAILED` in a small window.
 * `langs` sent by the crop toolbar / capture page become the new `settings.ocrLanguages` default when they differ.
 *
 * createImageTranslation(deps) takes its collaborators as parameters (tests inject fakes); the default instance uses
 * the real capture/OCR/storage modules. Pure helpers are exported for unit tests.
 */
import { ERROR_CODES, MSG } from '../shared/constants.js';
import { makeError, sendToTab } from '../shared/messaging.js';
import { normalizeOcrLanguages } from '../shared/ocr-languages.js';
import { getSettings, saveSettings } from '../shared/storage.js';
import { captureTab, cropForOcr, getCapture, getCaptureForTab } from './capture.js';
import { clearOcrCache, runOcr } from './ocr.js';
import { injectContentScripts } from './inject.js';

export const CAPTURE_PAGE = 'src/capture/capture.html';

/** Fallback-window sizing (CSS px of the screen). */
export const CAPTURE_WINDOW = Object.freeze({
  panel: 380, // results panel beside the screenshot
  chrome: 150, // page header + window title bar
  margin: 40, // keep this much of the source window visible around the popup
  minWidth: 640,
  minHeight: 480,
  defaultMaxWidth: 1280, // when the source window's bounds are unknown
  defaultMaxHeight: 860,
  errorWidth: 460,
  errorHeight: 340,
});

const warn = (label, err) => console.warn(`[TransPop] ${label}:`, err?.message || err);
const finite = (v) => Number.isFinite(Number(v));

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

const NO_SPACE_JOIN = new Set(['ja', 'zh-CN', 'zh-TW', 'th', 'lo', 'km', 'my']);
const LIST_ITEM = /^\s*(?:[-–—•·*▪◦]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/;

/**
 * Re-flow OCR output for translation: OCR keeps the image's visual line wraps, which would make the translator
 * treat every line as a separate sentence. Lines inside a paragraph are joined (with a space, or nothing for scripts
 * written without spaces), a trailing hyphen is joined without a space, blank lines (paragraphs) and list items are kept.
 * Pure; exported for tests.
 */
export function reflowOcrText(text, lang) {
  const source = String(text || '').replace(/\r\n?/g, '\n');
  const glue = NO_SPACE_JOIN.has(lang) ? '' : ' ';
  return source
    .split(/\n\s*\n+/)
    .map((para) => {
      const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
      let out = '';
      for (const line of lines) {
        if (!out) out = line;
        else if (LIST_ITEM.test(line)) out += `\n${line}`;
        // A trailing hyphen on the web is usually a real compound ("long-" + "term"): join without a space, keep it.
        else if (/[A-Za-zÀ-ÿ]-$/.test(out) && /^[a-zà-ÿ]/.test(line)) out += line;
        else out += glue + line;
      }
      return out;
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Attach the re-flowed text (keeping the raw lines for reference). */
function withReflow(ocr) {
  if (!ocr || typeof ocr.text !== 'string') return ocr;
  return { ...ocr, rawText: ocr.text, text: reflowOcrText(ocr.text, ocr.lang) };
}

/** Validate an `ocr-region` rect (CSS px, any drag direction): finite numbers, at least 1×1. → {x,y,width,height} | null */
export function sanitizeRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  if (!['x', 'y', 'width', 'height'].every((k) => finite(rect[k]))) return null;
  let { x, y, width, height } = { x: +rect.x, y: +rect.y, width: +rect.width, height: +rect.height };
  if (width < 0) [x, width] = [x + width, -width];
  if (height < 0) [y, height] = [y + height, -height];
  return width >= 1 && height >= 1 ? { x, y, width, height } : null;
}

/** Validate an `ocr-region` viewport: positive finite width/height. → {width, height} | null */
export function sanitizeViewport(viewport) {
  if (!viewport || typeof viewport !== 'object' || !finite(viewport.width) || !finite(viewport.height)) return null;
  const width = +viewport.width;
  const height = +viewport.height;
  return width > 0 && height > 0 ? { width, height } : null;
}

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * OCR languages for a request: the explicit list from the crop toolbar / capture page (normalized), else the
 * settings. `changed` = the explicit list differs from settings.ocrLanguages (→ remember it as the new default).
 * @returns {{langs: string[], changed: boolean}}
 */
export function pickOcrLanguages(requested, settings) {
  const current = normalizeOcrLanguages(settings?.ocrLanguages);
  if (!Array.isArray(requested) || !requested.length) return { langs: current, changed: false };
  const langs = normalizeOcrLanguages(requested);
  return { langs, changed: !sameList(langs, current) };
}

/**
 * Bounds of the fallback capture window: the screenshot at its CSS size plus the results panel, capped to the
 * source window (≈ the screen the user is looking at), centered over it.
 * @param {{image?: {width: number, height: number}, source?: {left?: number, top?: number, width?: number, height?: number} | null}} p
 * @returns {{width: number, height: number, left?: number, top?: number}}
 */
export function computeCaptureWindow({ image, source } = {}) {
  const W = CAPTURE_WINDOW;
  const hasSource = !!source && finite(source.width) && finite(source.height) && source.width > 0 && source.height > 0;
  const maxW = hasSource ? Math.max(W.minWidth, source.width - W.margin) : W.defaultMaxWidth;
  const maxH = hasSource ? Math.max(W.minHeight, source.height - W.margin) : W.defaultMaxHeight;
  // Device-pixel ratio of the screenshot ≈ image width / source window width (both cover the tab's width).
  const iw = finite(image?.width) ? +image.width : 0;
  const ih = finite(image?.height) ? +image.height : 0;
  const dpr = hasSource && iw > 0 ? Math.min(4, Math.max(1, iw / source.width)) : 1;
  const width = Math.round(Math.min(maxW, Math.max(W.minWidth, iw / dpr + W.panel)));
  const height = Math.round(Math.min(maxH, Math.max(W.minHeight, ih / dpr + W.chrome)));
  const bounds = { width, height };
  if (hasSource && finite(source.left) && finite(source.top)) {
    bounds.left = Math.round(source.left + (source.width - width) / 2);
    bounds.top = Math.round(source.top + (source.height - height) / 2);
  }
  return bounds;
}

/** Small centered window for a capture error. */
export function computeErrorWindow(source) {
  const W = CAPTURE_WINDOW;
  const bounds = { width: W.errorWidth, height: W.errorHeight };
  if (source && [source.left, source.top, source.width, source.height].every(finite)) {
    bounds.left = Math.round(source.left + (source.width - W.errorWidth) / 2);
    bounds.top = Math.round(source.top + Math.max(0, (source.height - W.errorHeight) / 3));
  }
  return bounds;
}

/** Query string of the capture page: `?id=<captureId>` or `?error=<CODE>`. */
export function capturePagePath({ id, error, from } = {}) {
  const back = typeof from === 'number' && from >= 0 ? `&from=${from}` : '';
  if (id) return `${CAPTURE_PAGE}?id=${encodeURIComponent(id)}${back}`;
  return `${CAPTURE_PAGE}?error=${encodeURIComponent(ERROR_CODES[error] ? error : ERROR_CODES.CAPTURE_FAILED)}${back}`;
}

/** True when the message comes from one of our own pages (popup, options, capture page) — not a content script. */
export function isExtensionPage(sender, extensionOrigin) {
  const origin = String(extensionOrigin || '').replace(/\/+$/, '');
  if (!origin) return false;
  return [sender?.url, sender?.origin].some((u) => typeof u === 'string' && (u === origin || u.startsWith(`${origin}/`)));
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

/**
 * @param {Partial<{captureTab: Function, cropForOcr: Function, getCapture: Function, getCaptureForTab: Function,
 *   runOcr: Function, clearOcrCache: Function, getSettings: Function, saveSettings: Function, sendToTab: Function,
 *   chrome: () => typeof chrome}>} overrides
 */
export function createImageTranslation(overrides = {}) {
  const deps = {
    captureTab,
    cropForOcr,
    getCapture,
    getCaptureForTab,
    runOcr,
    clearOcrCache,
    getSettings,
    saveSettings,
    sendToTab,
    injectContentScripts,
    chrome: () => globalThis.chrome,
    ...overrides,
  };
  const api = () => deps.chrome();
  const extensionOrigin = () => {
    try {
      return api().runtime.getURL('');
    } catch {
      return '';
    }
  };

  /** start-crop to the tab's top frame; null when nobody answers (or on any messaging error). */
  async function askTopFrame(tabId, payload) {
    try {
      return await deps.sendToTab(tabId, MSG.START_CROP, payload, { frameId: 0 });
    } catch (err) {
      warn('start-crop', err);
      return null;
    }
  }

  async function sourceWindow(windowId) {
    try {
      return typeof windowId === 'number' ? await api().windows.get(windowId) : null;
    } catch {
      return null;
    }
  }

  /**
   * Open the capture page (`{id}` = screenshot to crop, `{error}` = explain a failure) in a NEW TAB right next to the
   * source tab — only used for pages TransPop can't script (PDF viewer, chrome://, Web Store). "Back to page" on the
   * capture page closes it and re-activates the source tab (`from`).
   */
  async function openCapturePage({ id, error }, tab) {
    const chromeApi = api();
    const url = chromeApi.runtime.getURL(capturePagePath({ id, error, from: tab?.id }));
    const props = { url, active: true };
    if (typeof tab?.index === 'number') props.index = tab.index + 1;
    if (typeof tab?.id === 'number' && tab.id >= 0) props.openerTabId = tab.id;
    if (typeof tab?.windowId === 'number') props.windowId = tab.windowId;
    try {
      await chromeApi.tabs.create(props);
    } catch (err) {
      warn('tabs.create (capture page)', err);
      try {
        await chromeApi.tabs.create({ url });
      } catch (err2) {
        warn('tabs.create (capture page, plain)', err2);
      }
    }
  }

  /**
   * Run the whole trigger flow for `tab`. Resolves `{started: true, fallback}` (fallback = the capture page was
   * opened); rejects with CAPTURE_FAILED after telling the user (error bubble or capture page).
   * @param {{id: number, windowId: number, title?: string}} tab
   * @param {{mode?: 'region'|'image', srcUrl?: string}} [opts]
   */
  async function startCapture(tab, { mode = 'region', srcUrl } = {}) {
    if (!tab || typeof tab.id !== 'number' || tab.id < 0) throw makeError(ERROR_CODES.CAPTURE_FAILED, 'No tab to capture');
    const payload =
      mode === 'image' ? { mode: 'image', ...(typeof srcUrl === 'string' && srcUrl ? { srcUrl } : {}) } : { mode: 'region' };
    let prepared = await askTopFrame(tab.id, { prepare: true });
    // Tab opened before install/update → inject the content script now (activeTab) and ask again.
    if (!prepared?.ready && (await deps.injectContentScripts(tab.id))) prepared = await askTopFrame(tab.id, { prepare: true });
    const hasReceiver = !!prepared?.ready;

    let shot;
    try {
      shot = await deps.captureTab(tab);
    } catch (err) {
      const shown = hasReceiver ? await askTopFrame(tab.id, { ...payload, error: ERROR_CODES.CAPTURE_FAILED }) : null;
      if (!shown?.started) await openCapturePage({ error: ERROR_CODES.CAPTURE_FAILED }, tab);
      throw err?.code === ERROR_CODES.CAPTURE_FAILED ? err : makeError(ERROR_CODES.CAPTURE_FAILED, err?.message);
    }

    if (hasReceiver) {
      const res = await askTopFrame(tab.id, payload);
      if (res?.started) return { started: true, fallback: false };
    }
    await openCapturePage({ id: shot.id }, tab);
    return { started: true, fallback: true };
  }

  /** Active tab of the last focused normal window (never the capture popup window itself). */
  async function activeTab() {
    const chromeApi = api();
    try {
      if (chromeApi.windows?.getLastFocused) {
        const win = await chromeApi.windows.getLastFocused({ windowTypes: ['normal'] });
        if (win && typeof win.id === 'number') {
          const [tab] = await chromeApi.tabs.query({ active: true, windowId: win.id });
          if (tab) return tab;
        }
      }
    } catch {
      /* fall through */
    }
    try {
      const [tab] = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true });
      return tab || null;
    } catch {
      return null;
    }
  }

  /** `start-capture {tabId?, mode?, srcUrl?}` — popup button (tabId or the active tab) or a content script (its tab). */
  async function handleStartCapture(msg = {}, sender = {}) {
    let tab = null;
    if (sender?.tab && typeof sender.tab.id === 'number' && !isExtensionPage(sender, extensionOrigin())) tab = sender.tab;
    if (!tab && Number.isInteger(msg.tabId) && msg.tabId >= 0) {
      try {
        tab = await api().tabs.get(msg.tabId);
      } catch {
        tab = null;
      }
    }
    if (!tab) tab = await activeTab();
    if (!tab) throw makeError(ERROR_CODES.CAPTURE_FAILED, 'No active tab');
    await startCapture(tab, { mode: msg.mode === 'image' ? 'image' : 'region', srcUrl: msg.srcUrl });
    return {};
  }

  async function resolveLanguages(requested) {
    let settings = null;
    try {
      settings = await deps.getSettings();
    } catch {
      settings = null;
    }
    const { langs, changed } = pickOcrLanguages(requested, settings);
    if (changed) {
      // Remember the crop toolbar's choice as the new default (fire-and-forget: never delays OCR).
      Promise.resolve()
        .then(() => deps.saveSettings({ ocrLanguages: langs }))
        .catch((err) => warn('save ocrLanguages', err));
    }
    return langs;
  }

  /** `ocr-region` from the content script: crop the tab's screenshot and recognize it. */
  async function handleOcrRegion(msg = {}, sender = {}) {
    const tabId = sender?.tab?.id;
    if (typeof tabId !== 'number') throw makeError(ERROR_CODES.CAPTURE_FAILED, 'ocr-region must come from a tab');
    const capture = deps.getCaptureForTab(tabId);
    if (!capture) throw makeError(ERROR_CODES.CAPTURE_FAILED, 'The screenshot has expired — select the area again');
    const rect = sanitizeRect(msg.rect);
    const viewport = sanitizeViewport(msg.viewport);
    if (!rect || !viewport) throw makeError(ERROR_CODES.OCR_FAILED, 'Invalid area');
    const langs = await resolveLanguages(msg.langs);
    const png = await deps.cropForOcr(capture.dataUrl, rect, viewport);
    return { ocr: withReflow(await deps.runOcr(png, langs)) };
  }

  /** `ocr-image` from the capture page (already cropped client-side). */
  async function handleOcrImage(msg = {}) {
    if (typeof msg.dataUrl !== 'string' || !msg.dataUrl.startsWith('data:image/')) throw makeError(ERROR_CODES.OCR_FAILED, 'Not an image');
    const langs = await resolveLanguages(msg.langs);
    return { ocr: withReflow(await deps.runOcr(msg.dataUrl, langs)) };
  }

  /** `get-capture {id}` from the capture page. */
  async function handleGetCapture(msg = {}, sender = {}) {
    if (!isExtensionPage(sender, extensionOrigin())) throw makeError(ERROR_CODES.CAPTURE_FAILED, 'Not allowed');
    const capture = typeof msg.id === 'string' && msg.id ? deps.getCapture(msg.id) : null;
    if (!capture) throw makeError(ERROR_CODES.CAPTURE_FAILED, 'This screenshot is no longer available');
    return {
      dataUrl: capture.dataUrl,
      width: capture.width,
      height: capture.height,
      ...(typeof capture.tabTitle === 'string' && capture.tabTitle ? { tabTitle: capture.tabTitle } : {}),
    };
  }

  /** `ocr-clear-cache` from the options page. */
  async function handleClearCache(msg = {}, sender = {}) {
    if (!isExtensionPage(sender, extensionOrigin())) throw makeError(ERROR_CODES.UNKNOWN, 'Not allowed');
    await deps.clearOcrCache();
    return {};
  }

  return {
    startCapture,
    openCapturePage,
    handleStartCapture,
    handleOcrRegion,
    handleOcrImage,
    handleGetCapture,
    handleClearCache,
  };
}

/** The service worker's instance (real capture / OCR / storage). */
export const imageTranslation = createImageTranslation();
