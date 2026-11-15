/**
 * TransPop — Microsoft Translator provider. PURE: only `fetch`, no chrome.*. See docs/ARCHITECTURE.md §6.
 *
 * Transports (tried in order, first success wins):
 *  1. "edge" — free Edge token (`GET edge.microsoft.com/translate/auth`, cached ~8 min) + Translator v3 API
 *     (`api-edge.cognitive.microsofttranslator.com`). This is the contract endpoint.
 *  2. "bing" — Bing web translator (`www.bing.com/ttranslatev3`, same response schema as Translator v3).
 *     Used when the Edge token is unavailable. NOTE: needs the `https://www.bing.com/*` host permission in an
 *     extension context; without it the request fails fast and the error is reported normally.
 *
 * Single words / short phrases (EN ↔ X) additionally get a dictionary lookup (`/dictionary/lookup`).
 */
import { ERROR_CODES, LIMITS } from '../../shared/constants.js';
import { makeError } from '../../shared/messaging.js';
import { normalizeLangCode } from '../../shared/languages.js';
import { arr, defaultFetch, DEFAULT_TIMEOUT_MS, isShortText, num, request, str, uniqueStrings } from './http.js';

export const EDGE_AUTH_URL = 'https://edge.microsoft.com/translate/auth';
export const EDGE_API_BASE = 'https://api-edge.cognitive.microsofttranslator.com';
export const BING_BASE = 'https://www.bing.com';

const TOKEN_TTL_MS = 8 * 60 * 1000;
const EDGE_RETRY_AFTER_MS = 10 * 60 * 1000; // after a hard auth failure (e.g. 404), skip Edge for a while
const BING_MAX_CHARS = 1000; // Bing web endpoint rejects longer texts
const LOOKUP_MAX_WORDS = 3;

/* ------------------------------------------------------------------ */
/* Language codes                                                      */
/* ------------------------------------------------------------------ */

/** Google-style code → Microsoft code (only where they differ). */
const TO_MS = Object.freeze({
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  iw: 'he',
  tl: 'fil',
  jw: 'jv',
  no: 'nb',
  'mni-Mtei': 'mni',
  ku: 'kmr', // Google "ku" = Kurmanji (Northern)
  ckb: 'ku', // Microsoft "ku" = Central Kurdish (Sorani)
  sr: 'sr-Cyrl',
  hmn: 'mww',
  mn: 'mn-Cyrl',
  ny: 'nya',
  lg: 'lug',
});

/** Microsoft code → Google-style code (only where they differ). Checked before generic normalization. */
const FROM_MS = Object.freeze({
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
  yue: 'zh-TW',
  lzh: 'zh-TW',
  he: 'iw',
  fil: 'tl',
  jv: 'jw',
  nb: 'no',
  mni: 'mni-Mtei',
  ku: 'ckb',
  kmr: 'ku',
  'sr-Cyrl': 'sr',
  'sr-Latn': 'sr',
  mww: 'hmn',
  'mn-Cyrl': 'mn',
  'mn-Mong': 'mn',
  nya: 'ny',
  lug: 'lg',
  prs: 'fa',
  'pt-PT': 'pt',
  'pt-BR': 'pt',
  'fr-CA': 'fr',
});

export function toMicrosoftLang(code) {
  if (!code || code === 'auto') return code;
  return TO_MS[code] || code;
}

export function fromMicrosoftLang(code) {
  if (!code || typeof code !== 'string') return '';
  const direct = FROM_MS[code] || FROM_MS[Object.keys(FROM_MS).find((k) => k.toLowerCase() === code.toLowerCase())];
  return direct || normalizeLangCode(code) || code;
}

/* ------------------------------------------------------------------ */
/* Pure parsers                                                        */
/* ------------------------------------------------------------------ */

/** Error embedded in a response body (Translator v3 `{error:{code,message}}` or Bing `{statusCode,errorMessage}`), else null. */
export function parseMicrosoftError(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (json.error && typeof json.error === 'object') {
    const code = Number(json.error.code);
    const message = `microsoft: ${str(json.error.message) || `error ${json.error.code}`}`;
    if (code === 400035 || code === 400036) return makeError(ERROR_CODES.UNSUPPORTED_LANG, message);
    if (code === 429000 || code === 429001 || code === 429002) return makeError(ERROR_CODES.RATE_LIMITED, message);
    return makeError(ERROR_CODES.PROVIDER_ERROR, message);
  }
  if (typeof json.statusCode === 'number' && json.statusCode >= 400) {
    const message = `bing: status ${json.statusCode}${json.errorMessage ? ` ${json.errorMessage}` : ''}`;
    return makeError(json.statusCode === 429 ? ERROR_CODES.RATE_LIMITED : ERROR_CODES.PROVIDER_ERROR, message);
  }
  return null;
}

/**
 * Parse a `/translate` response (`[{ detectedLanguage?, translations: [{ text, to, transliteration? }] }]`).
 * @param {{from?: string, to?: string}} [opts] requested Google-style languages
 */
export function parseMicrosoftTranslate(json, text = '', { from = 'auto', to = '' } = {}) {
  const embedded = parseMicrosoftError(json);
  if (embedded) throw embedded;
  const item = Array.isArray(json) ? json[0] : null;
  const tr = item && arr(item.translations)[0];
  const translation = str(tr?.text).trim();
  if (!translation) throw makeError(ERROR_CODES.PROVIDER_ERROR, 'microsoft: empty translation');

  const detected = item.detectedLanguage && typeof item.detectedLanguage === 'object' ? item.detectedLanguage : null;
  const fromCode = fromMicrosoftLang(str(detected?.language)) || (from && from !== 'auto' ? from : 'auto');
  const result = {
    text: String(text),
    translation,
    from: fromCode,
    to: to || fromMicrosoftLang(str(tr.to)),
    provider: 'microsoft',
  };
  const score = num(detected?.score);
  if (score !== undefined) result.confidence = Math.max(0, Math.min(1, score));
  const translit = str(tr.transliteration?.text).trim();
  if (translit) result.translit = translit;
  return result;
}

const MS_POS = Object.freeze({
  ADJ: 'adjective',
  ADV: 'adverb',
  CONJ: 'conjunction',
  DET: 'determiner',
  MODAL: 'verb',
  NOUN: 'noun',
  PREP: 'preposition',
  PRON: 'pronoun',
  VERB: 'verb',
  OTHER: '',
});

/** Parse a `/dictionary/lookup` response into TranslationResult.dictionary (grouped by part of speech). */
export function parseMicrosoftLookup(json) {
  if (parseMicrosoftError(json)) return [];
  const item = Array.isArray(json) ? json[0] : null;
  const groups = new Map();
  for (const t of arr(item?.translations)) {
    const word = str(t?.displayTarget || t?.normalizedTarget).trim();
    if (!word) continue;
    const tag = str(t.posTag).toUpperCase();
    const pos = tag in MS_POS ? MS_POS[tag] : tag.toLowerCase();
    if (!groups.has(pos)) groups.set(pos, { pos, terms: [], entries: [] });
    const group = groups.get(pos);
    if (group.terms.includes(word)) continue;
    group.terms.push(word);
    const entry = { word, reverse: uniqueStrings(arr(t.backTranslations).map((b) => str(b?.displayText || b?.normalizedText))) };
    const score = num(t.confidence);
    if (score !== undefined) entry.score = score;
    group.entries.push(entry);
  }
  return [...groups.values()];
}

/** Extract the session parameters from the Bing translator page HTML. Returns null when not found. */
export function parseBingSession(html) {
  const s = String(html || '');
  const ig = s.match(/IG:"([^"]+)"/)?.[1];
  const iid = s.match(/data-iid="(translator\.[^"]+)"/)?.[1] || 'translator.5023';
  const m = s.match(/params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*\]/);
  if (!ig || !m) return null;
  return { ig, iid, key: m[1], token: m[2], ttl: Number(m[3]) || 0 };
}

/** Decode a JWT's `exp` (seconds) without verifying it; null when not decodable. */
export function jwtExpiry(token) {
  try {
    const part = String(token).split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const exp = JSON.parse(atob(b64)).exp;
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Transports (module-scoped caches)                                   */
/* ------------------------------------------------------------------ */

const state = {
  edgeToken: '',
  edgeTokenExpires: 0,
  edgeBlockedUntil: 0,
  bing: null, // { ig, iid, key, token, expires }
};

/** Reset cached tokens/sessions (tests). */
export function resetMicrosoftState() {
  state.edgeToken = '';
  state.edgeTokenExpires = 0;
  state.edgeBlockedUntil = 0;
  state.bing = null;
}

async function getEdgeToken(ctx) {
  const now = Date.now();
  if (state.edgeToken && now < state.edgeTokenExpires) return state.edgeToken;
  if (now < state.edgeBlockedUntil) throw makeError(ERROR_CODES.PROVIDER_ERROR, 'microsoft: Edge auth temporarily unavailable');
  try {
    const { body } = await request(EDGE_AUTH_URL, { method: 'GET' }, { ...ctx, as: 'text', label: 'microsoft auth' });
    const token = String(body || '').trim();
    if (!/^[\w-]+\.[\w-]+\.[\w-]*$/.test(token)) throw makeError(ERROR_CODES.PROVIDER_ERROR, 'microsoft auth: invalid token');
    const exp = jwtExpiry(token);
    const ttl = exp ? Math.min(TOKEN_TTL_MS, exp * 1000 - now - 60_000) : TOKEN_TTL_MS;
    state.edgeToken = token;
    state.edgeTokenExpires = now + Math.max(0, ttl);
    return token;
  } catch (err) {
    if (err?.code === ERROR_CODES.PROVIDER_ERROR) state.edgeBlockedUntil = now + EDGE_RETRY_AFTER_MS;
    throw err;
  }
}

/** Re-map an HTTP error whose body carries a Translator error code (e.g. invalid language → UNSUPPORTED_LANG). */
function remapHttpError(err) {
  if (err?.body) {
    try {
      const embedded = parseMicrosoftError(JSON.parse(err.body));
      if (embedded && embedded.code !== ERROR_CODES.PROVIDER_ERROR) {
        embedded.status = err.status;
        return embedded;
      }
    } catch {
      /* not JSON */
    }
  }
  return err;
}

async function edgeCall(ctx, path, params, text) {
  const qs = new URLSearchParams({ 'api-version': '3.0', ...params });
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getEdgeToken(ctx);
    try {
      const { body } = await request(
        `${EDGE_API_BASE}${path}?${qs}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([{ Text: text }]),
        },
        { ...ctx, label: `microsoft ${path}` },
      );
      return body;
    } catch (err) {
      if (err?.status === 401 && attempt === 0) {
        state.edgeToken = ''; // expired/revoked token: fetch a new one once
        continue;
      }
      throw remapHttpError(err);
    }
  }
  throw makeError(ERROR_CODES.PROVIDER_ERROR, 'microsoft: unauthorized');
}

async function getBingSession(ctx) {
  const now = Date.now();
  if (state.bing && now < state.bing.expires) return state.bing;
  const { body } = await request(`${BING_BASE}/translator`, { method: 'GET' }, { ...ctx, as: 'text', label: 'bing session' });
  const session = parseBingSession(body);
  if (!session) throw makeError(ERROR_CODES.PROVIDER_ERROR, 'bing: session parameters not found');
  const ttl = Math.min(session.ttl || 3_600_000, 3_600_000) - 60_000;
  state.bing = { ...session, expires: now + Math.max(60_000, ttl) };
  return state.bing;
}

async function bingCall(ctx, path, fields) {
  const session = await getBingSession(ctx);
  const qs = new URLSearchParams({ isVertical: '1', IG: session.ig, IID: session.iid });
  const { body } = await request(
    `${BING_BASE}/${path}?${qs}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ ...fields, key: session.key, token: session.token }).toString(),
    },
    { ...ctx, label: `bing ${path}` },
  );
  if (parseMicrosoftError(body)) state.bing = null; // stale session → refresh next time
  return body;
}

const TRANSPORTS = {
  edge: {
    translate: (ctx, { text, from, to }) =>
      edgeCall(ctx, '/translate', { to: toMicrosoftLang(to), ...(from && from !== 'auto' ? { from: toMicrosoftLang(from) } : {}) }, text),
    lookup: (ctx, { text, from, to }) => edgeCall(ctx, '/dictionary/lookup', { from: toMicrosoftLang(from), to: toMicrosoftLang(to) }, text),
  },
  bing: {
    translate: (ctx, { text, from, to }) => {
      if (text.length > BING_MAX_CHARS) throw makeError(ERROR_CODES.PROVIDER_ERROR, 'bing: text too long');
      return bingCall(ctx, 'ttranslatev3', {
        fromLang: from && from !== 'auto' ? toMicrosoftLang(from) : 'auto-detect',
        to: toMicrosoftLang(to),
        text,
      });
    },
    lookup: (ctx, { text, from, to }) => bingCall(ctx, 'tlookupv3', { from: toMicrosoftLang(from), to: toMicrosoftLang(to), text }),
  },
};

/** Dictionary lookup only makes sense for short EN ↔ X inputs. */
function wantsLookup(text, from, to) {
  if (!from || from === 'auto' || from === to) return false;
  if (from !== 'en' && to !== 'en') return false;
  return isShortText(text, LIMITS.DICT_MAX_CHARS, LOOKUP_MAX_WORDS);
}

/**
 * Translate with Microsoft. Resolves with a TranslationResult or throws an Error with `.code`.
 * @param {{text: string, from?: string, to: string, fetchImpl?: Function, timeoutMs?: number, transports?: string[]}} opts
 */
export async function translateMicrosoft({
  text,
  from = 'auto',
  to,
  fetchImpl = defaultFetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  transports = ['edge', 'bing'],
}) {
  const ctx = { fetchImpl, timeoutMs };
  let lastError = null;
  for (const name of transports) {
    const transport = TRANSPORTS[name];
    if (!transport) continue;
    let result;
    try {
      result = parseMicrosoftTranslate(await transport.translate(ctx, { text, from, to }), text, { from, to });
    } catch (err) {
      if (err?.code === ERROR_CODES.UNSUPPORTED_LANG) throw err; // another transport won't help
      lastError = err;
      continue;
    }
    if (wantsLookup(text, result.from, to)) {
      try {
        const dictionary = parseMicrosoftLookup(await transport.lookup(ctx, { text, from: result.from, to }));
        if (dictionary.length) result.dictionary = dictionary;
      } catch {
        /* optional enrichment */
      }
    }
    return result;
  }
  throw lastError || makeError(ERROR_CODES.PROVIDER_ERROR, 'microsoft: no transport available');
}
