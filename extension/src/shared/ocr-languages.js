/**
 * TransPop — OCR (image translation) languages (ES module, pure: safe to import in Node).
 * `ocr` = Tesseract traineddata code, `lang` = the Google-style code used everywhere else in TransPop
 * (for localized names via getLanguageName and as the translate `from` hint).
 */
import { getLanguageName, getUiLocale } from './languages.js';

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
