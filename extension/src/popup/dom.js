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
