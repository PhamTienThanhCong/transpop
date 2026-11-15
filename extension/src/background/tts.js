/**
 * TransPop — text-to-speech. Google TTS audio is played in the shared offscreen document (offscreen-doc.js,
 * also used by OCR); if that fails we fall back to chrome.tts.
 * The document may be closed by Chrome (audio idle) or by itself (idle) at any time —
 * ensureOffscreen() / sendToOffscreen() recreate it on demand.
 *
 * chunkText() / buildTtsUrls() / ttsLang() are pure (Node-testable); chrome.* is only touched inside functions.
 */
import { ERROR_CODES, LIMITS, MSG } from '../shared/constants.js';
import { makeError } from '../shared/messaging.js';
import { normalizeLangCode } from '../shared/languages.js';
import { ensureOffscreen, hasOffscreen, OFFSCREEN_PATH, sendToOffscreen } from './offscreen-doc.js';

export const TTS_ENDPOINT = 'https://translate.google.com/translate_tts';
export { OFFSCREEN_PATH };

const SENTENCE_END = /[.!?…。！？；;\n]/;
const CLAUSE_END = /[,，、:：)\]）」』]/;

/** Find where to cut `s` so that the first piece is ≤ max chars, preferring sentence > clause > word boundaries. */
function findCut(s, max) {
  const minCut = Math.floor(max * 0.3);
  const win = s.slice(0, max);
  for (const re of [SENTENCE_END, CLAUSE_END]) {
    for (let i = win.length - 1; i >= minCut; i--) if (re.test(win[i])) return i + 1;
  }
  const space = s.slice(0, max + 1).lastIndexOf(' ');
  if (space > 0) return space;
  let cut = max;
  const code = s.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1; // don't split a surrogate pair
  return cut;
}

/** Split text into chunks of ≤ `max` characters at sentence / clause / space boundaries. */
export function chunkText(text, max = LIMITS.TTS_CHUNK) {
  const limit = Math.max(1, Math.floor(max) || LIMITS.TTS_CHUNK);
  let rest = String(text ?? '')
    .replace(/[ \t\f\v\r ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  const chunks = [];
  while (rest.length > limit) {
    const cut = findCut(rest, limit);
    const piece = rest.slice(0, cut).replace(/\s+/g, ' ').trim();
    if (piece) chunks.push(piece);
    rest = rest.slice(cut).trim();
  }
  const last = rest.replace(/\s+/g, ' ').trim();
  if (last) chunks.push(last);
  return chunks;
}

/** Language code for Google TTS (`auto`/unknown → `en`). */
export function ttsLang(lang) {
  const code = normalizeLangCode(lang);
  return code && code !== 'auto' ? code : 'en';
}

/** Google TTS URLs, one per chunk (ARCHITECTURE §6). */
export function buildTtsUrls(text, lang, max = LIMITS.TTS_CHUNK) {
  const tl = ttsLang(lang);
  return chunkText(text, max).map((q) => `${TTS_ENDPOINT}?${new URLSearchParams({ ie: 'UTF-8', client: 'tw-ob', tl, q })}`);
}

/** Google code → BCP-47 for chrome.tts voices. */
const BCP47 = Object.freeze({ iw: 'he', tl: 'fil', jw: 'jv', no: 'nb', 'mni-Mtei': 'mni' });
export const toBcp47 = (code) => BCP47[code] || code;

export const clampRate = (rate) => {
  const r = Number(rate);
  return Number.isFinite(r) ? Math.min(LIMITS.SPEECH_RATE_MAX, Math.max(LIMITS.SPEECH_RATE_MIN, r)) : 1;
};

/* ------------------------------------------------------------------ */
/* Playback                                                            */
/* ------------------------------------------------------------------ */

let speakSeq = 0;

function stopNative() {
  try {
    chrome.tts?.stop();
  } catch {
    /* ignore */
  }
}

function speakNative(text, lang, rate) {
  return new Promise((resolve, reject) => {
    if (!chrome.tts?.speak) {
      reject(makeError(ERROR_CODES.UNKNOWN, 'Speech is not available'));
      return;
    }
    chrome.tts.speak(text, { lang: toBcp47(lang), rate, enqueue: false }, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(makeError(ERROR_CODES.UNKNOWN, err.message));
      else resolve();
    });
  });
}

/**
 * Speak `text` in `lang`. Resolves once playback has started (`{ engine: 'google' | 'native' }`),
 * or `{ engine: null }` when superseded by a newer speak()/stop() call.
 */
export async function speak(text, lang, rate = 1) {
  const clean = String(text ?? '').trim().slice(0, LIMITS.MAX_TEXT_LENGTH);
  if (!clean) throw makeError(ERROR_CODES.EMPTY, 'Nothing to speak');
  const code = ttsLang(lang);
  const r = clampRate(rate);
  const seq = ++speakSeq;
  stopNative();
  try {
    await ensureOffscreen();
    if (seq !== speakSeq) return { engine: null };
    const res = await sendToOffscreen({ type: MSG.OFFSCREEN_PLAY, urls: buildTtsUrls(clean, code), rate: r });
    if (res?.ok) return { engine: 'google' };
    throw new Error(res?.error?.message || 'Offscreen playback failed');
  } catch (err) {
    if (seq !== speakSeq) return { engine: null };
    console.warn('[TransPop] Audio playback failed, falling back to chrome.tts:', err?.message || err);
    await speakNative(clean, code, r);
    return { engine: 'native' };
  }
}

/** Stop any speech (offscreen audio and chrome.tts). */
export async function stop() {
  speakSeq++;
  stopNative();
  if (!(await hasOffscreen())) return;
  try {
    await sendToOffscreen({ type: MSG.OFFSCREEN_STOP }, { ensure: false });
  } catch {
    /* document went away — nothing to stop */
  }
}
