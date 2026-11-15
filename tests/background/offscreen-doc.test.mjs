import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL_CLOSED, NO_RECEIVER, createOffscreenMock } from './offscreen-mock.mjs';
import {
  OFFSCREEN_PATH,
  OFFSCREEN_REASONS,
  ensureOffscreen,
  hasOffscreen,
  isNoReceiver,
  sendToOffscreen,
} from '../../extension/src/background/offscreen-doc.js';

let m;
beforeEach(() => {
  m = createOffscreenMock();
  globalThis.chrome = m.chrome;
});

test('ensureOffscreen: concurrent callers share one creation (AUDIO_PLAYBACK + WORKERS)', async () => {
  const results = await Promise.all([ensureOffscreen(), ensureOffscreen(), ensureOffscreen()]);
  assert.equal(m.state.created.length, 1, 'createDocument called once');
  assert.deepEqual(results, [true, true, true]);
  const [params] = m.state.created;
  assert.equal(params.url, OFFSCREEN_PATH);
  assert.deepEqual(params.reasons, ['AUDIO_PLAYBACK', 'WORKERS']);
  assert.deepEqual([...OFFSCREEN_REASONS], ['AUDIO_PLAYBACK', 'WORKERS']);
  assert.match(params.justification, /audio/i);
  assert.match(params.justification, /OCR|text recognition/i);
  assert.deepEqual(m.state.lastContextsQuery, {
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: ['chrome-extension://transpop-test/src/offscreen/offscreen.html'],
  });

  assert.equal(await ensureOffscreen(), false, 'existing document is reused');
  assert.equal(m.state.created.length, 1);
});

test('ensureOffscreen: "only a single offscreen document" is not an error; other failures reject and allow a retry', async () => {
  m.onCreate = async () => {
    m.state.open = true;
    throw new Error('Only a single offscreen document may be created.');
  };
  assert.equal(await ensureOffscreen(), false);

  m.state.open = false;
  m.onCreate = async () => {
    throw new Error('Offscreen API unavailable');
  };
  await assert.rejects(ensureOffscreen(), /unavailable/);
  m.onCreate = async () => {
    m.state.open = true;
  };
  assert.equal(await ensureOffscreen(), true, 'guard released after a failure');
  assert.equal(m.state.created.length, 3);
});

test('hasOffscreen: falls back to chrome.offscreen.hasDocument and never throws', async () => {
  m = createOffscreenMock({ open: true, withGetContexts: false });
  globalThis.chrome = m.chrome;
  assert.equal(await hasOffscreen(), true);
  m.state.open = false;
  assert.equal(await hasOffscreen(), false);

  m.chrome.runtime.getContexts = async () => {
    throw new Error('boom');
  };
  assert.equal(await hasOffscreen(), false);
});

test('isNoReceiver recognizes missing / closed receivers only', () => {
  assert.equal(isNoReceiver(new Error(NO_RECEIVER)), true);
  assert.equal(isNoReceiver(new Error(CHANNEL_CLOSED)), true);
  assert.equal(isNoReceiver(new Error('The message port closed before a response was received.')), true);
  assert.equal(isNoReceiver(new Error('Invalid argument')), false);
  assert.equal(isNoReceiver(undefined), false);
});

test('sendToOffscreen: creates the document, adds target, returns the envelope', async () => {
  m.onSend = async (msg) => ({ ok: true, echo: msg.type });
  const res = await sendToOffscreen({ type: 'offscreen-stop' });
  assert.deepEqual(res, { ok: true, echo: 'offscreen-stop' });
  assert.equal(m.state.created.length, 1);
  assert.deepEqual(m.state.sent, [{ target: 'offscreen', type: 'offscreen-stop' }]);
});

test('sendToOffscreen: document vanished mid-call → recreated and message re-sent once', async () => {
  m.state.open = true;
  let calls = 0;
  m.onSend = async () => {
    calls++;
    if (calls === 1) {
      m.state.open = false; // Chrome closed the document while it was working
      throw new Error(CHANNEL_CLOSED);
    }
    return { ok: true };
  };
  assert.deepEqual(await sendToOffscreen({ type: 'offscreen-ocr' }), { ok: true });
  assert.equal(calls, 2);
  assert.equal(m.state.created.length, 1, 'recreated before the retry');
});

test('sendToOffscreen: an undefined answer counts as "no receiver"; gives up after one retry', async () => {
  m.state.open = true;
  m.onSend = async () => undefined;
  await assert.rejects(sendToOffscreen({ type: 'offscreen-ocr' }), /did not answer/);
  assert.equal(m.state.sent.length, 2);

  m.onSend = async () => {
    throw new Error(NO_RECEIVER);
  };
  await assert.rejects(sendToOffscreen({ type: 'offscreen-ocr' }), /Receiving end does not exist/);
  assert.equal(m.state.sent.length, 4);
});

test('sendToOffscreen: other errors are not retried; ensure:false never creates the document', async () => {
  m.state.open = true;
  m.onSend = async () => {
    throw new Error('Message length exceeded maximum allowed length.');
  };
  await assert.rejects(sendToOffscreen({ type: 'offscreen-ocr' }), /length exceeded/);
  assert.equal(m.state.sent.length, 1);

  m.state.open = false;
  m.onSend = async () => {
    throw new Error(NO_RECEIVER);
  };
  await assert.rejects(sendToOffscreen({ type: 'offscreen-stop' }, { ensure: false }));
  assert.equal(m.state.created.length, 0);
});
