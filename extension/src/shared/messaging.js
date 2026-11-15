/**
 * TransPop — messaging helpers for extension pages (ES module).
 * Every response is an envelope: { ok: true, ...data } | { ok: false, error: { code, message } }.
 */
import { ERROR_CODES } from './constants.js';

/** Create an Error carrying a TransPop error code. */
export function makeError(code, message) {
  const err = new Error(message || code);
  err.code = ERROR_CODES[code] ? code : ERROR_CODES.UNKNOWN;
  return err;
}

/**
 * Turn any thrown value into a serializable `{ code, message, details? }`. `details` = the error's plain-object
 * `.details` (e.g. OCR_NO_TEXT → `{ langs, guessed, autoDetected }`, ARCHITECTURE §11).
 */
export function serializeError(err) {
  const out = {
    code: err?.code && ERROR_CODES[err.code] ? err.code : ERROR_CODES.UNKNOWN,
    message: String(err?.message || err || 'Unknown error'),
  };
  const details = err?.details;
  if (details && typeof details === 'object' && !Array.isArray(details)) out.details = details;
  return out;
}

function unwrap(response) {
  if (!response) throw makeError(ERROR_CODES.UNKNOWN, 'No response');
  if (response.ok === false) {
    const err = makeError(response.error?.code, response.error?.message);
    if (response.error?.details && typeof response.error.details === 'object') err.details = response.error.details;
    throw err;
  }
  const { ok, ...data } = response;
  return data;
}

/** Send a message to the background service worker. Resolves with the data part of the envelope, or throws. */
export async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  return unwrap(response);
}

/**
 * Send a message to a tab's content script (top frame by default).
 * Resolves with data, or `null` if no content script is listening (e.g. chrome:// pages, tab not reloaded).
 */
export async function sendToTab(tabId, type, payload = {}, options = { frameId: 0 }) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type, ...payload }, options);
    return unwrap(response);
  } catch (err) {
    if (/Receiving end does not exist|Could not establish connection|message port closed/i.test(String(err?.message))) {
      return null;
    }
    throw err;
  }
}

/**
 * Helper for writing onMessage handlers that always answer with an envelope.
 *   chrome.runtime.onMessage.addListener(createHandler({ [MSG.X]: async (msg, sender) => ({ ... }) }))
 * Unknown types are ignored (return false) so other listeners can answer.
 */
export function createHandler(handlers) {
  return (message, sender, sendResponse) => {
    const handler = message && handlers[message.type];
    if (!handler) return false;
    Promise.resolve()
      .then(() => handler(message, sender))
      .then((data) => sendResponse({ ok: true, ...(data || {}) }))
      .catch((err) => sendResponse({ ok: false, error: serializeError(err) }));
    return true; // async response
  };
}
