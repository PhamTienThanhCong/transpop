import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL_CLOSED, NO_RECEIVER, createOffscreenMock } from './offscreen-mock.mjs';
import { clearOcrCache, runOcr, unwrapOcrResponse } from '../../extension/src/background/ocr.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const OCR = { text: 'Hello world', confidence: 91, langs: ['eng'], lang: 'en', lines: [] };

let m;
beforeEach(() => {
  m = createOffscreenMock();
  globalThis.chrome = m.chrome;
});

test('runOcr: ensures the document and sends offscreen-ocr with normalized languages', async () => {
  m.onSend = async () => ({ ok: true, ocr: OCR });
  const ocr = await runOcr(PNG, ['eng', 'vie', 'klingon', 'eng']);
  assert.deepEqual(ocr, OCR);
  assert.equal(m.state.created.length, 1);
  assert.deepEqual(m.state.sent, [{ target: 'offscreen', type: 'offscreen-ocr', dataUrl: PNG, langs: ['eng', 'vie'] }]);

  await runOcr(PNG);
  assert.deepEqual(m.state.sent.at(-1).langs, ['eng'], 'default language');
  assert.equal(m.state.created.length, 1, 'document reused');
});

test('runOcr: recreates the document and retries once when it vanished mid-call', async () => {
  m.state.open = true;
  let calls = 0;
  m.onSend = async () => {
    calls++;
    if (calls === 1) {
      m.state.open = false;
      throw new Error(CHANNEL_CLOSED);
    }
    return { ok: true, ocr: OCR };
  };
  assert.deepEqual(await runOcr(PNG, ['eng']), OCR);
  assert.equal(calls, 2);
  assert.equal(m.state.created.length, 1);
});

test('runOcr: a second failure maps to OCR_FAILED', async () => {
  m.onSend = async () => {
    throw new Error(NO_RECEIVER);
  };
  await assert.rejects(runOcr(PNG, ['eng']), (err) => err.code === 'OCR_FAILED' && /unavailable/.test(err.message));
  assert.equal(m.state.sent.length, 2, 'exactly one retry');
});

test('runOcr: engine errors keep OCR_NO_TEXT / NETWORK / OCR_FAILED, anything else becomes OCR_FAILED', async () => {
  for (const code of ['OCR_NO_TEXT', 'NETWORK', 'OCR_FAILED']) {
    m.onSend = async () => ({ ok: false, error: { code, message: `engine said ${code}` } });
    await assert.rejects(runOcr(PNG, ['eng']), (err) => err.code === code && err.message === `engine said ${code}`);
  }
  m.onSend = async () => ({ ok: false, error: { code: 'WEIRD', message: 'x' } });
  await assert.rejects(runOcr(PNG, ['eng']), { code: 'OCR_FAILED' });
  m.onSend = async () => ({ ok: true }); // no ocr payload
  await assert.rejects(runOcr(PNG, ['eng']), { code: 'OCR_FAILED' });
});

test('runOcr: rejects bad input without messaging; document creation failure → OCR_FAILED', async () => {
  await assert.rejects(runOcr('https://example.com/a.png', ['eng']), { code: 'OCR_FAILED' });
  await assert.rejects(runOcr(null), { code: 'OCR_FAILED' });
  assert.equal(m.state.sent.length, 0);

  m.onCreate = async () => {
    throw new Error('offscreen API missing');
  };
  await assert.rejects(runOcr(PNG, ['eng']), (err) => err.code === 'OCR_FAILED' && /offscreen API missing/.test(err.message));
});

test('runOcr: times out with OCR_FAILED when the engine never answers', async () => {
  m.state.open = true;
  m.onSend = () => new Promise(() => {});
  await assert.rejects(runOcr(PNG, ['eng'], { timeoutMs: 30 }), (err) => err.code === 'OCR_FAILED' && /timed out/.test(err.message));
});

test('unwrapOcrResponse', () => {
  assert.deepEqual(unwrapOcrResponse({ ok: true, ocr: OCR }), OCR);
  assert.throws(() => unwrapOcrResponse(undefined), { code: 'OCR_FAILED' });
  assert.throws(() => unwrapOcrResponse({ ok: true, ocr: { text: 5 } }), { code: 'OCR_FAILED' });
  assert.throws(() => unwrapOcrResponse({ ok: false, error: { code: 'OCR_NO_TEXT' } }), { code: 'OCR_NO_TEXT' });
});

test('clearOcrCache: sends offscreen-ocr-clear; failures → OCR_FAILED', async () => {
  m.onSend = async () => ({ ok: true });
  assert.deepEqual(await clearOcrCache(), {});
  assert.deepEqual(m.state.sent.at(-1), { target: 'offscreen', type: 'offscreen-ocr-clear' });

  m.onSend = async () => ({ ok: false, error: { code: 'OCR_FAILED', message: 'in use' } });
  await assert.rejects(clearOcrCache(), (err) => err.code === 'OCR_FAILED' && err.message === 'in use');
  m.onSend = async () => {
    throw new Error(NO_RECEIVER);
  };
  await assert.rejects(clearOcrCache(), { code: 'OCR_FAILED' });
});
