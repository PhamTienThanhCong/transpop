/** Minimal in-memory `chrome.*` mock for loading the service worker in Node (not a test file itself). */
import { readFileSync } from 'node:fs';

const MESSAGES = JSON.parse(readFileSync(new URL('../../extension/_locales/en/messages.json', import.meta.url), 'utf8'));

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function event() {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListeners: () => listeners.length > 0,
    dispatch: (...args) => listeners.map((fn) => fn(...args)),
  };
}

export function createChromeMock({ uiLanguage = 'vi' } = {}) {
  const log = {
    tabsCreated: [],
    windowsCreated: [],
    tabMessages: [],
    runtimeMessages: [],
    badge: { text: '', color: null, title: null },
    menus: new Map(),
    ttsSpoken: [],
    offscreenCreated: 0,
  };
  const areas = { sync: {}, local: {} };
  const onChanged = event();

  const storageArea = (name) => ({
    async get(keys) {
      const data = areas[name];
      if (keys == null) return clone(data);
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, clone(data[k])]));
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: clone(areas[name][k]), newValue: clone(v) };
        areas[name][k] = clone(v);
      }
      queueMicrotask(() => onChanged.dispatch(changes, name));
    },
  });

  // Behaviour knobs for tests
  const behaviour = {
    tabSendMessage: async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    },
    offscreenResponse: { ok: true },
    activeTab: { id: 7, windowId: 1, active: true },
    // image translation
    captureVisibleTab: async () => {
      throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.');
    },
    window: { id: 1, left: 100, top: 50, width: 1280, height: 800, type: 'normal' },
  };

  let offscreenOpen = false;
  const chrome = {
    runtime: {
      id: 'transpop-test',
      lastError: undefined,
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
      getURL: (p) => `chrome-extension://transpop-test/${p.replace(/^\//, '')}`,
      openOptionsPage: async () => log.tabsCreated.push('options'),
      getContexts: async ({ contextTypes }) => (contextTypes.includes('OFFSCREEN_DOCUMENT') && offscreenOpen ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []),
      sendMessage: async (msg) => {
        log.runtimeMessages.push(msg);
        return behaviour.offscreenResponse;
      },
    },
    storage: { sync: storageArea('sync'), local: storageArea('local'), onChanged },
    i18n: {
      getUILanguage: () => uiLanguage,
      getMessage: (key, subs) => {
        const m = MESSAGES[key];
        if (!m) return '';
        const s = [].concat(subs ?? []);
        return m.message.replace(/\$(\w+)\$/g, (_, name) => {
          const content = m.placeholders?.[name.toLowerCase()]?.content || '';
          return content.replace(/\$(\d)/, (__, n) => s[Number(n) - 1] ?? '');
        });
      },
    },
    contextMenus: {
      onClicked: event(),
      create: (props, cb) => {
        if (log.menus.has(props.id)) chrome.runtime.lastError = { message: `Cannot create item with duplicate id ${props.id}` };
        else log.menus.set(props.id, { ...props });
        cb?.();
        chrome.runtime.lastError = undefined;
      },
      update: (id, props, cb) => {
        if (log.menus.has(id)) Object.assign(log.menus.get(id), props);
        else chrome.runtime.lastError = { message: `Cannot find menu item with id ${id}` };
        cb?.();
        chrome.runtime.lastError = undefined;
      },
      removeAll: (cb) => {
        log.menus.clear();
        cb?.();
      },
    },
    commands: { onCommand: event() },
    tabs: {
      onActivated: event(),
      onUpdated: event(),
      onRemoved: event(),
      get: async (tabId) => ({ id: tabId, windowId: 1, active: true }),
      captureVisibleTab: async (windowId, opts) => {
        log.captures = (log.captures || 0) + 1;
        return behaviour.captureVisibleTab(windowId, opts);
      },
      query: async () => (behaviour.activeTab ? [behaviour.activeTab] : []),
      create: async (props) => {
        log.tabsCreated.push(props.url);
        return { id: 99, ...props };
      },
      sendMessage: async (tabId, msg, opts) => {
        log.tabMessages.push({ tabId, msg, opts });
        return behaviour.tabSendMessage(tabId, msg, opts);
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: event(),
      create: async (props) => {
        log.windowsCreated.push(props);
        return { id: 5 };
      },
      get: async () => ({ ...behaviour.window }),
    },
    action: {
      setBadgeText: async ({ text }) => {
        log.badge.text = text;
      },
      setBadgeBackgroundColor: async ({ color }) => {
        log.badge.color = color;
      },
      setBadgeTextColor: async () => {},
      setTitle: async ({ title }) => {
        log.badge.title = title;
      },
    },
    offscreen: {
      createDocument: async () => {
        log.offscreenCreated++;
        offscreenOpen = true;
      },
    },
    tts: {
      speak: (text, opts, cb) => {
        log.ttsSpoken.push({ text, ...opts });
        cb?.();
      },
      stop: () => {},
    },
  };

  /** Send a runtime message to the SW listeners like Chrome would; resolves with the response (or undefined). */
  const sendToBackground = (message, sender = { id: 'transpop-test', url: 'https://example.com/page' }) =>
    new Promise((resolve) => {
      let async = false;
      for (const fn of chrome.runtime.onMessage.listeners) {
        const ret = fn(message, sender, resolve);
        if (ret === true) async = true;
      }
      if (!async) resolve(undefined);
    });

  return { chrome, log, areas, behaviour, sendToBackground };
}

/** Wait for queued microtasks/timers to settle. */
export const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));
