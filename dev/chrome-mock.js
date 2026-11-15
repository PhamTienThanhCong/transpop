/**
 * TransPop dev harness — a small fake `chrome.*` API so extension pages and the content script
 * can run in a normal browser tab served by scripts/dev-server.mjs. DEV ONLY (never packaged).
 *
 * - storage.{sync,local,session} → localStorage (+ onChanged, synced across tabs)
 * - i18n → loads /extension/_locales/<lang>/messages.json (lang: localStorage 'transpop-dev-lang', default 'vi')
 * - runtime.sendMessage → emulates the background service worker (translate via /__dev/translate)
 */
(() => {
  if (window.chrome?.runtime?.id && !window.__transpopMock) return; // real extension context: do nothing
  window.__transpopMock = true;

  const EXT = '/extension/';
  const LANG = localStorage.getItem('transpop-dev-lang') || 'vi';
  const log = (...a) => console.debug('[chrome-mock]', ...a);

  const syncGet = (url) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    return xhr.status === 200 ? xhr.responseText : null;
  };

  /* ---------------- events ---------------- */
  const makeEvent = () => {
    const listeners = new Set();
    return {
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
      hasListener: (fn) => listeners.has(fn),
      _emit: (...args) => [...listeners].map((fn) => fn(...args)),
    };
  };

  /* ---------------- storage ---------------- */
  const onChanged = makeEvent();
  const PREFIX = 'transpop-mock:';
  const makeArea = (area) => {
    const key = PREFIX + area;
    const read = () => {
      try {
        return JSON.parse(localStorage.getItem(key) || '{}');
      } catch {
        return {};
      }
    };
    const write = (obj) => localStorage.setItem(key, JSON.stringify(obj));
    const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    return {
      async get(keys) {
        const all = read();
        if (keys == null) return clone(all);
        if (typeof keys === 'string') return keys in all ? { [keys]: clone(all[keys]) } : {};
        if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in all).map((k) => [k, clone(all[k])]));
        return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in all ? clone(all[k]) : d]));
      },
      async set(items) {
        const all = read();
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: all[k], newValue: clone(v) };
          all[k] = clone(v);
        }
        write(all);
        onChanged._emit(changes, area);
      },
      async remove(keys) {
        const all = read();
        const changes = {};
        for (const k of [].concat(keys)) {
          changes[k] = { oldValue: all[k] };
          delete all[k];
        }
        write(all);
        onChanged._emit(changes, area);
      },
      async clear() {
        write({});
      },
    };
  };
  // Cross-tab sync (e.g. popup tab ↔ demo tab)
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(PREFIX)) return;
    const area = e.key.slice(PREFIX.length);
    const oldAll = JSON.parse(e.oldValue || '{}');
    const newAll = JSON.parse(e.newValue || '{}');
    const changes = {};
    for (const k of new Set([...Object.keys(oldAll), ...Object.keys(newAll)])) {
      if (JSON.stringify(oldAll[k]) !== JSON.stringify(newAll[k])) changes[k] = { oldValue: oldAll[k], newValue: newAll[k] };
    }
    if (Object.keys(changes).length) onChanged._emit(changes, area);
  });

  /* ---------------- i18n ---------------- */
  let messages = {};
  try {
    messages = JSON.parse(syncGet(`${EXT}_locales/${LANG}/messages.json`) || '{}');
  } catch {
    messages = {};
  }
  let enMessages = messages;
  if (LANG !== 'en') {
    try {
      enMessages = JSON.parse(syncGet(`${EXT}_locales/en/messages.json`) || '{}');
    } catch {
      /* ignore */
    }
  }
  const getMessage = (name, subs) => {
    if (name === '@@bidi_dir') return 'ltr';
    if (name === '@@ui_locale') return LANG;
    const m = messages[name] || enMessages[name];
    if (!m) return '';
    const s = subs == null ? [] : [].concat(subs);
    let text = m.message;
    if (m.placeholders) {
      text = text.replace(/\$([A-Za-z0-9_]+)\$/g, (_, ph) => {
        const content = m.placeholders[ph.toLowerCase()]?.content || '';
        return content.replace(/\$(\d)/g, (__, n) => s[n - 1] ?? '');
      });
    }
    return text.replace(/\$(\d)/g, (_, n) => s[n - 1] ?? '');
  };

  /* ---------------- manifest ---------------- */
  let manifest = {};
  try {
    manifest = JSON.parse(syncGet(`${EXT}manifest.json`) || '{}');
  } catch {
    /* ignore */
  }

  /* ---------------- fake background ---------------- */
  const runtimeOnMessage = makeEvent();
  let shared = null;
  const loadShared = async () => {
    if (!shared) {
      const [storage, constants] = await Promise.all([import(`${EXT}src/shared/storage.js`), import(`${EXT}src/shared/constants.js`)]);
      shared = { ...storage, ...constants };
    }
    return shared;
  };

  const speak = (text, lang, rate = 1) => {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = rate;
      speechSynthesis.speak(u);
    } catch (e) {
      log('speech failed', e);
    }
  };

  const background = {
    async translate(msg) {
      const s = await loadShared();
      const settings = await s.getSettings();
      const body = {
        text: msg.text,
        from: msg.from || 'auto',
        to: msg.to || settings.targetLang,
        swapTo: msg.to ? undefined : settings.secondaryLang,
        provider: settings.provider,
        uiLang: LANG,
      };
      const res = await fetch('/__dev/translate', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
      if (res.ok && settings.saveHistory && msg.record !== false && msg.source !== 'welcome') {
        await s.addHistoryEntry(res.result);
      }
      return res.ok ? { ok: true, result: res.result } : res;
    },
    async 'get-settings'() {
      const s = await loadShared();
      return { ok: true, settings: await s.getSettings() };
    },
    async speak(msg) {
      const s = await loadShared();
      speak(msg.text, msg.lang, (await s.getSettings()).speechRate);
      return { ok: true };
    },
    async 'stop-speak'() {
      speechSynthesis.cancel();
      return { ok: true };
    },
    async 'open-options'(msg) {
      window.open(`${EXT}src/options/options.html${msg.section ? `#${msg.section}` : ''}`, '_blank');
      return { ok: true };
    },
    async 'toggle-favorite'(msg) {
      const s = await loadShared();
      return { ok: true, favorited: await s.toggleFavorite(msg.result) };
    },
    async 'check-favorite'(msg) {
      const s = await loadShared();
      return { ok: true, favorited: await s.isFavorite(msg.text, msg.to) };
    },
    async 'get-ui-messages'() {
      const s = await loadShared();
      const { uiLanguage } = await s.getSettings();
      if (!uiLanguage || uiLanguage === 'auto') return { ok: true, locale: LANG, messages: null };
      const all = await fetch(`${EXT}_locales/${uiLanguage}/messages.json`).then((r) => r.json());
      const messages = Object.fromEntries(
        Object.entries(all)
          .filter(([k]) => k.startsWith('bubble_') || k.startsWith('common_'))
          .map(([k, v]) => [k, { message: v.message, ...(v.placeholders ? { placeholders: v.placeholders } : {}) }]),
      );
      return { ok: true, locale: uiLanguage, messages };
    },
    async 'disable-site'(msg) {
      const s = await loadShared();
      const cur = await s.getSettings();
      return { ok: true, settings: await s.saveSettings({ disabledSites: [...cur.disabledSites, msg.hostname] }) };
    },
  };

  const sendMessage = (msg, maybeCb) => {
    const p = (async () => {
      log('sendMessage', msg);
      const handler = background[msg?.type];
      if (!handler) return undefined;
      try {
        return await handler(msg);
      } catch (e) {
        return { ok: false, error: { code: e.code || 'UNKNOWN', message: String(e.message || e) } };
      }
    })();
    if (typeof maybeCb === 'function') p.then(maybeCb);
    return p;
  };

  const noReceiver = () => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));

  /* ---------------- chrome ---------------- */
  const chromeMock = {
    runtime: {
      id: 'transpop-dev',
      lastError: undefined,
      getURL: (p) => EXT + String(p).replace(/^\//, ''),
      getManifest: () => manifest,
      sendMessage,
      onMessage: runtimeOnMessage,
      openOptionsPage: () => window.open(`${EXT}src/options/options.html`, '_blank'),
      getContexts: async () => [],
      onInstalled: makeEvent(),
      onStartup: makeEvent(),
    },
    storage: { sync: makeArea('sync'), local: makeArea('local'), session: makeArea('session'), onChanged },
    i18n: { getMessage, getUILanguage: () => LANG },
    tabs: {
      query: async () => [{ id: 1, windowId: 1, active: true, url: location.href }],
      create: async ({ url }) => {
        window.open(url.startsWith('chrome') ? 'about:blank' : url, '_blank');
        return { id: 2 };
      },
      sendMessage: noReceiver,
      getCurrent: async () => ({ id: 1 }),
      remove: async () => window.close(),
      update: async () => ({}),
    },
    windows: { create: async ({ url }) => window.open(url, '_blank', 'width=460,height=640') },
    commands: {
      getAll: async () =>
        Object.entries(manifest.commands || {}).map(([name, c]) => ({
          name,
          description: c.description ? getMessage(String(c.description).replace(/^__MSG_|__$/g, '')) : '',
          shortcut: c.suggested_key?.default || '',
        })),
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    contextMenus: { create: () => {}, removeAll: (cb) => cb && cb(), update: () => {}, onClicked: makeEvent() },
  };

  try {
    window.chrome = Object.assign(window.chrome || {}, chromeMock);
    if (window.chrome.runtime !== chromeMock.runtime) throw new Error('readonly');
  } catch {
    window.chrome = chromeMock;
  }
  log(`ready (lang=${LANG})`);
})();
