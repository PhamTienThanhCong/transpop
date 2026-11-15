/*
 * TransPop content script — in-page UI (file 5/7): floating trigger button + translation bubble.
 *
 * Host isolation: ONE <transpop-root> element appended to <html>, closed shadow root, `all: initial`,
 * max z-index, styles from styles.js. Built lazily on first use; re-attached if a SPA removes it.
 * Coordinates: everything is positioned `absolute` relative to the host, whose origin is measured
 * with getBoundingClientRect() — so the bubble scrolls with the document and stays correct even
 * when <html> is offset/positioned.
 * Security: remote/user text only ever goes through textContent / text nodes; example `<b>` tags
 * are rendered by util.splitBold() → <strong>; icons are built with createElementNS.
 * G.uiKit (end of file) shares the host, DOM helpers and result renderers with crop.js (image translation).
 */
(() => {
  'use strict';
  const G = globalThis.__transpopContent;
  if (!G || G.started) return;

  const U = G.util;
  const t = G.t;
  const XHTML = 'http://www.w3.org/1999/xhtml';

  /** Initially visible items before "Show more". */
  const LIMIT = Object.freeze({ dictGroups: 3, dictTerms: 8, alternatives: 6, defs: 3, examples: 2, synGroups: 2, synTerms: 8 });
  const TRIGGER_IDLE_MS = 6000;
  const REVEAL_DELAY_MS = 80; // cached results arrive before this → no skeleton flash
  const SETTINGS_WAIT_MS = 300;
  const TRANSLATE_TIMEOUT_MS = 20000;
  const EDGE = 8;

  /** Events from inside our UI that must not reach page listeners (shortcuts, focus traps, custom menus…). */
  const STOP_EVENTS = [
    'keydown', 'keyup', 'keypress', 'mousedown', 'pointerdown', 'click', 'dblclick', 'contextmenu',
    'wheel', 'input', 'selectstart', 'copy', 'cut', 'paste', 'focusin', 'focusout', 'touchstart',
  ];

  let host = null;
  let shadow = null;
  let root = null;
  let statusEl = null;
  let triggerEl = null;
  let bubbleEl = null;
  const els = {};

  let trigger = null; // { snap, timer }
  let session = null; // current bubble session
  let seq = 0;

  /** Other in-page UIs living in the same host (crop.js): "is something of yours visible?" predicates. */
  const activities = new Set();
  /** Called right before the selection bubble opens (other UIs close themselves). */
  const openHooks = new Set();
  const othersActive = () =>
    [...activities].some((fn) => {
      try {
        return !!fn();
      } catch {
        return false;
      }
    });

  let watching = false;
  let unwatch = [];
  let mo = null;
  let ro = null;
  let rafId = 0;
  let reattachCount = 0;

  const IS_MAC = /Mac|iPhone|iPad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                         */
  /* ------------------------------------------------------------------ */

  /** Tiny hyperscript. Strings become text nodes (never parsed as HTML). */
  function h(tag, attrs, ...children) {
    const el = document.createElementNS(XHTML, tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const v = attrs[key];
        if (v == null || v === false) continue;
        if (key === 'class') el.className = v;
        else if (key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2), v);
        else el.setAttribute(key, v === true ? '' : String(v));
      }
    }
    for (const c of children.flat(Infinity)) if (c != null && c !== false && c !== '') el.append(c);
    return el;
  }

  const icon = (name, size) => G.icons.icon(name, size);
  const strs = (arr) => (Array.isArray(arr) ? arr : []).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
  const sleep = (ms) => new Promise((resolve) => G.later(resolve, ms));
  const raf = (fn) => requestAnimationFrame(() => !G.dead && fn());

  function iconButton(name, label, onClick, small = false) {
    return h(
      'button',
      { class: small ? 'g-ib g-ib-sm' : 'g-ib', type: 'button', 'aria-label': label, title: label, onclick: onClick },
      icon(name, small ? 16 : 18),
    );
  }

  /** Text with whitelisted <b>…</b> → <strong>, everything else plain text. */
  function rich(str) {
    return U.splitBold(str).map((seg) => (seg.bold ? h('strong', null, seg.text) : document.createTextNode(seg.text)));
  }

  function viewport() {
    const de = document.documentElement;
    const quirks = document.compatMode !== 'CSS1Compat' && document.body;
    const w = (quirks ? document.body.clientWidth : de.clientWidth) || window.innerWidth;
    const hh = (quirks ? document.body.clientHeight : de.clientHeight) || window.innerHeight;
    return { width: Math.min(w, window.innerWidth || w), height: Math.min(hh, window.innerHeight || hh) };
  }

  function hostOrigin() {
    const r = host.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }
  const toHost = (r, o) => ({ left: r.left - o.x, top: r.top - o.y, right: r.right - o.x, bottom: r.bottom - o.y });
  const toView = (r, o) => ({ left: r.left + o.x, top: r.top + o.y, right: r.right + o.x, bottom: r.bottom + o.y });

  function keyLabel(key) {
    if (key === 'Alt') return IS_MAC ? '⌥ Option' : 'Alt';
    if (key === 'Control') return IS_MAC ? '⌃ Control' : 'Ctrl';
    if (key === 'Meta') return IS_MAC ? '⌘ Command' : 'Win';
    return 'Shift';
  }

  function announce(msg) {
    if (!statusEl) return;
    statusEl.textContent = '';
    if (msg) G.later(() => statusEl && (statusEl.textContent = msg), 40);
  }

  /* ------------------------------------------------------------------ */
  /* Host                                                                */
  /* ------------------------------------------------------------------ */

  function ensureHost() {
    if (G.dead) return false;
    const parent = document.documentElement;
    if (!parent || parent.namespaceURI !== XHTML) return false; // SVG/XML documents
    try {
      if (!host) build(parent);
      else if (host.parentNode !== parent) parent.appendChild(host);
      return true;
    } catch {
      return false;
    }
  }

  function build(parent) {
    host = document.createElementNS(XHTML, 'transpop-root');
    // Inline !important via CSSOM (not subject to CSP) — beats any page rule targeting us.
    const hs = host.style;
    hs.setProperty('all', 'initial', 'important');
    for (const [p, v] of [
      ['position', 'absolute'], ['top', '0'], ['left', '0'], ['width', '0'], ['height', '0'], ['display', 'block'],
      ['overflow', 'visible'], ['z-index', '2147483647'], ['pointer-events', 'none'],
    ]) {
      hs.setProperty(p, v, 'important');
    }
    shadow = host.attachShadow({ mode: 'closed' });
    parent.appendChild(host);

    const style = document.createElementNS(XHTML, 'style');
    style.textContent = G.CSS;
    shadow.appendChild(style);
    if (!style.sheet) {
      // Inline <style> refused by the page CSP → constructable stylesheet (CSSOM, never blocked).
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(G.CSS);
        shadow.adoptedStyleSheets = [sheet];
      } catch {
        /* ignore */
      }
    }

    root = h('div', { class: 'g-root', dir: G.uiDir(), 'data-theme': 'auto' });
    statusEl = h('div', { class: 'g-sr', role: 'status', 'aria-live': 'polite' });
    triggerEl = h('button', { class: 'g-trigger', type: 'button', hidden: true, 'aria-label': t('bubble_trigger_label') }, G.icons.logo());
    root.append(statusEl, triggerEl);
    shadow.appendChild(root);

    const stop = (e) => e.stopPropagation();
    for (const type of STOP_EVENTS) root.addEventListener(type, stop, { passive: true });

    triggerEl.addEventListener('mousedown', (e) => e.preventDefault()); // keep the page selection & focus
    triggerEl.addEventListener('click', openFromTrigger);
    triggerEl.addEventListener('mouseenter', () => trigger && G.cancel(trigger.timer));
    triggerEl.addEventListener('mouseleave', armTriggerTimer);
  }

  function applySettings() {
    if (!root) return;
    const st = G.settings || G.DEFAULT_SETTINGS;
    root.setAttribute('data-theme', st.theme === 'light' || st.theme === 'dark' ? st.theme : 'auto');
    const fs = U.clamp(Math.round(+st.fontSize || 14), G.LIMITS.FONT_SIZE_MIN, G.LIMITS.FONT_SIZE_MAX);
    root.style.setProperty('--g-fs', `${fs}px`);
    const label = t('bubble_trigger_label');
    triggerEl.setAttribute('aria-label', label);
    triggerEl.title = t('bubble_trigger_hint', [keyLabel(st.modifierKey)]) || label;
  }

  /* ------------------------------------------------------------------ */
  /* Watchers — only attached while something is visible                 */
  /* ------------------------------------------------------------------ */

  function startWatching() {
    if (watching) return;
    watching = true;
    reattachCount = 0;
    unwatch.push(G.listen(window, 'scroll', onScroll, { capture: true, passive: true }));
    unwatch.push(G.listen(window, 'resize', onResize, { passive: true }));
    unwatch.push(G.listen(document, 'selectionchange', onSelectionChange, { passive: true }));
    try {
      mo = new MutationObserver(onMutations);
      mo.observe(document.documentElement, { childList: true });
    } catch {
      mo = null;
    }
  }

  function stopWatching() {
    if (!watching) return;
    watching = false;
    for (const off of unwatch) off();
    unwatch = [];
    if (mo) mo.disconnect();
    mo = null;
    unobserveBubble();
  }

  function maybeStopWatching() {
    if (trigger || session) return;
    stopWatching();
    if (localeStale) G.later(resetIfStale, 0); // deferred: open() hides the trigger right before it builds the bubble
  }

  function observeBubble() {
    if (ro || !bubbleEl || typeof ResizeObserver !== 'function') return;
    ro = new ResizeObserver(schedulePosition); // deferred to rAF: no "ResizeObserver loop" errors on the page
    ro.observe(bubbleEl);
  }

  function unobserveBubble() {
    if (ro) ro.disconnect();
    ro = null;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function schedulePosition() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!G.dead) position();
    });
  }

  /** Hide the trigger when the page (or a container holding the selection) scrolls — not for unrelated carousels. */
  function onScroll(e) {
    if (!trigger) return;
    const target = e.target;
    const node = trigger.snap.node;
    const isPage = target === document || target === window || target === document.documentElement || target === document.body;
    if (isPage || !node || (target && typeof target.contains === 'function' && target.contains(node))) hideTrigger();
  }

  function onResize() {
    if (trigger) hideTrigger();
    schedulePosition();
  }

  function onSelectionChange() {
    if (!trigger) return;
    const field = trigger.snap.field;
    if (field) {
      let collapsed = true;
      try {
        collapsed = field.selectionStart === field.selectionEnd || G.deepActiveElement() !== field;
      } catch {
        /* ignore */
      }
      if (collapsed) hideTrigger();
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) hideTrigger();
  }

  function onMutations() {
    if (!host || host.isConnected || (!trigger && !session)) return;
    if (++reattachCount > 20) return; // don't fight a page forever
    try {
      document.documentElement.appendChild(host);
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Trigger button                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * @param {{text:string, rect?:object, line?:object, point?:{x:number,y:number}, upward?:boolean, field?:Element}} snap
   *        selection snapshot in viewport coordinates
   */
  function showTrigger(snap) {
    if (!ensureHost()) return;
    applySettings();
    const pos = U.placeTrigger({ point: snap.point, line: snap.line || snap.rect, upward: snap.upward }, viewport());
    const o = hostOrigin();
    if (trigger) G.cancel(trigger.timer);
    trigger = { snap, timer: 0 };
    triggerEl.style.setProperty('left', `${pos.left - o.x}px`);
    triggerEl.style.setProperty('top', `${pos.top - o.y}px`);
    triggerEl.classList.remove('is-visible');
    triggerEl.hidden = false;
    raf(() => trigger && triggerEl && triggerEl.classList.add('is-visible'));
    armTriggerTimer();
    startWatching();
  }

  function armTriggerTimer() {
    if (!trigger) return;
    G.cancel(trigger.timer);
    trigger.timer = G.later(hideTrigger, TRIGGER_IDLE_MS);
  }

  function hideTrigger() {
    if (!trigger) return;
    G.cancel(trigger.timer);
    trigger = null;
    if (triggerEl) {
      triggerEl.hidden = true;
      triggerEl.classList.remove('is-visible');
    }
    maybeStopWatching();
  }

  function openFromTrigger() {
    const tr = trigger;
    if (!tr) return;
    hideTrigger();
    open(tr.snap);
  }

  /* ------------------------------------------------------------------ */
  /* Bubble frame (built once)                                           */
  /* ------------------------------------------------------------------ */

  function buildBubble() {
    if (bubbleEl) return;
    els.speakSrc = iconButton('volume', t('bubble_listen_source'), (e) => {
      const s = session;
      if (s && s.result) speak(s, s.result.text || s.text, s.result.from, e.currentTarget);
    });
    els.src = h('div', { class: 'g-src is-clamped', dir: 'auto' });
    els.srcToggleLabel = h('span', null, t('bubble_expand_source'));
    els.srcToggle = h(
      'button',
      { class: 'g-src-toggle', type: 'button', hidden: true, 'aria-expanded': 'false', onclick: toggleSource },
      icon('chevron-down', 14),
      els.srcToggleLabel,
    );
    els.phon = h('div', { class: 'g-phon', dir: 'auto', hidden: true });
    els.star = iconButton('star', t('common_add_favorite'), toggleFavorite);
    els.star.setAttribute('aria-pressed', 'false');
    els.gear = iconButton('settings', t('common_settings'), () => G.send(G.MSG.OPEN_OPTIONS, {}).catch(() => {}));
    els.close = iconButton('x', t('common_close'), () => close());
    els.head = h(
      'div',
      { class: 'g-head' },
      els.speakSrc,
      (els.srcWrap = h('div', { class: 'g-src-wrap' }, (els.srcBody = h('div', { class: 'g-src-body' }, els.src, els.phon)), els.srcToggle)),
      h('div', { class: 'g-head-actions' }, els.star, els.gear, els.close),
    );
    els.head.addEventListener('pointerdown', onHeadPointerDown);

    els.from = h('span', { class: 'g-from' });
    els.to = h('select', { class: 'g-to', 'aria-label': t('bubble_translate_into'), title: t('bubble_translate_into') });
    els.to.addEventListener('change', onTargetChange);
    const arrow = icon('arrow-right', 14);
    arrow.setAttribute('class', 'g-arrow');
    els.langs = h('div', { class: 'g-langs' }, els.from, arrow, h('span', { class: 'g-select' }, els.to, icon('chevron-down', 14)));

    els.body = h('div', { class: 'g-body' });
    els.foot = h('div', { class: 'g-foot', hidden: true });

    bubbleEl = h(
      'div',
      { class: 'g-bubble', role: 'dialog', 'aria-label': t('bubble_dialog_label'), tabindex: '-1', hidden: true },
      els.head,
      els.langs,
      els.body,
      els.foot,
    );
    root.append(bubbleEl);
  }

  /** Fill a target-language <select> (once) and select `code` — also used by crop.js. */
  function fillTargetSelect(select, code) {
    if (!select.options.length) for (const o of G.lang.options()) select.append(h('option', { value: o.code }, o.name));
    if (!code) return;
    if (![...select.options].some((o) => o.value === code)) select.append(h('option', { value: code }, G.lang.name(code) || code));
    if (select.value !== code) select.value = code;
  }

  function setTargetValue(code) {
    fillTargetSelect(els.to, code);
  }

  /* ------------------------------------------------------------------ */
  /* Session lifecycle                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Open the bubble for a selection snapshot (viewport coordinates).
   * @param {{text:string, rect?:object|null, line?:object|null, point?:{x:number,y:number}|null}} snap
   * @param {{focus?: boolean}} [opts]  focus: move keyboard focus into the bubble (explicit keyboard command only)
   */
  function open(snap, { focus = false } = {}) {
    if (!snap || !snap.text || !ensureHost()) return;
    for (const fn of [...openHooks]) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    hideTrigger();
    buildBubble();
    if (session) {
      endSession();
      bubbleEl.hidden = true;
      bubbleEl.classList.remove('is-open', 'is-dragging');
    }

    const o = hostOrigin();
    const vp = viewport();
    let rect = snap.rect || null;
    // Very tall selections: anchor to the line under the cursor instead of the whole block.
    if (rect && snap.line && rect.bottom - rect.top > vp.height * 0.4) rect = snap.line;
    const anchorRect = rect || { left: vp.width / 2, right: vp.width / 2, top: 0, bottom: EDGE };

    const s = {
      id: ++seq,
      text: snap.text,
      to: null,
      result: null,
      error: null,
      loading: true,
      anchor: toHost(anchorRect, o),
      prefX: rect && snap.point ? snap.point.x - o.x : null,
      canReveal: false,
      revealed: false,
      revealTimer: 0,
      userMoved: false,
      expanded: false,
      srcExpanded: false,
      favorited: false,
      spoke: false,
      autoSpoke: false,
      req: 0,
      openedAt: performance.now(),
      opener: G.deepActiveElement(),
      wantsFocus: !!focus,
    };
    session = s;
    els.srcToggle.hidden = true;
    els.srcToggle.setAttribute('aria-expanded', 'false');
    els.srcToggleLabel.textContent = t('bubble_expand_source');
    startWatching();
    request(s);

    const settingsReady = G.getSettings().catch(() => null);
    Promise.race([settingsReady, sleep(SETTINGS_WAIT_MS)]).then(() => {
      if (session !== s) return;
      s.canReveal = true;
      applySettings();
      if (s.result || s.error) {
        render(s);
        reveal(s);
        maybeAutoSpeak(s);
        return;
      }
      const wait = Math.max(0, REVEAL_DELAY_MS - (performance.now() - s.openedAt));
      s.revealTimer = G.later(() => {
        if (session !== s || s.revealed) return;
        render(s);
        reveal(s);
      }, wait);
    });
  }

  /** Fire-and-forget translation request for a session (never leaks an unhandled rejection). */
  function request(s) {
    doRequest(s).catch(() => {});
  }

  async function doRequest(s) {
    const req = ++s.req;
    s.loading = true;
    s.error = null;
    const payload = { text: s.text, source: 'bubble' };
    if (s.to) payload.to = s.to;
    let result = null;
    let error = null;
    try {
      const res = await G.send(G.MSG.TRANSLATE, payload, { timeout: TRANSLATE_TIMEOUT_MS });
      result = res.result && typeof res.result === 'object' ? res.result : null;
      if (!result) error = 'UNKNOWN';
    } catch (err) {
      if (G.dead || (err && err.code === 'CONTEXT_INVALIDATED')) return;
      error = err && G.ERROR_CODES.includes(err.code) ? err.code : 'UNKNOWN';
    }
    if (session !== s || s.req !== req) return; // closed or superseded
    s.loading = false;
    s.result = result;
    s.error = error;
    if (!s.canReveal) return; // the settings wait in open() will render + reveal
    render(s);
    if (!s.revealed) {
      reveal(s); // announces + checks favorite
    } else if (result) {
      announce(typeof result.translation === 'string' ? result.translation : '');
      checkFavorite(s);
    }
    if (result) maybeAutoSpeak(s);
  }

  function reveal(s) {
    if (session !== s || s.revealed) return;
    s.revealed = true;
    G.cancel(s.revealTimer);
    bubbleEl.hidden = false;
    bubbleEl.classList.remove('is-open');
    updateSourceClamp(s);
    position();
    observeBubble();
    raf(() => session === s && bubbleEl.classList.add('is-open'));
    if (s.wantsFocus) {
      try {
        bubbleEl.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
    if (s.result) {
      announce(typeof s.result.translation === 'string' ? s.result.translation : '');
      checkFavorite(s);
    }
  }

  function endSession() {
    const s = session;
    if (!s) return;
    session = null;
    G.cancel(s.revealTimer);
    if (s.spoke) G.send(G.MSG.STOP_SPEAK, {}).catch(() => {});
  }

  function close() {
    const s = session;
    if (!s) return;
    const focusInside = !!host && document.activeElement === host;
    endSession();
    if (bubbleEl) {
      bubbleEl.hidden = true;
      bubbleEl.classList.remove('is-open', 'is-dragging');
      bubbleEl.style.removeProperty('max-height');
    }
    unobserveBubble();
    announce('');
    if (focusInside) {
      const op = s.opener;
      try {
        if (op && op !== host && op.isConnected && typeof op.focus === 'function') op.focus({ preventScroll: true });
        else if (shadow.activeElement) shadow.activeElement.blur();
      } catch {
        /* ignore */
      }
    }
    maybeStopWatching();
  }

  function dismiss() {
    hideTrigger();
    close();
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function formatPhonetic(p, srcText) {
    // Latin-script sources get a dictionary-style /…/; romanizations (pinyin, romaji…) stay bare.
    return /\p{Script=Latin}/u.test(srcText) && !/^[/[]/.test(p) ? `/${p}/` : p;
  }

  function render(s) {
    if (!bubbleEl || session !== s) return;
    const st = G.settings;
    const r = s.result;

    // Header
    const srcText = (r && typeof r.text === 'string' && r.text) || s.text;
    if (els.src.textContent !== srcText) els.src.textContent = srcText;
    if (r && r.from && r.from !== 'auto') els.src.setAttribute('lang', G.lang.bcp47(r.from));
    else els.src.removeAttribute('lang');
    els.src.classList.toggle('is-clamped', !s.srcExpanded);
    els.srcWrap.classList.toggle('is-expanded', !!s.srcExpanded);
    const phon = r && st.showPhonetic && typeof r.phonetic === 'string' ? r.phonetic.trim() : '';
    els.phon.hidden = !phon;
    els.phon.textContent = phon ? formatPhonetic(phon, srcText) : '';
    els.speakSrc.disabled = !r;
    els.star.disabled = !r;
    updateStar(s);

    // Language row
    const fromName = r && r.from && r.from !== 'auto' ? G.lang.name(r.from) || r.from : '';
    els.from.textContent = fromName || t('common_detect_language');
    if (fromName) els.from.title = t('common_detected_language', [fromName]) || fromName;
    else els.from.removeAttribute('title');
    setTargetValue((r && r.to) || s.to || st.targetLang || G.lang.uiTarget());

    // Body + footer
    renderBody(s);
    const provider = r && typeof r.provider === 'string' ? r.provider : '';
    els.foot.hidden = !provider;
    els.foot.textContent = provider ? t('common_powered_by_app') : '';
    bubbleEl.setAttribute('aria-busy', s.loading ? 'true' : 'false');

    if (s.revealed) {
      updateSourceClamp(s);
      schedulePosition();
    }
  }

  function renderBody(s) {
    const body = els.body;
    body.replaceChildren();
    body.classList.toggle('is-expanded', !!s.expanded);
    body.scrollTop = 0;
    if (s.error) {
      body.append(errorView(s));
      return;
    }
    const r = s.result;
    if (!r) {
      body.append(
        h(
          'div',
          { class: 'g-skel-wrap', 'aria-hidden': 'true' },
          h('div', { class: 'g-skel g-skel-lg' }),
          h('div', { class: 'g-skel g-skel-md' }),
          h('div', { class: 'g-skel g-skel-sm' }),
        ),
        h('span', { class: 'g-sr' }, t('common_translating')),
      );
      return;
    }

    body.append(
      ...resultViews(r, {
        body,
        expanded: !!s.expanded,
        speak: (text, lang, btn) => speak(s, text, lang, btn),
        onToggle: (expanded) => {
          s.expanded = expanded;
        },
        onLayout: schedulePosition,
      }),
    );
  }

  /**
   * The translation views for a TranslationResult: main translation (+ speak/copy) and the dictionary sections
   * allowed by the settings, plus a "Show more" button when something is collapsed. Shared with crop.js.
   * @param {object} r  TranslationResult
   * @param {{body: Element, expanded?: boolean, speak: (text: string, lang: string, btn: Element) => void,
   *   onToggle?: (expanded: boolean) => void, onLayout?: () => void}} ctx
   *   body: the `.g-body` container that gets `is-expanded` (CSS hides `.g-extra` items while it is collapsed)
   * @returns {Element[]}
   */
  function resultViews(r, ctx) {
    const st = G.settings;
    const flags = { truncated: false };
    const toLang = G.lang.bcp47(r.to) || null;
    const fromLang = r.from && r.from !== 'auto' ? G.lang.bcp47(r.from) : null;
    const out = [];
    const add = (el) => el && out.push(el);
    add(mainView(r, toLang, ctx));
    // Dictionary + alternatives follow `showDictionary`; definitions + synonyms (both monolingual,
    // source language) follow `showDefinitions`; examples follow `showExamples`.
    if (st.showDictionary) {
      add(posGridView('common_dictionary', r.dictionary, LIMIT.dictGroups, LIMIT.dictTerms, toLang, true, flags));
      add(alternativesView(r, toLang, flags));
    }
    if (st.showDefinitions) add(definitionsView(r, fromLang, flags));
    if (st.showExamples) add(examplesView(r, fromLang, flags));
    if (st.showDefinitions) add(posGridView('common_synonyms', r.synonyms, LIMIT.synGroups, LIMIT.synTerms, fromLang, false, flags));
    if (flags.truncated) add(moreButton(ctx));
    return out;
  }

  function mainView(r, lang, ctx) {
    const translation = typeof r.translation === 'string' ? r.translation : '';
    // Words / short phrases get a large, brand-colored headline; sentences stay at reading size.
    const isShort = translation.length > 0 && translation.length <= 40 && !/[\n.!?。！？]\s*\S/.test(translation);
    const tr = h('div', { class: isShort ? 'g-tr is-short' : 'g-tr', dir: 'auto', lang });
    if (translation) tr.textContent = translation;
    else tr.append(h('span', { class: 'g-empty' }, t('bubble_no_translation')));
    const parts = [tr];
    if (typeof r.translit === 'string' && r.translit.trim()) parts.push(h('div', { class: 'g-translit', dir: 'auto' }, r.translit.trim()));

    const speakBtn = iconButton('volume', t('bubble_listen_translation'), (e) => ctx.speak(translation, r.to, e.currentTarget), true);
    const copied = h('span', { class: 'g-copied', 'aria-hidden': 'true' }, t('common_copied'));
    const copyBtn = iconButton(
      'copy',
      t('bubble_copy_translation'),
      (e) => {
        copyText(translation, e.currentTarget, copied).catch(() => {});
      },
      true,
    );
    speakBtn.disabled = !translation;
    copyBtn.disabled = !translation;
    parts.push(h('div', { class: 'g-actions' }, speakBtn, copyBtn, copied));
    return h('div', { class: 'g-main' }, parts);
  }

  function section(titleKey, ...content) {
    return h('section', { class: 'g-sec' }, h('h3', { class: 'g-sec-title' }, t(titleKey)), content);
  }

  /** Dictionary / synonyms: "pos  term, term, term" rows in a 2-column grid. */
  function posGridView(titleKey, groupsRaw, maxGroups, maxTerms, lang, withReverse, flags) {
    const groups = (Array.isArray(groupsRaw) ? groupsRaw : []).filter((g) => g && strs(g.terms).length);
    if (!groups.length) return null;
    const grid = h('div', { class: 'g-grid' });
    groups.forEach((g, gi) => {
      const terms = strs(g.terms);
      const entries = withReverse && Array.isArray(g.entries) ? g.entries : [];
      const termsEl = h('div', { class: 'g-terms', dir: 'auto', lang });
      terms.forEach((term, ti) => {
        const entry = entries.find((e) => e && e.word === term);
        const reverse = entry ? strs(entry.reverse).slice(0, 10).join(', ') : '';
        const termEl = h('span', { class: 'g-term', title: reverse || null }, term);
        if (ti >= maxTerms) termsEl.append(h('span', { class: 'g-extra' }, ', ', termEl));
        else termsEl.append(ti ? ', ' : '', termEl);
      });
      if (terms.length > maxTerms) {
        flags.truncated = true;
        termsEl.append(h('span', { class: 'g-count g-collapsed-only' }, `+${terms.length - maxTerms}`));
      }
      const posEl = h('div', { class: 'g-pos' }, typeof g.pos === 'string' ? g.pos : '');
      if (gi >= maxGroups) {
        flags.truncated = true;
        posEl.classList.add('g-extra');
        termsEl.classList.add('g-extra');
      }
      grid.append(posEl, termsEl);
    });
    return section(titleKey, grid);
  }

  function alternativesView(r, lang, flags) {
    const main = typeof r.translation === 'string' ? r.translation.trim().toLowerCase() : '';
    const alts = [...new Set(strs(r.alternatives))].filter((a) => a.toLowerCase() !== main);
    if (!alts.length) return null;
    const chips = h('div', { class: 'g-chips', lang });
    alts.forEach((a, i) => chips.append(h('span', { class: i >= LIMIT.alternatives ? 'g-chip g-extra' : 'g-chip', dir: 'auto' }, a)));
    if (alts.length > LIMIT.alternatives) flags.truncated = true;
    return section('common_alternatives', chips);
  }

  function definitionsView(r, lang, flags) {
    const groups = (Array.isArray(r.definitions) ? r.definitions : [])
      .map((g) => ({ pos: g && typeof g.pos === 'string' ? g.pos : '', items: (g && Array.isArray(g.items) ? g.items : []).filter((i) => i && typeof i.definition === 'string' && i.definition.trim()) }))
      .filter((g) => g.items.length);
    if (!groups.length) return null;
    const wrap = h('div', { lang });
    let count = 0;
    for (const g of groups) {
      const groupEl = h('div', { class: count >= LIMIT.defs ? 'g-def-group g-extra' : 'g-def-group' });
      if (g.pos) groupEl.append(h('div', { class: 'g-pos' }, g.pos));
      const ol = h('ol', { class: 'g-defs' });
      for (const it of g.items) {
        const li = h('li', { class: count >= LIMIT.defs ? 'g-extra' : null, dir: 'auto' }, h('span', null, rich(it.definition.trim())));
        if (typeof it.example === 'string' && it.example.trim()) li.append(h('div', { class: 'g-def-ex' }, '“', rich(it.example.trim()), '”'));
        ol.append(li);
        count++;
      }
      groupEl.append(ol);
      wrap.append(groupEl);
    }
    if (count > LIMIT.defs) flags.truncated = true;
    return section('common_definitions', wrap);
  }

  function examplesView(r, lang, flags) {
    const examples = strs(r.examples);
    if (!examples.length) return null;
    const ul = h('ul', { class: 'g-examples', lang });
    examples.forEach((ex, i) => ul.append(h('li', { class: i >= LIMIT.examples ? 'g-extra' : null, dir: 'auto' }, rich(ex))));
    if (examples.length > LIMIT.examples) flags.truncated = true;
    return section('common_examples', ul);
  }

  function moreButton(ctx) {
    let expanded = !!ctx.expanded;
    const label = h('span', null, t(expanded ? 'common_show_less' : 'common_show_more'));
    const btn = h('button', { class: 'g-more', type: 'button', 'aria-expanded': String(expanded) }, label, icon(expanded ? 'chevron-up' : 'chevron-down', 14));
    btn.addEventListener('click', () => {
      expanded = !expanded;
      ctx.body.classList.toggle('is-expanded', expanded);
      btn.setAttribute('aria-expanded', String(expanded));
      label.textContent = t(expanded ? 'common_show_less' : 'common_show_more');
      btn.lastChild.replaceWith(icon(expanded ? 'chevron-up' : 'chevron-down', 14));
      if (ctx.onToggle) ctx.onToggle(expanded);
      if (ctx.onLayout) ctx.onLayout();
    });
    return btn;
  }

  function errorView(s) {
    const code = s.error || 'UNKNOWN';
    const msg = t(`common_error_${code}`) || t('common_error_UNKNOWN');
    const retryBtn = h('button', { class: 'g-btn', type: 'button' }, icon('refresh', 14), h('span', null, t('common_retry')));
    retryBtn.addEventListener('click', () => {
      if (session !== s) return;
      const hadFocus = shadow.activeElement === retryBtn;
      s.result = null;
      s.error = null;
      s.loading = true;
      render(s);
      if (hadFocus) bubbleEl.focus({ preventScroll: true });
      request(s);
    });
    return h('div', { class: 'g-error', role: 'alert' }, icon('alert', 20), h('div', null, h('p', { class: 'g-error-msg' }, msg), retryBtn));
  }

  function updateSourceClamp(s) {
    if (!bubbleEl || bubbleEl.hidden) return;
    if (s.srcExpanded) {
      els.srcToggle.hidden = false;
      return;
    }
    els.src.classList.add('is-clamped');
    els.srcWrap.classList.remove('is-expanded');
    const srcOverflows = els.src.scrollHeight > els.src.clientHeight + 1;
    // Long source → the phonetic collapses to a single line too (it is often longer than the text itself).
    els.srcWrap.classList.toggle('is-long', srcOverflows);
    const phonOverflows = !els.phon.hidden && els.phon.scrollHeight > els.phon.clientHeight + 1;
    els.srcToggle.hidden = !(srcOverflows || phonOverflows);
  }

  function toggleSource() {
    const s = session;
    if (!s) return;
    s.srcExpanded = !s.srcExpanded;
    els.src.classList.toggle('is-clamped', !s.srcExpanded);
    els.srcWrap.classList.toggle('is-expanded', s.srcExpanded);
    if (!s.srcExpanded) els.srcBody.scrollTop = 0;
    els.srcToggle.setAttribute('aria-expanded', String(s.srcExpanded));
    els.srcToggleLabel.textContent = t(s.srcExpanded ? 'bubble_collapse_source' : 'bubble_expand_source');
    schedulePosition();
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  function speak(s, text, lang, btn) {
    if (!text || session !== s) return;
    s.spoke = true;
    if (btn) btn.classList.add('is-speaking');
    const done = () => G.later(() => btn && btn.classList.remove('is-speaking'), 500);
    G.send(G.MSG.SPEAK, { text, lang: lang || 'auto' }).then(done, done);
  }

  function maybeAutoSpeak(s) {
    if (s.autoSpoke || !s.result || session !== s || !s.canReveal) return;
    s.autoSpoke = true; // only once per bubble (not again after changing the target language)
    const text = s.result.text || s.text;
    if (G.settings.autoSpeak && U.countWords(text) <= 3) speak(s, text, s.result.from, els.speakSrc);
  }

  function updateStar(s) {
    const on = !!s.favorited;
    els.star.classList.toggle('is-starred', on);
    els.star.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = t(on ? 'common_remove_favorite' : 'common_add_favorite');
    els.star.setAttribute('aria-label', label);
    els.star.title = label;
    if (els.star.dataset.on !== String(on)) {
      els.star.dataset.on = String(on);
      els.star.replaceChildren(icon(on ? 'star-filled' : 'star', 18));
    }
  }

  function checkFavorite(s) {
    const r = s.result;
    if (!r) return;
    G.send(G.MSG.CHECK_FAVORITE, { text: r.text || s.text, to: r.to }).then(
      (res) => {
        if (session !== s || s.result !== r) return;
        s.favorited = !!res.favorited;
        updateStar(s);
      },
      () => {},
    );
  }

  function toggleFavorite() {
    const s = session;
    const r = s && s.result;
    if (!r) return;
    const prev = s.favorited;
    s.favorited = !prev; // optimistic
    updateStar(s);
    G.send(G.MSG.TOGGLE_FAVORITE, { result: r }).then(
      (res) => {
        if (session !== s) return;
        s.favorited = !!res.favorited;
        updateStar(s);
      },
      () => {
        if (session !== s) return;
        s.favorited = prev;
        updateStar(s);
      },
    );
  }

  function onTargetChange() {
    const s = session;
    const to = els.to.value;
    if (!s || !to) return;
    if (s.result && s.result.to === to) return;
    s.to = to; // explicit target → no smart swap, this bubble only
    s.result = null;
    s.error = null;
    s.loading = true;
    s.favorited = false;
    render(s);
    request(s);
  }

  async function copyText(text, btn, label) {
    if (!text) return;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) ok = execCopy(text);
    if (!ok || !btn.isConnected) return;
    btn.replaceChildren(icon('check', 16));
    btn.classList.add('is-done');
    label.classList.add('is-visible');
    announce(t('common_copied'));
    G.later(() => {
      if (!btn.isConnected) return;
      btn.replaceChildren(icon('copy', 16));
      btn.classList.remove('is-done');
      label.classList.remove('is-visible');
    }, 1200);
  }

  /** Fallback for frames where the async Clipboard API is blocked by permissions policy. */
  function execCopy(text) {
    const active = shadow.activeElement;
    const ta = h('textarea', { class: 'g-clip', readonly: true, tabindex: '-1', 'aria-hidden': 'true' });
    ta.value = text;
    root.append(ta);
    let ok = false;
    try {
      ta.focus({ preventScroll: true });
      ta.select();
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    try {
      if (active) active.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    return ok;
  }

  /* ------------------------------------------------------------------ */
  /* Positioning & dragging                                              */
  /* ------------------------------------------------------------------ */

  function position() {
    const s = session;
    if (!s || !s.revealed || !bubbleEl || bubbleEl.hidden || !host) return;
    const o = hostOrigin();
    const vp = viewport();
    if (s.userMoved) {
      clampIntoView(o, vp);
      return;
    }
    bubbleEl.style.removeProperty('max-height');
    const size = { width: bubbleEl.offsetWidth, height: bubbleEl.offsetHeight };
    const p = U.placeBubble(toView(s.anchor, o), size, vp, {
      gap: EDGE,
      margin: EDGE,
      prefX: s.prefX != null ? s.prefX + o.x : undefined,
    });
    if (p.maxHeight != null) bubbleEl.style.setProperty('max-height', `${p.maxHeight}px`);
    bubbleEl.style.setProperty('left', `${p.left - o.x}px`);
    bubbleEl.style.setProperty('top', `${p.top - o.y}px`);
    if (bubbleEl.dataset.placement !== p.placement) bubbleEl.dataset.placement = p.placement;
  }

  function clampIntoView(o, vp) {
    const w = bubbleEl.offsetWidth;
    const hh = bubbleEl.offsetHeight;
    const left = U.clamp((parseFloat(bubbleEl.style.left) || 0) + o.x, EDGE, vp.width - EDGE - w);
    const top = U.clamp((parseFloat(bubbleEl.style.top) || 0) + o.y, EDGE, vp.height - EDGE - hh);
    bubbleEl.style.setProperty('left', `${left - o.x}px`);
    bubbleEl.style.setProperty('top', `${top - o.y}px`);
  }

  function onHeadPointerDown(e) {
    const s = session;
    if (!s) return;
    dragPanel(e, els.head, bubbleEl, {
      isActive: () => session === s,
      onStart: () => {
        s.userMoved = true;
      },
    });
  }

  /**
   * Drag a panel (bubble) by its header — shared with crop.js. Call from the handle's `pointerdown`.
   * Clicks on controls inside the handle are ignored; the panel stays inside the viewport.
   * @param {PointerEvent} e
   * @param {Element} handle
   * @param {HTMLElement} panel  absolutely positioned inside the host (style.left/top in host px)
   * @param {{isActive?: () => boolean, onStart?: () => void}} [opts]
   */
  function dragPanel(e, handle, panel, { isActive = () => true, onStart } = {}) {
    if (!panel || e.button !== 0 || !e.isPrimary) return;
    if (e.target && e.target.closest && e.target.closest('button, select, a, input, textarea')) return;
    e.preventDefault(); // inside our UI only: no text selection while dragging
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = parseFloat(panel.style.left) || 0;
    const startTop = parseFloat(panel.style.top) || 0;
    let moved = false;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const onMove = (ev) => {
      if (!isActive()) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!moved) {
        moved = true;
        if (onStart) onStart();
        panel.classList.add('is-dragging');
      }
      const o = hostOrigin();
      const vp = viewport();
      const left = U.clamp(startLeft + dx + o.x, EDGE, vp.width - EDGE - panel.offsetWidth);
      const top = U.clamp(startTop + dy + o.y, EDGE, vp.height - EDGE - panel.offsetHeight);
      panel.style.setProperty('left', `${left - o.x}px`);
      panel.style.setProperty('top', `${top - o.y}px`);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      panel.classList.remove('is-dragging');
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  /* ------------------------------------------------------------------ */
  /* Display language changed → rebuild the UI with the new strings      */
  /* ------------------------------------------------------------------ */

  let localeStale = false;

  /** Drop the built UI (strings, `dir`, language list are baked in at build time) once nothing is visible. */
  function resetIfStale() {
    if (!localeStale || trigger || session || othersActive()) return;
    localeStale = false;
    if (!host) return;
    stopWatching();
    try {
      host.remove();
    } catch {
      /* ignore */
    }
    host = shadow = root = statusEl = triggerEl = bubbleEl = null;
    for (const key of Object.keys(els)) delete els[key];
  }

  G.onUiLanguageChange(() => {
    if (!host) return; // nothing built yet — the next build uses the new strings
    localeStale = true;
    if (trigger || session || othersActive()) {
      applySettings(); // trigger labels now; the rest is rebuilt when the bubble closes
      if (session && session.canReveal) render(session);
      return;
    }
    resetIfStale();
  });

  /* ------------------------------------------------------------------ */
  /* Teardown & API                                                      */
  /* ------------------------------------------------------------------ */

  G.onCleanup(() => {
    stopWatching();
    session = null;
    trigger = null;
    try {
      if (host) host.remove();
    } catch {
      /* ignore */
    }
    host = shadow = root = statusEl = triggerEl = bubbleEl = null;
  });

  G.ui = {
    showTrigger,
    hideTrigger,
    openFromTrigger,
    open,
    close,
    dismiss,
    /** Is this node (typically a retargeted event target) our host? */
    isOurs: (node) => !!host && !!node && (node === host || (typeof node.nodeType === 'number' && host.contains(node))),
    triggerVisible: () => !!trigger,
    triggerText: () => (trigger ? trigger.snap.text : ''),
    bubbleVisible: () => !!session,
    bubbleText: () => (session ? (session.result && session.result.text) || session.text : ''),
    isActive: () => !!trigger || !!session,
    /** Re-apply theme/font size and re-render after a settings change. */
    refresh: () => {
      applySettings();
      if (session && session.canReveal) render(session);
    },
  };

  /** Building blocks for other in-page UIs sharing this host (crop.js). Getters: the host is rebuilt lazily. */
  G.uiKit = {
    h,
    icon,
    iconButton,
    ensureHost,
    root: () => root,
    shadow: () => shadow,
    host: () => host,
    viewport,
    hostOrigin,
    toHost,
    toView,
    applySettings,
    announce,
    copyText,
    resultViews,
    fillTargetSelect,
    dragPanel,
    EDGE,
    /** Register an "is your UI visible?" predicate (keeps the host alive across display-language changes). */
    registerActivity: (fn) => {
      activities.add(fn);
      return () => activities.delete(fn);
    },
    /** Run `fn` right before the selection bubble opens. */
    onBubbleOpen: (fn) => {
      openHooks.add(fn);
      return () => openHooks.delete(fn);
    },
    /** Another UI closed: finish a pending display-language rebuild once nothing is visible. */
    idle: () => {
      if (localeStale) G.later(resetIfStale, 0);
    },
  };
})();
