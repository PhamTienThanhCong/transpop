/**
 * Unit tests for extension/src/shared/ocr-languages.js — the OCR-language auto-detector (guessOcrLanguages and its
 * helpers), hint sanitizing, the "try another language" suggestions and endonyms (ARCHITECTURE §11).
 *
 *   node --test tests/shared/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OCR_GUESS_MIN_SIGNAL,
  OCR_HINT_LIMITS,
  OCR_MAX_LANGUAGES,
  OCR_RETRY_COMMON,
  OCR_RETRY_MAX,
  getOcrEndonym,
  guessOcrLanguages,
  isOcrLanguage,
  ocrBcp47,
  parsePageLang,
  sanitizeOcrHints,
  suggestRetryLanguages,
} from '../../extension/src/shared/ocr-languages.js';

const guess = (text, pageLang = '', pageText = '') => guessOcrLanguages({ text, pageLang, pageText });

/* ---------------- parsePageLang ---------------- */

test('parsePageLang: primary subtag, OCR code, Traditional Chinese variants', () => {
  assert.deepEqual(parsePageLang('en-US'), { primary: 'en', ocr: 'eng', traditional: false });
  assert.deepEqual(parsePageLang('pt_BR'), { primary: 'pt', ocr: 'por', traditional: false });
  assert.deepEqual(parsePageLang('he'), { primary: 'he', ocr: 'heb', traditional: false });
  assert.deepEqual(parsePageLang('nb-NO'), { primary: 'nb', ocr: 'nor', traditional: false });
  assert.deepEqual(parsePageLang('fil'), { primary: 'fil', ocr: 'fil', traditional: false });
  assert.deepEqual(parsePageLang('zh-CN'), { primary: 'zh', ocr: 'chi_sim', traditional: false });
  assert.deepEqual(parsePageLang('zh'), { primary: 'zh', ocr: 'chi_sim', traditional: false });
  for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW', 'ZH_tw']) {
    assert.deepEqual(parsePageLang(tag), { primary: 'zh', ocr: 'chi_tra', traditional: true }, tag);
  }
  assert.equal(parsePageLang('zh-Hans-HK').traditional, false, 'explicit Hans wins');
  assert.deepEqual(parsePageLang('am'), { primary: 'am', ocr: null, traditional: false }, 'no OCR model for Amharic');
  for (const bad of ['', '  ', 'x', 'english', '12', null, undefined, 42, {}, 'en US', '<script>']) {
    assert.deepEqual(parsePageLang(bad), { primary: '', ocr: null, traditional: false }, String(bad));
  }
});

/* ---------------- guessOcrLanguages: one script ---------------- */

test('Han without kana → chi_sim (the reported bug: a Chinese paragraph with default settings)', () => {
  assert.deepEqual(guess('机器翻译在过去十年里取得了巨大的进步。然而，在文学、法律和市场营销等领域，人工翻译仍然是不可或缺的。'), ['chi_sim']);
  assert.deepEqual(guess('机器翻译', 'en'), ['chi_sim'], 'the text wins over an English page');
  assert.deepEqual(guess('中文', 'zh-CN'), ['chi_sim']);
});

test('Han → chi_tra on zh-TW / zh-HK / zh-Hant pages or when traditional-only characters clearly dominate', () => {
  for (const tag of ['zh-TW', 'zh-HK', 'zh-Hant', 'zh-MO']) assert.deepEqual(guess('中文字幕', tag), ['chi_tra'], tag);
  assert.deepEqual(guess('這是一個測試，我們來說說話。'), ['chi_tra'], 'traditional-only characters');
  assert.deepEqual(guess('這是一個測試，我們來說說話。', 'zh-CN'), ['chi_tra'], 'clear text evidence beats the page');
  assert.deepEqual(guess('这是一个测试，我们来说说话。', 'zh-TW'), ['chi_sim'], 'clearly simplified text on a zh-TW page');
  assert.deepEqual(guess('這个'), ['chi_sim'], 'one of each: not clear → default simplified');
  assert.deepEqual(guess('這个', 'zh-HK'), ['chi_tra'], 'not clear → the page decides');
});

test('kana → jpn (Han counts as Japanese); kanji-only text on a ja page → jpn', () => {
  assert.deepEqual(guess('今日はとても良い天気ですね。'), ['jpn']);
  assert.deepEqual(guess('コンピューター'), ['jpn']);
  assert.deepEqual(guess('東京都知事選挙', 'ja'), ['jpn']);
  assert.deepEqual(guess('東京都知事選挙'), ['chi_sim'], 'no kana, no page hint: Chinese');
});

test('Hangul, Cyrillic (rus / ukr / bul), Arabic script (ara / fas / urd) and the other scripts', () => {
  assert.deepEqual(guess('안녕하세요 반갑습니다'), ['kor']);
  assert.deepEqual(guess('Привет, как дела?'), ['rus']);
  assert.deepEqual(guess('Привіт, як справи?'), ['ukr'], 'і → Ukrainian');
  assert.deepEqual(guess('Їжак і єнот, ґанок'), ['ukr']);
  assert.deepEqual(guess('Добър ден, как сте?', 'bg'), ['bul']);
  assert.deepEqual(guess('Добрый день', 'uk'), ['ukr']);
  assert.deepEqual(guess('مرحبا بالعالم'), ['ara']);
  assert.deepEqual(guess('سلام دنیا، حال شما چطور است', 'fa-IR'), ['fas']);
  assert.deepEqual(guess('آپ کیسے ہیں', 'ur'), ['urd']);
  assert.deepEqual(guess('שלום עולם'), ['heb']);
  assert.deepEqual(guess('สวัสดีครับ'), ['tha']);
  assert.deepEqual(guess('नमस्ते दुनिया'), ['hin']);
  assert.deepEqual(guess('হ্যালো বিশ্ব'), ['ben']);
  assert.deepEqual(guess('வணக்கம் உலகம்'), ['tam']);
  assert.deepEqual(guess('Καλημέρα κόσμε'), ['ell']);
  assert.deepEqual(guess('សួស្តី​ពិភពលោក'), ['khm']);
  assert.deepEqual(guess('ສະບາຍດີ'), ['lao']);
});

test('Latin → vie with Vietnamese-only letters, else the page language (Latin OCR languages), else eng', () => {
  assert.deepEqual(guess('Tiếng Việt có sáu thanh điệu'), ['vie']);
  assert.deepEqual(guess('TIẾNG VIỆT CÓ SÁU THANH ĐIỆU'), ['vie'], 'upper case');
  assert.deepEqual(guess('Tiếng Việt có sáu'), ['vie'], 'decomposed (NFD) input');
  assert.deepEqual(guess('Hello world'), ['eng']);
  assert.deepEqual(guess('Hello world', 'en-GB'), ['eng']);
  assert.deepEqual(guess('La vie est belle', 'fr'), ['fra']);
  assert.deepEqual(guess('Die Wissenschaft beginnt', 'de-AT'), ['deu']);
  assert.deepEqual(guess('Când mă gândesc la tine', 'ro'), ['ron']);
  assert.deepEqual(guess('Hello world', 'zh-CN'), ['eng'], 'non-Latin page language → eng');
  assert.deepEqual(guess('Hello world', 'vi'), ['eng'], 'no Vietnamese letters on a vi page → probably English');
  assert.deepEqual(guess('Đi chơi', 'vi'), ['vie'], 'one Vietnamese letter is enough on a vi page');
  // Letters shared with other languages don't make it Vietnamese.
  assert.deepEqual(guess('Când mă gândesc la tine'), ['eng'], 'Romanian ă/â');
  assert.deepEqual(guess('Ça côute très cher, être là'), ['eng'], 'French ç ô ê à');
  assert.deepEqual(guess('Đakovo is a town in Croatia'), ['eng'], 'a single đ (Croatian) is not enough');
});

/* ---------------- guessOcrLanguages: mixed, signal, fallbacks ---------------- */

test('mixed scripts: most frequent first; substantial Latin adds eng; noise is ignored; max 3', () => {
  assert.deepEqual(guess('我们使用 Google Chrome 浏览器'), ['chi_sim', 'eng']);
  assert.deepEqual(guess('Welcome to Tokyo, the capital of Japan — 東京へようこそ'), ['eng', 'jpn']);
  assert.deepEqual(guess('机器翻译在过去十年里取得了巨大的进步，例如 AI 模型。'), ['chi_sim'], '2 Latin letters are noise');
  assert.deepEqual(guess('The area of a circle is π r squared, and a sphere is similar'), ['eng'], 'a lone Greek letter');
  const three = guess('Привет мир Hello world 안녕하세요 세계 こんにちは世界');
  assert.equal(three.length, 3);
  assert.ok(three.length <= OCR_MAX_LANGUAGES);
  assert.equal(new Set(three).size, three.length, 'unique');
});

test('digits, punctuation and spaces carry no signal; too little text → pageText, then the page language', () => {
  assert.deepEqual(guess('12345 !!! ... ---'), []);
  assert.deepEqual(guess('12345 !!! ...', 'ko'), ['kor']);
  assert.deepEqual(guess('a', 'fr'), ['fra'], 'one letter is below the minimum signal');
  assert.deepEqual(guess('中', 'ja'), ['jpn'], 'one Han character (weight 2) is below the minimum');
  assert.ok(OCR_GUESS_MIN_SIGNAL >= 3);
  assert.deepEqual(guess('', '', 'Привет мир, это пример'), ['rus'], 'page sample when the area has no text');
  assert.deepEqual(guess('42', 'en', '这是一个中文网站的正文'), ['chi_sim'], 'page sample beats <html lang>');
  assert.deepEqual(guess('机器翻译', 'en', 'An English page'), ['chi_sim'], 'the page sample is only a fallback');
  assert.deepEqual(guess('', 'zh-Hant-TW'), ['chi_tra']);
  assert.deepEqual(guess('', 'he'), ['heb']);
  assert.deepEqual(guess('', 'en'), ['eng']);
  assert.deepEqual(guess('', 'am'), [], 'no OCR model for the page language');
  assert.deepEqual(guessOcrLanguages(), []);
  assert.deepEqual(guessOcrLanguages({ text: 42, pageLang: {}, pageText: null }), [], 'garbage input');
});

test('the detector only looks at the first OCR_HINT_LIMITS.text characters', () => {
  const text = `${'a'.repeat(OCR_HINT_LIMITS.text)}这是中文这是中文这是中文`;
  assert.deepEqual(guess(text), ['eng']);
});

/* ---------------- hints ---------------- */

test('sanitizeOcrHints keeps capped strings only', () => {
  assert.deepEqual(sanitizeOcrHints(undefined), { text: '', pageText: '', pageLang: '' });
  assert.deepEqual(sanitizeOcrHints({ text: 1, pageText: ['x'], pageLang: { a: 1 }, extra: 'x' }), { text: '', pageText: '', pageLang: '' });
  const h = sanitizeOcrHints({ text: 'x'.repeat(10000), pageText: 'y'.repeat(10000), pageLang: 'z'.repeat(100) });
  assert.equal(h.text.length, OCR_HINT_LIMITS.text);
  assert.equal(h.pageText.length, OCR_HINT_LIMITS.pageText);
  assert.equal(h.pageLang.length, OCR_HINT_LIMITS.pageLang);
  assert.deepEqual(sanitizeOcrHints({ text: '中文', pageLang: 'zh-CN' }), { text: '中文', pageText: '', pageLang: 'zh-CN' });
});

/* ---------------- recovery suggestions ---------------- */

test('suggestRetryLanguages: untried guesses first, then the common list minus tried, max 6', () => {
  assert.equal(OCR_RETRY_MAX, 6);
  assert.ok(OCR_RETRY_COMMON.every(isOcrLanguage));
  assert.deepEqual(suggestRetryLanguages({ tried: ['eng'] }), ['chi_sim', 'chi_tra', 'jpn', 'kor', 'vie', 'rus']);
  assert.deepEqual(suggestRetryLanguages({ tried: ['eng'], guessed: ['ukr'] }), ['ukr', 'chi_sim', 'chi_tra', 'jpn', 'kor', 'vie']);
  assert.deepEqual(suggestRetryLanguages({ tried: ['chi_sim', 'eng'], guessed: ['chi_sim'] }), ['chi_tra', 'jpn', 'kor', 'vie', 'rus', 'tha']);
  assert.deepEqual(suggestRetryLanguages({ tried: ['vie'] }), ['eng', 'chi_sim', 'chi_tra', 'jpn', 'kor', 'rus'], 'English offered when not tried');
  assert.deepEqual(suggestRetryLanguages({ tried: ['eng'], guessed: ['xx', 'jpn', 'jpn'], max: 3 }), ['jpn', 'chi_sim', 'chi_tra']);
  assert.deepEqual(suggestRetryLanguages({ tried: 'eng', guessed: 'jpn' }).length, 6, 'non-arrays are ignored');
  assert.deepEqual(suggestRetryLanguages(), ['eng', 'chi_sim', 'chi_tra', 'jpn', 'kor', 'vie']);
});

/* ---------------- endonyms ---------------- */

test('getOcrEndonym / ocrBcp47: each language in its own name', () => {
  assert.equal(ocrBcp47('chi_sim'), 'zh-Hans');
  assert.equal(ocrBcp47('chi_tra'), 'zh-Hant');
  assert.equal(ocrBcp47('heb'), 'he');
  assert.equal(ocrBcp47('jpn'), 'ja');
  assert.equal(ocrBcp47('nope'), '');
  assert.equal(getOcrEndonym('jpn'), '日本語');
  assert.equal(getOcrEndonym('vie'), 'Tiếng Việt');
  assert.equal(getOcrEndonym('kor'), '한국어');
  assert.match(getOcrEndonym('chi_sim'), /中文|简体/);
  assert.match(getOcrEndonym('chi_tra'), /中文|繁體/);
  assert.equal(getOcrEndonym('nope'), 'nope');
});
