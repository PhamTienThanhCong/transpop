/**
 * TransPop — OCR from the service worker: runs Tesseract in the shared offscreen document (ARCHITECTURE §11).
 *
 *   const ocr = await runOcr(dataUrl, ['eng', 'vie']);   // → OcrResult, or throws Error with .code
 *
 * The offscreen document is created on demand; if it is missing or vanishes mid-call (Chrome closed it, or it closed
 * itself when idle) it is recreated and the request is re-sent once (offscreen-doc.js → sendToOffscreen).
 * While waiting, a cheap extension API call every 20 s keeps the service worker from being suspended (the first run
 * downloads language data and can take longer than the 30 s idle limit).
 *
 * Errors: `OCR_NO_TEXT` (nothing readable), `NETWORK` (language data could not be downloaded), `OCR_FAILED` (anything
 * else: engine failed, timeout, document unavailable).
 */
import { ERROR_CODES, MSG } from '../shared/constants.js';
import { makeError } from '../shared/messaging.js';
import { normalizeOcrLanguages } from '../shared/ocr-languages.js';
import { sendToOffscreen } from './offscreen-doc.js';

/** Upper bound for one OCR request (the engine has its own, shorter init/recognize timeouts). */
export const OCR_TIMEOUT_MS = 240_000;
export const KEEPALIVE_INTERVAL_MS = 20_000;
/** Max length of a data: URL we forward (≈ 24 MB of image data — far above any cropped screenshot). */
export const MAX_DATA_URL_LENGTH = 32 * 1024 * 1024;

const DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;
/** Codes the offscreen document may answer with that we pass through unchanged. */
const PASS_THROUGH = new Set([ERROR_CODES.OCR_NO_TEXT, ERROR_CODES.OCR_FAILED, ERROR_CODES.NETWORK]);

/** Periodically touch an extension API so the service worker stays alive while we wait. Returns a stop function. */
function keepAlive(intervalMs = KEEPALIVE_INTERVAL_MS) {
  const timer = setInterval(() => {
    try {
      chrome.runtime.getPlatformInfo?.().catch?.(() => {});
    } catch {
      /* ignore */
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(makeError(ERROR_CODES.OCR_FAILED, message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Map an offscreen response envelope to an OcrResult or a coded Error. */
export function unwrapOcrResponse(response) {
  if (response?.ok === true && response.ocr && typeof response.ocr.text === 'string') return response.ocr;
  if (response?.ok === false) {
    const code = PASS_THROUGH.has(response.error?.code) ? response.error.code : ERROR_CODES.OCR_FAILED;
    throw makeError(code, response.error?.message || 'Text recognition failed');
  }
  throw makeError(ERROR_CODES.OCR_FAILED, 'Invalid answer from the OCR engine');
}

/**
 * Recognize text in an image.
 * @param {string} dataUrl  `data:image/…;base64,…` (PNG from cropForOcr(), or any image Tesseract reads)
 * @param {string[]} [langs]  Tesseract codes (normalized: known codes only, max 3, default `['eng']`)
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{text: string, confidence: number, langs: string[], lang?: string,
 *   lines?: Array<{text: string, confidence: number, bbox: {x0: number, y0: number, x1: number, y1: number}}>}>}
 */
export async function runOcr(dataUrl, langs, { timeoutMs = OCR_TIMEOUT_MS } = {}) {
  if (typeof dataUrl !== 'string' || !DATA_URL_RE.test(dataUrl)) throw makeError(ERROR_CODES.OCR_FAILED, 'Not an image');
  if (dataUrl.length > MAX_DATA_URL_LENGTH) throw makeError(ERROR_CODES.OCR_FAILED, 'Image is too large');
  const codes = normalizeOcrLanguages(langs);
  const stopKeepAlive = keepAlive();
  try {
    let response;
    try {
      response = await withTimeout(
        sendToOffscreen({ type: MSG.OFFSCREEN_OCR, dataUrl, langs: codes }),
        timeoutMs,
        'Text recognition timed out',
      );
    } catch (err) {
      if (err?.code === ERROR_CODES.OCR_FAILED) throw err; // our timeout
      throw makeError(ERROR_CODES.OCR_FAILED, `OCR engine unavailable: ${err?.message || err}`);
    }
    return unwrapOcrResponse(response);
  } finally {
    stopKeepAlive();
  }
}

/**
 * Delete the downloaded language data (IndexedDB, in the offscreen document's origin) and stop the OCR worker.
 * Used by `ocr-clear-cache`. Rejects with OCR_FAILED if the document can't be reached.
 */
export async function clearOcrCache() {
  let response;
  try {
    response = await sendToOffscreen({ type: MSG.OFFSCREEN_OCR_CLEAR });
  } catch (err) {
    throw makeError(ERROR_CODES.OCR_FAILED, `OCR engine unavailable: ${err?.message || err}`);
  }
  if (response?.ok !== true) throw makeError(ERROR_CODES.OCR_FAILED, response?.error?.message || 'Could not clear OCR data');
  return {};
}
