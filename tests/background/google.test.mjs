import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGoogleRequest, parseGoogleResponse, translateGoogle } from '../../extension/src/background/providers/google.js';
import { fixture, googleBody, hangingFetch, jsonResponse, mockFetch, textResponse } from './helpers.mjs';

test('parseGoogleResponse: single word with dictionary, definitions, examples, synonyms (live fixture)', () => {
  const r = parseGoogleResponse(fixture('google-word-en-vi.json'), 'obvious', { from: 'auto', to: 'vi' });
  assert.equal(r.text, 'obvious');
  assert.equal(r.translation, 'rõ ràng');
  assert.equal(r.from, 'en');
  assert.equal(r.to, 'vi');
  assert.equal(r.provider, 'google');
  assert.equal(r.confidence, 1);
  assert.equal(r.phonetic, 'ˈäbvēəs');
  assert.equal(r.translit, undefined);

  assert.deepEqual(r.alternatives, ['hiển nhiên'], 'alternatives exclude the main translation');

  assert.equal(r.dictionary.length, 1);
  assert.equal(r.dictionary[0].pos, 'adjective');
  assert.deepEqual(r.dictionary[0].terms, ['minh bạch', 'rỏ ràng']);
  // The live response has these terms in decomposed form (NFD); the parser must return NFC.
  assert.notEqual(fixture('google-word-en-vi.json').dict[0].terms[1], 'rỏ ràng');
  assert.ok(r.dictionary[0].entries.every((e) => e.word === e.word.normalize('NFC')));
  assert.equal(r.dictionary[0].entries[0].word, 'minh bạch');
  assert.ok(r.dictionary[0].entries[0].reverse.includes('transparent'));

  assert.equal(r.definitions[0].pos, 'adjective');
  assert.match(r.definitions[0].items[0].definition, /easily perceived or understood/);
  assert.match(r.definitions[0].items[0].example, /most obvious cost of the recession/);

  assert.equal(r.examples.length, 2);
  assert.ok(r.examples.every((e) => e.includes('<b>obvious</b>')), 'keeps <b> tags');

  assert.equal(r.synonyms[0].pos, 'adjective');
  const syn = r.synonyms[0].terms;
  assert.ok(syn.includes('clear') && syn.includes('evident'));
  assert.equal(new Set(syn).size, syn.length, 'synonyms are unique');
});

test('parseGoogleResponse: multi-sentence text joins sentences, no rich data (live fixture)', () => {
  const text = "The weather is nice today. Let's go for a walk in the park!";
  const r = parseGoogleResponse(fixture('google-sentence-en-vi.json'), text, { to: 'vi' });
  assert.equal(r.translation, 'Thời tiết hôm nay đẹp. Chúng ta hãy đi dạo trong công viên nhé!');
  assert.equal(r.from, 'en');
  for (const k of ['dictionary', 'definitions', 'examples', 'synonyms', 'alternatives', 'phonetic', 'translit']) {
    assert.equal(r[k], undefined, `${k} should be absent`);
  }
});

test('parseGoogleResponse: non-Latin source gets transliteration (live fixture)', () => {
  const r = parseGoogleResponse(fixture('google-nonlatin-zh-en.json'), '你好世界', { to: 'en' });
  assert.equal(r.translation, 'Hello World');
  assert.equal(r.from, 'zh-CN');
  assert.equal(r.phonetic, 'Nǐ hǎo shìjiè');
  assert.equal(r.alternatives, undefined, 'only alternative equals the main translation');
});

test('parseGoogleResponse: translation transliteration + dictionary score (live fixture)', () => {
  const r = parseGoogleResponse(fixture('google-translit-en-ja.json'), 'good morning', { to: 'ja' });
  assert.equal(r.translation, 'おはよう');
  assert.equal(r.translit, 'Ohayō');
  assert.equal(r.phonetic, 'ˌɡo͝od ˈmôrniNG');
  assert.deepEqual(r.alternatives, ['おはようございます']);
  assert.equal(r.dictionary[0].pos, 'phrase');
  assert.equal(typeof r.dictionary[0].entries[0].score, 'number');
  assert.equal(r.definitions[0].items[0].example, undefined);
});

test('parseGoogleResponse: defensive against missing / malformed fields', () => {
  const minimal = parseGoogleResponse({ sentences: [{ trans: 'xin chào' }] }, 'hello', { from: 'en', to: 'vi' });
  assert.deepEqual(minimal, { text: 'hello', translation: 'xin chào', from: 'en', to: 'vi', provider: 'google' });

  const messy = parseGoogleResponse(
    {
      sentences: [null, { trans: 'a' }, { trans: 5 }, { src_translit: '' }],
      dict: 'oops',
      definitions: [null, { pos: 'noun', entry: [{ gloss: '' }, null] }],
      examples: { example: 'nope' },
      synsets: [{ pos: 'noun', entry: [{ synonym: ['x', 'x', null] }] }],
      alternative_translations: [{ alternative: [{ word_postproc: 'A' }, {}] }],
      ld_result: { srclangs: ['fr'], srclangs_confidences: [0.42] },
    },
    'texte',
  );
  assert.equal(messy.translation, 'a');
  assert.equal(messy.from, 'fr', 'falls back to ld_result');
  assert.equal(messy.confidence, 0.42);
  assert.equal(messy.dictionary, undefined);
  assert.equal(messy.definitions, undefined);
  assert.equal(messy.examples, undefined);
  assert.deepEqual(messy.synonyms, [{ pos: 'noun', terms: ['x'] }]);
  assert.equal(messy.alternatives, undefined, '"A" equals the translation case-insensitively');

  for (const bad of [null, [], 'x', {}, { sentences: [] }, { sentences: [{ trans: '   ' }] }]) {
    assert.throws(() => parseGoogleResponse(bad, 'x'), (e) => e.code === 'PROVIDER_ERROR');
  }
});

test('buildGoogleRequest: rich dt only for short inputs; POST form body', () => {
  const short = buildGoogleRequest({ text: 'hello world', from: 'auto', to: 'vi', uiLang: 'vi' });
  const u = new URL(short.url);
  assert.equal(u.origin + u.pathname, 'https://translate.googleapis.com/translate_a/single');
  assert.equal(u.searchParams.get('client'), 'gtx');
  assert.equal(u.searchParams.get('dj'), '1');
  assert.equal(u.searchParams.get('sl'), 'auto');
  assert.equal(u.searchParams.get('tl'), 'vi');
  assert.equal(u.searchParams.get('hl'), 'vi');
  assert.deepEqual(u.searchParams.getAll('dt').sort(), ['at', 'bd', 'ex', 'md', 'rm', 'ss', 't']);
  assert.equal(short.init.method, 'POST');
  assert.match(short.init.headers['Content-Type'], /application\/x-www-form-urlencoded/);
  assert.equal(short.init.body, 'q=hello%20world');

  const sixWords = buildGoogleRequest({ text: 'one two three four five six', to: 'vi' });
  assert.deepEqual(new URL(sixWords.url).searchParams.getAll('dt').sort(), ['rm', 't']);
  const longText = buildGoogleRequest({ text: 'x'.repeat(61), to: 'vi' });
  assert.deepEqual(new URL(longText.url).searchParams.getAll('dt').sort(), ['rm', 't']);
  const cjk = buildGoogleRequest({ text: '你好世界', to: 'en', uiLang: 'en-US' });
  assert.equal(new URL(cjk.url).searchParams.getAll('dt').length, 7);
  assert.equal(new URL(cjk.url).searchParams.get('hl'), 'en');
});

test('translateGoogle: success through fetchImpl', async () => {
  const fetchImpl = mockFetch([['translate.googleapis.com', () => jsonResponse(fixture('google-word-en-vi.json'))]]);
  const r = await translateGoogle({ text: 'obvious', to: 'vi', fetchImpl });
  assert.equal(r.translation, 'rõ ràng');
  assert.equal(r.to, 'vi');
  assert.equal(fetchImpl.calls[0].init.credentials, 'omit');
});

test('translateGoogle: HTTP / network errors map to TransPop codes', async () => {
  const cases = [
    [429, 'RATE_LIMITED'],
    [503, 'RATE_LIMITED'],
    [500, 'PROVIDER_ERROR'],
    [400, 'PROVIDER_ERROR'],
  ];
  for (const [status, code] of cases) {
    const fetchImpl = mockFetch([['googleapis', () => textResponse('error', status)]]);
    await assert.rejects(translateGoogle({ text: 'hi', to: 'vi', fetchImpl }), (e) => e.code === code, `HTTP ${status}`);
  }
  const offline = mockFetch([]);
  await assert.rejects(translateGoogle({ text: 'hi', to: 'vi', fetchImpl: offline }), (e) => e.code === 'NETWORK');
  await assert.rejects(translateGoogle({ text: 'hi', to: 'vi', fetchImpl: hangingFetch, timeoutMs: 30 }), (e) => e.code === 'NETWORK' && /timed out/.test(e.message));
  const badJson = mockFetch([['googleapis', () => jsonResponse('<html>not json</html>')]]);
  await assert.rejects(translateGoogle({ text: 'hi', to: 'vi', fetchImpl: badJson }), (e) => e.code === 'PROVIDER_ERROR');
  const empty = mockFetch([['googleapis', () => jsonResponse(googleBody(''))]]);
  await assert.rejects(translateGoogle({ text: 'hi', to: 'vi', fetchImpl: empty }), (e) => e.code === 'PROVIDER_ERROR');
});

test('parseGoogleResponse drops a phonetic/translit that merely echoes the text', async () => {
  const { parseGoogleResponse } = await import('../../extension/src/background/providers/google.js');
  const r = parseGoogleResponse(
    { sentences: [{ trans: 'Science', orig: 'Wissenschaft' }, { translit: 'Science', src_translit: 'Wissenschaft' }], src: 'de' },
    'Wissenschaft',
    { to: 'en' },
  );
  assert.equal(r.phonetic, undefined);
  assert.equal(r.translit, undefined);
  const r2 = parseGoogleResponse({ sentences: [{ trans: 'xin chào', orig: '你好' }, { src_translit: 'Nǐ hǎo' }], src: 'zh-CN' }, '你好', { to: 'vi' });
  assert.equal(r2.phonetic, 'Nǐ hǎo');
});
