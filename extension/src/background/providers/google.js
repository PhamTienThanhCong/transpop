/**
 * TransPop — Google Translate provider (free "gtx" web endpoint, `dj=1` JSON). PURE: only `fetch`, no chrome.*.
 * See docs/ARCHITECTURE.md §6.
 */
import { ERROR_CODES, LIMITS } from '../../shared/constants.js';
import { makeError } from '../../shared/messaging.js';
import { normalizeLangCode } from '../../shared/languages.js';
import { arr, defaultFetch, DEFAULT_TIMEOUT_MS, isNonEmptyString, isShortText, num, request, str, uniqueStrings } from './http.js';

export const GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

/** Build the request URL + init for a text. Rich data (bd/md/ex/ss/at) only for short inputs. */
export function buildGoogleRequest({ text, from = 'auto', to, uiLang = 'en' }) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: from || 'auto',
    tl: to,
    hl: normalizeLangCode(uiLang) || 'en',
    dj: '1',
    ie: 'UTF-8',
    oe: 'UTF-8',
  });
  const dt = ['t', 'rm'];
  if (isShortText(text, LIMITS.DICT_MAX_CHARS, LIMITS.DICT_MAX_WORDS)) dt.push('bd', 'md', 'ex', 'ss', 'at');
  for (const d of dt) params.append('dt', d);
  return {
    url: `${GOOGLE_ENDPOINT}?${params}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `q=${encodeURIComponent(text)}`,
    },
  };
}

/**
 * Parse a `dj=1` response into a TranslationResult. Every field of the response is optional.
 * @param {object} json   parsed response body
 * @param {string} text   original (trimmed) text
 * @param {{from?: string, to?: string}} [opts] requested languages (used when the response doesn't say)
 */
export function parseGoogleResponse(json, text = '', { from = 'auto', to = '' } = {}) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw makeError(ERROR_CODES.PROVIDER_ERROR, 'google: unexpected response shape');
  }
  const sentences = arr(json.sentences);
  const translation = sentences
    .map((s) => str(s?.trans))
    .join('')
    .trim();
  if (!translation) throw makeError(ERROR_CODES.PROVIDER_ERROR, 'google: empty translation');

  const phonetic = sentences.map((s) => str(s?.src_translit)).find(isNonEmptyString);
  const translit = sentences.map((s) => str(s?.translit)).find(isNonEmptyString);

  const ld = json.ld_result && typeof json.ld_result === 'object' ? json.ld_result : {};
  const detected = str(json.src) || str(arr(ld.srclangs)[0]);
  const fromCode = normalizeLangCode(detected) || detected || (from && from !== 'auto' ? from : 'auto');
  const confidence = num(json.confidence) ?? num(arr(ld.srclangs_confidences)[0]);

  const result = {
    text: String(text),
    translation,
    from: fromCode,
    to: to || '',
    provider: 'google',
  };
  if (confidence !== undefined) result.confidence = Math.max(0, Math.min(1, confidence));
  // Google echoes Latin-script input as its own "transliteration" (e.g. "Wissenschaft") — that's noise, drop it.
  const sameAs = (a, b) => a.trim().toLocaleLowerCase() === String(b).trim().toLocaleLowerCase();
  if (phonetic && !sameAs(phonetic, text)) result.phonetic = phonetic.trim();
  if (translit && !sameAs(translit, translation)) result.translit = translit.trim();

  const alternatives = parseAlternatives(json.alternative_translations, translation);
  if (alternatives.length) result.alternatives = alternatives;

  const dictionary = parseDictionary(json.dict);
  if (dictionary.length) result.dictionary = dictionary;

  const definitions = parseDefinitions(json.definitions);
  if (definitions.length) result.definitions = definitions;

  const examples = uniqueStrings(arr(json.examples?.example).map((e) => str(e?.text)));
  if (examples.length) result.examples = examples;

  const synonyms = parseSynonyms(json.synsets);
  if (synonyms.length) result.synonyms = synonyms;

  return result;
}

/** `alternative_translations` → whole-text alternatives (only when the text is a single segment). */
function parseAlternatives(list, translation) {
  const segments = arr(list).filter((seg) => seg && typeof seg === 'object');
  if (segments.length !== 1) return [];
  return uniqueStrings(
    arr(segments[0].alternative).map((a) => str(a?.word_postproc)),
    [translation],
  );
}

/** `dict` → dictionary[{ pos, terms, entries[{ word, reverse, score }] }]. */
function parseDictionary(list) {
  const out = [];
  for (const d of arr(list)) {
    if (!d || typeof d !== 'object') continue;
    const entries = [];
    for (const e of arr(d.entry)) {
      const word = str(e?.word).trim();
      if (!word) continue;
      const entry = { word, reverse: uniqueStrings(arr(e.reverse_translation)) };
      const score = num(e.score);
      if (score !== undefined) entry.score = score;
      entries.push(entry);
    }
    let terms = uniqueStrings(arr(d.terms));
    if (!terms.length) terms = uniqueStrings(entries.map((e) => e.word));
    if (!terms.length) continue;
    const item = { pos: str(d.pos).trim(), terms };
    if (entries.length) item.entries = entries;
    out.push(item);
  }
  return out;
}

/** `definitions` → definitions[{ pos, items[{ definition, example? }] }]. */
function parseDefinitions(list) {
  const out = [];
  for (const d of arr(list)) {
    if (!d || typeof d !== 'object') continue;
    const items = [];
    for (const e of arr(d.entry)) {
      const definition = str(e?.gloss).trim();
      if (!definition) continue;
      const item = { definition };
      const example = str(e.example).trim();
      if (example) item.example = example;
      items.push(item);
    }
    if (items.length) out.push({ pos: str(d.pos).trim(), items });
  }
  return out;
}

/** `synsets` → synonyms[{ pos, terms }] (all synonym groups of a pos flattened, de-duplicated). */
function parseSynonyms(list) {
  const out = [];
  for (const s of arr(list)) {
    if (!s || typeof s !== 'object') continue;
    const terms = uniqueStrings(arr(s.entry).flatMap((e) => arr(e?.synonym)));
    if (terms.length) out.push({ pos: str(s.pos).trim(), terms });
  }
  return out;
}

/**
 * Translate with Google. Resolves with a TranslationResult or throws an Error with `.code`.
 * @param {{text: string, from?: string, to: string, uiLang?: string, fetchImpl?: Function, timeoutMs?: number}} opts
 */
export async function translateGoogle({ text, from = 'auto', to, uiLang = 'en', fetchImpl = defaultFetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const { url, init } = buildGoogleRequest({ text, from, to, uiLang });
  const { body } = await request(url, init, { fetchImpl, timeoutMs, label: 'google' });
  return parseGoogleResponse(body, text, { from, to });
}
