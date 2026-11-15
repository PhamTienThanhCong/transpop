/**
 * TransPop — provider-agnostic translate(). PURE: no chrome.* (runs in Node for tests / dev server).
 *
 *  - validates input (EMPTY / TOO_LONG / UNSUPPORTED_LANG)
 *  - automatic fallback to the other provider on NETWORK / PROVIDER_ERROR / RATE_LIMITED
 *    (and UNSUPPORTED_LANG / UNKNOWN: the other provider may support the pair)
 *  - smart swap: when `swapTo` is given and the detected source equals `to`, translate into `swapTo`
 */
import { ERROR_CODES, LIMITS, PROVIDERS } from '../shared/constants.js';
import { makeError } from '../shared/messaging.js';
import { normalizeLangCode } from '../shared/languages.js';
import { translateGoogle } from './providers/google.js';
import { translateMicrosoft } from './providers/microsoft.js';
import { defaultFetch, DEFAULT_TIMEOUT_MS } from './providers/http.js';

export const PROVIDER_IMPLS = Object.freeze({
  google: translateGoogle,
  microsoft: translateMicrosoft,
});

const FALLBACK_CODES = new Set([
  ERROR_CODES.NETWORK,
  ERROR_CODES.PROVIDER_ERROR,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.UNSUPPORTED_LANG,
  ERROR_CODES.UNKNOWN,
]);

/** Provider order: the chosen one first, then the rest as fallbacks. */
export function providerOrder(provider) {
  const primary = PROVIDERS.includes(provider) ? provider : 'google';
  return [primary, ...PROVIDERS.filter((p) => p !== primary)];
}

/** Ensure every thrown value carries a TransPop error code. */
function asCodedError(err) {
  if (err?.code && ERROR_CODES[err.code]) return err;
  const wrapped = makeError(ERROR_CODES.UNKNOWN, String(err?.message || err || 'Unknown error'));
  wrapped.cause = err;
  return wrapped;
}

/** Validate & normalize a target-like language code (no `auto`). */
function targetCode(code) {
  const norm = normalizeLangCode(code);
  return norm && norm !== 'auto' ? norm : null;
}

/** Try each provider in order; throws the primary provider's error if all fail. */
async function translateWithFallback(order, params, impls) {
  let firstError = null;
  for (const name of order) {
    const impl = impls[name];
    if (typeof impl !== 'function') continue;
    try {
      const result = await impl(params);
      return { ...result, text: params.text, to: result.to || params.to, provider: result.provider || name };
    } catch (raw) {
      const err = asCodedError(raw);
      err.provider = err.provider || name;
      if (!firstError) firstError = err;
      else (firstError.fallbackErrors ||= []).push(err);
      if (!FALLBACK_CODES.has(err.code)) break;
    }
  }
  throw firstError || makeError(ERROR_CODES.PROVIDER_ERROR, 'No translation provider available');
}

/**
 * Translate `text`. Resolves with a TranslationResult (docs/ARCHITECTURE.md §5) or throws an Error with `.code`.
 * @param {object} opts
 * @param {string} opts.text
 * @param {string} [opts.from='auto']
 * @param {string} opts.to
 * @param {string} [opts.swapTo]       smart-swap language (used when the detected source equals `to`)
 * @param {'google'|'microsoft'} [opts.provider='google']
 * @param {string} [opts.uiLang]       UI language (Google returns part-of-speech labels in it)
 * @param {Function} [opts.fetchImpl]  injectable fetch (tests)
 * @param {number} [opts.timeoutMs]
 * @param {object} [opts.providers]    injectable provider implementations (tests)
 */
export async function translate({
  text,
  from = 'auto',
  to,
  swapTo,
  provider = 'google',
  uiLang = 'en',
  fetchImpl = defaultFetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  providers = PROVIDER_IMPLS,
} = {}) {
  const input = typeof text === 'string' ? text.trim() : '';
  if (!input) throw makeError(ERROR_CODES.EMPTY, 'Nothing to translate');
  if (input.length > LIMITS.MAX_TEXT_LENGTH) {
    throw makeError(ERROR_CODES.TOO_LONG, `Text is longer than ${LIMITS.MAX_TEXT_LENGTH} characters`);
  }

  const source = normalizeLangCode(from || 'auto');
  if (!source) throw makeError(ERROR_CODES.UNSUPPORTED_LANG, `Unsupported source language: ${from}`);
  const target = targetCode(to);
  if (!target) throw makeError(ERROR_CODES.UNSUPPORTED_LANG, `Unsupported target language: ${to}`);
  const swap = swapTo ? targetCode(swapTo) : null;
  const swapTarget = swap && swap !== target ? swap : null;

  const order = providerOrder(provider);
  const base = { text: input, uiLang, fetchImpl, timeoutMs };

  // Source explicitly equals the target: go straight to the swap language.
  if (swapTarget && source !== 'auto' && source === target) {
    return translateWithFallback(order, { ...base, from: source, to: swapTarget }, providers);
  }

  const result = await translateWithFallback(order, { ...base, from: source, to: target }, providers);

  if (swapTarget && normalizeLangCode(result.from) === target) {
    // Detected source == target → re-translate into the swap language, starting with the provider that worked.
    const swapOrder = providerOrder(result.provider);
    try {
      return await translateWithFallback(swapOrder, { ...base, from: result.from, to: swapTarget }, providers);
    } catch {
      return result; // the un-swapped result is still a valid answer
    }
  }
  return result;
}
