/**
 * TransPop popup — tiny DOM helpers (ES module).
 * All text goes through textContent / text nodes; never innerHTML with user or remote text.
 */
import { icon } from '../ui/icons.js';

export const $ = (id) => document.getElementById(id);

/**
 * Create an element. `props`: class, text, dataset, on<Event> handlers, other keys → attributes
 * (null / undefined / false are skipped, true → empty attribute). Children: Nodes or strings (as text).
 */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/* Icons that are not (yet) in the shared set (src/ui/icons.js) — Lucide (ISC), built with DOM APIs. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const LOCAL_ICONS = {
  'scan-text': [
    'M3 7V5a2 2 0 0 1 2-2h2',
    'M17 3h2a2 2 0 0 1 2 2v2',
    'M21 17v2a2 2 0 0 1-2 2h-2',
    'M7 21H5a2 2 0 0 1-2-2v-2',
    'M7 8h8',
    'M7 12h10',
    'M7 16h6',
  ],
};

/** SVGElement for a popup-local stroke icon (same markup conventions as icon() in src/ui/icons.js). */
export function localIcon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: `icon icon-${name}`,
    'aria-hidden': 'true',
    focusable: 'false',
  };
  for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, String(value));
  for (const d of LOCAL_ICONS[name] || []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Accessible name + tooltip for an icon button. */
export function setLabel(el, label) {
  el.setAttribute('aria-label', label);
  el.setAttribute('title', label);
}

/** Replace (or insert) the leading SVG icon of a button. */
export function setIcon(el, name, size) {
  const svg = icon(name, size ? { size } : undefined);
  const current = el.querySelector(':scope > svg.icon');
  if (current) current.replaceWith(svg);
  else el.prepend(svg);
}

/** Square icon-only button with aria-label + title. */
export function iconButton(name, label, { className = '', size, pressed } = {}) {
  const btn = h('button', { type: 'button', class: `icon-btn ${className}`.trim() });
  btn.append(icon(name, size ? { size } : undefined));
  setLabel(btn, label);
  if (pressed !== undefined) btn.setAttribute('aria-pressed', String(Boolean(pressed)));
  return btn;
}

let toastTimer = 0;

/** Short status message at the bottom of the page. */
export function showToast(message, duration = 1800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), duration);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Resolve with `fallback` if `promise` doesn't settle within `ms` (rejections also resolve to `fallback`). */
export function withTimeout(promise, ms, fallback = null) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** localStorage wrappers for per-page UI preferences (never throw). */
export function readPref(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore (storage disabled) */
  }
}
