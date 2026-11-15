/**
 * TransPop — the single offscreen document shared by text-to-speech (audio playback) and OCR (Tesseract worker).
 *
 * Chrome allows one offscreen document per extension, so every feature goes through ensureOffscreen():
 *  - reasons `['AUDIO_PLAYBACK', 'WORKERS']`, one creation in flight at a time (concurrent callers share it);
 *  - existence is checked with chrome.runtime.getContexts (fallback: chrome.offscreen.hasDocument).
 *
 * Lifetime: the document may disappear at any time — Chrome can close an audio document after ~30 s of silence and
 * the document closes itself after a few idle minutes (see offscreen.js). sendToOffscreen() therefore recreates it and
 * re-sends once when the message finds no receiver or the channel closes mid-call.
 *
 * chrome.* is only touched inside functions (the module can be imported in Node tests with a mocked `chrome`).
 */

export const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
export const OFFSCREEN_REASONS = Object.freeze(['AUDIO_PLAYBACK', 'WORKERS']);
export const OFFSCREEN_JUSTIFICATION =
  'Play pronunciation audio (text-to-speech) and run on-device text recognition (OCR) for image translation.';
/** Delay before re-sending a message that found no receiver (document just created / being recreated). */
export const RESEND_DELAY_MS = 150;

const NO_RECEIVER_RE = /Receiving end does not exist|Could not establish connection|message (port|channel) closed/i;
const ALREADY_EXISTS_RE = /single offscreen|already exists|only a single/i;

/** True when a sendMessage error means "nobody (or nobody anymore) is listening". */
export const isNoReceiver = (err) => NO_RECEIVER_RE.test(String(err?.message || err || ''));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let creating = null; // Promise<boolean> while a check/creation is in flight

/** Whether our offscreen document currently exists. Never throws. */
export async function hasOffscreen() {
  try {
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
      });
      return contexts.length > 0;
    }
    return chrome.offscreen?.hasDocument ? await chrome.offscreen.hasDocument() : false;
  } catch {
    return false;
  }
}

/**
 * Make sure the offscreen document exists. Concurrent callers share one check/creation, so createDocument is
 * never called twice in parallel. Resolves `true` if this call created the document, `false` if it already existed.
 * Rejects only when Chrome refuses to create it (e.g. offscreen API unavailable).
 */
export function ensureOffscreen() {
  if (creating) return creating;
  creating = (async () => {
    if (await hasOffscreen()) return false;
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: [...OFFSCREEN_REASONS],
        justification: OFFSCREEN_JUSTIFICATION,
      });
      return true;
    } catch (err) {
      if (ALREADY_EXISTS_RE.test(String(err?.message))) return false;
      throw err;
    }
  })().finally(() => {
    creating = null;
  });
  return creating;
}

/**
 * Send `message` to the offscreen document (adds `target: 'offscreen'` so other listeners ignore it) and resolve
 * with its raw response envelope. Creates the document first; if the message finds no receiver, the channel closes
 * before the answer (document closed mid-call) or nobody answers, the document is re-ensured and the message is
 * re-sent once. A second failure rejects with the original Chrome error.
 *
 * @param {object} message  `{ type, ...payload }`
 * @param {{ ensure?: boolean }} [options]  `ensure: false` = don't create the document (e.g. for "stop").
 */
export async function sendToOffscreen(message, { ensure = true } = {}) {
  const payload = { target: 'offscreen', ...message };
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await delay(RESEND_DELAY_MS);
    if (ensure) await ensureOffscreen();
    try {
      const response = await chrome.runtime.sendMessage(payload);
      if (response !== undefined) return response;
      lastError = new Error('The offscreen document did not answer (message port closed).');
    } catch (err) {
      if (!isNoReceiver(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

