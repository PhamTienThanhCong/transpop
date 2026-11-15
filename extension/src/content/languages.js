/*
 * TransPop content script — languages (file 2/6).
 * Language codes + English names, localized display names, <select> options.
 * Names use G.uiLocale() — the Display-language setting when set, else the browser language — and the
 * caches below are keyed by locale, so a display-language change needs no invalidation.
 *
 * KEEP IN SYNC with extension/src/shared/languages.js (LANGUAGES, DISPLAY_CODES, RTL_LANGS) —
 * content scripts cannot import ES modules, so this is a deliberate copy.
 */
(() => {
  'use strict';
  const G = globalThis.__transpopContent;
  if (!G || G.started) return;

  /** Google Translate codes with English names (fallback when Intl.DisplayNames can't name a code). */
  const LANGUAGES = [
    ['af', 'Afrikaans'], ['sq', 'Albanian'], ['am', 'Amharic'], ['ar', 'Arabic'], ['hy', 'Armenian'],
    ['as', 'Assamese'], ['ay', 'Aymara'], ['az', 'Azerbaijani'], ['bm', 'Bambara'], ['eu', 'Basque'],
    ['be', 'Belarusian'], ['bn', 'Bengali'], ['bho', 'Bhojpuri'], ['bs', 'Bosnian'], ['bg', 'Bulgarian'],
    ['ca', 'Catalan'], ['ceb', 'Cebuano'], ['ny', 'Chichewa'], ['zh-CN', 'Chinese (Simplified)'],
    ['zh-TW', 'Chinese (Traditional)'], ['co', 'Corsican'], ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'],
    ['dv', 'Dhivehi'], ['doi', 'Dogri'], ['nl', 'Dutch'], ['en', 'English'], ['eo', 'Esperanto'], ['et', 'Estonian'],
    ['ee', 'Ewe'], ['tl', 'Filipino'], ['fi', 'Finnish'], ['fr', 'French'], ['fy', 'Frisian'], ['gl', 'Galician'],
    ['ka', 'Georgian'], ['de', 'German'], ['el', 'Greek'], ['gn', 'Guarani'], ['gu', 'Gujarati'],
    ['ht', 'Haitian Creole'], ['ha', 'Hausa'], ['haw', 'Hawaiian'], ['iw', 'Hebrew'], ['hi', 'Hindi'],
    ['hmn', 'Hmong'], ['hu', 'Hungarian'], ['is', 'Icelandic'], ['ig', 'Igbo'], ['ilo', 'Ilocano'],
    ['id', 'Indonesian'], ['ga', 'Irish'], ['it', 'Italian'], ['ja', 'Japanese'], ['jw', 'Javanese'],
    ['kn', 'Kannada'], ['kk', 'Kazakh'], ['km', 'Khmer'], ['rw', 'Kinyarwanda'], ['gom', 'Konkani'], ['ko', 'Korean'],
    ['kri', 'Krio'], ['ku', 'Kurdish (Kurmanji)'], ['ckb', 'Kurdish (Sorani)'], ['ky', 'Kyrgyz'], ['lo', 'Lao'],
    ['la', 'Latin'], ['lv', 'Latvian'], ['ln', 'Lingala'], ['lt', 'Lithuanian'], ['lg', 'Luganda'],
    ['lb', 'Luxembourgish'], ['mk', 'Macedonian'], ['mai', 'Maithili'], ['mg', 'Malagasy'], ['ms', 'Malay'],
    ['ml', 'Malayalam'], ['mt', 'Maltese'], ['mi', 'Maori'], ['mr', 'Marathi'], ['mni-Mtei', 'Meiteilon (Manipuri)'],
    ['lus', 'Mizo'], ['mn', 'Mongolian'], ['my', 'Myanmar (Burmese)'], ['ne', 'Nepali'], ['no', 'Norwegian'],
    ['or', 'Odia (Oriya)'], ['om', 'Oromo'], ['ps', 'Pashto'], ['fa', 'Persian'], ['pl', 'Polish'],
    ['pt', 'Portuguese'], ['pa', 'Punjabi'], ['qu', 'Quechua'], ['ro', 'Romanian'], ['ru', 'Russian'],
    ['sm', 'Samoan'], ['sa', 'Sanskrit'], ['gd', 'Scots Gaelic'], ['nso', 'Sepedi'], ['sr', 'Serbian'],
    ['st', 'Sesotho'], ['sn', 'Shona'], ['sd', 'Sindhi'], ['si', 'Sinhala'], ['sk', 'Slovak'], ['sl', 'Slovenian'],
    ['so', 'Somali'], ['es', 'Spanish'], ['su', 'Sundanese'], ['sw', 'Swahili'], ['sv', 'Swedish'], ['tg', 'Tajik'],
    ['ta', 'Tamil'], ['tt', 'Tatar'], ['te', 'Telugu'], ['th', 'Thai'], ['ti', 'Tigrinya'], ['ts', 'Tsonga'],
    ['tr', 'Turkish'], ['tk', 'Turkmen'], ['ak', 'Twi'], ['uk', 'Ukrainian'], ['ur', 'Urdu'], ['ug', 'Uyghur'],
    ['uz', 'Uzbek'], ['vi', 'Vietnamese'], ['cy', 'Welsh'], ['xh', 'Xhosa'], ['yi', 'Yiddish'], ['yo', 'Yoruba'],
    ['zu', 'Zulu'],
  ];

  const BY_CODE = new Map(LANGUAGES);
  const BY_LOWER = new Map(LANGUAGES.map(([code]) => [code.toLowerCase(), code]));

  /** Google code → BCP-47 code understood by Intl.DisplayNames / the `lang` attribute. */
  const DISPLAY_CODES = Object.freeze({
    iw: 'he',
    tl: 'fil',
    jw: 'jv',
    'zh-CN': 'zh-Hans',
    'zh-TW': 'zh-Hant',
    'mni-Mtei': 'mni',
    ku: 'kmr',
  });

  /** BCP-47 / provider aliases → Google code (subset of ALIASES in shared/languages.js). */
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
  });

  const RTL_LANGS = new Set(['ar', 'iw', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']);

  /** Any code (e.g. "en-US", "zh-tw", "he") → supported Google code, or null. */
  function normalize(code) {
    if (!code || typeof code !== 'string') return null;
    const raw = code.trim();
    if (BY_CODE.has(raw)) return raw;
    const lower = raw.toLowerCase().replace(/_/g, '-');
    if (ALIASES[lower]) return ALIASES[lower];
    if (BY_LOWER.has(lower)) return BY_LOWER.get(lower);
    const primary = lower.split('-')[0];
    if (ALIASES[primary]) return ALIASES[primary];
    return BY_LOWER.get(primary) || null;
  }

  const dnCache = new Map();
  function displayNames(locale) {
    if (!dnCache.has(locale)) {
      let dn = null;
      try {
        dn = new Intl.DisplayNames([locale, 'en'], { type: 'language', fallback: 'none' });
      } catch {
        dn = null;
      }
      dnCache.set(locale, dn);
    }
    return dnCache.get(locale);
  }

  const capitalize = (s, locale) => (s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s);

  /** Localized language name in the effective UI language, e.g. name('en') → "Tiếng Anh" for a vi UI. */
  function name(code, locale = G.uiLocale()) {
    if (!code || code === 'auto') return '';
    const norm = normalize(code) || code;
    const dcode = DISPLAY_CODES[norm] || norm;
    const dn = displayNames(locale);
    if (dn) {
      try {
        const n = dn.of(dcode);
        if (n && n.toLowerCase() !== dcode.toLowerCase()) return capitalize(n, locale);
      } catch {
        /* fall through */
      }
    }
    return BY_CODE.get(norm) || code;
  }

  let optionsCache = null;
  /** [{code, name}] sorted by localized name (cached per locale). */
  function options(locale = G.uiLocale()) {
    if (optionsCache && optionsCache.locale === locale) return optionsCache.list;
    let collator;
    try {
      collator = new Intl.Collator(locale);
    } catch {
      collator = new Intl.Collator('en');
    }
    const list = LANGUAGES.map(([code]) => ({ code, name: name(code, locale) })).sort((a, b) => collator.compare(a.name, b.name));
    optionsCache = { locale, list };
    return list;
  }

  G.lang = {
    LANGUAGES,
    normalize,
    name,
    options,
    has: (code) => BY_CODE.has(code),
    isRtl: (code) => RTL_LANGS.has(code),
    /** BCP-47 tag for the `lang` attribute (helps the browser pick CJK glyphs, hyphenation…). */
    bcp47: (code) => DISPLAY_CODES[code] || code || '',
    /** Default target derived from the effective UI language (mirrors uiLangToTarget()). */
    uiTarget: () => normalize(G.uiLocale()) || 'en',
  };
})();
