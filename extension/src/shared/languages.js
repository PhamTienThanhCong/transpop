/**
 * TransPop — language list & helpers (ES module, pure: safe to import in Node).
 * Codes follow Google Translate conventions (e.g. "iw" for Hebrew, "zh-CN", "tl", "jw").
 */

export const AUTO = 'auto';

/** Google Translate supported languages with English names (fallback when Intl.DisplayNames can't name a code). */
export const LANGUAGES = Object.freeze([
  { code: 'af', name: 'Afrikaans' },
  { code: 'sq', name: 'Albanian' },
  { code: 'am', name: 'Amharic' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hy', name: 'Armenian' },
  { code: 'as', name: 'Assamese' },
  { code: 'ay', name: 'Aymara' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'bm', name: 'Bambara' },
  { code: 'eu', name: 'Basque' },
  { code: 'be', name: 'Belarusian' },
  { code: 'bn', name: 'Bengali' },
  { code: 'bho', name: 'Bhojpuri' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'ca', name: 'Catalan' },
  { code: 'ceb', name: 'Cebuano' },
  { code: 'ny', name: 'Chichewa' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'co', name: 'Corsican' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'dv', name: 'Dhivehi' },
  { code: 'doi', name: 'Dogri' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'eo', name: 'Esperanto' },
  { code: 'et', name: 'Estonian' },
  { code: 'ee', name: 'Ewe' },
  { code: 'tl', name: 'Filipino' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'fy', name: 'Frisian' },
  { code: 'gl', name: 'Galician' },
  { code: 'ka', name: 'Georgian' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'gn', name: 'Guarani' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'ht', name: 'Haitian Creole' },
  { code: 'ha', name: 'Hausa' },
  { code: 'haw', name: 'Hawaiian' },
  { code: 'iw', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hmn', name: 'Hmong' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'is', name: 'Icelandic' },
  { code: 'ig', name: 'Igbo' },
  { code: 'ilo', name: 'Ilocano' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ga', name: 'Irish' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'jw', name: 'Javanese' },
  { code: 'kn', name: 'Kannada' },
  { code: 'kk', name: 'Kazakh' },
  { code: 'km', name: 'Khmer' },
  { code: 'rw', name: 'Kinyarwanda' },
  { code: 'gom', name: 'Konkani' },
  { code: 'ko', name: 'Korean' },
  { code: 'kri', name: 'Krio' },
  { code: 'ku', name: 'Kurdish (Kurmanji)' },
  { code: 'ckb', name: 'Kurdish (Sorani)' },
  { code: 'ky', name: 'Kyrgyz' },
  { code: 'lo', name: 'Lao' },
  { code: 'la', name: 'Latin' },
  { code: 'lv', name: 'Latvian' },
  { code: 'ln', name: 'Lingala' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'lg', name: 'Luganda' },
  { code: 'lb', name: 'Luxembourgish' },
  { code: 'mk', name: 'Macedonian' },
  { code: 'mai', name: 'Maithili' },
  { code: 'mg', name: 'Malagasy' },
  { code: 'ms', name: 'Malay' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mt', name: 'Maltese' },
  { code: 'mi', name: 'Maori' },
  { code: 'mr', name: 'Marathi' },
  { code: 'mni-Mtei', name: 'Meiteilon (Manipuri)' },
  { code: 'lus', name: 'Mizo' },
  { code: 'mn', name: 'Mongolian' },
  { code: 'my', name: 'Myanmar (Burmese)' },
  { code: 'ne', name: 'Nepali' },
  { code: 'no', name: 'Norwegian' },
  { code: 'or', name: 'Odia (Oriya)' },
  { code: 'om', name: 'Oromo' },
  { code: 'ps', name: 'Pashto' },
  { code: 'fa', name: 'Persian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'qu', name: 'Quechua' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sm', name: 'Samoan' },
  { code: 'sa', name: 'Sanskrit' },
  { code: 'gd', name: 'Scots Gaelic' },
  { code: 'nso', name: 'Sepedi' },
  { code: 'sr', name: 'Serbian' },
  { code: 'st', name: 'Sesotho' },
  { code: 'sn', name: 'Shona' },
  { code: 'sd', name: 'Sindhi' },
  { code: 'si', name: 'Sinhala' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'so', name: 'Somali' },
  { code: 'es', name: 'Spanish' },
  { code: 'su', name: 'Sundanese' },
  { code: 'sw', name: 'Swahili' },
  { code: 'sv', name: 'Swedish' },
  { code: 'tg', name: 'Tajik' },
  { code: 'ta', name: 'Tamil' },
  { code: 'tt', name: 'Tatar' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'ti', name: 'Tigrinya' },
  { code: 'ts', name: 'Tsonga' },
  { code: 'tr', name: 'Turkish' },
  { code: 'tk', name: 'Turkmen' },
  { code: 'ak', name: 'Twi' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'ug', name: 'Uyghur' },
  { code: 'uz', name: 'Uzbek' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'cy', name: 'Welsh' },
  { code: 'xh', name: 'Xhosa' },
  { code: 'yi', name: 'Yiddish' },
  { code: 'yo', name: 'Yoruba' },
  { code: 'zu', name: 'Zulu' },
]);

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

/** Aliases (BCP-47 / other providers) → Google code. */
const ALIASES = Object.freeze({
  he: 'iw',
  fil: 'tl',
  jv: 'jw',
  nb: 'no',
  nn: 'no',
  zh: 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-sg': 'zh-CN',
  'zh-hant': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
  mni: 'mni-Mtei',
  'mni-mtei': 'mni-Mtei',
  'zh-cn': 'zh-CN',
  'zh-tw': 'zh-TW',
});

/** Google code → BCP-47 code understood by Intl.DisplayNames. */
const DISPLAY_CODES = Object.freeze({
  iw: 'he',
  tl: 'fil',
  jw: 'jv',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'mni-Mtei': 'mni',
  ku: 'kmr',
});

export const RTL_LANGS = new Set(['ar', 'iw', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']);

/** Normalize any language code to the Google-style code used across TransPop. Returns `auto` unchanged, `null` if unknown. */
export function normalizeLangCode(code) {
  if (!code || typeof code !== 'string') return null;
  const raw = code.trim();
  if (raw.toLowerCase() === AUTO) return AUTO;
  if (BY_CODE.has(raw)) return raw;
  const lower = raw.toLowerCase().replace(/_/g, '-');
  if (ALIASES[lower]) return ALIASES[lower];
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === lower);
  if (exact) return exact.code;
  const primary = lower.split('-')[0];
  if (ALIASES[primary]) return ALIASES[primary];
  if (BY_CODE.has(primary)) return primary;
  return null;
}

export function isSupportedLang(code) {
  return BY_CODE.has(code);
}

export function isRtl(code) {
  return RTL_LANGS.has(code);
}

/** Map a browser UI language (e.g. "vi", "en-US", "pt-BR", "zh-TW") to a supported target code. */
export function uiLangToTarget(uiLang) {
  return normalizeLangCode(uiLang) || 'en';
}

/** Best-effort UI locale (works in extension contexts and in Node). */
export function getUiLocale() {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) return chrome.i18n.getUILanguage();
  } catch {
    /* ignore */
  }
  return (typeof navigator !== 'undefined' && navigator.language) || 'en';
}

const displayNamesCache = new Map();
function getDisplayNames(locale) {
  if (!displayNamesCache.has(locale)) {
    let dn = null;
    try {
      dn = new Intl.DisplayNames([locale, 'en'], { type: 'language', fallback: 'none' });
    } catch {
      dn = null;
    }
    displayNamesCache.set(locale, dn);
  }
  return displayNamesCache.get(locale);
}

function capitalize(s, locale) {
  return s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s;
}

/** Localized language name, e.g. getLanguageName('en', 'vi') → "Tiếng Anh". `auto` returns null (UIs show their own "Detect language" string). */
export function getLanguageName(code, locale = getUiLocale()) {
  if (!code || code === AUTO) return null;
  const norm = normalizeLangCode(code) || code;
  const dn = getDisplayNames(locale);
  if (dn) {
    try {
      const name = dn.of(DISPLAY_CODES[norm] || norm);
      if (name && name.toLowerCase() !== (DISPLAY_CODES[norm] || norm).toLowerCase()) return capitalize(name, locale);
    } catch {
      /* fall through */
    }
  }
  return BY_CODE.get(norm)?.name || code;
}

/** [{code, name}] sorted by localized name, for <select> elements. */
export function getLanguageOptions(locale = getUiLocale()) {
  const collator = new Intl.Collator(locale);
  return LANGUAGES.map((l) => ({ code: l.code, name: getLanguageName(l.code, locale) })).sort((a, b) =>
    collator.compare(a.name, b.name),
  );
}
