/**
 * TransPop — tiny HTTP helper shared by the providers. PURE (only `fetch`, no chrome.*).
 * Maps transport failures to TransPop error codes:
 *   network error / abort / timeout → NETWORK
 *   HTTP 429 / 503                  → RATE_LIMITED
 *   any other non-2xx / bad JSON    → PROVIDER_ERROR
 */
import { ERROR_CODES } from '../../shared/constants.js';
import { makeError } from '../../shared/messaging.js';

export const DEFAULT_TIMEOUT_MS = 10_000;

/** Default fetch, called unbound (calling a stored `fetch` as a method throws "Illegal invocation"). */
export const defaultFetch = (...args) => globalThis.fetch(...args);

/** Map an HTTP status to a TransPop error code. */
export function statusToCode(status) {
  if (status === 429 || status === 503) return ERROR_CODES.RATE_LIMITED;
  return ERROR_CODES.PROVIDER_ERROR;
}

/**
 * fetch + timeout + error mapping. Resolves with `{ status, body }` where body is parsed JSON
 * (`as: 'json'`, default) or text (`as: 'text'`). The timeout covers reading the body too.
 */
export async function request(url, init = {}, { fetchImpl = defaultFetch, timeoutMs = DEFAULT_TIMEOUT_MS, as = 'json', label = 'request' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetchImpl(url, { credentials: 'omit', ...init, signal: controller.signal });
    } catch (err) {
      const reason = controller.signal.aborted ? `timed out after ${timeoutMs} ms` : String(err?.message || err);
      throw makeError(ERROR_CODES.NETWORK, `${label}: ${reason}`);
    }
    if (!res || typeof res.status !== 'number') throw makeError(ERROR_CODES.PROVIDER_ERROR, `${label}: invalid response`);
    if (!res.ok) {
      const err = makeError(statusToCode(res.status), `${label}: HTTP ${res.status}`);
      err.status = res.status;
      try {
        err.body = await res.text();
      } catch {
        /* ignore */
      }
      throw err;
    }
    let body;
    try {
      body = as === 'text' ? await res.text() : await res.json();
    } catch (err) {
      if (controller.signal.aborted) throw makeError(ERROR_CODES.NETWORK, `${label}: timed out after ${timeoutMs} ms`);
      throw makeError(ERROR_CODES.PROVIDER_ERROR, `${label}: invalid ${as === 'text' ? 'body' : 'JSON'}`);
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/*
 * Small defensive accessors used by the parsers. Strings are NFC-normalized: Google returns some dictionary
 * terms decomposed (e.g. Vietnamese "rỏ ràng" as o + U+0309), which breaks equality/de-duplication.
 */
export const arr = (v) => (Array.isArray(v) ? v : []);
export const str = (v) => (typeof v === 'string' ? v.normalize('NFC') : '');
export const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Unique non-empty trimmed (NFC) strings, preserving order. */
export function uniqueStrings(list, exclude = []) {
  const seen = new Set(exclude.map((s) => String(s).normalize('NFC').trim().toLocaleLowerCase()));
  const out = [];
  for (const item of list) {
    if (!isNonEmptyString(item)) continue;
    const value = item.normalize('NFC').trim();
    const k = value.toLocaleLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(value);
  }
  return out;
}

/** True for short inputs that deserve dictionary / definitions / examples (ARCHITECTURE §6). */
export function isShortText(text, maxChars, maxWords) {
  const t = String(text || '').trim();
  if (!t || t.length > maxChars) return false;
  return t.split(/\s+/).filter(Boolean).length <= maxWords;
}
