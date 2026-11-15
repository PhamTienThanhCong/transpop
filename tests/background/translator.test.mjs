import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { providerOrder, translate } from '../../extension/src/background/translator.js';
import { resetMicrosoftState } from '../../extension/src/background/providers/microsoft.js';
import { BING, EDGE_API, EDGE_AUTH, GOOGLE_HOST, fakeJwt, fixture, googleBody, jsonResponse, mockFetch, textResponse } from './helpers.mjs';

beforeEach(() => resetMicrosoftState());

const params = (call) => new URL(call.url).searchParams;
const msOk = (text = 'xin chào', lang = 'en') => () => jsonResponse([{ detectedLanguage: { language: lang, score: 1 }, translations: [{ text, to: 'vi' }] }]);
const edgeOk = (translateHandler = msOk()) => [
  [EDGE_AUTH, () => textResponse(fakeJwt())],
  [`${EDGE_API}/translate`, translateHandler],
  [`${EDGE_API}/dictionary/lookup`, () => jsonResponse([])],
];

test('validation: EMPTY / TOO_LONG / UNSUPPORTED_LANG before any request', async () => {
  const fetchImpl = mockFetch([]);
  for (const text of ['', '   \n\t', undefined, null, 42]) {
    await assert.rejects(translate({ text, to: 'vi', fetchImpl }), (e) => e.code === 'EMPTY');
  }
  await assert.rejects(translate({ text: 'a'.repeat(5001), to: 'vi', fetchImpl }), (e) => e.code === 'TOO_LONG');
  await translate({ text: ` ${'a'.repeat(5000)} `, to: 'vi', fetchImpl: mockFetch([[GOOGLE_HOST, () => jsonResponse(googleBody('a'))]]) });
  await assert.rejects(translate({ text: 'hi', to: 'xx-nope', fetchImpl }), (e) => e.code === 'UNSUPPORTED_LANG');
  await assert.rejects(translate({ text: 'hi', fetchImpl }), (e) => e.code === 'UNSUPPORTED_LANG');
  await assert.rejects(translate({ text: 'hi', to: 'auto', fetchImpl }), (e) => e.code === 'UNSUPPORTED_LANG');
  await assert.rejects(translate({ text: 'hi', from: 'klingon', to: 'vi', fetchImpl }), (e) => e.code === 'UNSUPPORTED_LANG');
  assert.equal(fetchImpl.calls.length, 0);
});

test('google success: trimmed text, normalized codes, uiLang passed as hl', async () => {
  const fetchImpl = mockFetch([[GOOGLE_HOST, () => jsonResponse(fixture('google-word-en-vi.json'))]]);
  const r = await translate({ text: '  obvious  ', to: 'VI', uiLang: 'vi-VN', fetchImpl });
  assert.equal(r.text, 'obvious');
  assert.equal(r.to, 'vi');
  assert.equal(r.provider, 'google');
  assert.equal(r.translation, 'rõ ràng');
  assert.equal(params(fetchImpl.calls[0]).get('hl'), 'vi');
  assert.equal(params(fetchImpl.calls[0]).get('tl'), 'vi');
  assert.equal(fetchImpl.calls[0].body, 'q=obvious');
});

test('smart swap: detected source == to → re-translate into swapTo', async () => {
  const fetchImpl = mockFetch([
    [GOOGLE_HOST, (url) => (new URL(url).searchParams.get('tl') === 'vi' ? jsonResponse(googleBody('rõ ràng', 'vi')) : jsonResponse(googleBody('clear', 'vi')))],
  ]);
  const r = await translate({ text: 'rõ ràng', to: 'vi', swapTo: 'en', fetchImpl });
  assert.equal(r.to, 'en');
  assert.equal(r.from, 'vi');
  assert.equal(r.translation, 'clear');
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(params(fetchImpl.calls[1]).get('sl'), 'vi', 'second call uses the detected source');
  assert.equal(params(fetchImpl.calls[1]).get('tl'), 'en');
});

test('smart swap: not applied when detected source differs, or when swapTo is absent', async () => {
  const fetchImpl = mockFetch([[GOOGLE_HOST, () => jsonResponse(googleBody('rõ ràng', 'en'))]]);
  const r = await translate({ text: 'obvious', to: 'vi', swapTo: 'en', fetchImpl });
  assert.equal(r.to, 'vi');
  assert.equal(fetchImpl.calls.length, 1);

  const same = mockFetch([[GOOGLE_HOST, () => jsonResponse(googleBody('rõ ràng', 'vi'))]]);
  const r2 = await translate({ text: 'rõ ràng', to: 'vi', fetchImpl: same });
  assert.equal(r2.to, 'vi');
  assert.equal(same.calls.length, 1);
});

test('smart swap: explicit from == to goes straight to swapTo (one request)', async () => {
  const fetchImpl = mockFetch([[GOOGLE_HOST, () => jsonResponse(googleBody('clear', 'vi'))]]);
  const r = await translate({ text: 'rõ ràng', from: 'vi', to: 'vi', swapTo: 'en', fetchImpl });
  assert.equal(r.to, 'en');
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(params(fetchImpl.calls[0]).get('tl'), 'en');
});

test('smart swap: failure of the swap request returns the un-swapped result', async () => {
  const fetchImpl = mockFetch([
    [GOOGLE_HOST, (url) => (new URL(url).searchParams.get('tl') === 'vi' ? jsonResponse(googleBody('rõ ràng', 'vi')) : textResponse('', 500))],
    [EDGE_AUTH, () => textResponse('', 500)],
    [BING, () => textResponse('', 500)],
  ]);
  const r = await translate({ text: 'rõ ràng', to: 'vi', swapTo: 'en', fetchImpl });
  assert.equal(r.to, 'vi');
  assert.equal(r.translation, 'rõ ràng');
});

test('fallback: Google 503 / network error → Microsoft', async () => {
  for (const googleHandler of [() => textResponse('busy', 503), () => Promise.reject(new TypeError('fetch failed'))]) {
    resetMicrosoftState();
    const fetchImpl = mockFetch([[GOOGLE_HOST, googleHandler], ...edgeOk()]);
    const r = await translate({ text: 'hello', to: 'vi', fetchImpl });
    assert.equal(r.provider, 'microsoft');
    assert.equal(r.translation, 'xin chào');
    assert.equal(r.text, 'hello');
    assert.equal(r.to, 'vi');
  }
});

test('fallback: provider=microsoft fails (Edge + Bing) → Google', async () => {
  const fetchImpl = mockFetch([
    [EDGE_AUTH, () => textResponse('', 404)],
    [BING, () => Promise.reject(new TypeError('Failed to fetch'))],
    [GOOGLE_HOST, () => jsonResponse(googleBody('xin chào', 'en'))],
  ]);
  const r = await translate({ text: 'hello', to: 'vi', provider: 'microsoft', fetchImpl });
  assert.equal(r.provider, 'google');
  assert.equal(fetchImpl.calls[0].url.includes(EDGE_AUTH), true, 'microsoft tried first');
});

test('fallback: both providers fail → primary error code, other errors attached', async () => {
  const fetchImpl = mockFetch([
    [GOOGLE_HOST, () => textResponse('', 429)],
    [EDGE_AUTH, () => textResponse('', 500)],
    [BING, () => textResponse('', 500)],
  ]);
  await assert.rejects(translate({ text: 'hello', to: 'vi', fetchImpl }), (e) => {
    assert.equal(e.code, 'RATE_LIMITED');
    assert.equal(e.provider, 'google');
    assert.equal(e.fallbackErrors[0].provider, 'microsoft');
    return true;
  });
});

test('fallback: uncoded provider exceptions are wrapped as UNKNOWN and still fall back', async () => {
  const providers = {
    google: async () => {
      throw new TypeError('boom');
    },
    microsoft: async ({ text, to }) => ({ text, translation: 'ok', from: 'en', to, provider: 'microsoft' }),
  };
  const r = await translate({ text: 'hello', to: 'vi', providers });
  assert.equal(r.provider, 'microsoft');

  await assert.rejects(
    translate({ text: 'hello', to: 'vi', providers: { google: providers.google, microsoft: providers.google } }),
    (e) => e.code === 'UNKNOWN' && e.message === 'boom',
  );
});

test('providerOrder', () => {
  assert.deepEqual(providerOrder('google'), ['google', 'microsoft']);
  assert.deepEqual(providerOrder('microsoft'), ['microsoft', 'google']);
  assert.deepEqual(providerOrder('nope'), ['google', 'microsoft']);
});
