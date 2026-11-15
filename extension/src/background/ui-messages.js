/**
 * TransPop — Display language in the service worker (docs/ARCHITECTURE.md §10).
 *
 *  - keeps the messages.json of `settings.uiLanguage` in memory (re-fetched when the setting changes);
 *  - bgT(): like t(), but uses that dictionary → context-menu titles and the badge follow the setting;
 *  - getUiMessages(): payload of the `get-ui-messages` request used by the content script.
 *
 * The worker never calls setUiLocaleOverride(): its getUiLocale() keeps returning the browser language.
 */
import { UI_LANGUAGES } from '../shared/constants.js';
import { createDictionary, fetchLocaleMessages, lookupMessage, t } from '../shared/i18n.js';
import { getUiLocale } from '../shared/languages.js';
import { getSettings } from '../shared/storage.js';

/** Key prefixes the in-page UI (bubble, trigger, crop overlay) uses — the subset sent to content scripts. */
const CONTENT_PREFIXES = ['bubble_', 'common_'];

let current = null; // { lang, messages, dict, content } for the loaded uiLanguage ('auto' → nulls)
let pending = null; // { lang, promise }

const pickLang = (value) => (UI_LANGUAGES.includes(value) ? value : 'auto');

function pickContentMessages(messages) {
  const out = {};
  for (const [key, entry] of Object.entries(messages)) {
    if (!CONTENT_PREFIXES.some((p) => key.startsWith(p)) || typeof entry?.message !== 'string') continue;
    out[key] = entry.placeholders ? { message: entry.message, placeholders: entry.placeholders } : { message: entry.message };
  }
  return out;
}

/**
 * Make sure the dictionary for `settings.uiLanguage` is loaded (reads the settings when not given).
 * Resolves with `{ lang, messages, dict }`; never rejects (a failed load behaves like 'auto' and is retried next time).
 */
export async function ensureUiMessages(settings) {
  let lang = 'auto';
  try {
    lang = pickLang((settings || (await getSettings())).uiLanguage);
  } catch {
    /* keep 'auto' */
  }
  if (current && current.lang === lang) return current;
  if (lang === 'auto') {
    pending = null;
    current = { lang, messages: null, dict: null, content: null };
    return current;
  }
  if (pending && pending.lang === lang) return pending.promise;
  const job = { lang, promise: null };
  job.promise = fetchLocaleMessages(lang).then(
    (messages) => {
      const next = { lang, messages, dict: createDictionary(messages), content: pickContentMessages(messages) };
      if (pending === job) {
        pending = null;
        current = next;
      }
      return next;
    },
    (err) => {
      console.warn(`[TransPop] could not load UI language "${lang}":`, err?.message || err);
      if (pending === job) pending = null; // not cached → retried next time
      return { lang: 'auto', messages: null, dict: null, content: null };
    },
  );
  pending = job;
  return job.promise;
}

/** The uiLanguage whose dictionary is loaded (null until the first ensureUiMessages()). */
export const loadedUiLanguage = () => current?.lang ?? null;

/** t() for the service worker: Display-language dictionary first, then chrome.i18n, then the key. */
export function bgT(key, subs) {
  return lookupMessage(current?.dict, key, subs) || t(key, subs);
}

/** `get-ui-messages` → `{ locale, messages }`; `messages` is null for 'auto' (use chrome.i18n). */
export async function getUiMessages() {
  const ui = await ensureUiMessages();
  return ui.content ? { locale: ui.lang, messages: ui.content } : { locale: getUiLocale(), messages: null };
}
