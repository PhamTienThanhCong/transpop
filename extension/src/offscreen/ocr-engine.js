/**
 * TransPop — OCR engine (ES module): Tesseract.js, vendored in extension/vendor/tesseract/ (never loaded from a CDN).
 * Runs in the offscreen document, and in any extension or dev page (needs Worker, WebAssembly, fetch, IndexedDB).
 *
 *   import { recognize, clearCache } from './ocr-engine.js';
 *   const ocr = await recognize(pngDataUrl, ['eng', 'vie']);  // → OcrResult (ARCHITECTURE §11) or throws Error.code
 *
 * - One long-lived Tesseract worker; re-initialized only when the language list changes (a fresh worker is created
 *   instead once too much language data would pile up in its memory). Jobs are serialized. The worker is terminated
 *   after `idleMs` without jobs (memory) and recreated on demand.
 * - Code (worker, WASM core) comes from the extension; only language data (`<lang>.traineddata.gz`) is downloaded, from
 *   jsDelivr `@tesseract.js-data/<lang>/4.0.0_best_int` (tesseract.js default), and cached in IndexedDB by Tesseract.
 * - The WASM core variant (relaxed SIMD / SIMD / baseline, LSTM-only) is picked here with the same feature probes
 *   tesseract.js uses, so only the `.js` + `.wasm` pairs we actually ship are ever requested.
 * - Page segmentation: AUTO for page-like crops, SINGLE_BLOCK for wide strips; when that finds nothing readable a second
 *   pass runs with a fallback mode. Lines without letters/digits or with very low confidence are dropped.
 *
 * Errors (Error with `.code`): OCR_NO_TEXT (nothing readable), NETWORK (language data download failed),
 * OCR_FAILED (bad input, engine failure, timeout).
 *
 * The pure helpers (buildOcrResult, normalizeOcrText, choosePsm, sniffImageType, imageSize) are Node-testable:
 * importing this module has no side effects and Tesseract itself is only loaded on first use.
 */
import { ERROR_CODES } from '../shared/constants.js';
import { makeError } from '../shared/messaging.js';
import { normalizeOcrLanguages, ocrToLang } from '../shared/ocr-languages.js';

/**
 * Init-time Tesseract parameters. Tesseract prints diagnostics ("Estimating resolution as 673", "Detected 52
 * diacritics", "Parameter not found…") through its debug channel, which Emscripten routes to console.error — Chrome
 * then lists them under the extension's "Errors". They are not errors: send that channel to /dev/null.
 */
const INIT_CONFIG = Object.freeze({ debug_file: '/dev/null' });

/** Tesseract page segmentation modes we use (values are what `tessedit_pageseg_mode` expects). */
export const PSM = Object.freeze({ AUTO: '3', SINGLE_BLOCK: '6', SINGLE_LINE: '7', SPARSE_TEXT: '11' });
const OEM_LSTM_ONLY = 1;

export const OCR_LIMITS = Object.freeze({
  MIN_CONFIDENCE: 35, // character-weighted mean confidence below this → OCR_NO_TEXT
  MIN_LINE_CONFIDENCE: 20, // lines below this are dropped as noise
  STRIP_RATIO: 4, // width / height ≥ this → a strip of text (SINGLE_BLOCK), else page-like (AUTO)
  MAX_PIXELS: 25_000_000, // refuse absurdly large images instead of freezing the worker
  MAX_LOADED_LANGS: 6, // languages kept in one worker's memory before it is recreated
});

/** IndexedDB database where Tesseract (idb-keyval) caches downloaded traineddata. */
export const CACHE_DB_NAME = 'keyval-store';

/** Vendored core builds (LSTM-only) by WebAssembly feature level. Each `.js` loads the `.wasm` next to it. */
export const CORE_FILES = Object.freeze({
  relaxedsimd: 'tesseract-core-relaxedsimd-lstm.js',
  simd: 'tesseract-core-simd-lstm.js',
  baseline: 'tesseract-core-lstm.js',
});

// Same probe modules as wasm-feature-detect (used by tesseract.js to choose its core).
const SIMD_PROBE = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];
const RELAXED_SIMD_PROBE = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11,
];

const DEFAULT_CONFIG = Object.freeze({
  initTimeoutMs: 120_000, // core + language data download + init (first run on a slow connection)
  recognizeTimeoutMs: 45_000, // one recognition pass
  idleMs: 3 * 60_000, // terminate the worker after this long without jobs (0 = never)
});
let config = { ...DEFAULT_CONFIG };

/** Override timeouts / idle delay (tests, dev harness). */
export function configure(options = {}) {
  config = { ...config, ...options };
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u3000-\\u303F\\u30FC\\uFF01-\\uFF9F';
const CJK_GAP_RE = new RegExp(`(?<=[${CJK}])\\s+(?=[${CJK}])`, 'gu');
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

/**
 * Clean one recognized line: NFC, collapse whitespace, drop the spaces Tesseract puts between CJK characters
 * ("今日 は 天気 。" → "今日は天気。"), strip table-border pipes at the edges.
 */
export function normalizeOcrText(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(CJK_GAP_RE, '')
    .replace(/^[|¦]\s+/, '')
    .replace(/\s+[|¦]$/, '')
    .trim();
}

const weight = (text) => Math.max(1, text.replace(/\s/gu, '').length);
function weightedConfidence(lines) {
  let sum = 0;
  let total = 0;
  for (const l of lines) {
    const w = weight(l.text);
    sum += l.confidence * w;
    total += w;
  }
  return total ? sum / total : 0;
}

const clampConfidence = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
};

function toBbox(b) {
  if (!b || typeof b !== 'object') return undefined;
  const v = (k) => (Number.isFinite(Number(b[k])) ? Math.round(Number(b[k])) : 0);
  return { x0: v('x0'), y0: v('y0'), x1: v('x1'), y1: v('y1') };
}

/** Lines (text, confidence, bbox) from a Tesseract.js `recognize()` result (`blocks` output, else plain `text`). */
function collectLines(data) {
  const lines = [];
  for (const block of data?.blocks || []) {
    for (const para of block?.paragraphs || []) {
      for (const line of para?.lines || []) lines.push({ text: line?.text, confidence: line?.confidence, bbox: line?.bbox });
    }
  }
  if (!lines.length && typeof data?.text === 'string') {
    for (const text of data.text.split('\n')) lines.push({ text, confidence: data.confidence });
  }
  return lines;
}

/**
 * Turn a Tesseract.js result into an OcrResult, or null when nothing readable was found (no line with a letter or
 * digit, or a character-weighted mean confidence below OCR_LIMITS.MIN_CONFIDENCE).
 * @param {object} data  `(await worker.recognize(img, opts, { text: true, blocks: true })).data`
 * @param {string[]} langs  Tesseract codes used
 */
export function buildOcrResult(data, langs) {
  const candidates = collectLines(data)
    .map((l) => ({ text: normalizeOcrText(l.text), confidence: clampConfidence(l.confidence), bbox: toBbox(l.bbox) }))
    .filter((l) => WORD_CHAR_RE.test(l.text));
  if (!candidates.length || weightedConfidence(candidates) < OCR_LIMITS.MIN_CONFIDENCE) return null;
  const kept = candidates.filter((l) => l.confidence >= OCR_LIMITS.MIN_LINE_CONFIDENCE);
  if (!kept.length) return null;
  const codes = [...langs];
  const result = {
    text: kept.map((l) => l.text).join('\n'),
    confidence: Math.round(weightedConfidence(kept)),
    langs: codes,
  };
  const lang = codes.length === 1 ? ocrToLang(codes[0]) : null;
  if (lang) result.lang = lang;
  result.lines = kept.map((l) => ({
    text: l.text,
    confidence: Math.round(l.confidence),
    ...(l.bbox ? { bbox: l.bbox } : {}),
  }));
  return result;
}

/** Page segmentation mode for an image of `size` (null/unknown → AUTO). */
export function choosePsm(size) {
  const w = Number(size?.width);
  const h = Number(size?.height);
  if (!(w > 0 && h > 0)) return PSM.AUTO;
  return w / h >= OCR_LIMITS.STRIP_RATIO ? PSM.SINGLE_BLOCK : PSM.AUTO;
}

/** Second-pass mode when the first one found nothing readable (null = no second pass). */
export function fallbackPsm(psm) {
  if (psm === PSM.AUTO) return PSM.SINGLE_BLOCK;
  if (psm === PSM.SINGLE_BLOCK) return PSM.SPARSE_TEXT;
  return null;
}

/** Image format from magic bytes: 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | null (all readable by Tesseract). */
export function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const at = (i, ...sig) => sig.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  if (at(0, 0x42, 0x4d)) return 'bmp';
  return null;
}

/** Width/height without decoding, for PNG (IHDR) and GIF (logical screen); null for other formats. */
export function imageSize(bytes) {
  const type = sniffImageType(bytes);
  if (type === 'png' && bytes.length >= 24) {
    const u32 = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
    return { width: u32(16), height: u32(20) };
  }
  if (type === 'gif') return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
  return null;
}

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

/**
 * Base URL of the vendored Tesseract files. In the extension: chrome.runtime.getURL(…); in dev pages (mocked chrome,
 * http://localhost) it is computed relative to this module, which resolves to /extension/vendor/tesseract/.
 */
export function vendorBaseUrl() {
  const runtime = globalThis.chrome?.runtime;
  if (globalThis.location?.protocol === 'chrome-extension:' && runtime?.id && typeof runtime.getURL === 'function') {
    return new URL('./', runtime.getURL('vendor/tesseract/worker.min.js')).href;
  }
  return new URL('../../vendor/tesseract/', import.meta.url).href;
}

/** 'relaxedsimd' | 'simd' | 'baseline' — the best core build this browser can run. */
export function detectCoreVariant() {
  try {
    if (WebAssembly.validate(new Uint8Array(RELAXED_SIMD_PROBE))) return 'relaxedsimd';
    if (WebAssembly.validate(new Uint8Array(SIMD_PROBE))) return 'simd';
  } catch {
    /* no WebAssembly */
  }
  return 'baseline';
}

let tesseractPromise = null;
function loadTesseract() {
  tesseractPromise ||= import('../../vendor/tesseract/tesseract.esm.min.js')
    .then((mod) => mod.default || mod)
    .catch((err) => {
      tesseractPromise = null;
      throw err;
    });
  return tesseractPromise;
}

/* ------------------------------------------------------------------ */
/* Errors / timing                                                     */
/* ------------------------------------------------------------------ */

const NETWORK_RE = /Network error while fetching|Failed to fetch|NetworkError|Load failed|ERR_(INTERNET|NAME|CONNECTION|NETWORK)/i;

/** Map anything thrown by Tesseract (often a bare string) to a coded Error. */
export function toOcrError(err) {
  if (err instanceof Error && err.code && ERROR_CODES[err.code]) return err;
  const message = String(err?.message || err || 'Text recognition failed');
  return makeError(NETWORK_RE.test(message) ? ERROR_CODES.NETWORK : ERROR_CODES.OCR_FAILED, message);
}

function withTimeout(promise, ms, message) {
  if (!(ms > 0)) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(makeError(ERROR_CODES.OCR_FAILED, message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* ------------------------------------------------------------------ */
/* Input decoding                                                      */
/* ------------------------------------------------------------------ */

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Re-encode an image Tesseract can't read (AVIF, …) as PNG, when the browser can decode it. */
async function transcodeToPng(bytes) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/** data: URL / Blob / ArrayBuffer / Uint8Array → bytes of an image Tesseract can read. Throws OCR_FAILED. */
async function toImageBytes(image) {
  let bytes = null;
  try {
    if (typeof image === 'string') {
      const m = /^data:image\/[a-z0-9.+-]+;base64,/i.exec(image);
      if (m) bytes = base64ToBytes(image.slice(m[0].length));
    } else if (image instanceof Uint8Array) bytes = image;
    else if (image instanceof ArrayBuffer) bytes = new Uint8Array(image);
    else if (typeof Blob === 'function' && image instanceof Blob) bytes = new Uint8Array(await image.arrayBuffer());
  } catch {
    bytes = null;
  }
  if (!bytes?.length) throw makeError(ERROR_CODES.OCR_FAILED, 'Not an image');
  if (sniffImageType(bytes)) return bytes;
  const png = await transcodeToPng(bytes);
  if (!png) throw makeError(ERROR_CODES.OCR_FAILED, 'Unsupported image format');
  return png;
}

async function measure(bytes) {
  const quick = imageSize(bytes);
  if (quick || typeof createImageBitmap !== 'function') return quick;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    throw makeError(ERROR_CODES.OCR_FAILED, 'Unreadable image');
  }
}

/* ------------------------------------------------------------------ */
/* Worker lifecycle                                                    */
/* ------------------------------------------------------------------ */

let engine = null; // { worker, native, key, loaded: Set<string>, core, crashed: Promise<never> }
let queue = Promise.resolve();
let pending = 0;
let idleTimer = null;
let progressHandler = null;

function emitProgress(m) {
  try {
    progressHandler?.({ status: m?.status, progress: m?.progress });
  } catch {
    /* listener errors never break OCR */
  }
}

async function createEngine(langs) {
  if (typeof Worker !== 'function' || typeof WebAssembly !== 'object') {
    throw makeError(ERROR_CODES.OCR_FAILED, 'Web Workers / WebAssembly are not available');
  }
  const Tesseract = await loadTesseract();
  const base = vendorBaseUrl();
  const core = detectCoreVariant();
  let native = null;
  let initDone = false;
  let failInit = () => {};
  const initFailed = new Promise((_, reject) => {
    failInit = reject;
  });

  // tesseract.js hands out its worker only after initialisation succeeded, and createWorker() never settles when the
  // language data can't be downloaded. Capture the Worker it spawns (synchronously, inside createWorker) so that a
  // failed or hung start can still be terminated instead of leaking a thread with the WASM heap.
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      native = this;
    }
  };
  let creating;
  try {
    creating = Tesseract.createWorker([...langs], OEM_LSTM_ONLY, {
      // Our thin wrapper (filters Tesseract's informational stderr noise) which importScripts() the vendored worker.
      // It must sit next to the .wasm files: Emscripten locates them relative to the worker script.
      workerPath: `${base}transpop-worker.js`,
      corePath: `${base}${CORE_FILES[core]}`,
      workerBlobURL: false,
      logger: emitProgress,
      // Without a handler tesseract.js re-throws job errors from its onmessage callback (uncaught in the page).
      errorHandler: (err) => {
        if (!initDone) failInit(err);
      },
    }, { ...INIT_CONFIG });
  } catch (err) {
    creating = Promise.reject(err);
  } finally {
    globalThis.Worker = NativeWorker;
  }

  try {
    const worker = await withTimeout(Promise.race([creating, initFailed]), config.initTimeoutMs, 'OCR engine start timed out');
    initDone = true;
    const crashed = new Promise((_, reject) => {
      native?.addEventListener('error', (event) => reject(new Error(event?.message || 'OCR worker crashed')));
    });
    crashed.catch(() => {});
    return { worker, native, key: langs.join('+'), loaded: new Set(langs), core, crashed };
  } catch (err) {
    initDone = true;
    try {
      native?.terminate();
    } catch {
      /* ignore */
    }
    throw toOcrError(err);
  }
}

async function disposeEngine() {
  const current = engine;
  engine = null;
  if (!current) return;
  try {
    await current.worker.terminate();
  } catch {
    /* ignore */
  }
  try {
    current.native?.terminate();
  } catch {
    /* ignore */
  }
}

/** Race a worker job against a crash and a timeout; on any failure the worker is discarded. */
async function job(current, promise, ms, message) {
  try {
    return await withTimeout(Promise.race([promise, current.crashed]), ms, message);
  } catch (err) {
    if (engine === current) await disposeEngine();
    throw toOcrError(err);
  }
}

/** The engine for `langs`: reuse, re-initialize (languages changed) or create. */
async function getEngine(langs) {
  const key = langs.join('+');
  if (engine?.key === key) return engine;
  if (engine) {
    const current = engine;
    const fresh = langs.filter((l) => !current.loaded.has(l));
    if (current.loaded.size + fresh.length <= OCR_LIMITS.MAX_LOADED_LANGS) {
      await job(current, current.worker.reinitialize([...langs], OEM_LSTM_ONLY, { ...INIT_CONFIG }), config.initTimeoutMs, 'OCR language switch timed out');
      fresh.forEach((l) => current.loaded.add(l));
      current.key = key;
      return current;
    }
    await disposeEngine();
  }
  engine = await createEngine(langs);
  return engine;
}

async function recognizePass(current, bytes, psm) {
  const { data } = await job(
    current,
    current.worker.recognize(bytes, { tessedit_pageseg_mode: psm }, { text: true, blocks: true }),
    config.recognizeTimeoutMs,
    'Text recognition timed out',
  );
  return data;
}

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdle() {
  clearIdleTimer();
  if (!(config.idleMs > 0) || !engine) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (pending === 0 && engine) enqueue(disposeEngine).catch(() => {});
  }, config.idleMs);
}

/** Run tasks one at a time, in call order. */
function enqueue(task) {
  pending++;
  clearIdleTimer();
  const run = queue.then(() => task());
  queue = run
    .catch(() => {})
    .finally(() => {
      pending--;
      if (pending === 0) scheduleIdle();
    });
  return run;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Recognize text in an image. Jobs are serialized; the worker is created / re-initialized as needed.
 * @param {string | Blob | ArrayBuffer | Uint8Array} image  usually a `data:image/png;base64,…` URL
 * @param {string[]} [langs]  Tesseract codes (normalized: known codes, max 3, default ['eng']); order = priority
 * @param {{ psm?: string, onProgress?: (p: {status: string, progress: number}) => void }} [options]
 *   `psm` forces a page segmentation mode (no automatic choice, no second pass)
 * @returns {Promise<{text: string, confidence: number, langs: string[], lang?: string,
 *   lines: Array<{text: string, confidence: number, bbox?: {x0: number, y0: number, x1: number, y1: number}}>}>}
 */
export function recognize(image, langs, options = {}) {
  return enqueue(async () => {
    const codes = normalizeOcrLanguages(langs);
    const bytes = await toImageBytes(image);
    const size = await measure(bytes);
    if (size && size.width * size.height > OCR_LIMITS.MAX_PIXELS) throw makeError(ERROR_CODES.OCR_FAILED, 'Image is too large');
    const forced = options.psm != null ? String(options.psm) : null;
    const first = forced || choosePsm(size);
    progressHandler = typeof options.onProgress === 'function' ? options.onProgress : null;
    try {
      const current = await getEngine(codes);
      let result = buildOcrResult(await recognizePass(current, bytes, first), codes);
      const second = forced ? null : fallbackPsm(first);
      if (!result && second && engine === current) result = buildOcrResult(await recognizePass(current, bytes, second), codes);
      if (!result) throw makeError(ERROR_CODES.OCR_NO_TEXT, 'No text found in the image');
      return result;
    } finally {
      progressHandler = null;
    }
  });
}

/** Terminate the worker and delete all downloaded language data (Tesseract's IndexedDB cache). */
export function clearCache() {
  return enqueue(async () => {
    await disposeEngine();
    if (!globalThis.indexedDB) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(makeError(ERROR_CODES.OCR_FAILED, 'Language data is still in use')), 10_000);
      const req = indexedDB.deleteDatabase(CACHE_DB_NAME);
      // `blocked` just means the terminated worker's connection is still closing — success follows.
      req.onsuccess = () => {
        clearTimeout(timer);
        resolve();
      };
      req.onerror = () => {
        clearTimeout(timer);
        reject(makeError(ERROR_CODES.OCR_FAILED, req.error?.message || 'Could not delete language data'));
      };
    });
  });
}

/** Terminate the worker now (it is recreated by the next recognize()). */
export function terminate() {
  return enqueue(disposeEngine);
}

/** Snapshot for the offscreen document's idle logic and the dev harness. */
export function getStatus() {
  return {
    busy: pending > 0,
    ready: Boolean(engine),
    langs: engine ? engine.key.split('+') : [],
    core: engine?.core || null,
  };
}
