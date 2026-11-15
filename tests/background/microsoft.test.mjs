import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromMicrosoftLang,
  jwtExpiry,
  parseBingSession,
  parseMicrosoftError,
  parseMicrosoftLookup,
  parseMicrosoftTranslate,
  resetMicrosoftState,
  toMicrosoftLang,
  translateMicrosoft,
} from '../../extension/src/background/providers/microsoft.js';
import { BING, EDGE_API, EDGE_AUTH, fakeJwt, fixture, jsonResponse, mockFetch, textResponse } from './helpers.mjs';

beforeEach(() => resetMicrosoftState());

const BING_PAGE = `<html><script>var _G={IG:"ABCDEF0123456789",}; var params_AbusePreventionHelper = [1794724358645,"tok-EN_123",3600000];</script>
<div id="rich_tta" data-iid="translator.5023"></div></html>`;

test('parseMicrosoftTranslate: live-captured responses (Translator v3 schema)', () => {
  const word = parseMicrosoftTranslate(fixture('microsoft-translate-word-en-vi.json'), 'obvious', { to: 'vi' });
  assert.deepEqual(word, { text: 'obvious', translation: 'rõ ràng', from: 'en', to: 'vi', provider: 'microsoft' });

  const zh = parseMicrosoftTranslate(fixture('microsoft-translate-zh-en.json'), '你好世界', { to: 'en' });
  assert.equal(zh.from, 'zh-CN', 'zh-Hans → zh-CN');
  assert.equal(zh.translation, 'Hello, World');

  const ja = parseMicrosoftTranslate(fixture('microsoft-translate-translit-en-ja.json'), 'good morning', { to: 'ja' });
  assert.equal(ja.translation, 'おはようございます');
  assert.equal(ja.translit, 'O-wa you gozaimasu');
});

test('parseMicrosoftTranslate: official API shape with detection score; given `from` kept when not detected', () => {
  const r = parseMicrosoftTranslate([{ detectedLanguage: { language: 'he', score: 0.98 }, translations: [{ text: 'hello', to: 'en' }] }], 'שלום');
  assert.equal(r.from, 'iw');
  assert.equal(r.to, 'en', 'falls back to the response `to` (mapped)');
  assert.equal(r.confidence, 0.98);

  const explicit = parseMicrosoftTranslate([{ translations: [{ text: 'xin chào', to: 'vi' }] }], 'hello', { from: 'en', to: 'vi' });
  assert.equal(explicit.from, 'en');
});

test('parseMicrosoftError / parseMicrosoftTranslate: error shapes', () => {
  assert.equal(parseMicrosoftError({ error: { code: 400036, message: 'The target language is not valid.' } }).code, 'UNSUPPORTED_LANG');
  assert.equal(parseMicrosoftError({ error: { code: 400035, message: 'bad from' } }).code, 'UNSUPPORTED_LANG');
  assert.equal(parseMicrosoftError({ error: { code: 429001, message: 'quota' } }).code, 'RATE_LIMITED');
  assert.equal(parseMicrosoftError({ error: { code: 401000, message: 'unauthorized' } }).code, 'PROVIDER_ERROR');
  assert.equal(parseMicrosoftError({ statusCode: 400, errorMessage: '' }).code, 'PROVIDER_ERROR'); // Bing error (live shape)
  assert.equal(parseMicrosoftError({ statusCode: 429 }).code, 'RATE_LIMITED');
  assert.equal(parseMicrosoftError([{ translations: [] }]), null);

  for (const bad of [null, [], {}, [{}], [{ translations: [{ text: '' }] }], { statusCode: 400, errorMessage: '' }]) {
    assert.throws(() => parseMicrosoftTranslate(bad, 'x', { to: 'vi' }), (e) => ['PROVIDER_ERROR'].includes(e.code));
  }
});

test('parseMicrosoftLookup: groups by part of speech (live fixture + multi-pos sample)', () => {
  const dict = parseMicrosoftLookup(fixture('microsoft-lookup-en-vi.json'));
  assert.equal(dict.length, 1);
  assert.equal(dict[0].pos, 'adjective');
  assert.deepEqual(dict[0].terms, ['rõ ràng']);
  assert.equal(dict[0].entries[0].score, 1);
  assert.ok(dict[0].entries[0].reverse.includes('clear'));

  const multi = parseMicrosoftLookup([
    {
      normalizedSource: 'light',
      translations: [
        { displayTarget: 'luz', posTag: 'NOUN', confidence: 0.4, backTranslations: [{ displayText: 'light' }, { displayText: 'lamp' }] },
        { displayTarget: 'ligero', posTag: 'ADJ', confidence: 0.21, backTranslations: [{ displayText: 'light' }] },
        { displayTarget: 'lámpara', posTag: 'NOUN', confidence: 0.03, backTranslations: [] },
        { displayTarget: 'luz', posTag: 'NOUN', confidence: 0.01 },
        { displayTarget: '', posTag: 'VERB' },
        { displayTarget: 'algo', posTag: 'OTHER' },
      ],
    },
  ]);
  assert.deepEqual(
    multi.map((g) => [g.pos, g.terms]),
    [
      ['noun', ['luz', 'lámpara']],
      ['adjective', ['ligero']],
      ['', ['algo']],
    ],
  );
  assert.deepEqual(parseMicrosoftLookup({ error: { code: 400000 } }), []);
  assert.deepEqual(parseMicrosoftLookup(null), []);
});

test('language code mapping Google ↔ Microsoft', () => {
  const pairs = [
    ['zh-CN', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['iw', 'he'],
    ['tl', 'fil'],
    ['jw', 'jv'],
    ['no', 'nb'],
    ['mni-Mtei', 'mni'],
    ['ku', 'kmr'],
    ['ckb', 'ku'],
    ['sr', 'sr-Cyrl'],
    ['hmn', 'mww'],
  ];
  for (const [google, ms] of pairs) {
    assert.equal(toMicrosoftLang(google), ms, `${google} → ${ms}`);
    assert.equal(fromMicrosoftLang(ms), google, `${ms} → ${google}`);
  }
  assert.equal(toMicrosoftLang('vi'), 'vi');
  assert.equal(toMicrosoftLang('auto'), 'auto');
  assert.equal(fromMicrosoftLang('en'), 'en');
  assert.equal(fromMicrosoftLang('pt-PT'), 'pt');
  assert.equal(fromMicrosoftLang('ZH-HANS'), 'zh-CN');
  assert.equal(fromMicrosoftLang('tlh-Latn'), 'tlh-Latn', 'unknown codes are kept');
});

test('parseBingSession / jwtExpiry', () => {
  assert.deepEqual(parseBingSession(BING_PAGE), { ig: 'ABCDEF0123456789', iid: 'translator.5023', key: '1794724358645', token: 'tok-EN_123', ttl: 3600000 });
  assert.equal(parseBingSession('<html></html>'), null);
  const exp = jwtExpiry(fakeJwt(300));
  assert.ok(exp > Date.now() / 1000 + 290 && exp <= Date.now() / 1000 + 300);
  assert.equal(jwtExpiry('not-a-jwt'), null);
});

function edgeRoutes({ auth = () => textResponse(fakeJwt()), translate, lookup } = {}) {
  return [
    [EDGE_AUTH, auth],
    [`${EDGE_API}/translate`, translate || (() => jsonResponse(fixture('microsoft-translate-word-en-vi.json')))],
    [`${EDGE_API}/dictionary/lookup`, lookup || (() => jsonResponse(fixture('microsoft-lookup-en-vi.json')))],
  ];
}

test('translateMicrosoft (edge): bearer token, mapped codes, JSON body, dictionary lookup, token cache', async () => {
  const fetchImpl = mockFetch(edgeRoutes());
  const r = await translateMicrosoft({ text: 'obvious', from: 'auto', to: 'vi', fetchImpl });
  assert.equal(r.translation, 'rõ ràng');
  assert.equal(r.provider, 'microsoft');
  assert.equal(r.dictionary[0].terms[0], 'rõ ràng');

  const tr = fetchImpl.calls.find((c) => c.url.includes('/translate?'));
  const u = new URL(tr.url);
  assert.equal(u.searchParams.get('api-version'), '3.0');
  assert.equal(u.searchParams.get('to'), 'vi');
  assert.equal(u.searchParams.get('from'), null, 'no from for auto');
  assert.match(tr.init.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]*$/);
  assert.deepEqual(JSON.parse(tr.body), [{ Text: 'obvious' }]);
  const lk = new URL(fetchImpl.calls.find((c) => c.url.includes('/dictionary/lookup')).url);
  assert.equal(lk.searchParams.get('from'), 'en');
  assert.equal(lk.searchParams.get('to'), 'vi');

  await translateMicrosoft({ text: '你好', from: 'zh-CN', to: 'iw', fetchImpl });
  const second = new URL(fetchImpl.calls.filter((c) => c.url.includes('/translate?')).at(-1).url);
  assert.equal(second.searchParams.get('from'), 'zh-Hans');
  assert.equal(second.searchParams.get('to'), 'he');
  assert.equal(fetchImpl.count(EDGE_AUTH), 1, 'token is cached in module scope');
});

test('translateMicrosoft (edge): no lookup for sentences or non-English pairs; lookup failure is ignored', async () => {
  const detected = (lang) => () => jsonResponse([{ detectedLanguage: { language: lang, score: 1 }, translations: [{ text: 'x', to: 'vi' }] }]);
  const fetchImpl = mockFetch(
    edgeRoutes({
      translate: (url, init) => {
        const text = JSON.parse(init.body)[0].Text;
        if (text === 'bonjour') return detected('fr')();
        if (text === 'one two three four') return detected('en')();
        return jsonResponse(fixture('microsoft-translate-word-en-vi.json'));
      },
      lookup: () => textResponse('boom', 500),
    }),
  );
  await translateMicrosoft({ text: 'one two three four', to: 'vi', fetchImpl });
  await translateMicrosoft({ text: 'bonjour', to: 'vi', fetchImpl });
  assert.equal(fetchImpl.count('/dictionary/lookup'), 0);
  const r = await translateMicrosoft({ text: 'obvious', to: 'vi', fetchImpl });
  assert.equal(fetchImpl.count('/dictionary/lookup'), 1);
  assert.equal(r.dictionary, undefined);
  assert.equal(r.translation, 'rõ ràng');
});

test('translateMicrosoft (edge): 401 refreshes the token once', async () => {
  const fetchImpl = mockFetch(
    edgeRoutes({
      translate: (url, init, i) => (i === 0 ? jsonResponse({ error: { code: 401000, message: 'expired' } }, 401) : jsonResponse(fixture('microsoft-translate-word-en-vi.json'))),
    }),
  );
  const r = await translateMicrosoft({ text: 'obvious', to: 'vi', fetchImpl, transports: ['edge'] });
  assert.equal(r.translation, 'rõ ràng');
  assert.equal(fetchImpl.count(EDGE_AUTH), 2);
});

test('translateMicrosoft: invalid language → UNSUPPORTED_LANG, no other transport tried', async () => {
  const fetchImpl = mockFetch([
    ...edgeRoutes({ translate: () => jsonResponse({ error: { code: 400036, message: 'The target language is not valid.' } }, 400) }),
    [BING, () => textResponse(BING_PAGE)],
  ]);
  await assert.rejects(translateMicrosoft({ text: 'hi', to: 'xx', fetchImpl }), (e) => e.code === 'UNSUPPORTED_LANG');
  assert.equal(fetchImpl.count(BING), 0);
});

test('translateMicrosoft: Edge auth 404 → Bing transport; Edge is skipped for a while afterwards', async () => {
  const fetchImpl = mockFetch([
    [EDGE_AUTH, () => textResponse('', 404)],
    [`${BING}/translator`, () => textResponse(BING_PAGE)],
    [`${BING}/ttranslatev3`, () => jsonResponse(fixture('microsoft-translate-zh-en.json'))],
    [`${BING}/tlookupv3`, () => jsonResponse([])],
  ]);
  const r = await translateMicrosoft({ text: '你好世界', to: 'en', fetchImpl });
  assert.equal(r.translation, 'Hello, World');
  assert.equal(r.from, 'zh-CN');

  const call = fetchImpl.calls.find((c) => c.url.includes('/ttranslatev3'));
  const u = new URL(call.url);
  assert.equal(u.searchParams.get('IG'), 'ABCDEF0123456789');
  assert.equal(u.searchParams.get('IID'), 'translator.5023');
  const form = new URLSearchParams(call.body);
  assert.equal(form.get('fromLang'), 'auto-detect');
  assert.equal(form.get('to'), 'en');
  assert.equal(form.get('text'), '你好世界');
  assert.equal(form.get('key'), '1794724358645');
  assert.equal(form.get('token'), 'tok-EN_123');

  await translateMicrosoft({ text: '你好世界', to: 'en', fetchImpl });
  assert.equal(fetchImpl.count(EDGE_AUTH), 1, 'blocked Edge auth not retried immediately');
  assert.equal(fetchImpl.count(`${BING}/translator`), 1, 'Bing session cached');
});

test('translateMicrosoft: all transports failing rejects with a coded error', async () => {
  const fetchImpl = mockFetch([
    [EDGE_AUTH, () => textResponse('', 503)],
    [BING, () => textResponse('', 429)],
  ]);
  await assert.rejects(translateMicrosoft({ text: 'hi', to: 'vi', fetchImpl }), (e) => e.code === 'RATE_LIMITED');
  resetMicrosoftState();
  await assert.rejects(translateMicrosoft({ text: 'hi', to: 'vi', fetchImpl: mockFetch([]) }), (e) => e.code === 'NETWORK');
});
