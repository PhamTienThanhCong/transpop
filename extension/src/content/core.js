/*
 * TransPop content script — core (file 1/7).
 *
 * Content scripts are CLASSIC scripts (no `import`). All TransPop content files share ONE namespace
 * object, `globalThis.__transpopContent` (the isolated world's global, invisible to the page).
 * Load order (manifest `content_scripts[0].js`):
 *   core.js → languages.js → styles.js → icons.js → bubble.js → crop.js → content.js
 *
 * This file: double-injection guard, duplicated constants, lifecycle (listener/timer registry +
 * teardown when the extension context is invalidated), messaging, i18n, and PURE helpers
 * (text validation, placement math, hostname matching, `<b>` splitting) that are unit-tested in
 * Node (tests/content/) — so nothing here may touch `window`/`document`/`chrome` at load time.
 */
(() => {
  'use strict';

  const KEY = '__transpopContent';
  const prev = globalThis[KEY];
  if (prev) {
    // Injected twice into the same isolated world. A healthy instance wins (later files see
    // `started` and bail out); an orphaned one (extension reloaded) is torn down and replaced.
    if (prev.started && typeof prev.isAlive === 'function' && prev.isAlive()) return;
    try {
      prev.destroy?.();
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Constants — keep in sync with src/shared/constants.js               */
  /* ------------------------------------------------------------------ */

  const MSG = Object.freeze({
    TRANSLATE: 'translate',
    SPEAK: 'speak',
    STOP_SPEAK: 'stop-speak',
    GET_SETTINGS: 'get-settings',
    OPEN_OPTIONS: 'open-options',
    TOGGLE_FAVORITE: 'toggle-favorite',
    CHECK_FAVORITE: 'check-favorite',
    SHOW_TRANSLATION: 'show-translation',
    GET_SELECTION: 'get-selection',
    PING: 'ping',
    GET_UI_MESSAGES: 'get-ui-messages',
    // image translation (ARCHITECTURE §11)
    START_CROP: 'start-crop',
    START_CAPTURE: 'start-capture',
    OCR_REGION: 'ocr-region',
  });

  const LIMITS = Object.freeze({
    MAX_SELECTION_LENGTH: 2000, // passive triggers ignore longer selections
    MAX_TEXT_LENGTH: 5000, // background hard limit (explicit requests may go up to this)
    FONT_SIZE_MIN: 12,
    FONT_SIZE_MAX: 20,
  });

  const ERROR_CODES = Object.freeze([
    'EMPTY', 'TOO_LONG', 'NETWORK', 'RATE_LIMITED', 'PROVIDER_ERROR', 'UNSUPPORTED_LANG', 'UNKNOWN',
    'CAPTURE_FAILED', 'OCR_FAILED', 'OCR_NO_TEXT',
  ]);

  /** Fallback used until (or if) `get-settings` answers. Mirrors DEFAULT_SETTINGS. */
  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    targetLang: null,
    secondaryLang: null,
    triggerMode: 'icon',
    modifierKey: 'Shift',
    doubleClickOnly: false,
    provider: 'google',
    showPhonetic: true,
    showDictionary: true,
    showDefinitions: true,
    showExamples: true,
    autoSpeak: false,
    speechRate: 1,
    theme: 'auto',
    fontSize: 14,
    disableInInputs: true,
    disabledSites: [],
    saveHistory: true,
    closeOnClickOutside: true,
    uiLanguage: 'auto',
    ocrLanguages: ['eng'],
  });

  const G = {
    started: false,
    dead: false,
    MSG,
    LIMITS,
    ERROR_CODES,
    DEFAULT_SETTINGS,
    /** Latest known settings (defaults until the background answers). */
    settings: { ...DEFAULT_SETTINGS },
    IS_TOP: (() => {
      try {
        return typeof window === 'undefined' || window.top === window;
      } catch {
        return false;
      }
    })(),
  };
  globalThis[KEY] = G;

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  const cleanups = new Set();
  const timers = new Set();

  /** addEventListener that is undone automatically on teardown. Returns an `off()` function. */
  G.listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    const off = () => target.removeEventListener(type, fn, opts);
    cleanups.add(off);
    return () => {
      cleanups.delete(off);
      off();
    };
  };

  /** Register a teardown callback. */
  G.onCleanup = (fn) => {
    cleanups.add(fn);
    return () => cleanups.delete(fn);
  };

  /** setTimeout that is cancelled on teardown and never fires after it. */
  G.later = (fn, ms = 0) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!G.dead) fn();
    }, ms);
    timers.add(id);
    return id;
  };
  G.cancel = (id) => {
    if (!id) return;
    clearTimeout(id);
    timers.delete(id);
  };

  /** Tear everything down quietly (extension reloaded/updated/uninstalled while the page is open). */
  G.destroy = () => {
    if (G.dead) return;
    G.dead = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (const fn of [...cleanups]) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    cleanups.clear();
  };

  /** True while the extension context is valid. */
  G.isAlive = () => {
    if (G.dead) return false;
    try {
      return !!(globalThis.chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  };

  /** Like isAlive(), but tears down when the context is gone. Call at the top of event handlers. */
  G.checkAlive = () => {
    if (G.isAlive()) return true;
    G.destroy();
    return false;
  };

  /* ------------------------------------------------------------------ */
  /* Messaging (envelope → value or rejected Error with .code)           */
  /* ------------------------------------------------------------------ */

  const INVALIDATED_RE = /context invalidated/i;

  function makeError(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
  }
  G.makeError = makeError;

  /**
   * Send a message to the background. Resolves with the whole envelope (`{ok:true, ...data}`) or
   * rejects with an Error whose `.code` is an ERROR_CODE or 'CONTEXT_INVALIDATED'. Never throws
   * synchronously; callers must attach a catch.
   */
  G.send = (type, payload = {}, { timeout = 0 } = {}) =>
    new Promise((resolve, reject) => {
      if (!G.checkAlive()) {
        reject(makeError('CONTEXT_INVALIDATED'));
        return;
      }
      let settled = false;
      let tid = 0;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (tid) clearTimeout(tid);
        fn(value);
      };
      if (timeout > 0) tid = setTimeout(() => finish(reject, makeError('UNKNOWN', 'Timed out')), timeout);
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (res) => {
          let lastError = null;
          try {
            lastError = chrome.runtime.lastError;
          } catch {
            /* ignore */
          }
          if (lastError) {
            if (INVALIDATED_RE.test(String(lastError.message)) || !G.isAlive()) {
              G.destroy();
              finish(reject, makeError('CONTEXT_INVALIDATED'));
            } else {
              finish(reject, makeError('UNKNOWN', lastError.message));
            }
            return;
          }
          if (!res || typeof res !== 'object') finish(reject, makeError('UNKNOWN', 'No response'));
          else if (res.ok === false) finish(reject, makeError(res.error?.code || 'UNKNOWN', res.error?.message));
          else finish(resolve, res);
        });
      } catch (err) {
        if (INVALIDATED_RE.test(String(err?.message)) || !G.isAlive()) {
          G.destroy();
          finish(reject, makeError('CONTEXT_INVALIDATED'));
        } else {
          finish(reject, makeError('UNKNOWN', String(err?.message || err)));
        }
      }
    });

  /* ------------------------------------------------------------------ */
  /* i18n                                                                */
  /* ------------------------------------------------------------------ */

  // Display language (docs/ARCHITECTURE.md §10): content.js asks the background for `get-ui-messages`
  // → { locale, messages } and hands it to G.setUiMessages(). `messages: null` ('auto') = plain chrome.i18n.
  let uiDict = null; // Map(lower-cased key → messages.json entry), null = follow the browser language
  let uiLocaleOverride = null; // e.g. 'vi' while uiDict is active
  const uiListeners = new Set();
  const NAMED_PLACEHOLDER_RE = /\$([A-Za-z0-9_@]+)\$/g;
  const RTL_UI_RE = /^(ar|ckb|dv|fa|he|iw|ps|sd|ug|ur|yi)(?:[-_]|$)/i;

  /**
   * Chrome's getMessage() substitution rules for one messages.json entry: `$name$` → placeholders[name].content
   * (case-insensitive), then `$1`…`$9` → subs (missing → ''), `$$` → `$`, other `$x` dropped.
   * KEEP IN SYNC with formatMessage() in src/shared/i18n.js (tests/shared/i18n.test.mjs compares the two).
   */
  function formatMessage(entry, subs) {
    const raw = typeof entry === 'string' ? entry : entry && typeof entry.message === 'string' ? entry.message : '';
    if (!raw) return '';
    const placeholders = {};
    if (entry && typeof entry === 'object' && entry.placeholders && typeof entry.placeholders === 'object') {
      for (const name of Object.keys(entry.placeholders)) {
        const ph = entry.placeholders[name];
        if (ph && typeof ph.content === 'string') placeholders[name.toLowerCase()] = ph.content;
      }
    }
    const message = raw.replace(NAMED_PLACEHOLDER_RE, (match, name) => placeholders[name.toLowerCase()] ?? match);
    const values = subs === undefined || subs === null ? [] : [].concat(subs).slice(0, 9).map(String);
    if (!message.includes('$')) return message;
    let out = '';
    for (let i = 0; i < message.length; i++) {
      const ch = message[i];
      if (ch !== '$') {
        out += ch;
        continue;
      }
      const next = message[++i];
      if (next === undefined) break;
      if (next === '$') {
        while (message[i] === '$') {
          out += '$';
          i++;
        }
        i--;
      } else if (next >= '1' && next <= '9') {
        out += values[next.charCodeAt(0) - 49] ?? '';
      }
    }
    return out;
  }
  G.formatMessage = formatMessage;

  /**
   * Message lookup: Display-language dictionary first, then chrome.i18n.getMessage; '' when missing / context gone.
   * Callers may keep a reference to G.t — it always reads the current dictionary.
   */
  G.t = (key, subs) => {
    if (uiDict && typeof key === 'string') {
      const entry = uiDict.get(key.toLowerCase());
      if (entry) return formatMessage(entry, subs);
    }
    try {
      return chrome.i18n.getMessage(key, subs) || '';
    } catch {
      return '';
    }
  };

  /**
   * Install the `get-ui-messages` answer: `messages` object (Chrome messages.json format) for an explicit display
   * language, or null to follow the browser. Listeners registered with G.onUiLanguageChange run when it changes.
   */
  G.setUiMessages = (locale, messages) => {
    const active = !!(locale && typeof locale === 'string' && messages && typeof messages === 'object');
    const nextLocale = active ? locale : null;
    if (nextLocale === uiLocaleOverride && !!uiDict === active) return;
    uiLocaleOverride = nextLocale;
    uiDict = null;
    if (active) {
      uiDict = new Map();
      for (const key of Object.keys(messages)) {
        const entry = messages[key];
        if (entry && typeof entry.message === 'string') uiDict.set(key.toLowerCase(), entry);
      }
    }
    for (const fn of [...uiListeners]) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  };

  /** Subscribe to display-language changes. Returns an unsubscribe function. */
  G.onUiLanguageChange = (fn) => {
    uiListeners.add(fn);
    return () => uiListeners.delete(fn);
  };

  /** Effective UI locale: the Display-language override, else the browser UI locale (e.g. "vi" or "en-US"). */
  G.uiLocale = () => {
    if (uiLocaleOverride) return uiLocaleOverride;
    try {
      const l = globalThis.chrome?.i18n?.getUILanguage?.();
      if (l) return l;
    } catch {
      /* ignore */
    }
    return (typeof navigator !== 'undefined' && navigator.language) || 'en';
  };

  /** Direction of the effective UI locale ('ltr' | 'rtl'). */
  G.uiDir = () => {
    if (uiLocaleOverride) return RTL_UI_RE.test(uiLocaleOverride) ? 'rtl' : 'ltr';
    return G.t('@@bidi_dir') === 'rtl' ? 'rtl' : 'ltr';
  };

  /** document.activeElement, descending into open shadow roots (web components). */
  G.deepActiveElement = () => {
    let el = document.activeElement;
    try {
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    } catch {
      /* ignore */
    }
    return el;
  };

  /* ------------------------------------------------------------------ */
  /* Pure helpers (unit-tested in tests/content/helpers.test.mjs)        */
  /* ------------------------------------------------------------------ */

  const U = {};
  G.util = U;

  /** Clamp v into [lo, hi]; when hi < lo, lo wins. */
  U.clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

  /**
   * Normalize selected text: drop zero-width/soft-hyphen chars, unify line breaks, collapse runs of
   * spaces inside lines, keep at most one blank line between paragraphs, trim.
   */
  U.cleanText = (raw) => {
    if (typeof raw !== 'string' || !raw) return '';
    return raw
      .replace(/[\u200B\uFEFF\u00AD]/g, '')
      .replace(/\r\n?|[\u2028\u2029]/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+$/i;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const LETTER_RE = /\p{L}/u;

  /** Is this (already cleaned) text worth translating from a passive trigger? */
  U.isTranslatable = (text, max = LIMITS.MAX_SELECTION_LENGTH) =>
    typeof text === 'string' &&
    text.length >= 1 &&
    text.length <= max &&
    LETTER_RE.test(text) &&
    !URL_RE.test(text) &&
    !EMAIL_RE.test(text);

  /** Case/whitespace-insensitive comparison of two texts. */
  U.squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  U.sameText = (a, b) => {
    const x = U.squash(a);
    return !!x && x === U.squash(b);
  };

  /** Number of words (Intl.Segmenter when available, so CJK text is counted sensibly). */
  let segmenter = null;
  U.countWords = (text) => {
    const s = String(text ?? '').trim();
    if (!s) return 0;
    try {
      segmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
      let n = 0;
      for (const seg of segmenter.segment(s)) if (seg.isWordLike) n++;
      return n;
    } catch {
      return s.split(/\s+/).length;
    }
  };

  /** Hostname normalization — mirrors normalizeHostname() in src/shared/storage.js. */
  U.normalizeHost = (input) => {
    if (!input || typeof input !== 'string') return '';
    let host = input
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme (origins from location.ancestorOrigins)
      .replace(/^[^@/]*@/, ''); // userinfo
    host = host.replace(/^\*\./, '').replace(/^www\./, '').split('/')[0].split(':')[0];
    return /^[a-z0-9.-]+$/.test(host) ? host : '';
  };

  /** True if any of `hostnames` equals a disabled site or is a subdomain of one. */
  U.isHostDisabled = (hostnames, disabledSites) => {
    const sites = (Array.isArray(disabledSites) ? disabledSites : []).map(U.normalizeHost).filter(Boolean);
    if (!sites.length) return false;
    return (hostnames || []).some((raw) => {
      const host = U.normalizeHost(raw);
      return !!host && sites.some((site) => host === site || host.endsWith(`.${site}`));
    });
  };

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' };

  /** Decode the handful of HTML entities providers emit. Result is plain text (use textContent). */
  U.decodeEntities = (s) =>
    String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });

  /**
   * Whitelist splitter for provider strings containing `<b>…</b>` (Google examples).
   * Returns [{ text, bold }] segments; every other tag is stripped. Never produces markup.
   */
  U.splitBold = (input) => {
    const out = [];
    let bold = false;
    for (const part of String(input ?? '').split(/(<\/?b\s*>)/i)) {
      if (/^<b\s*>$/i.test(part)) {
        bold = true;
        continue;
      }
      if (/^<\/b\s*>$/i.test(part)) {
        bold = false;
        continue;
      }
      const text = U.decodeEntities(part.replace(/<[^>]*>/g, ''));
      if (!text) continue;
      const last = out[out.length - 1];
      if (last && last.bold === bold) last.text += text;
      else out.push({ text, bold });
    }
    return out;
  };

  /** Plain {left, top, right, bottom, width, height} copy of a DOMRect-like object. */
  U.rect = (r) => {
    if (!r) return null;
    const left = +r.left || 0;
    const top = +r.top || 0;
    const right = r.right != null ? +r.right : left + (+r.width || 0);
    const bottom = r.bottom != null ? +r.bottom : top + (+r.height || 0);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };

  /** From a list of selection client rects, pick the line nearest to `y` (last line if y is null). */
  U.pickLineRect = (rects, y) => {
    const list = Array.from(rects || []).filter((r) => r && r.width > 0 && r.height > 0);
    if (!list.length) return null;
    if (y == null) return list[list.length - 1];
    let best = null;
    let bestDist = Infinity;
    for (const r of list) {
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < bestDist || (d === bestDist && best && r.bottom > best.bottom)) {
        best = r;
        bestDist = d;
      }
    }
    return best;
  };

  /**
   * Where to put the bubble (viewport coordinates).
   * @param {{left:number, top:number, right:number, bottom:number}} anchor  selection rect (may be off-screen)
   * @param {{width:number, height:number}} size  natural bubble size
   * @param {{width:number, height:number}} viewport
   * @param {{gap?:number, margin?:number, prefX?:number, minHeight?:number}} [opts]
   *        prefX: preferred horizontal centre (e.g. the mouse-up x)
   * @returns {{left:number, top:number, placement:'below'|'above'|'overlay', maxHeight:number|null}}
   */
  U.placeBubble = (anchor, size, viewport, { gap = 8, margin = 8, prefX, minHeight = 140 } = {}) => {
    const vw = viewport.width;
    const vh = viewport.height;
    const w = Math.min(size.width, Math.max(0, vw - margin * 2));
    const h = size.height;
    const cx = Number.isFinite(prefX) ? prefX : (anchor.left + anchor.right) / 2;
    const left = U.clamp(cx - w / 2, margin, vw - margin - w);

    const spaceBelow = vh - margin - (anchor.bottom + gap);
    const spaceAbove = anchor.top - gap - margin;
    let top;
    let placement;
    let maxHeight = null;

    if (h <= spaceBelow) {
      top = anchor.bottom + gap;
      placement = 'below';
    } else if (h <= spaceAbove) {
      top = anchor.top - gap - h;
      placement = 'above';
    } else if (Math.max(spaceBelow, spaceAbove) >= minHeight) {
      // Doesn't fit entirely on either side: use the roomier side and scroll inside.
      if (spaceBelow >= spaceAbove) {
        maxHeight = spaceBelow;
        top = anchor.bottom + gap;
        placement = 'below';
      } else {
        maxHeight = spaceAbove;
        top = anchor.top - gap - spaceAbove;
        placement = 'above';
      }
    } else {
      // Huge selection / tiny viewport: overlap the selection, but stay fully on-screen.
      maxHeight = Math.max(0, vh - margin * 2);
      const hh = Math.min(h, maxHeight);
      top = U.clamp(anchor.bottom + gap, margin, vh - margin - hh);
      placement = 'overlay';
    }

    const finalH = maxHeight == null ? h : Math.min(h, maxHeight);
    top = U.clamp(top, margin, vh - margin - finalH);
    return {
      left: Math.round(left),
      top: Math.round(top),
      placement,
      maxHeight: maxHeight == null ? null : Math.max(0, Math.floor(maxHeight)),
    };
  };

  /**
   * Where to put the floating trigger button (viewport coordinates, top-left corner).
   * Goes just below-right of the mouse-up point, under the selected line so it never covers the
   * selection; above the line when the drag went upwards or there is no room below; flips to the
   * left of the cursor at the right edge.
   * @param {{point?:{x:number,y:number}|null, line?:object|null, upward?:boolean}} at
   * @param {{width:number, height:number}} viewport
   */
  U.placeTrigger = ({ point = null, line = null, upward = false } = {}, viewport, { size = 30, gap = 6, margin = 4 } = {}) => {
    const vw = viewport.width;
    const vh = viewport.height;
    const px = point ? point.x : line ? line.right : vw / 2;
    let left = px + 6;
    if (left + size > vw - margin) left = px - 6 - size;

    const refTop = line ? line.top : point ? point.y - 8 : margin;
    const refBottom = line ? line.bottom : point ? point.y + 8 : margin;
    const below = refBottom + gap;
    const above = refTop - gap - size;
    let top = upward ? above : below;
    if (top + size > vh - margin) top = above;
    if (top < margin) top = below + size <= vh - margin ? below : margin;

    return {
      left: Math.round(U.clamp(left, margin, vw - margin - size)),
      top: Math.round(U.clamp(top, margin, vh - margin - size)),
    };
  };
})();
