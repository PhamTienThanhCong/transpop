/**
 * TransPop dev harness — a small fake `chrome.*` API so extension pages and the content script
 * can run in a normal browser tab served by scripts/dev-server.mjs. DEV ONLY (never packaged).
 *
 * - storage.{sync,local,session} → localStorage (+ onChanged, synced across tabs)
 * - i18n → loads /extension/_locales/<lang>/messages.json (lang: localStorage 'transpop-dev-lang', default 'vi')
 * - runtime.sendMessage → emulates the background service worker (translate via /__dev/translate)
 * - image translation (ARCHITECTURE §11): there is no captureVisibleTab here, so a "screenshot" is faked by drawing
 *   the page's same-origin <img> elements where they are (page TEXT is not in it — select over images). OCR runs the
 *   real engine (/extension/src/offscreen/ocr-engine.js) in the page, after the real crop (background/capture.js),
 *   with the real language resolution (background/image-translate.js → resolveOcrLanguages: `hints` from the content
 *   script → auto-detected languages first, `langsSource: 'user'` picks saved) and OCR_NO_TEXT `details`.
 *   Dev triggers: Alt+Shift+A (= the crop-translate command), Alt+right-click on an image (= "Translate text in
 *   image"), buttons with data-dev-crop="region|image|error|fallback" (dev/demo.html), window.__transpopDev.
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
      const [storage, constants, ocrLanguages] = await Promise.all([
        import(`${EXT}src/shared/storage.js`),
        import(`${EXT}src/shared/constants.js`),
        import(`${EXT}src/shared/ocr-languages.js`),
      ]);
      shared = { ...storage, ...constants, ...ocrLanguages };
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

  /* ---------------- image translation (dev stand-ins) ---------------- */
  let devCapture = null; // pseudo screenshot (data: URL) taken when a dev crop starts
  let ocrEngine = null;
  let captureModule = null;
  const loadOcr = () => (ocrEngine ||= import(`${EXT}src/offscreen/ocr-engine.js`));
  const loadCaptureModule = () => (captureModule ||= import(`${EXT}src/background/capture.js`));
  const devError = (code, message) => Object.assign(new Error(message || code), { code });

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Cannot load ${src}`));
      img.src = src;
    });

  /** "Screenshot" of the viewport at devicePixelRatio: white page + every visible same-origin <img> where it is. */
  function pseudoScreenshot() {
    const dpr = Number(localStorage.getItem('transpop-dev-dpr')) || window.devicePixelRatio || 1; // override to emulate Retina captures
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const img of document.images) {
      if (!img.complete || !img.naturalWidth) continue;
      const src = img.currentSrc || img.src;
      const sameOrigin = /^(data|blob):/.test(src) || new URL(src, location.href).origin === location.origin;
      const r = img.getBoundingClientRect();
      if (!sameOrigin || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
      ctx.drawImage(img, r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr);
    }
    return canvas.toDataURL('image/png');
  }

  /** For the capture page opened in its own window (no page to "screenshot"): the OCR fixtures stacked, 2×. */
  async function fixtureScreenshot() {
    const imgs = await Promise.all(['en-paragraph', 'zh-paragraph', 'vi-sentence', 'ja-line'].map((n) => loadImage(`/dev/fixtures/${n}.png`)));
    const k = 2;
    const pad = 40 * k;
    const width = Math.max(...imgs.map((i) => i.naturalWidth)) * k + pad * 2;
    const height = imgs.reduce((h, i) => h + i.naturalHeight * k + pad, pad);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    let y = pad;
    for (const img of imgs) {
      ctx.drawImage(img, pad, y, img.naturalWidth * k, img.naturalHeight * k);
      y += img.naturalHeight * k + pad;
    }
    return { dataUrl: canvas.toDataURL('image/png'), width, height };
  }

  /** Dispatch a message to this page's content script like chrome.tabs.sendMessage (frame 0) would. */
  function emitToContent(msg, timeout = 3000) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const results = runtimeOnMessage._emit(msg, { id: 'transpop-dev' }, done);
      if (!results.some((r) => r === true)) setTimeout(() => done(undefined), 0); // sync answers already arrived
      setTimeout(() => done(undefined), timeout);
    });
  }

  const openDevCapturePage = (query = 'id=dev') =>
    window.open(`${EXT}src/capture/capture.html?${query}`, '_blank', 'width=1100,height=760');

  /** Same flow as the service worker's startCapture(): prepare → "capture" → start-crop, else the capture page. */
  async function devStartCrop(mode = 'region', srcUrl = '', { error = null } = {}) {
    const ready = await emitToContent({ type: 'start-crop', prepare: true });
    if (!ready || !ready.ready) {
      openDevCapturePage(error ? `error=${error}` : 'id=dev'); // no content script on this page (popup, options…)
      return { ok: true };
    }
    if (error) {
      await emitToContent({ type: 'start-crop', mode, error });
      return { ok: false, error: { code: error, message: 'Simulated capture failure (dev)' } };
    }
    devCapture = pseudoScreenshot();
    const res = await emitToContent({ type: 'start-crop', mode, ...(srcUrl ? { srcUrl } : {}) });
    if (!res || !res.started) openDevCapturePage();
    return { ok: true };
  }

  /**
   * Same language resolution as the service worker (image-translate.js → resolveOcrLanguages): the user's pick
   * (`langsSource: 'user'`, saved when it differs), else the guess from `hints` + settings.ocrLanguages when
   * settings.ocrAutoDetect is on, else settings.ocrLanguages. Then the real OCR + the same post-processing
   * (finishOcrResult) and OCR_NO_TEXT `details` (noTextDetails).
   */
  async function devOcr(msg, image) {
    const s = await loadShared();
    const bg = await import(`${EXT}src/background/image-translate.js`);
    const resolved = bg.resolveOcrLanguages(msg, await s.getSettings());
    if (resolved.save) await s.saveSettings({ ocrLanguages: resolved.langs });
    log('ocr langs', resolved, 'hints', msg.hints);
    const { recognize } = await loadOcr();
    try {
      return { ok: true, ocr: bg.finishOcrResult(await recognize(await image(), resolved.langs), resolved) };
    } catch (e) {
      if (e && e.code === 'OCR_NO_TEXT') e.details = bg.noTextDetails(resolved);
      throw e;
    }
  }

  const background = {
    async 'start-capture'(msg) {
      return devStartCrop(msg.mode === 'image' ? 'image' : 'region', msg.srcUrl || '');
    },
    async 'ocr-region'(msg) {
      if (!devCapture) throw devError('CAPTURE_FAILED', 'No dev screenshot — start the crop with a dev trigger');
      const { cropForOcr } = await loadCaptureModule();
      const shot = devCapture;
      return devOcr(msg, () => cropForOcr(shot, msg.rect, msg.viewport));
    },
    async 'ocr-image'(msg) {
      return devOcr(msg, async () => msg.dataUrl);
    },
    async 'get-capture'() {
      if (devCapture) {
        const img = await loadImage(devCapture);
        return { ok: true, dataUrl: devCapture, width: img.naturalWidth, height: img.naturalHeight, tabTitle: document.title };
      }
      return { ok: true, ...(await fixtureScreenshot()), tabTitle: 'TransPop dev fixtures' };
    },
    async 'ocr-clear-cache'() {
      const { clearCache } = await loadOcr();
      await clearCache();
      return { ok: true };
    },
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
        return {
          ok: false,
          error: { code: e.code || 'UNKNOWN', message: String(e.message || e), ...(e && e.details ? { details: e.details } : {}) },
        };
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

  /* ---------------- dev triggers for image translation ---------------- */
  window.__transpopDev = { startCrop: devStartCrop, pseudoScreenshot };
  // Alt+Shift+A — stand-in for the crop-translate command.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyA') {
        e.preventDefault();
        devStartCrop('region');
      }
    },
    true,
  );
  // Alt+right-click on an image — stand-in for "Translate text in image". Bubble phase on document, so the content
  // script's capture-phase listener has already recorded the right-clicked element.
  document.addEventListener('contextmenu', (e) => {
    const img = e.altKey && e.target && e.target.closest && e.target.closest('img');
    if (!img) return;
    e.preventDefault();
    devStartCrop('image', img.currentSrc || img.src);
  });
  // <button data-dev-crop="region|image|error|fallback" [data-dev-src="…"]> (dev/demo.html)
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('[data-dev-crop]');
    if (!btn) return;
    const kind = btn.getAttribute('data-dev-crop');
    if (kind === 'image') devStartCrop('image', new URL(btn.getAttribute('data-dev-src') || '', location.href).href);
    else if (kind === 'error') devStartCrop('region', '', { error: 'CAPTURE_FAILED' });
    else if (kind === 'fallback') openDevCapturePage();
    else devStartCrop('region');
  });
  log(`ready (lang=${LANG})`);
})();
