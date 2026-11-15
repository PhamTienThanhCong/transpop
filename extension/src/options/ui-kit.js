/**
 * TransPop — small UI kit shared by the options page and the welcome page (private to the options agent).
 * Everything here builds DOM nodes; user / translation text is only ever assigned via textContent.
 */
import { MODIFIER_KEYS, UI_LANGUAGES } from '../shared/constants.js';
import { getLanguageOptions } from '../shared/languages.js';
import { t } from '../shared/i18n.js';
import { icon } from '../ui/icons.js';

export const LOGO_SRC = '../../icons/logo-mark.svg';
export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

/**
 * Tiny element factory: el('span', { class: 'x', text: 'hello', 'aria-label': '…' }, child1, child2)
 * `text` → textContent (safe). Other keys → attributes (`false`/`null` skip).
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* Extra icons (not in the shared set) — Lucide (ISC), static markup   */
/* ------------------------------------------------------------------ */

const EXTRA_ICONS = {
  puzzle:
    '<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
};

const tpl = document.createElement('template');

/** SVG for an icon that is not part of src/ui/icons.js (static, trusted markup only). */
export function extraIcon(name, { size = 18, className = '' } = {}) {
  tpl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-${name} ${className}" aria-hidden="true" focusable="false">${EXTRA_ICONS[name] || ''}</svg>`;
  return tpl.content.firstElementChild;
}

/** Replace `<i data-extra-icon="pin">` placeholders. */
export function hydrateExtraIcons(root = document) {
  root.querySelectorAll('i[data-extra-icon]').forEach((node) => {
    node.replaceWith(extraIcon(node.dataset.extraIcon, { size: Number(node.dataset.iconSize) || 18, className: node.className }));
  });
}

/* ------------------------------------------------------------------ */
/* Logo                                                                */
/* ------------------------------------------------------------------ */

function logoFallback(img) {
  if (!img.parentNode || img.dataset.fallback) return;
  img.dataset.fallback = '1';
  const size = Number(img.getAttribute('width')) || 28;
  const fallback = el('span', { class: `logo-fallback ${img.className}`, 'aria-hidden': 'true' });
  fallback.style.width = `${size}px`;
  fallback.style.height = `${size}px`;
  fallback.append(icon('languages', { size: Math.round(size * 0.58) }));
  img.replaceWith(fallback);
}

/** Create the TransPop logo <img>; degrades to a gradient mark if the SVG is missing. */
export function logoImg(size = 28, className = '') {
  const img = el('img', { src: LOGO_SRC, width: size, height: size, alt: '', class: `logo ${className}`.trim(), draggable: 'false' });
  img.addEventListener('error', () => logoFallback(img), { once: true });
  return img;
}

/**
 * Attach the fallback behaviour to every `img.logo` already in the document. The error event may
 * have fired before this module ran, so also use decode(), which rejects for broken images.
 */
export function setupLogos(root = document) {
  root.querySelectorAll('img.logo').forEach((img) => {
    img.addEventListener('error', () => logoFallback(img), { once: true });
    img.decode?.().catch(() => {
      if (img.complete) logoFallback(img);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Platform / modifier keys                                            */
/* ------------------------------------------------------------------ */

export function isMac() {
  const platform = (typeof navigator !== 'undefined' && (navigator.userAgentData?.platform || navigator.platform)) || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const MAC_LABELS = { Shift: '⇧ Shift', Alt: '⌥ Option', Control: '⌃ Control', Meta: '⌘ Command' };
const PC_LABELS = { Shift: 'Shift', Alt: 'Alt', Control: 'Ctrl', Meta: 'Win' };
const MAC_SYMBOLS = { Shift: '⇧', Alt: '⌥', Control: '⌃', Meta: '⌘' };

/** Human label for a modifier key, e.g. "⌥ Option" (Mac) or "Alt" (Windows/Linux). */
export function modifierLabel(key) {
  return (isMac() ? MAC_LABELS : PC_LABELS)[key] || key;
}

/** Short label for keycaps, e.g. "⇧" (Mac) or "Shift". */
export function modifierKeycap(key) {
  return (isMac() ? MAC_SYMBOLS : PC_LABELS)[key] || key;
}

/** KeyboardEvent/MouseEvent property that tells whether the modifier is held. */
export const MODIFIER_EVENT_PROP = Object.freeze({ Shift: 'shiftKey', Alt: 'altKey', Control: 'ctrlKey', Meta: 'metaKey' });

export function fillModifierSelect(select) {
  select.replaceChildren(...MODIFIER_KEYS.map((key) => new Option(modifierLabel(key), key)));
}

/* ------------------------------------------------------------------ */
/* Language select                                                     */
/* ------------------------------------------------------------------ */

let languageOptionsCache = null;

export function fillLanguageSelect(select) {
  languageOptionsCache ||= getLanguageOptions();
  const frag = document.createDocumentFragment();
  for (const { code, name } of languageOptionsCache) frag.append(new Option(name, code));
  select.replaceChildren(frag);
}

/** A language's own name ("English", "Tiếng Việt") — what a user looks for when the UI is in a language they can't read. */
export function endonym(code) {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    /* fall through */
  }
  return code;
}

/** Display-language <select>: "Auto (browser language)" + every shipped UI locale by its endonym. */
export function fillUiLanguageSelect(select) {
  select.replaceChildren(
    new Option(t('options_ui_language_auto'), 'auto'),
    ...UI_LANGUAGES.filter((code) => code !== 'auto').map((code) => {
      const option = new Option(endonym(code), code);
      option.lang = code;
      return option;
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Radio groups (segmented controls, selectable cards)                 */
/* ------------------------------------------------------------------ */

/**
 * Make `[role=radio]` children of `group` behave like a radio group: click / Space / Enter select,
 * arrow keys move + select, roving tabindex. `onChange(value)` fires only for user changes.
 */
export function setupRadioGroup(group, onChange) {
  const radios = () => [...group.querySelectorAll('[role="radio"]')];
  let value = null;

  const setValue = (next) => {
    value = next == null ? null : String(next);
    const list = radios();
    const hasMatch = list.some((r) => r.dataset.value === value);
    list.forEach((r, i) => {
      const on = r.dataset.value === value;
      r.setAttribute('aria-checked', on ? 'true' : 'false');
      r.tabIndex = on || (!hasMatch && i === 0) ? 0 : -1;
    });
  };

  const choose = (radio) => {
    const next = radio.dataset.value;
    if (next === value) return;
    setValue(next);
    onChange?.(next);
  };

  group.addEventListener('click', (e) => {
    const radio = e.target.closest('[role="radio"]');
    if (radio && group.contains(radio)) choose(radio);
  });

  group.addEventListener('keydown', (e) => {
    const list = radios();
    const index = list.indexOf(e.target.closest('[role="radio"]'));
    if (index < 0) return;
    const rtl = getComputedStyle(group).direction === 'rtl';
    let next = null;
    if (e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = index + 1;
    else if (e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = list[(next + list.length) % list.length];
    target.focus();
    choose(target);
  });

  return { setValue, getValue: () => value };
}

/* ------------------------------------------------------------------ */
/* Trigger-mode cards                                                  */
/* ------------------------------------------------------------------ */

const TRIGGER_CARDS = [
  { mode: 'icon', title: 'options_trigger_icon_title', desc: 'options_trigger_icon_desc' },
  { mode: 'auto', title: 'options_trigger_auto_title', desc: 'options_trigger_auto_desc' },
  { mode: 'hotkey', title: 'options_trigger_hotkey_title', desc: 'options_trigger_hotkey_desc' },
];

function illustration(mode) {
  const box = el('span', { class: `trigger-illus trigger-illus--${mode}`, 'aria-hidden': 'true' });
  const line1 = el(
    'span',
    { class: 'illus-line' },
    el('span', { class: 'illus-bar illus-bar--short' }),
    el('span', { class: 'illus-sel' }),
    el('span', { class: 'illus-bar' }),
  );
  const line2 = el('span', { class: 'illus-line' }, el('span', { class: 'illus-bar illus-bar--long' }));
  box.append(line1, line2);

  if (mode === 'icon') {
    const badge = el('span', { class: 'illus-badge' }, logoImg(14));
    const cursor = el('span', { class: 'illus-cursor' }, icon('pointer', { size: 16, strokeWidth: 2 }));
    box.append(badge, cursor);
  } else if (mode === 'auto') {
    const bubble = el(
      'span',
      { class: 'illus-bubble' },
      el('span', { class: 'illus-bubble-line' }),
      el('span', { class: 'illus-bubble-line illus-bubble-line--short' }),
    );
    const zap = el('span', { class: 'illus-zap' }, icon('zap', { size: 12, strokeWidth: 2.25 }));
    box.append(bubble, zap);
  } else {
    const keys = el(
      'span',
      { class: 'illus-keys' },
      el('span', { class: 'illus-key' }, icon('keyboard', { size: 13 })),
      el('span', { class: 'illus-key illus-key--mod', 'data-role': 'modifier' }),
    );
    box.append(keys);
  }
  return box;
}

/**
 * Build the three trigger-mode cards inside `group` (which should carry aria-labelledby/aria-label).
 * Returns { setValue(mode), setModifier(key) }.
 */
export function buildTriggerCards(group, { compact = false, idPrefix = 'trigger', onChange } = {}) {
  group.classList.add('trigger-cards');
  if (compact) group.classList.add('is-compact');
  group.setAttribute('role', 'radiogroup');

  for (const { mode, title, desc } of TRIGGER_CARDS) {
    const titleId = `${idPrefix}-${mode}-title`;
    const descId = `${idPrefix}-${mode}-desc`;
    const card = el(
      'button',
      {
        type: 'button',
        role: 'radio',
        class: 'trigger-card',
        'data-value': mode,
        'aria-checked': 'false',
        'aria-labelledby': titleId,
        'aria-describedby': descId,
      },
      illustration(mode),
      el(
        'span',
        { class: 'trigger-card-body' },
        el('span', { class: 'trigger-card-title', id: titleId, text: t(title) }),
        el('span', { class: 'trigger-card-desc', id: descId, text: t(desc) }),
      ),
      el('span', { class: 'trigger-card-check', 'aria-hidden': 'true' }, icon('check', { size: 12, strokeWidth: 3 })),
    );
    group.append(card);
  }

  const radio = setupRadioGroup(group, onChange);
  return {
    setValue: radio.setValue,
    setModifier(key) {
      group.querySelectorAll('[data-role="modifier"]').forEach((node) => {
        node.textContent = modifierKeycap(key);
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

/** Returns show(message, { type: 'success' | 'error' | 'info', duration }). */
export function createToast(node) {
  let timer = 0;
  return function show(message, { type = 'success', duration = 1800 } = {}) {
    const glyph = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check';
    node.replaceChildren(icon(glyph, { size: 16 }), el('span', { text: message }));
    node.dataset.type = type;
    // Restart the transition if a toast is already visible.
    node.classList.remove('is-visible');
    void node.offsetWidth;
    node.classList.add('is-visible');
    clearTimeout(timer);
    timer = setTimeout(() => node.classList.remove('is-visible'), duration);
  };
}

/* ------------------------------------------------------------------ */
/* Keyboard shortcuts                                                  */
/* ------------------------------------------------------------------ */

/** chrome.commands.getAll(), ordered (popup, translate, toggle, others). Never throws. */
export async function getCommands() {
  try {
    if (!chrome.commands?.getAll) return [];
    const list = await chrome.commands.getAll();
    const order = ['_execute_action', 'translate-selection', 'toggle-enabled'];
    const rank = (name) => (order.includes(name) ? order.indexOf(name) : order.length);
    return [...(list || [])].sort((a, b) => rank(a.name) - rank(b.name));
  } catch {
    return [];
  }
}

/** Split a Chrome shortcut ("Alt+Shift+S" or Mac-style "⌥⇧S") into individual keys. */
export function shortcutKeys(shortcut) {
  if (!shortcut) return [];
  if (shortcut.includes('+') && shortcut.length > 1) {
    return shortcut
      .split('+')
      .map((k) => k.trim())
      .filter(Boolean);
  }
  const keys = [];
  let rest = shortcut;
  while (rest.length > 1 && /^[⌘⌥⇧⌃]/.test(rest)) {
    keys.push(rest[0]);
    rest = rest.slice(1);
  }
  if (rest) keys.push(rest);
  return keys;
}

/** Element with one `.kbd` per key. */
export function kbdGroup(keys) {
  const group = el('span', { class: 'kbd-group' });
  for (const key of keys) group.append(el('kbd', { class: 'kbd', text: key }));
  return group;
}

export async function openShortcutsPage() {
  try {
    await chrome.tabs.create({ url: SHORTCUTS_URL });
  } catch {
    /* ignore — e.g. dev harness */
  }
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export function errorMessage(err) {
  const code = err?.code || 'UNKNOWN';
  const msg = t(`common_error_${code}`);
  return msg.startsWith('common_error_') ? t('common_error_UNKNOWN') : msg;
}
