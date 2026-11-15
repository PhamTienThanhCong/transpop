/*
 * TransPop content script — image translation UI (file 6/7, ARCHITECTURE §11): crop overlay + OCR results bubble.
 *
 * The background screenshots the visible tab FIRST, then sends `start-crop` to the top frame:
 *   mode 'region' → full-viewport dim overlay; the user drags a rectangle (Esc / right-click / ✕ cancels);
 *   mode 'image'  → the box of the right-clicked <img> (matching `srcUrl`) is used directly, no drag;
 *   `error`       → the capture failed: an error bubble with Retry;
 *   `prepare`     → (sent before the screenshot) hide every TransPop UI so it is never in the image.
 * The rectangle (CSS px, viewport-relative) goes back as `ocr-region` with `hints` (visible page text inside it, the
 * nearest `lang`, a page-text sample when the area has no text) so the background can guess the text language; the
 * recognized text is shown in an editable textarea and translated with the normal `translate` message (`from` = the
 * OCR language hint). "No text found" offers one-tap retries in other languages on the same screenshot.
 *
 * Everything lives in the bubble's closed shadow root (G.uiKit from bubble.js) and is rebuilt on every open.
 * Top frame only. The pure helpers (G.cropUtil) are unit-tested in tests/content/crop.test.mjs, so nothing here
 * touches window/document at load time. Recognized/translated text only ever goes through textContent / .value.
 */
(() => {
  'use strict';
  const G = globalThis.__transpopContent;
  if (!G || G.started) return;

  const U = G.util;
  const t = G.t;
  const MSG = G.MSG;

  /** [Tesseract code, Google-style code] — KEEP IN SYNC with OCR_LANGUAGES in src/shared/ocr-languages.js (tested). */
  const OCR_LANGUAGES = [
    ['eng', 'en'], ['vie', 'vi'], ['chi_sim', 'zh-CN'], ['chi_tra', 'zh-TW'], ['jpn', 'ja'], ['kor', 'ko'],
    ['fra', 'fr'], ['deu', 'de'], ['spa', 'es'], ['ita', 'it'], ['por', 'pt'], ['rus', 'ru'], ['ukr', 'uk'],
    ['pol', 'pl'], ['nld', 'nl'], ['tur', 'tr'], ['ara', 'ar'], ['heb', 'iw'], ['fas', 'fa'], ['hin', 'hi'],
    ['ben', 'bn'], ['tam', 'ta'], ['urd', 'ur'], ['tha', 'th'], ['ind', 'id'], ['msa', 'ms'], ['fil', 'tl'],
    ['khm', 'km'], ['lao', 'lo'], ['ell', 'el'], ['ces', 'cs'], ['slk', 'sk'], ['hun', 'hu'], ['ron', 'ro'],
    ['bul', 'bg'], ['swe', 'sv'], ['dan', 'da'], ['nor', 'no'], ['fin', 'fi'],
  ];
  const OCR_TO_LANG = new Map(OCR_LANGUAGES);
  const OCR_MAX = 3;
  const OCR_DEFAULT = Object.freeze(['eng']);

  const MIN_SIZE = 12; // smallest selectable area (CSS px, each side)
  const OCR_TIMEOUT_MS = 250000; // the background gives up after 240 s
  const TRANSLATE_TIMEOUT_MS = 20000;
  const SLOW_HINT_MS = 3000; // "first use downloads language data…" after this long
  const LOW_CONFIDENCE = 60; // Tesseract mean confidence (0..100) below which we suggest checking the text
  const CONTEXT_TARGET_MAX_AGE_MS = 60000;
  const RELANG_DEBOUNCE_MS = 700;
  const HINT_MAX = 1500; // chars of page text sent as `hints.text`
  const PAGE_SAMPLE_MAX = 500; // chars of `hints.pageText`
  const HINT_BUDGET_MS = 12; // stop walking the DOM after this long (typical: 1–3 ms)
  const HINT_MAX_NODES = 4000;
  const HINT_SKIP = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'select', 'option', 'iframe', 'frame', 'object', 'embed', 'canvas', 'video', 'audio', 'head']);
  /** Recovery chips after "no text found" — KEEP IN SYNC with OCR_RETRY_COMMON / OCR_RETRY_MAX (tested). */
  const RETRY_COMMON = ['eng', 'chi_sim', 'chi_tra', 'jpn', 'kor', 'vie', 'rus', 'tha', 'ara'];
  const RETRY_MAX = 6;
  const SCROLL_KEYS = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  const IS_MAC =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');

  /* ------------------------------------------------------------------ */
  /* Pure helpers (unit-tested)                                          */
  /* ------------------------------------------------------------------ */

  const CU = {};
  G.cropUtil = CU;
  CU.OCR_LANGUAGES = OCR_LANGUAGES;
  CU.MIN_SIZE = MIN_SIZE;

  const num = (v) => (Number.isFinite(+v) ? +v : 0);

  /** Known Tesseract codes, unique, at most 3, in order; falls back to ['eng'] (mirrors normalizeOcrLanguages). */
  CU.normalizeOcrLangs = (list) => {
    const out = [];
    for (const code of Array.isArray(list) ? list : []) {
      if (out.length >= OCR_MAX) break;
      if (OCR_TO_LANG.has(code) && !out.includes(code)) out.push(code);
    }
    return out.length ? out : [...OCR_DEFAULT];
  };

  /** Tesseract code → Google-style code ('jpn' → 'ja'), null if unknown. */
  CU.ocrToLang = (code) => OCR_TO_LANG.get(code) || null;

  /** Rectangle spanned by two points, whatever the drag direction. */
  CU.dragRect = (a, b) => {
    const x0 = num(a && a.x);
    const y0 = num(a && a.y);
    const x1 = num(b && b.x);
    const y1 = num(b && b.y);
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
  };

  /** Clamp a rect ({x, y, width, height}, negative sizes allowed) to [0, vp.width] × [0, vp.height]; null if empty. */
  CU.clampRect = (rect, vp) => {
    if (!rect || !vp) return null;
    let left = num(rect.x);
    let top = num(rect.y);
    let right = left + num(rect.width);
    let bottom = top + num(rect.height);
    if (right < left) [left, right] = [right, left];
    if (bottom < top) [top, bottom] = [bottom, top];
    const vw = Math.max(0, num(vp.width));
    const vh = Math.max(0, num(vp.height));
    left = U.clamp(left, 0, vw);
    right = U.clamp(right, 0, vw);
    top = U.clamp(top, 0, vh);
    bottom = U.clamp(bottom, 0, vh);
    if (right - left <= 0 || bottom - top <= 0) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  };

  CU.bigEnough = (rect, min = MIN_SIZE) => !!rect && rect.width >= min && rect.height >= min;

  /** DOMRect-like {left, top, right, bottom} → {x, y, width, height}. */
  CU.fromClientRect = (r) => (r ? { x: num(r.left), y: num(r.top), width: num(r.right) - num(r.left), height: num(r.bottom) - num(r.top) } : null);

  /**
   * Geometry for `ocr-region`: the rect + viewport in CSS px as captureVisibleTab saw them. Normally the rect is
   * unchanged and viewport = innerWidth × innerHeight (the background derives the device-pixel ratio from the image
   * width, which covers both devicePixelRatio and page zoom). With pinch-zoom the screenshot only shows the visual
   * viewport, so the rect is shifted by its offset and scaled by its scale.
   * @param {{x:number, y:number, width:number, height:number}} rect  viewport-relative CSS px
   * @param {{innerWidth:number, innerHeight:number, vv?: {scale:number, offsetLeft:number, offsetTop:number}|null}} view
   */
  CU.toCaptureGeometry = (rect, view) => {
    let x = num(rect && rect.x);
    let y = num(rect && rect.y);
    let width = num(rect && rect.width);
    let height = num(rect && rect.height);
    const vv = view && view.vv;
    const scale = vv && num(vv.scale) > 1.001 ? num(vv.scale) : 1;
    if (scale !== 1) {
      x = (x - num(vv.offsetLeft)) * scale;
      y = (y - num(vv.offsetTop)) * scale;
      width *= scale;
      height *= scale;
    }
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      rect: { x: r2(x), y: r2(y), width: r2(width), height: r2(height) },
      viewport: { width: num(view && view.innerWidth), height: num(view && view.innerHeight) },
    };
  };

  /** Does an image candidate ({src, currentSrc}) show `srcUrl` (the context menu's info.srcUrl)? */
  CU.imageMatches = (img, srcUrl) => {
    if (!img || !srcUrl) return false;
    const want = String(srcUrl);
    for (const v of [img.currentSrc, img.src]) {
      if (!v) continue;
      if (v === want) return true;
      try {
        if (decodeURI(v) === decodeURI(want)) return true;
      } catch {
        /* malformed URI */
      }
    }
    return false;
  };

  /** Visible area (px²) of a client rect {left, top, right, bottom} inside the viewport. */
  CU.visibleArea = (r, vp) => {
    if (!r || !vp) return 0;
    const w = Math.min(num(r.right), num(vp.width)) - Math.max(num(r.left), 0);
    const h = Math.min(num(r.bottom), num(vp.height)) - Math.max(num(r.top), 0);
    return w > 0 && h > 0 ? w * h : 0;
  };

  /**
   * Which image did the user right-click? Candidates: {node, src, currentSrc, rect: {left, top, right, bottom}}.
   *  1. the last right-clicked <img>, when it shows `srcUrl` (or no srcUrl is known);
   *  2. else the most visible image showing `srcUrl`;
   *  3. else the last right-clicked <img> anyway (srcset / redirect differences).
   * Images outside the viewport are never picked.
   */
  CU.pickImage = ({ target = null, images = [], srcUrl = '', viewport } = {}) => {
    const visible = (c) => !!c && CU.visibleArea(c.rect, viewport) > 0;
    if (visible(target) && (!srcUrl || CU.imageMatches(target, srcUrl))) return target;
    let best = null;
    let bestArea = 0;
    if (srcUrl) {
      for (const c of images || []) {
        if (!c || !CU.imageMatches(c, srcUrl)) continue;
        const area = CU.visibleArea(c.rect, viewport);
        if (area > bestArea) {
          best = c;
          bestArea = area;
        }
      }
    }
    if (best) return best;
    return visible(target) ? target : null;
  };

  /** Size label of the selection, e.g. "320 × 48". */
  CU.sizeLabel = (rect) => `${Math.round(num(rect && rect.width))} × ${Math.round(num(rect && rect.height))}`;

  /** Collapse whitespace; '' for anything but a string. */
  CU.cleanText = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

  /** Do two {left, top, right, bottom} rects overlap with a positive area? */
  CU.intersects = (a, b) =>
    !!a && !!b && num(a.left) < num(b.right) && num(a.right) > num(b.left) && num(a.top) < num(b.bottom) && num(a.bottom) > num(b.top);

  /** Text accumulator capped at `max` chars: add(s) returns false once full; text() joins with spaces. */
  CU.textBag = (max) => {
    const parts = [];
    let len = 0;
    return {
      add(value) {
        const v = CU.cleanText(value);
        if (len >= max) return false;
        if (v) {
          const piece = v.slice(0, max - len);
          parts.push(piece);
          len += piece.length + 1;
        }
        return len < max;
      },
      text: () => parts.join(' ').slice(0, max),
    };
  };

  /** A `lang` attribute worth sending ("zh-Hant-TW", "pt_BR"); '' when empty or malformed. */
  CU.cleanLang = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{1,8})*$/.test(s) && s.length <= 35 ? s : '';
  };

  CU.RETRY_COMMON = RETRY_COMMON;
  /**
   * Quick-retry chips after "no text found": guessed languages not tried yet, then RETRY_COMMON minus the tried ones.
   * Mirrors suggestRetryLanguages() in src/shared/ocr-languages.js (tested).
   */
  CU.retryLangs = ({ tried = [], guessed = [], max = RETRY_MAX } = {}) => {
    const skip = new Set(Array.isArray(tried) ? tried : []);
    const out = [];
    for (const code of [...(Array.isArray(guessed) ? guessed : []), ...RETRY_COMMON]) {
      if (out.length >= max) break;
      if (OCR_TO_LANG.has(code) && !skip.has(code) && !out.includes(code)) out.push(code);
    }
    return out;
  };

  /** Error code → one of ours ('UNKNOWN' becomes `fallback`). */
  CU.errorCode = (err, fallback = 'UNKNOWN') => {
    const code = err && typeof err.code === 'string' ? err.code : '';
    return code && code !== 'UNKNOWN' && G.ERROR_CODES.includes(code) ? code : fallback;
  };

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  const kit = () => G.uiKit;
  let overlay = null; // region-selection overlay (one at a time)
  let res = null; // results session (one at a time)
  let langs = [...OCR_DEFAULT]; // OCR languages shown in the pickers (settings.ocrLanguages unless changed)
  let langsTouched = false; // changed by the user since the last start() → sent with ocr-region (and saved by the SW)
  let seq = 0;
  let mo = null;
  let ro = null;
  let rafId = 0;
  let reattachCount = 0;
  let unwatch = [];

  const vpSize = () => ({ width: window.innerWidth, height: window.innerHeight });

  function viewInfo() {
    const vv = window.visualViewport;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      vv: vv ? { scale: vv.scale, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop } : null,
    };
  }

  const langName = (ocrCode) => G.lang.name(CU.ocrToLang(ocrCode) || '') || ocrCode;
  /** The language's own name ("简体中文", "日本語") — readable even when the UI language isn't. */
  const endonym = (ocrCode) => {
    const lang = CU.ocrToLang(ocrCode) || '';
    return (lang && G.lang.name(lang, G.lang.bcp47(lang))) || langName(ocrCode);
  };
  /** "English, Japanese and Korean" in the UI language. */
  function listNames(codes) {
    const names = codes.map(langName);
    try {
      return new Intl.ListFormat(G.uiLocale(), { style: 'long', type: 'conjunction' }).format(names);
    } catch {
      return names.join(', ');
    }
  }
  /** Is the text language guessed automatically for the next request (setting on, chips untouched)? */
  const autoOn = () => G.settings.ocrAutoDetect !== false && !langsTouched;

  let optionsCache = null;
  /** OCR languages [{code, name}] sorted by localized name (cached per UI locale). */
  function ocrOptions() {
    const locale = G.uiLocale();
    if (optionsCache && optionsCache.locale === locale) return optionsCache.list;
    let collator;
    try {
      collator = new Intl.Collator(locale);
    } catch {
      collator = new Intl.Collator('en');
    }
    const list = OCR_LANGUAGES.map(([code]) => ({ code, name: langName(code) })).sort((a, b) => collator.compare(a.name, b.name));
    optionsCache = { locale, list };
    return list;
  }

  /* ------------------------------------------------------------------ */
  /* Host watching (only while something is shown)                       */
  /* ------------------------------------------------------------------ */

  function watch() {
    if (unwatch.length) return;
    reattachCount = 0;
    unwatch.push(G.listen(window, 'resize', onWindowResize, { passive: true }));
    try {
      mo = new MutationObserver(() => {
        const host = kit().host();
        if (!host || host.isConnected || ++reattachCount > 20) return; // a SPA wiped <html> children
        kit().ensureHost();
      });
      mo.observe(document.documentElement, { childList: true });
    } catch {
      mo = null;
    }
  }

  function unwatchAll() {
    for (const off of unwatch) off();
    unwatch = [];
    if (mo) mo.disconnect();
    mo = null;
    if (ro) ro.disconnect();
    ro = null;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function afterClose() {
    if (overlay || res) return;
    unwatchAll();
    if (kit()) kit().idle();
  }

  function onWindowResize() {
    if (overlay && (window.innerWidth !== overlay.vw || window.innerHeight !== overlay.vh)) {
      cancel(); // the screenshot no longer matches the page
      return;
    }
    schedulePosition();
  }

  /** Focus was inside our UI (the host is document.activeElement) → give it back to where it came from. */
  function restoreFocus(opener) {
    const k = kit();
    const host = k && k.host();
    if (!host || document.activeElement !== host) return;
    try {
      if (opener && opener !== host && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
      else if (k.shadow() && k.shadow().activeElement) k.shadow().activeElement.blur();
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ */
  /* OCR language picker (chips + "add" select)                          */
  /* ------------------------------------------------------------------ */

  /**
   * @param {string[]} initial  Tesseract codes
   * @param {(list: string[]) => void} onChange  called after a user change
   * @param {{auto?: boolean}} [opts]  auto: show the "Auto" pill (the text language is also guessed from the page)
   * @returns {{el: HTMLElement, render: (list: string[]) => void, setAuto: (on: boolean) => void}}
   */
  function buildPicker(initial, onChange, { auto: autoInitial = false } = {}) {
    const { h, icon } = kit();
    const label = t('bubble_crop_langs_label');
    const el = h('div', { class: 'g-ocr-langs', role: 'group', 'aria-label': label, title: label });
    let current = CU.normalizeOcrLangs(initial);
    let auto = !!autoInitial;

    function paint(keepFocus) {
      const shadow = kit().shadow();
      const hadFocus = keepFocus && shadow && el.contains(shadow.activeElement);
      const nodes = [icon('languages', 16)];
      if (auto) nodes.push(h('span', { class: 'g-lauto', title: t('bubble_crop_auto_title') }, t('bubble_crop_auto')));
      const several = current.length > 1;
      for (const code of current) {
        const name = langName(code);
        const chip = h('span', { class: several ? 'g-lchip' : 'g-lchip is-single', lang: G.lang.bcp47(CU.ocrToLang(code)) || null }, name);
        if (several) {
          const removeLabel = t('bubble_crop_lang_remove', [name]);
          const x = h('button', { class: 'g-lchip-x', type: 'button', 'aria-label': removeLabel, title: removeLabel }, icon('x', 12));
          x.addEventListener('click', () => set(current.filter((c) => c !== code)));
          chip.append(x);
        }
        nodes.push(chip);
      }
      if (current.length < OCR_MAX) {
        const addLabel = t('bubble_crop_lang_add');
        const sel = h('select', { class: 'g-ladd', 'aria-label': addLabel, title: addLabel });
        sel.append(h('option', { value: '', selected: true, hidden: true }, '+'));
        for (const o of ocrOptions()) if (!current.includes(o.code)) sel.append(h('option', { value: o.code }, o.name));
        sel.addEventListener('change', () => {
          if (sel.value) set([...current, sel.value]);
        });
        nodes.push(sel);
      }
      el.replaceChildren(...nodes);
      if (hadFocus) {
        const next = el.querySelector('.g-ladd') || el.querySelector('.g-lchip-x');
        try {
          if (next) next.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      }
    }

    function set(list) {
      const next = CU.normalizeOcrLangs(list);
      if (next.join('+') === current.join('+')) return;
      current = next;
      auto = false; // an explicit choice
      paint(true);
      onChange(current.slice());
    }

    paint(false);
    return {
      el,
      render: (list) => {
        current = CU.normalizeOcrLangs(list);
        paint(true);
      },
      setAuto: (on) => {
        if (auto === !!on) return;
        auto = !!on;
        paint(true);
      },
    };
  }

  /** Re-read the settings (the picker shows settings.ocrLanguages) and re-apply theme / font size. */
  function refreshSettings() {
    G.getSettings().then(
      (st) => {
        if (G.dead) return;
        if (kit()) kit().applySettings();
        if (langsTouched) return;
        if (overlay) overlay.picker.setAuto(autoOn());
        if (res && res.state === 'ocr') res.els.picker.setAuto(autoOn());
        const next = CU.normalizeOcrLangs(st.ocrLanguages);
        if (next.join('+') === langs.join('+')) return;
        langs = next;
        if (overlay) overlay.picker.render(langs);
        if (res && res.state === 'ocr') {
          res.langs = [...langs];
          res.els.picker.render(res.langs);
        }
      },
      () => {},
    );
  }

  /* ------------------------------------------------------------------ */
  /* Region selection overlay                                            */
  /* ------------------------------------------------------------------ */

  function startSelect({ imageMissing = false } = {}) {
    const k = kit();
    const { h } = k;
    const wrap = h('div', { class: 'g-crop', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('bubble_crop_overlay_label'), tabindex: '-1' });
    const size = h('span', { class: 'g-crop-size', 'aria-hidden': 'true' });
    const box = h('div', { class: 'g-crop-box', hidden: true }, size);
    const picker = buildPicker(
      langs,
      (list) => {
        langs = list;
        langsTouched = true;
      },
      { auto: autoOn() },
    );
    const hint = t(imageMissing ? 'bubble_crop_image_missing' : 'bubble_crop_hint');
    const fullBtn = k.iconButton('maximize', t('bubble_crop_full'), () => commitRect(CU.clampRect({ x: 0, y: 0, ...vpSize() }, vpSize())), true);
    const cancelBtn = k.iconButton('x', t('common_cancel'), () => cancel(), true);
    const bar = h(
      'div',
      { class: 'g-crop-bar' },
      h('span', { class: 'g-crop-brand' }, G.icons.logo({ unique: true }), h('span', { class: 'g-crop-hint' }, hint)),
      picker.el,
      h('span', { class: 'g-crop-actions' }, fullBtn, cancelBtn),
    );
    wrap.append(box, bar);
    k.root().append(wrap);
    overlay = { wrap, box, size, bar, picker, drag: null, opener: G.deepActiveElement(), vw: window.innerWidth, vh: window.innerHeight };

    wrap.addEventListener('pointerdown', onPointerDown);
    wrap.addEventListener('pointermove', onPointerMove);
    wrap.addEventListener('pointerup', onPointerUp);
    wrap.addEventListener('pointercancel', onPointerCancel);
    wrap.addEventListener('contextmenu', onOverlayContextMenu);
    wrap.addEventListener('wheel', stopScroll, { passive: false }); // our element only — the page is never blocked otherwise
    wrap.addEventListener('touchmove', stopScroll, { passive: false });
    wrap.addEventListener('keydown', onOverlayKeyDown);
    watch();
    try {
      wrap.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    k.announce(hint);
  }

  function stopScroll(e) {
    if (e.cancelable) e.preventDefault();
  }

  function onPointerDown(e) {
    const o = overlay;
    if (!o || o.bar.contains(e.target)) return; // toolbar controls work normally
    if (e.button !== 0) {
      e.preventDefault(); // no middle-click autoscroll; right-click cancels on `contextmenu`
      return;
    }
    if (!e.isPrimary) return;
    e.preventDefault(); // no text selection / focus change on the page; also suppresses page mousedown handlers
    try {
      o.wrap.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    try {
      o.wrap.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    o.drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
  }

  function onPointerMove(e) {
    const o = overlay;
    const d = o && o.drag;
    if (!d || e.pointerId !== d.id) return;
    const p = { x: e.clientX, y: e.clientY };
    if (!d.moved && Math.abs(p.x - d.x) + Math.abs(p.y - d.y) < 3) return;
    d.moved = true;
    drawBox(CU.clampRect(CU.dragRect(d, p), vpSize()));
  }

  function onPointerUp(e) {
    const o = overlay;
    const d = o && o.drag;
    if (!d || e.pointerId !== d.id) return;
    o.drag = null;
    try {
      o.wrap.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const rect = d.moved ? CU.clampRect(CU.dragRect(d, { x: e.clientX, y: e.clientY }), vpSize()) : null;
    if (CU.bigEnough(rect)) commitRect(rect);
    else drawBox(null); // a click or a tiny drag: keep waiting for a real selection
  }

  function onPointerCancel() {
    if (!overlay) return;
    overlay.drag = null;
    drawBox(null);
  }

  function onOverlayContextMenu(e) {
    e.preventDefault();
    cancel();
  }

  function drawBox(rect) {
    const o = overlay;
    if (!o) return;
    if (!rect) {
      o.box.hidden = true;
      o.wrap.classList.remove('is-dragging');
      return;
    }
    o.wrap.classList.add('is-dragging');
    o.box.hidden = false;
    const s = o.box.style;
    s.setProperty('left', `${rect.x}px`);
    s.setProperty('top', `${rect.y}px`);
    s.setProperty('width', `${rect.width}px`);
    s.setProperty('height', `${rect.height}px`);
    o.size.textContent = CU.sizeLabel(rect);
    o.size.classList.toggle('is-inside', rect.y + rect.height + 30 > window.innerHeight);
  }

  function onOverlayKeyDown(e) {
    const o = overlay;
    if (!o) return;
    if (e.key === 'Tab') {
      // Keep keyboard focus inside the overlay (it is modal): cycle through the toolbar controls.
      const items = [...o.bar.querySelectorAll('button, select')].filter((el) => !el.disabled);
      e.preventDefault();
      if (!items.length) return;
      const active = kit().shadow() ? kit().shadow().activeElement : null;
      const i = items.indexOf(active);
      const next = i < 0 ? (e.shiftKey ? items.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next].focus({ preventScroll: true });
      return;
    }
    const inControl = e.target && e.target.closest && e.target.closest('button, select');
    if (SCROLL_KEYS.has(e.key) && !inControl) e.preventDefault(); // no page scrolling under the overlay
  }

  function commitRect(rect, { flash = false, image = null } = {}) {
    if (!rect) return;
    const geometry = CU.toCaptureGeometry(rect, viewInfo());
    const opener = overlay ? overlay.opener : G.deepActiveElement();
    removeOverlay(false);
    const hints = collectHints(rect, image); // after the overlay is gone (the DOM is still as in the screenshot)
    openResults({ rect, geometry, opener, flash, hints });
  }

  function removeOverlay(restore) {
    const o = overlay;
    if (!o) return;
    overlay = null;
    try {
      o.wrap.remove();
    } catch {
      /* ignore */
    }
    if (restore) restoreFocus(o.opener);
    afterClose();
  }

  function cancel() {
    removeOverlay(true);
  }

  /* ------------------------------------------------------------------ */
  /* Image mode                                                          */
  /* ------------------------------------------------------------------ */

  /** The right-clicked image: {rect (viewport, clamped), node}, or null. */
  function findImage(srcUrl) {
    const vp = vpSize();
    const candidate = (img) => {
      try {
        const r = img.getBoundingClientRect();
        return { node: img, src: img.src || '', currentSrc: img.currentSrc || '', rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
      } catch {
        return null;
      }
    };
    const el = typeof G.lastContextTarget === 'function' ? G.lastContextTarget(CONTEXT_TARGET_MAX_AGE_MS) : null;
    const target = el && el.isConnected && String(el.localName).toLowerCase() === 'img' ? candidate(el) : null;
    let images = [];
    if (srcUrl && !(target && CU.imageMatches(target, srcUrl))) {
      try {
        images = Array.from(document.images).slice(0, 5000).map(candidate).filter(Boolean);
      } catch {
        images = [];
      }
    }
    const picked = CU.pickImage({ target, images, srcUrl, viewport: vp });
    if (!picked) return null;
    const rect = CU.clampRect(CU.fromClientRect(picked.rect), vp);
    return CU.bigEnough(rect, 4) ? { rect, node: picked.node || null } : null;
  }

  /* ------------------------------------------------------------------ */
  /* Language hints from the page (→ ocr-region `hints`)                 */
  /* ------------------------------------------------------------------ */

  const FILTER_ACCEPT = 1;
  const FILTER_REJECT = 2;
  const FILTER_SKIP = 3;
  const SHOW_ELEMENT = 0x1;
  const SHOW_TEXT = 0x4;

  /** Text node rendered visibly (not visibility:hidden / opacity:0)? Cached per parent element. */
  function visibleParent(el, cache) {
    if (!el) return false;
    if (cache.has(el)) return cache.get(el);
    let ok = true;
    try {
      if (typeof el.checkVisibility === 'function') {
        ok = el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true });
      }
    } catch {
      ok = true;
    }
    cache.set(el, ok);
    return ok;
  }

  /**
   * Visible text of the page inside `rect` (viewport CSS px) plus alt/title of images there, ≤ HINT_MAX chars.
   * Only descends into elements whose box intersects the rect (collapsed wrappers — e.g. around floats — and
   * display:contents are entered anyway); our own host, scripts, styles, form fields and hidden text are skipped.
   */
  function regionText(rect, image) {
    const bag = CU.textBag(HINT_MAX);
    if (image) {
      bag.add(image.getAttribute('alt'));
      bag.add(image.getAttribute('title'));
    }
    const root = document.body || document.documentElement;
    if (!root) return bag.text();
    const box = { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height };
    const host = kit() && kit().host();
    const started = performance.now();
    let visited = 0;
    const over = () => ++visited > HINT_MAX_NODES || performance.now() - started > HINT_BUDGET_MS;
    const walker = document.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === 3) return FILTER_ACCEPT;
        if (over() || node === host || HINT_SKIP.has(String(node.localName).toLowerCase())) return FILTER_REJECT;
        const r = node.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) {
          if (node.getClientRects().length) return FILTER_SKIP; // collapsed box (floats inside…): look inside
          try {
            return getComputedStyle(node).display === 'contents' ? FILTER_SKIP : FILTER_REJECT; // display:none
          } catch {
            return FILTER_REJECT;
          }
        }
        if (!CU.intersects(r, box)) return FILTER_REJECT;
        if (node !== image && String(node.localName).toLowerCase() === 'img') {
          bag.add(node.getAttribute('alt'));
          bag.add(node.getAttribute('title'));
        }
        return FILTER_SKIP; // walk its children, never return the element itself
      },
    });
    const range = document.createRange();
    const visible = new Map();
    let node;
    while ((node = walker.nextNode())) {
      if (over()) break;
      const value = node.nodeValue;
      if (!value || !value.trim()) continue;
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      let hit = false;
      for (let i = 0; i < rects.length && !hit; i++) hit = CU.intersects(rects[i], box);
      if (!hit || !visibleParent(node.parentElement, visible)) continue;
      if (!bag.add(value)) break;
    }
    return bag.text();
  }

  /** A short sample of the page's main text (script guess only, when the area itself has no text). */
  function pageSample() {
    const bag = CU.textBag(PAGE_SAMPLE_MAX);
    const root = document.querySelector('main, article, [role="main"]') || document.body;
    if (!root) return '';
    const host = kit() && kit().host();
    let visited = 0;
    const walker = document.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === 3) return FILTER_ACCEPT;
        return node === host || HINT_SKIP.has(String(node.localName).toLowerCase()) ? FILTER_REJECT : FILTER_SKIP;
      },
    });
    let node;
    while ((node = walker.nextNode()) && ++visited < 3000) if (!bag.add(node.nodeValue)) break;
    return bag.text();
  }

  /** Nearest `lang` at the area's center (`local`: set below <html>), else <html lang>. */
  function langAt(rect, image) {
    const host = kit() && kit().host();
    let el = image || null;
    if (!el) {
      try {
        for (const e of document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) {
          if (e !== host && !(host && host.contains(e))) {
            el = e;
            break;
          }
        }
      } catch {
        el = null;
      }
    }
    const root = document.documentElement;
    const owner = el && typeof el.closest === 'function' ? el.closest('[lang]:not([lang=""])') : null;
    const local = owner && owner !== root ? CU.cleanLang(owner.getAttribute('lang')) : '';
    return { pageLang: local || CU.cleanLang(root && root.getAttribute('lang')), local: !!local };
  }

  /**
   * `hints` for ocr-region: { text, pageLang, pageText? } (ARCHITECTURE §11). The page sample is added only when the
   * area has (almost) no text of its own and no element-level `lang` says otherwise. Never throws.
   */
  function collectHints(rect, image) {
    const hints = { text: '', pageLang: '' };
    if (!rect) return hints;
    const img = image && image.isConnected ? image : null;
    try {
      hints.text = regionText(rect, img);
    } catch {
      /* hints are optional */
    }
    try {
      const lang = langAt(rect, img);
      hints.pageLang = lang.pageLang;
      if (hints.text.length < 20 && !lang.local) {
        const sample = pageSample();
        if (sample) hints.pageText = sample;
      }
    } catch {
      /* hints are optional */
    }
    return hints;
  }

  /* ------------------------------------------------------------------ */
  /* Results bubble                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * @param {{rect?: object|null, geometry?: object|null, opener?: Element|null, flash?: boolean,
   *   error?: string|null, retry?: {mode: string, srcUrl?: string}|null, hints?: object|null}} opts
   *   rect/geometry: the selected region (viewport CSS px) → recognize it; hints: page text/lang around it;
   *   error: show a capture error (retry = how to start over)
   */
  function openResults({ rect = null, geometry = null, opener = null, flash = false, error = null, retry = null, hints = null }) {
    const k = kit();
    if (!k || !k.ensureHost()) return false;
    closeResults(false);
    const o = k.hostOrigin();
    const vp = k.viewport();
    const anchorRect = rect
      ? { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height }
      : { left: vp.width / 2, right: vp.width / 2, top: 0, bottom: k.EDGE };
    const s = {
      id: ++seq,
      rect,
      geometry,
      anchor: k.toHost(anchorRect, o),
      opener: opener || G.deepActiveElement(),
      state: error ? 'ocr-error' : 'ocr', // 'ocr' (recognizing) | 'ocr-error' | 'done'
      ocrError: error,
      retry,
      ocr: null,
      ocrReq: 0,
      hints,
      tried: [], // languages of the last attempt (shown in "no text found with …")
      guessed: [], // languages guessed from the page (background)
      autoDetected: false,
      recovering: false, // retrying from a "try another language" chip
      slow: false,
      slowTimer: 0,
      relangTimer: 0,
      langs: [...langs],
      text: '', // last translated text
      to: null, // explicit target language (this bubble only)
      result: null,
      trError: null,
      trLoading: false,
      trReq: 0,
      expanded: false,
      userMoved: false,
      spoke: false,
      els: {},
    };
    res = s;
    if (rect) {
      const mark = k.h('div', { class: flash ? 'g-crop-mark is-flash' : 'g-crop-mark', 'aria-hidden': 'true' });
      for (const [p, v] of [['left', s.anchor.left], ['top', s.anchor.top], ['width', rect.width], ['height', rect.height]]) {
        mark.style.setProperty(p, `${v}px`);
      }
      s.els.mark = mark;
      k.root().append(mark);
    }
    buildResults(s);
    s.els.bubble.hidden = false;
    watch();
    if (s.state === 'ocr') recognize(s);
    else {
      render(s);
      k.announce(t(`common_error_${s.ocrError}`) || t('common_error_UNKNOWN'));
    }
    position();
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(schedulePosition);
      ro.observe(s.els.bubble);
    }
    requestAnimationFrame(() => res === s && s.els.bubble.classList.add('is-open'));
    try {
      s.els.bubble.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    return true;
  }

  function buildResults(s) {
    const k = kit();
    const { h } = k;
    const e = s.els;
    e.again = k.iconButton('scan-text', t('bubble_crop_select_again'), () => selectAgain());
    e.gear = k.iconButton('settings', t('common_settings'), () => G.send(MSG.OPEN_OPTIONS, {}).catch(() => {}));
    e.close = k.iconButton('x', t('common_close'), () => closeResults(true));
    e.head = h(
      'div',
      { class: 'g-head g-ocr-head' },
      G.icons.logo({ unique: true }),
      h('div', { class: 'g-ocr-title' }, t('bubble_crop_title')),
      h('div', { class: 'g-head-actions' }, e.again, e.gear, e.close),
    );
    e.head.addEventListener('pointerdown', (ev) =>
      k.dragPanel(ev, e.head, e.bubble, {
        isActive: () => res === s,
        onStart: () => {
          s.userMoved = true;
        },
      }),
    );
    e.body = h('div', { class: 'g-body' });
    e.picker = buildPicker(s.langs, (list) => onResultLangs(s, list), { auto: !s.ocrError && autoOn() });
    e.powered = h('span', { class: 'g-ocr-powered' });
    e.foot = h('div', { class: 'g-foot g-ocr-foot' }, e.picker.el, e.powered);
    e.bubble = h('div', { class: 'g-bubble g-ocr', role: 'dialog', 'aria-label': t('bubble_crop_dialog_label'), tabindex: '-1', hidden: true }, e.head, e.body, e.foot);
    k.root().append(e.bubble);
  }

  const ocrLang = (s) => (s.ocr && (s.ocr.lang || (s.ocr.langs && s.ocr.langs.length === 1 ? CU.ocrToLang(s.ocr.langs[0]) : null))) || null;

  function render(s) {
    if (res !== s) return;
    const e = s.els;
    e.bubble.setAttribute('aria-busy', s.state === 'ocr' || s.trLoading ? 'true' : 'false');
    if (e.mark) e.mark.classList.toggle('is-busy', s.state === 'ocr');
    if (s.state === 'ocr') renderRecognizing(s);
    else if (s.state === 'ocr-error') renderOcrError(s);
    else renderDone(s);
    const provider = s.result && typeof s.result.provider === 'string' ? s.result.provider : '';
    e.powered.textContent = provider ? t('common_powered_by', [t(`common_provider_${provider}`) || provider]) : '';
    schedulePosition();
  }

  function renderRecognizing(s) {
    const { h } = kit();
    const e = s.els;
    e.srcFor = null;
    e.body.replaceChildren(
      h(
        'div',
        { class: 'g-ocr-status' },
        h('span', { class: 'g-spin', 'aria-hidden': 'true' }),
        h(
          'div',
          null,
          h('p', null, t('bubble_crop_recognizing')),
          s.recovering
            ? h('p', { class: 'g-ocr-slow' }, t('bubble_crop_downloading'))
            : s.slow
              ? h('p', { class: 'g-ocr-slow' }, t('bubble_crop_slow'))
              : null,
        ),
      ),
    );
  }

  function actionButton(iconName, labelKey, onClick) {
    const { h, icon } = kit();
    const btn = h('button', { class: 'g-btn', type: 'button' }, icon(iconName, 14), h('span', null, t(labelKey)));
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** "No text found with: English. Is the text in another language?" + one-tap language chips + More… + Select again. */
  function renderNoText(s) {
    const { h, icon } = kit();
    const e = s.els;
    const tried = s.tried.length ? s.tried : s.langs;
    const codes = CU.retryLangs({ tried, guessed: s.guessed });
    const chips = codes.map((code) => {
      const lang = CU.ocrToLang(code);
      const btn = h(
        'button',
        { class: 'g-rchip', type: 'button', lang: G.lang.bcp47(lang) || null, title: t('bubble_crop_try_lang', [langName(code)]) },
        endonym(code),
      );
      btn.addEventListener('click', () => retryWith(s, code));
      return btn;
    });
    const moreLabel = t('bubble_crop_more_langs_label');
    const more = h('select', { class: 'g-rmore', 'aria-label': moreLabel, title: moreLabel });
    more.append(h('option', { value: '', selected: true, hidden: true }, t('bubble_crop_more_langs')));
    for (const o of ocrOptions()) if (!tried.includes(o.code) && !codes.includes(o.code)) more.append(h('option', { value: o.code }, o.name));
    more.addEventListener('change', () => more.value && retryWith(s, more.value));
    e.body.replaceChildren(
      h(
        'div',
        { class: 'g-error g-no-text', role: 'alert' },
        icon('alert', 20),
        h(
          'div',
          null,
          h('p', { class: 'g-error-msg' }, t('bubble_crop_no_text_with', [listNames(tried)])),
          h('div', { class: 'g-retry-langs', role: 'group', 'aria-label': t('bubble_crop_try_label') }, ...chips, more),
          h('div', { class: 'g-error-actions' }, actionButton('scan-text', 'bubble_crop_select_again', () => selectAgain())),
        ),
      ),
    );
  }

  /** A recovery chip: OCR the same area again (same screenshot) with `[code, ...tried]` as the user's choice. */
  function retryWith(s, code) {
    if (res !== s || !s.geometry || !OCR_TO_LANG.has(code)) return;
    const list = CU.normalizeOcrLangs([code, ...(s.tried.length ? s.tried : s.langs)]);
    langs = list;
    langsTouched = true; // explicit → sent with langsSource 'user', remembered as the new default
    s.langs = list.slice();
    s.els.picker.render(s.langs);
    s.els.picker.setAuto(false);
    s.recovering = true;
    G.cancel(s.relangTimer);
    try {
      s.els.bubble.focus({ preventScroll: true }); // the chip is about to disappear
    } catch {
      /* ignore */
    }
    recognize(s);
  }

  function renderOcrError(s) {
    const { h, icon } = kit();
    const e = s.els;
    e.srcFor = null;
    const code = s.ocrError || 'UNKNOWN';
    if (code === 'OCR_NO_TEXT' && !s.retry && s.geometry) {
      renderNoText(s);
      return;
    }
    const actions = [];
    if (s.retry) {
      // The screenshot itself failed: start over (same trigger mode).
      actions.push(actionButton('refresh', 'common_retry', () => restartCapture(s.retry)));
    } else {
      // An expired screenshot or "no text" won't change by retrying the same request.
      if (code !== 'CAPTURE_FAILED' && code !== 'OCR_NO_TEXT') actions.push(actionButton('refresh', 'common_retry', () => recognize(s)));
      actions.push(actionButton('scan-text', 'bubble_crop_select_again', () => selectAgain()));
    }
    e.body.replaceChildren(
      h(
        'div',
        { class: 'g-error', role: 'alert' },
        icon('alert', 20),
        h('div', null, h('p', { class: 'g-error-msg' }, t(`common_error_${code}`) || t('common_error_UNKNOWN')), h('div', { class: 'g-error-actions' }, actions)),
      ),
    );
  }

  function autosize(ta) {
    if (!ta || !ta.isConnected) return;
    ta.style.setProperty('height', 'auto');
    const max = Math.max(60, Math.min(200, Math.round(window.innerHeight * 0.3)));
    ta.style.setProperty('height', `${Math.min(ta.scrollHeight + 2, max)}px`);
  }

  function buildSource(s) {
    const k = kit();
    const { h, icon } = k;
    const e = s.els;
    const lang = ocrLang(s);
    e.text = h('textarea', {
      class: 'g-ocr-text',
      dir: 'auto',
      rows: '1',
      spellcheck: 'false',
      'aria-label': t('bubble_crop_recognized_label'),
      lang: lang ? G.lang.bcp47(lang) : null,
    });
    e.text.value = s.ocr.text;
    e.text.addEventListener('input', () => {
      autosize(e.text);
      updateAgain(s);
      schedulePosition();
    });
    e.text.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        translateAgain(s);
      }
    });
    e.copiedSrc = h('span', { class: 'g-copied', 'aria-hidden': 'true' }, t('common_copied'));
    e.speakSrc = k.iconButton(
      'volume',
      t('bubble_crop_listen_text'),
      (ev) => speak(s, e.text.value.trim(), (s.result && s.result.from) || ocrLang(s), ev.currentTarget),
      true,
    );
    e.copySrc = k.iconButton(
      'copy',
      t('bubble_crop_copy_text'),
      (ev) => {
        k.copyText(e.text.value, ev.currentTarget, e.copiedSrc).catch(() => {});
      },
      true,
    );
    e.againTr = h(
      'button',
      { class: 'g-btn is-primary', type: 'button', title: t('bubble_crop_translate_again_hint', [IS_MAC ? '⌘ + Enter' : 'Ctrl + Enter']) },
      icon('refresh', 14),
      h('span', null, t('bubble_crop_translate_again')),
    );
    e.againTr.addEventListener('click', () => translateAgain(s));
    const lowConfidence = Number.isFinite(+s.ocr.confidence) && +s.ocr.confidence < LOW_CONFIDENCE;
    e.srcWrap = h(
      'div',
      { class: 'g-ocr-src' },
      h('div', { class: 'g-ocr-label', 'aria-hidden': 'true' }, t('bubble_crop_recognized_label')),
      e.text,
      lowConfidence ? h('p', { class: 'g-ocr-note' }, t('bubble_crop_low_confidence')) : null,
      h('div', { class: 'g-ocr-tools' }, e.speakSrc, e.copySrc, e.copiedSrc, e.againTr),
    );

    e.from = h('span', { class: 'g-from' });
    e.to = h('select', { class: 'g-to', 'aria-label': t('bubble_translate_into'), title: t('bubble_translate_into') });
    e.to.addEventListener('change', () => onTargetChange(s));
    const arrow = icon('arrow-right', 14);
    arrow.setAttribute('class', 'g-arrow');
    e.langs = h('div', { class: 'g-langs' }, e.from, arrow, h('span', { class: 'g-select' }, e.to, icon('chevron-down', 14)));
    e.out = h('div', { class: 'g-ocr-out' });
    e.body.replaceChildren(e.srcWrap, e.langs, e.out);
    e.body.scrollTop = 0;
    e.srcFor = s.ocr;
    autosize(e.text);
  }

  function renderDone(s) {
    const k = kit();
    const e = s.els;
    if (e.srcFor !== s.ocr) buildSource(s);
    const r = s.result;
    const fromCode = (r && r.from && r.from !== 'auto' && r.from) || ocrLang(s);
    const fromName = fromCode ? G.lang.name(fromCode) || fromCode : '';
    e.from.textContent = fromName || t('common_detect_language');
    k.fillTargetSelect(e.to, (r && r.to) || s.to || G.settings.targetLang || G.lang.uiTarget());
    updateAgain(s);
    renderOut(s);
  }

  function renderOut(s) {
    const k = kit();
    const { h, icon } = k;
    const e = s.els;
    e.body.classList.toggle('is-expanded', !!s.expanded);
    if (s.trError) {
      const retry = actionButton('refresh', 'common_retry', () => translate(s, s.pendingText || e.text.value.trim()));
      e.out.replaceChildren(
        h(
          'div',
          { class: 'g-error', role: 'alert' },
          icon('alert', 20),
          h('div', null, h('p', { class: 'g-error-msg' }, t(`common_error_${s.trError}`) || t('common_error_UNKNOWN')), retry),
        ),
      );
      return;
    }
    if (!s.result) {
      e.out.replaceChildren(
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
    e.out.replaceChildren(
      ...k.resultViews(s.result, {
        body: e.body,
        expanded: s.expanded,
        speak: (text, lang, btn) => speak(s, text, lang, btn),
        onToggle: (expanded) => {
          s.expanded = expanded;
        },
        onLayout: schedulePosition,
      }),
    );
  }

  function updateAgain(s) {
    const e = s.els;
    if (!e.againTr || !e.text) return;
    const value = e.text.value.trim();
    e.againTr.disabled = !value || s.trLoading || (!!s.result && !s.trError && U.squash(value) === U.squash(s.text));
  }

  /* ------------------------------------------------------------------ */
  /* Requests                                                            */
  /* ------------------------------------------------------------------ */

  function recognize(s) {
    doRecognize(s).catch(() => {});
  }

  async function doRecognize(s) {
    if (res !== s || !s.geometry) return;
    const req = ++s.ocrReq;
    s.state = 'ocr';
    s.ocrError = null;
    s.ocr = null;
    s.result = null;
    s.trError = null;
    s.text = '';
    s.slow = false;
    G.cancel(s.slowTimer);
    s.slowTimer = G.later(() => {
      if (res !== s || s.ocrReq !== req || s.state !== 'ocr') return;
      s.slow = true;
      render(s);
    }, SLOW_HINT_MS);
    render(s);
    const payload = { rect: s.geometry.rect, viewport: s.geometry.viewport };
    if (s.hints) payload.hints = s.hints;
    if (langsTouched) {
      // The user's choice; otherwise the background guesses from `hints` and/or uses settings.ocrLanguages.
      payload.langs = s.langs.slice();
      payload.langsSource = 'user';
    }
    let ocr = null;
    let error = null;
    let details = null;
    try {
      const r = await G.send(MSG.OCR_REGION, payload, { timeout: OCR_TIMEOUT_MS });
      ocr = r.ocr && typeof r.ocr.text === 'string' && r.ocr.text.trim() ? r.ocr : null;
      if (!ocr) error = 'OCR_NO_TEXT';
    } catch (err) {
      if (G.dead || (err && err.code === 'CONTEXT_INVALIDATED')) return;
      error = CU.errorCode(err, 'OCR_FAILED');
      details = err && err.details && typeof err.details === 'object' ? err.details : null;
    }
    if (res !== s || s.ocrReq !== req) return; // closed or superseded (e.g. languages changed)
    G.cancel(s.slowTimer);
    s.recovering = false;
    const used = (details && details.langs) || (ocr && ocr.langs);
    s.tried = Array.isArray(used) && used.length ? CU.normalizeOcrLangs(used) : s.langs.slice();
    s.guessed = details && Array.isArray(details.guessed) ? details.guessed.filter((c) => OCR_TO_LANG.has(c)) : [];
    s.autoDetected = !!((details && details.autoDetected) || (ocr && ocr.autoDetected));
    if (!langsTouched) {
      s.langs = s.tried.slice(); // what the background actually used
      s.els.picker.render(s.langs);
    }
    s.els.picker.setAuto(!langsTouched && s.autoDetected);
    if (error) {
      s.state = 'ocr-error';
      s.ocrError = error;
      render(s);
      kit().announce(
        error === 'OCR_NO_TEXT' && s.geometry ? t('bubble_crop_no_text_with', [listNames(s.tried)]) : t(`common_error_${error}`) || t('common_error_UNKNOWN'),
      );
      return;
    }
    s.ocr = { ...ocr, text: ocr.text.trim() };
    s.state = 'done';
    translate(s, s.ocr.text);
  }

  function translate(s, text) {
    doTranslate(s, text).catch(() => {});
  }

  async function doTranslate(s, text) {
    if (res !== s || !text) return;
    const req = ++s.trReq;
    s.trLoading = true;
    s.trError = null;
    s.result = null;
    s.pendingText = text;
    render(s);
    const payload = { text, from: ocrLang(s) || 'auto', source: 'bubble' };
    if (s.to) payload.to = s.to;
    let result = null;
    let error = null;
    try {
      const r = await G.send(MSG.TRANSLATE, payload, { timeout: TRANSLATE_TIMEOUT_MS });
      result = r.result && typeof r.result === 'object' ? r.result : null;
      if (!result) error = 'UNKNOWN';
    } catch (err) {
      if (G.dead || (err && err.code === 'CONTEXT_INVALIDATED')) return;
      error = CU.errorCode(err);
    }
    if (res !== s || s.trReq !== req) return;
    s.trLoading = false;
    s.result = result;
    s.trError = error;
    if (result) s.text = text;
    render(s);
    kit().announce(result ? (typeof result.translation === 'string' ? result.translation : '') : t(`common_error_${error}`));
  }

  function translateAgain(s) {
    const e = s.els;
    if (res !== s || !e.text || (e.againTr && e.againTr.disabled)) return;
    const text = e.text.value.trim();
    if (text) translate(s, text);
  }

  function onTargetChange(s) {
    const to = s.els.to.value;
    if (res !== s || !to || (s.result && s.result.to === to)) return;
    s.to = to;
    translate(s, s.text || s.els.text.value.trim());
  }

  function onResultLangs(s, list) {
    langs = list;
    langsTouched = true;
    s.langs = list.slice();
    s.recovering = false;
    G.cancel(s.relangTimer);
    if (!s.geometry) return; // capture error: nothing to re-recognize yet
    s.relangTimer = G.later(() => res === s && recognize(s), RELANG_DEBOUNCE_MS);
  }

  function speak(s, text, lang, btn) {
    if (!text || res !== s) return;
    s.spoke = true;
    if (btn) btn.classList.add('is-speaking');
    const done = () => G.later(() => btn && btn.classList.remove('is-speaking'), 500);
    G.send(MSG.SPEAK, { text, lang: lang || 'auto' }).then(done, done);
  }

  /** Ask the background for a new screenshot + crop (activeTab stays granted for this tab until it navigates). */
  function restartCapture(payload) {
    closeResults(false);
    G.send(MSG.START_CAPTURE, payload || { mode: 'region' }).catch((err) => {
      if (G.dead || (err && err.code === 'CONTEXT_INVALIDATED')) return;
      // A failed capture is normally reported by the background itself (start-crop with `error`).
      if (!overlay && !res) openResults({ error: 'CAPTURE_FAILED', retry: payload || { mode: 'region' } });
    });
  }

  function selectAgain() {
    restartCapture({ mode: 'region' });
  }

  /* ------------------------------------------------------------------ */
  /* Positioning                                                         */
  /* ------------------------------------------------------------------ */

  function schedulePosition() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!G.dead) position();
    });
  }

  function position() {
    const s = res;
    const k = kit();
    const b = s && s.els.bubble;
    if (!b || b.hidden || !k.host()) return;
    const o = k.hostOrigin();
    const vp = k.viewport();
    const EDGE = k.EDGE;
    if (s.userMoved) {
      const left = U.clamp((parseFloat(b.style.left) || 0) + o.x, EDGE, vp.width - EDGE - b.offsetWidth);
      const top = U.clamp((parseFloat(b.style.top) || 0) + o.y, EDGE, vp.height - EDGE - b.offsetHeight);
      b.style.setProperty('left', `${left - o.x}px`);
      b.style.setProperty('top', `${top - o.y}px`);
      return;
    }
    b.style.removeProperty('max-height');
    const p = U.placeBubble(k.toView(s.anchor, o), { width: b.offsetWidth, height: b.offsetHeight }, vp, { gap: EDGE, margin: EDGE });
    if (p.maxHeight != null) b.style.setProperty('max-height', `${p.maxHeight}px`);
    b.style.setProperty('left', `${p.left - o.x}px`);
    b.style.setProperty('top', `${p.top - o.y}px`);
    if (b.dataset.placement !== p.placement) b.dataset.placement = p.placement;
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle / API                                                     */
  /* ------------------------------------------------------------------ */

  function closeResults(restore) {
    const s = res;
    if (!s) return;
    res = null;
    G.cancel(s.slowTimer);
    G.cancel(s.relangTimer);
    if (s.spoke) G.send(MSG.STOP_SPEAK, {}).catch(() => {});
    if (ro) ro.disconnect();
    ro = null;
    const k = kit();
    const focusInside = restore && k && k.host() && document.activeElement === k.host();
    for (const el of [s.els.bubble, s.els.mark]) {
      try {
        if (el) el.remove();
      } catch {
        /* ignore */
      }
    }
    if (focusInside) restoreFocus(s.opener);
    if (k) k.announce('');
    afterClose();
  }

  function closeAll() {
    removeOverlay(false);
    closeResults(false);
  }

  /**
   * `start-crop` from the background (screenshot already taken). Returns false when this document can't host the UI
   * (not the top frame, XML/SVG document) — the background then opens the fallback capture page.
   * @param {{mode?: 'region'|'image', srcUrl?: string, error?: string}} [opts]
   */
  function start({ mode = 'region', srcUrl = '', error = null } = {}) {
    const k = kit();
    if (!G.IS_TOP || !k || !k.ensureHost()) return false;
    G.ui.dismiss();
    closeAll();
    langsTouched = false;
    langs = CU.normalizeOcrLangs(G.settings.ocrLanguages);
    k.applySettings();
    refreshSettings();
    const image = mode === 'image';
    if (error) {
      const code = G.ERROR_CODES.includes(error) ? error : 'CAPTURE_FAILED';
      return openResults({ error: code, retry: image ? { mode: 'image', ...(srcUrl ? { srcUrl } : {}) } : { mode: 'region' } });
    }
    if (image) {
      const found = findImage(typeof srcUrl === 'string' ? srcUrl : '');
      if (found) {
        commitRect(found.rect, { flash: true, image: found.node });
        return true;
      }
      startSelect({ imageMissing: true }); // e.g. the image is in an iframe or scrolled away: let the user drag
      return true;
    }
    startSelect();
    return true;
  }

  /** `start-crop {prepare}`: hide every TransPop UI and let the page repaint before the screenshot is taken. */
  function prepare() {
    const visible = !!overlay || !!res || (G.ui && G.ui.isActive());
    if (G.ui) G.ui.dismiss();
    closeAll();
    if (!visible) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(finish, 30)));
      setTimeout(finish, 200); // rAF is throttled in background tabs
    });
  }

  if (G.uiKit) {
    G.uiKit.registerActivity(() => !!overlay || !!res);
    G.uiKit.onBubbleOpen(() => closeAll()); // the selection bubble replaces the image-translation UI
  }

  G.onCleanup(() => {
    unwatchAll();
    overlay = null;
    res = null;
  });

  G.crop = {
    start,
    prepare,
    /** Esc: cancel the selection, or close the results bubble. */
    dismiss: () => {
      if (overlay) cancel();
      else closeResults(true);
    },
    close: () => closeResults(true),
    isActive: () => !!overlay || !!res,
    selecting: () => !!overlay,
    resultsVisible: () => !!res,
    /** Re-apply theme / font size after a settings change. */
    refresh: () => {
      if (!kit()) return;
      kit().applySettings();
      if (res) render(res);
    },
  };
})();
