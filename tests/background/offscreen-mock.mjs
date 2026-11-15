/**
 * Controllable `chrome.offscreen` / `chrome.runtime` mock for offscreen-doc.js and ocr.js tests (not a test file itself).
 *
 *   const m = createOffscreenMock();
 *   globalThis.chrome = m.chrome;
 *   m.onSend = async (msg, state) => ({ ok: true });   // how the "offscreen document" answers
 */
export const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.';
export const CHANNEL_CLOSED =
  'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received';

export function createOffscreenMock({ open = false, withGetContexts = true } = {}) {
  const state = {
    open,
    created: [], // createDocument() arguments
    sent: [], // runtime.sendMessage() payloads
    platformInfoCalls: 0,
  };
  const mock = {
    state,
    /** Answer for runtime.sendMessage; default: the document answers { ok: true } when it exists. */
    onSend: async () => {
      if (!state.open) throw new Error(NO_RECEIVER);
      return { ok: true };
    },
    /** Override createDocument behaviour (default: opens the document after a tick). */
    onCreate: async () => {
      await new Promise((r) => setTimeout(r, 5));
      state.open = true;
    },
  };
  const runtime = {
    id: 'transpop-test',
    getURL: (p) => `chrome-extension://transpop-test/${String(p).replace(/^\//, '')}`,
    sendMessage: async (msg) => {
      state.sent.push(msg);
      return mock.onSend(msg, state);
    },
    getPlatformInfo: async () => {
      state.platformInfoCalls++;
      return { os: 'mac' };
    },
  };
  if (withGetContexts) {
    runtime.getContexts = async ({ contextTypes, documentUrls }) => {
      state.lastContextsQuery = { contextTypes, documentUrls };
      return contextTypes.includes('OFFSCREEN_DOCUMENT') && state.open ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : [];
    };
  }
  mock.chrome = {
    runtime,
    offscreen: {
      createDocument: async (params) => {
        state.created.push(params);
        await mock.onCreate(params, state);
      },
      hasDocument: async () => state.open,
    },
  };
  return mock;
}
