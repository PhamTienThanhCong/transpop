/**
 * TransPop — OCR (image translation) languages (ES module, pure: safe to import in Node).
 * `ocr` = Tesseract traineddata code, `lang` = the Google-style code used everywhere else in TransPop
 * (for localized names via getLanguageName and as the translate `from` hint).
 */
import { getLanguageName, getUiLocale, normalizeLangCode } from './languages.js';

export const OCR_LANGUAGES = Object.freeze([
  { ocr: 'eng', lang: 'en' },
  { ocr: 'vie', lang: 'vi' },
  { ocr: 'chi_sim', lang: 'zh-CN' },
  { ocr: 'chi_tra', lang: 'zh-TW' },
  { ocr: 'jpn', lang: 'ja' },
  { ocr: 'kor', lang: 'ko' },
  { ocr: 'fra', lang: 'fr' },
  { ocr: 'deu', lang: 'de' },
  { ocr: 'spa', lang: 'es' },
  { ocr: 'ita', lang: 'it' },
  { ocr: 'por', lang: 'pt' },
  { ocr: 'rus', lang: 'ru' },
  { ocr: 'ukr', lang: 'uk' },
  { ocr: 'pol', lang: 'pl' },
  { ocr: 'nld', lang: 'nl' },
  { ocr: 'tur', lang: 'tr' },
  { ocr: 'ara', lang: 'ar' },
  { ocr: 'heb', lang: 'iw' },
  { ocr: 'fas', lang: 'fa' },
  { ocr: 'hin', lang: 'hi' },
  { ocr: 'ben', lang: 'bn' },
  { ocr: 'tam', lang: 'ta' },
  { ocr: 'urd', lang: 'ur' },
  { ocr: 'tha', lang: 'th' },
  { ocr: 'ind', lang: 'id' },
  { ocr: 'msa', lang: 'ms' },
  { ocr: 'fil', lang: 'tl' },
  { ocr: 'khm', lang: 'km' },
  { ocr: 'lao', lang: 'lo' },
  { ocr: 'ell', lang: 'el' },
  { ocr: 'ces', lang: 'cs' },
  { ocr: 'slk', lang: 'sk' },
  { ocr: 'hun', lang: 'hu' },
  { ocr: 'ron', lang: 'ro' },
  { ocr: 'bul', lang: 'bg' },
  { ocr: 'swe', lang: 'sv' },
  { ocr: 'dan', lang: 'da' },
  { ocr: 'nor', lang: 'no' },
  { ocr: 'fin', lang: 'fi' },
]);

export const DEFAULT_OCR_LANGUAGES = Object.freeze(['eng']);
export const OCR_MAX_LANGUAGES = 3;

const BY_OCR = new Map(OCR_LANGUAGES.map((l) => [l.ocr, l]));
const BY_LANG = new Map(OCR_LANGUAGES.map((l) => [l.lang, l]));

export const isOcrLanguage = (code) => BY_OCR.has(code);

/** Tesseract code → Google-style code ('jpn' → 'ja'); null if unknown. */
export const ocrToLang = (code) => BY_OCR.get(code)?.lang || null;

/** Google-style code → Tesseract code ('ja' → 'jpn'); null if unsupported. */
export const langToOcr = (code) => BY_LANG.get(code)?.ocr || null;

/** Validate a list of Tesseract codes: known, unique, at most OCR_MAX_LANGUAGES; falls back to the default. */
export function normalizeOcrLanguages(list) {
  const out = Array.isArray(list) ? [...new Set(list.filter(isOcrLanguage))].slice(0, OCR_MAX_LANGUAGES) : [];
  return out.length ? out : [...DEFAULT_OCR_LANGUAGES];
}

/** [{code, lang, name}] sorted by localized name, for pickers. */
export function getOcrLanguageOptions(locale = getUiLocale()) {
  const collator = new Intl.Collator(locale);
  return OCR_LANGUAGES.map((l) => ({ code: l.ocr, lang: l.lang, name: getLanguageName(l.lang, locale) })).sort((a, b) =>
    collator.compare(a.name, b.name),
  );
}

/* ------------------------------------------------------------------ */
/* Endonyms (recovery chips: "中文（简体）", "日本語"…)                    */
/* ------------------------------------------------------------------ */

/** Google-style code → BCP-47 tag for Intl.DisplayNames / the `lang` attribute (subset of languages.js DISPLAY_CODES). */
const BCP47 = Object.freeze({ 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', iw: 'he', tl: 'fil' });

/** BCP-47 tag of an OCR language ('chi_sim' → 'zh-Hans'), '' if unknown. */
export const ocrBcp47 = (code) => {
  const lang = ocrToLang(code);
  return lang ? BCP47[lang] || lang : '';
};

/** A language's own name ('jpn' → "日本語", 'vie' → "Tiếng Việt"); falls back to the localized name. */
export function getOcrEndonym(code) {
  const tag = ocrBcp47(code);
  if (!tag) return code;
  return getLanguageName(ocrToLang(code), tag) || code;
}

/* ------------------------------------------------------------------ */
/* Language auto-detection from page hints (ARCHITECTURE §11)          */
/* ------------------------------------------------------------------ */
/*
 * guessOcrLanguages() looks at the Unicode scripts of the page text around the selected area (and the page `lang`)
 * to pick Tesseract models — so a Chinese paragraph is read with chi_sim even when settings.ocrLanguages is ['eng'].
 * Rules (letters only: digits, punctuation, spaces and combining marks are ignored):
 *  - Han / kana / Hangul count double (one character ≈ a syllable or a word); a guess needs a weight ≥ MIN_SIGNAL,
 *    otherwise `pageText` (a sample of the page's main text) is tried, then the page language alone.
 *  - any Hiragana/Katakana → jpn (the Han characters count as Japanese); Han without kana → chi_sim, or chi_tra when
 *    traditional-only characters clearly dominate (TRAD_ONLY vs SIMP_ONLY: ≥ 2 and more than twice the other), or —
 *    when the characters don't tell — when the page is zh-TW / zh-HK / zh-MO / zh-Hant; a `ja` page reads Han as jpn.
 *  - Hangul → kor; Cyrillic → rus (ukr when і ї є ґ appear or the page is uk, bul on a bg page); Arabic script → ara
 *    (fas on a fa page, urd on a ur page); Hebrew → heb; Thai → tha; Devanagari → hin; Bengali → ben; Tamil → tam;
 *    Greek → ell; Khmer → khm; Lao → lao.
 *  - Latin → vie when Vietnamese-only letters appear (ơ ư đ, hook-above / dot-below vowels… — at least 2, or 1 on a
 *    `vi` page; plain ă â ê ô are shared with Romanian/French), else the page language when it is a Latin-script OCR
 *    language (fra, deu, spa…), else eng.
 *  - mixed scripts → by weight, most frequent first; another script is added when it has ≥ MINOR_SHARE of the weight
 *    (that is how "substantial Latin" adds eng to a Chinese paragraph). At most OCR_MAX_LANGUAGES codes, de-duplicated.
 */

/** Minimum weighted letter count for a guess from text (2 Han characters, or 3 Latin letters). */
export const OCR_GUESS_MIN_SIGNAL = 3;
/** A secondary script is added when it has at least this share of the weighted letters. */
export const OCR_GUESS_MINOR_SHARE = 0.15;
/** Max length (chars) of the hints the background looks at. */
export const OCR_HINT_LIMITS = Object.freeze({ text: 2000, pageText: 600, pageLang: 35 });

/** Latin-script OCR languages a page `lang` may select (vie needs its letters, see above). */
const LATIN_PAGE_OCR = new Set(['fra', 'deu', 'spa', 'ita', 'por', 'pol', 'nld', 'tur', 'ind', 'msa', 'fil', 'ces', 'slk', 'hun', 'ron', 'swe', 'dan', 'nor', 'fin']);

const SCRIPTS = ['han', 'kana', 'hangul', 'cyrillic', 'arabic', 'hebrew', 'thai', 'devanagari', 'bengali', 'tamil', 'greek', 'khmer', 'lao', 'latin'];
const SCRIPT_RE = new RegExp(
  `(?=\\p{L})(?:${[
    '\\p{sc=Han}',
    '[\\p{sc=Hiragana}\\p{sc=Katakana}]',
    '\\p{sc=Hangul}',
    '\\p{sc=Cyrillic}',
    '\\p{sc=Arabic}',
    '\\p{sc=Hebrew}',
    '\\p{sc=Thai}',
    '\\p{sc=Devanagari}',
    '\\p{sc=Bengali}',
    '\\p{sc=Tamil}',
    '\\p{sc=Greek}',
    '\\p{sc=Khmer}',
    '\\p{sc=Lao}',
    '\\p{sc=Latin}',
  ]
    .map((p) => `(${p})`)
    .join('|')})`,
  'gu',
);
const WEIGHT = Object.freeze({ han: 2, kana: 2, hangul: 2 });
const FIXED_CODE = Object.freeze({
  kana: 'jpn',
  hangul: 'kor',
  hebrew: 'heb',
  thai: 'tha',
  devanagari: 'hin',
  bengali: 'ben',
  tamil: 'tam',
  greek: 'ell',
  khmer: 'khm',
  lao: 'lao',
});

/** Frequent characters written differently in Traditional / Simplified Chinese (each only used in its own system). */
const TRAD_ONLY = new Set('們個這來時會說國對學發經過還點開關問題書車門長東無為與當實現體電話見應從變讓歡請謝語記認識機動處業萬買賣網華愛頭邊產區級線進條報場歷聲廣');
const SIMP_ONLY = new Set('们个这来时会说国对学发经过还点开关问题书车门长东无为与当实现体电话见应从变让欢请谢语记认识机动处业万买卖网华爱头边产区级线进条报场历声广');
/** Letters only Vietnamese uses among the OCR languages (NFC). */
const VI_ONLY_RE = /[đơưảẻỉỏủỷạẹịọụỵấầẩẫậắằẳẵặếềểễệốồổỗộớờởỡợứừửữựẽĩũỹ]/giu;
const UKR_RE = /[іїєґ]/iu;

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Parse a page `lang` attribute ("zh-Hant-TW", "pt_BR", "en"): primary subtag, the OCR language it names (if any)
 * and whether it is Traditional Chinese.
 * @returns {{primary: string, ocr: string|null, traditional: boolean}}
 */
export function parsePageLang(tag) {
  const raw = str(tag, OCR_HINT_LIMITS.pageLang).trim().toLowerCase().replace(/_/g, '-');
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/.test(raw)) return { primary: '', ocr: null, traditional: false };
  const parts = raw.split('-');
  const primary = parts[0];
  if (primary === 'zh') {
    const traditional = !parts.includes('hans') && parts.some((p) => p === 'hant' || p === 'tw' || p === 'hk' || p === 'mo');
    return { primary, ocr: traditional ? 'chi_tra' : 'chi_sim', traditional };
  }
  const google = normalizeLangCode(primary);
  return { primary, ocr: (google && langToOcr(google)) || null, traditional: false };
}

/** Letter counts per script (see SCRIPTS). */
function countScripts(text) {
  const counts = {};
  for (const s of SCRIPTS) counts[s] = 0;
  for (const m of text.matchAll(SCRIPT_RE)) {
    for (let i = 1; i <= SCRIPTS.length; i++) {
      if (m[i] !== undefined) {
        counts[SCRIPTS[i - 1]]++;
        break;
      }
    }
  }
  return counts;
}

function hanCode(text, page) {
  if (page.primary === 'ja') return 'jpn';
  let trad = 0;
  let simp = 0;
  for (const ch of text) {
    if (TRAD_ONLY.has(ch)) trad++;
    else if (SIMP_ONLY.has(ch)) simp++;
  }
  if (trad >= 2 && trad > simp * 2) return 'chi_tra';
  if (simp >= 2 && simp > trad * 2) return 'chi_sim';
  return page.traditional ? 'chi_tra' : 'chi_sim';
}

function cyrillicCode(text, page) {
  if (UKR_RE.test(text) || page.ocr === 'ukr') return 'ukr';
  return page.ocr === 'bul' ? 'bul' : 'rus';
}

function latinCode(text, page) {
  const vi = (text.match(VI_ONLY_RE) || []).length;
  if (vi >= 2 || (vi >= 1 && page.ocr === 'vie')) return 'vie';
  return page.ocr && LATIN_PAGE_OCR.has(page.ocr) ? page.ocr : 'eng';
}

/** Weighted script groups of `text` → [{code, weight}] sorted by weight (heaviest first); [] below MIN_SIGNAL. */
function scriptGroups(text, page) {
  const counts = countScripts(text);
  const byCode = new Map();
  let total = 0;
  for (const script of SCRIPTS) {
    const n = counts[script];
    if (!n) continue;
    let code;
    if (script === 'han') code = counts.kana ? 'jpn' : hanCode(text, page);
    else if (script === 'cyrillic') code = cyrillicCode(text, page);
    else if (script === 'arabic') code = page.ocr === 'fas' || page.ocr === 'urd' ? page.ocr : 'ara';
    else if (script === 'latin') code = latinCode(text, page);
    else code = FIXED_CODE[script];
    const weight = n * (WEIGHT[script] || 1);
    byCode.set(code, (byCode.get(code) || 0) + weight);
    total += weight;
  }
  if (total < OCR_GUESS_MIN_SIGNAL) return [];
  return [...byCode]
    .map(([code, weight]) => ({ code, weight, share: weight / total }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Guess the OCR languages of an image from the text around it (rules above).
 * @param {{text?: string, pageLang?: string, pageText?: string}} [hints]
 *   text: visible page text inside the selected area (+ alt/title of the image); pageLang: nearest `lang` attribute;
 *   pageText: a sample of the page's main text, used only when `text` has too little signal.
 * @returns {string[]} ordered, unique Tesseract codes (0…OCR_MAX_LANGUAGES)
 */
export function guessOcrLanguages({ text = '', pageLang = '', pageText = '' } = {}) {
  const page = parsePageLang(pageLang);
  for (const sample of [text, pageText]) {
    const clean = str(sample, OCR_HINT_LIMITS.text).normalize('NFC');
    if (!clean) continue;
    const groups = scriptGroups(clean, page);
    if (!groups.length) continue;
    const out = [groups[0].code];
    for (const g of groups.slice(1)) if (g.share >= OCR_GUESS_MINOR_SHARE && !out.includes(g.code)) out.push(g.code);
    return out.slice(0, OCR_MAX_LANGUAGES);
  }
  return page.ocr ? [page.ocr] : [];
}

/** Keep only the string fields of an `ocr-region` / `ocr-image` `hints` object, capped (input from a web page). */
export function sanitizeOcrHints(hints) {
  const h = hints && typeof hints === 'object' ? hints : {};
  return {
    text: str(h.text, OCR_HINT_LIMITS.text),
    pageText: str(h.pageText, OCR_HINT_LIMITS.pageText),
    pageLang: str(h.pageLang, OCR_HINT_LIMITS.pageLang),
  };
}

/* ------------------------------------------------------------------ */
/* One-tap recovery after OCR_NO_TEXT                                  */
/* ------------------------------------------------------------------ */

/** Languages offered after "no text found" (after the guessed ones), minus those already tried. */
export const OCR_RETRY_COMMON = Object.freeze(['eng', 'chi_sim', 'chi_tra', 'jpn', 'kor', 'vie', 'rus', 'tha', 'ara']);
export const OCR_RETRY_MAX = 6;

/**
 * Quick-retry chips: guessed languages not tried yet, then OCR_RETRY_COMMON minus the tried ones.
 * @param {{tried?: string[], guessed?: string[], max?: number}} [p]
 * @returns {string[]}
 */
export function suggestRetryLanguages({ tried = [], guessed = [], max = OCR_RETRY_MAX } = {}) {
  const skip = new Set(Array.isArray(tried) ? tried : []);
  const out = [];
  for (const code of [...(Array.isArray(guessed) ? guessed : []), ...OCR_RETRY_COMMON]) {
    if (out.length >= max) break;
    if (isOcrLanguage(code) && !skip.has(code) && !out.includes(code)) out.push(code);
  }
  return out;
}
