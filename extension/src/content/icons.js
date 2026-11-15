/*
 * TransPop content script — icons (file 4/6).
 */
(() => {
  'use strict';

  /**
   * LOGO_SVG — the mark shown on the floating trigger button (30×30 px).
   * Keep in sync with extension/icons/logo-mark.svg (same bold variant as store-assets/src/icon-32.svg).
   * Requirements: self-contained SVG markup with a viewBox (it is scaled to 30px); no scripts, event
   * attributes or external references (ids are scoped to our closed shadow root).
   * Uses the bolder 32px variant (store-assets/src/icon-32.svg) because the button is ~30px.
   */
  const LOGO_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs>' +
    '<linearGradient id="transpop-front" x1="10" y1="40" x2="80" y2="120" gradientUnits="userSpaceOnUse">' +
    '<stop offset="0" stop-color="#6366F1"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient>' +
    '<mask id="transpop-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">' +
    '<rect width="128" height="128" fill="#fff"/>' +
    '<path d="M26 40h38a16 16 0 0 1 16 16v34a16 16 0 0 1-16 16H44l-22 14 6-14h-2a16 16 0 0 1-16-16V56a16 16 0 0 1 16-16z" fill="#000" stroke="#000" stroke-width="10" stroke-linejoin="round"/>' +
    '</mask></defs><g transform="translate(64 64) scale(1.111) translate(-64 -66)"><g mask="url(#transpop-cut)">' +
    '<path d="M64 12h38a16 16 0 0 1 16 16v36a16 16 0 0 1-16 16h-2l6 14-22-14H64a16 16 0 0 1-16-16V28a16 16 0 0 1 16-16z" fill="#C7D2FE"/>' +
    '<path d="M100 26v6M86 37h28M107 38c-3 9-10 15-20 20M93 38c3 9 10 15 20 20" fill="none" stroke="#3730A3" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</g>' +
    '<path d="M26 40h38a16 16 0 0 1 16 16v34a16 16 0 0 1-16 16H44l-22 14 6-14h-2a16 16 0 0 1-16-16V56a16 16 0 0 1 16-16z" fill="url(#transpop-front)"/>' +
    '<path d="M33 91 45 57 57 91M37.4 80h15.2" fill="none" stroke="#fff" stroke-width="10.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</g></svg>';

  const G = globalThis.__transpopContent;
  if (!G || G.started) return;

  /**
   * Stroke icon bodies, 24×24 grid, currentColor — copied from src/ui/icons.js (Lucide, ISC License).
   * Keep the path data in sync with that file.
   */
  const PATHS = {
    volume:
      '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    settings:
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    refresh:
      '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const TAG_RE = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  /**
   * Build an SVG element from TRUSTED, STATIC markup with createElementNS — never innerHTML, so
   * it works on pages enforcing Trusted Types. Supports nesting, attributes and text content;
   * drops comments, processing instructions, `xmlns*` and any `on*` attribute.
   */
  function buildSvg(markup) {
    const src = String(markup).replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
    const stack = [];
    let root = null;
    let last = 0;
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(src))) {
      const text = src.slice(last, m.index);
      if (stack.length && text.trim()) stack[stack.length - 1].appendChild(document.createTextNode(U_decode(text)));
      last = TAG_RE.lastIndex;
      const [, closing, tag, attrs, selfClosing] = m;
      if (closing) {
        stack.pop();
        continue;
      }
      const el = document.createElementNS(SVG_NS, tag);
      let a;
      ATTR_RE.lastIndex = 0;
      while ((a = ATTR_RE.exec(attrs))) {
        const name = a[1];
        const value = a[2] ?? a[3] ?? '';
        if (name === 'xmlns' || name.startsWith('xmlns:') || /^on/i.test(name)) continue;
        if (name.startsWith('xlink:')) el.setAttributeNS(XLINK_NS, name, value);
        else el.setAttribute(name, value);
      }
      if (stack.length) stack[stack.length - 1].appendChild(el);
      else if (!root) root = el;
      else continue; // ignore stray top-level siblings
      if (!selfClosing) stack.push(el);
    }
    return root;
  }

  const U_decode = (s) => (G.util ? G.util.decodeEntities(s) : s);

  const cache = new Map();

  /** Cloned SVG for a stroke icon (sized by CSS; width/height attributes are a fallback). */
  function icon(name, size = 18) {
    const key = `${name}|${size}`;
    if (!cache.has(key)) {
      const filled = name === 'star-filled';
      const body = PATHS[filled ? 'star' : name] || '';
      const fill = filled ? 'currentColor' : 'none';
      cache.set(
        key,
        buildSvg(
          `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" stroke-width="2" ` +
            `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`,
        ),
      );
    }
    return cache.get(key).cloneNode(true);
  }

  /** Cloned logo SVG. */
  function logo() {
    if (!cache.has('logo')) {
      const svg = buildSvg(LOGO_SVG);
      if (svg) {
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
      }
      cache.set('logo', svg);
    }
    const svg = cache.get('logo');
    return svg ? svg.cloneNode(true) : document.createElementNS(SVG_NS, 'svg');
  }

  G.icons = { icon, logo, buildSvg };
})();
