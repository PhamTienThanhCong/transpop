/**
 * TransPop — screen capture + crop for image translation (ARCHITECTURE §11, background pipeline steps 1 and 3).
 *
 *   const shot = await captureTab(tab);                       // { id, dataUrl, width, height } — kept 2 min
 *   const png  = await cropForOcr(shot.dataUrl, rect, viewport); // grayscale, upscaled PNG for Tesseract
 *
 * `rect` / `viewport` are CSS pixels relative to the viewport, as measured by the content script
 * (`viewport` = `{ width: innerWidth, height: innerHeight }` — the same area captureVisibleTab grabs). The screenshot is
 * in device pixels, so `scale = imageWidth / viewport.width` (covers devicePixelRatio and page zoom).
 *
 * Works in the service worker (createImageBitmap + OffscreenCanvas, no DOM). computeCropBox / computeScale /
 * grayscaleContrast / pngSize are pure and Node-testable; chrome.* is only touched inside functions.
 */
import { ERROR_CODES } from '../shared/constants.js';
import { makeError } from '../shared/messaging.js';

export const CAPTURE_TTL_MS = 2 * 60 * 1000;

/** Crop scaling policy (output pixels). */
export const CROP_DEFAULTS = Object.freeze({
  minLongSide: 1000, // crops whose long side is shorter than this are upscaled…
  targetLongSide: 1400, // …towards this long side…
  maxUpscale: 2.5, // …but never more than 2.5×
  maxLongSide: 3000, // larger crops are downscaled (keeps OCR fast and memory bounded)
  contrast: 1.2, // mild linear contrast around mid-grey, applied after grayscale
});

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Device-pixel ratio between the screenshot and the CSS viewport: imageWidth / viewport.width
 * (falls back to the height ratio, then 1, when a dimension is missing).
 */
export function computeDeviceScale(viewport, image) {
  const vw = num(viewport?.width);
  const vh = num(viewport?.height);
  if (vw > 0 && num(image?.width) > 0) return num(image.width) / vw;
  if (vh > 0 && num(image?.height) > 0) return num(image.height) / vh;
  return 1;
}

/**
 * Map a viewport-relative CSS rect to an integer pixel box inside the screenshot, clamped to the image bounds.
 * Negative width/height (drag towards the top-left) are normalized. Edges are rounded outwards so no selected
 * pixel is lost.
 * @param {{x: number, y: number, width: number, height: number}} rect   CSS px, viewport-relative
 * @param {{width: number, height: number}} viewport                     CSS px
 * @param {{width: number, height: number}} image                        screenshot size in device px
 * @returns {{x: number, y: number, width: number, height: number, scale: number} | null}  null if nothing remains
 */
export function computeCropBox(rect, viewport, image) {
  const iw = Math.floor(num(image?.width));
  const ih = Math.floor(num(image?.height));
  if (iw <= 0 || ih <= 0) return null;
  const scale = computeDeviceScale(viewport, image);
  let left = num(rect?.x);
  let top = num(rect?.y);
  let right = left + num(rect?.width);
  let bottom = top + num(rect?.height);
  if (right < left) [left, right] = [right, left];
  if (bottom < top) [top, bottom] = [bottom, top];
  // Round to 1e-6 first so float noise (e.g. 100 * 1.8 = 180.00000000000003) doesn't add a pixel.
  const px = (v) => Math.round(v * scale * 1e6) / 1e6;
  const x0 = Math.min(iw, Math.max(0, Math.floor(px(left))));
  const y0 = Math.min(ih, Math.max(0, Math.floor(px(top))));
  const x1 = Math.min(iw, Math.max(0, Math.ceil(px(right))));
  const y1 = Math.min(ih, Math.max(0, Math.ceil(px(bottom))));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, scale };
}

/**
 * Resize factor for a crop of `width`×`height` device px: small crops are upscaled so the long side reaches
 * ~targetLongSide (max `maxUpscale`×), crops longer than `maxLongSide` are downscaled, anything else is kept (1).
 */
export function computeScale(width, height, options = {}) {
  const { minLongSide, targetLongSide, maxUpscale, maxLongSide } = { ...CROP_DEFAULTS, ...options };
  const long = Math.max(num(width), num(height));
  if (!(long > 0)) return 1;
  if (long > maxLongSide) return maxLongSide / long;
  if (long >= minLongSide) return 1;
  return Math.max(1, Math.min(maxUpscale, targetLongSide / long));
}

/**
 * In place: RGBA → grayscale (Rec. 601 luma) with a linear contrast stretch around 128; alpha forced to 255.
 * @param {Uint8ClampedArray} data  ImageData.data
 * @param {number} [contrast]
 */
export function grayscaleContrast(data, contrast = CROP_DEFAULTS.contrast) {
  const c = Number.isFinite(contrast) && contrast > 0 ? contrast : 1;
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const v = (y - 128) * c + 128;
    const out = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    data[i] = out;
    data[i + 1] = out;
    data[i + 2] = out;
    data[i + 3] = 255;
  }
  return data;
}

/** Width/height from a PNG's IHDR chunk (Uint8Array of at least 24 bytes), or null if it isn't a PNG. */
export function pngSize(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!bytes || bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  const u32 = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

/** PNG size straight from a base64 data: URL (decodes only the first bytes), or null. */
export function pngSizeFromDataUrl(dataUrl) {
  const m = /^data:image\/png;base64,/i.exec(String(dataUrl || ''));
  if (!m) return null;
  try {
    const head = atob(dataUrl.slice(m[0].length, m[0].length + 44));
    return pngSize(Uint8Array.from(head, (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** Uint8Array → base64 (chunked, no stack overflow on large images). */
function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

/* ------------------------------------------------------------------ */
/* Capture store (memory only, one capture per tab)                    */
/* ------------------------------------------------------------------ */

const captures = new Map(); // tabId → { id, tabId, windowId, dataUrl, width, height, capturedAt, tabTitle }

function isExpired(entry, now = Date.now()) {
  return !entry || now - entry.capturedAt > CAPTURE_TTL_MS;
}

function purgeExpired() {
  const now = Date.now();
  for (const [tabId, entry] of captures) if (isExpired(entry, now)) captures.delete(tabId);
}

/**
 * Screenshot the visible area of `tab` (PNG) and keep it in memory for CAPTURE_TTL_MS, replacing the tab's previous
 * capture. Must run in response to a user gesture on that tab (activeTab) — command, context menu, popup button.
 * @param {{id: number, windowId: number, title?: string}} tab
 * @returns {Promise<{id: string, dataUrl: string, width: number, height: number}>}
 * @throws Error with code CAPTURE_FAILED (no permission, restricted page, tab not visible, rate limit…)
 */
export async function captureTab(tab) {
  if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number') {
    throw makeError(ERROR_CODES.CAPTURE_FAILED, 'No tab to capture');
  }
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (err) {
    throw makeError(ERROR_CODES.CAPTURE_FAILED, err?.message || 'Screen capture failed');
  }
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw makeError(ERROR_CODES.CAPTURE_FAILED, 'Screen capture returned no image');
  }
  let size = pngSizeFromDataUrl(dataUrl);
  if (!size) {
    try {
      const bitmap = await createImageBitmap(await dataUrlToBlob(dataUrl));
      size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
    } catch (err) {
      throw makeError(ERROR_CODES.CAPTURE_FAILED, `Unreadable screenshot: ${err?.message || err}`);
    }
  }
  purgeExpired();
  const entry = {
    id: crypto.randomUUID(),
    tabId: tab.id,
    windowId: tab.windowId,
    dataUrl,
    width: size.width,
    height: size.height,
    capturedAt: Date.now(),
    tabTitle: typeof tab.title === 'string' ? tab.title : undefined,
  };
  captures.set(tab.id, entry);
  return { id: entry.id, dataUrl, width: entry.width, height: entry.height };
}

/**
 * Look up a live capture by its id (for the fallback capture page).
 * @returns {{id: string, tabId: number, dataUrl: string, width: number, height: number, capturedAt: number,
 *   tabTitle?: string} | null}  null when unknown or older than CAPTURE_TTL_MS
 */
export function getCapture(id) {
  purgeExpired();
  for (const entry of captures.values()) if (entry.id === id) return entry;
  return null;
}

/** The live capture of a tab (for `ocr-region`, keyed by `sender.tab.id`), or null. */
export function getCaptureForTab(tabId) {
  const entry = captures.get(tabId);
  if (isExpired(entry)) {
    captures.delete(tabId);
    return null;
  }
  return entry;
}

/** Forget a tab's capture (e.g. after OCR, on tab close). */
export function dropCapture(tabId) {
  captures.delete(tabId);
}

/* ------------------------------------------------------------------ */
/* Crop                                                                */
/* ------------------------------------------------------------------ */

/**
 * Crop the selected region out of a screenshot and prepare it for OCR: device-pixel mapping, clamping, resize
 * (computeScale), grayscale + mild contrast, PNG.
 * @param {string} dataUrl  screenshot (`data:image/png;base64,…`)
 * @param {{x: number, y: number, width: number, height: number}} rect  CSS px, viewport-relative
 * @param {{width: number, height: number}} viewport  CSS px (`innerWidth` / `innerHeight`)
 * @param {Partial<typeof CROP_DEFAULTS> & { grayscale?: boolean }} [options]
 * @returns {Promise<string>} PNG data: URL
 * @throws Error with code OCR_FAILED when the region is empty or the image can't be decoded
 */
export async function cropForOcr(dataUrl, rect, viewport, options = {}) {
  const opts = { ...CROP_DEFAULTS, grayscale: true, ...options };
  let bitmap;
  try {
    bitmap = await createImageBitmap(await dataUrlToBlob(dataUrl));
  } catch (err) {
    throw makeError(ERROR_CODES.OCR_FAILED, `Unreadable screenshot: ${err?.message || err}`);
  }
  try {
    const box = computeCropBox(rect, viewport, { width: bitmap.width, height: bitmap.height });
    if (!box) throw makeError(ERROR_CODES.OCR_FAILED, 'The selected area is empty');
    const factor = computeScale(box.width, box.height, opts);
    const outW = Math.max(1, Math.round(box.width * factor));
    const outH = Math.max(1, Math.round(box.height * factor));
    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, outW, outH);
    if (opts.grayscale) {
      const img = ctx.getImageData(0, 0, outW, outH);
      grayscaleContrast(img.data, opts.contrast);
      ctx.putImageData(img, 0, 0);
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return `data:image/png;base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
  } finally {
    bitmap.close?.();
  }
}
