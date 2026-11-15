/**
 * TransPop — i18n helpers for extension pages (ES module).
 * Strings come from extension/_locales/<lang>/messages.json, generated from i18n/*.json.
 */

/** Translate a message key. `subs` may be a string or an array of up to 9 substitutions ($1..$9). Falls back to the key. */
export function t(key, subs) {
  try {
    const msg = chrome.i18n.getMessage(key, subs === undefined ? undefined : [].concat(subs).map(String));
    return msg || key;
  } catch {
    return key;
  }
}

/** UI language direction for the current extension locale. */
export function uiDir() {
  try {
    return chrome.i18n.getMessage('@@bidi_dir') || 'ltr';
  } catch {
    return 'ltr';
  }
}

/**
 * Localize a DOM subtree:
 *   data-i18n="key"             → textContent
 *   data-i18n-placeholder="key" → placeholder
 *   data-i18n-title="key"       → title
 *   data-i18n-aria-label="key"  → aria-label
 * Also sets <html lang/dir> when called on the whole document.
 */
export function localizeDocument(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
  if (root === document) {
    try {
      document.documentElement.lang = chrome.i18n.getUILanguage();
    } catch {
      /* ignore */
    }
    document.documentElement.dir = uiDir();
    const titleKey = document.documentElement.dataset.i18nDocTitle;
    if (titleKey) document.title = t(titleKey);
  }
}

/** Relative time like "3 min ago" using Intl.RelativeTimeFormat in the UI locale. */
export function formatRelativeTime(ts, now = Date.now()) {
  let locale = 'en';
  try {
    locale = chrome.i18n.getUILanguage();
  } catch {
    /* ignore */
  }
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diff = Math.round((ts - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ts).toLocaleDateString(locale);
}
