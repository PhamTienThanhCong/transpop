/**
 * TransPop — Welcome / onboarding page (opened by the background right after install).
 * Content scripts don't run on extension pages, so step 3 is an inline demo that talks to the
 * background directly (`translate` with source: 'welcome' → never recorded in history).
 */
import { MSG } from '../shared/constants.js';
import { getLanguageName, getUiLocale, isRtl } from '../shared/languages.js';
import { initI18n, localizeDocument, reloadOnUiLanguageChange, t } from '../shared/i18n.js';
import { send } from '../shared/messaging.js';
import { getSettings, onSettingsChanged, saveSettings } from '../shared/storage.js';
import { applyTheme } from '../ui/theme.js';
import { hydrateIcons, icon } from '../ui/icons.js';
import {
  MODIFIER_EVENT_PROP,
  buildTriggerCards,
  createToast,
  el,
  errorMessage,
  fillLanguageSelect,
  fillModifierSelect,
  fillUiLanguageSelect,
  getCommands,
  hydrateExtraIcons,
  kbdGroup,
  logoImg,
  modifierLabel,
  openShortcutsPage,
  setupLogos,
  shortcutKeys,
} from '../options/ui-kit.js';

applyTheme('auto');

const $ = (sel, scope = document) => scope.querySelector(sel);

const state = { settings: null, theme: null };
const showToast = createToast($('#toast'));
let trigger = null;

async function init() {
  await initI18n(); // Display language (ARCHITECTURE §10) — before localizeDocument() and the language lists
  hydrateIcons();
  hydrateExtraIcons();
  localizeDocument();
  setupLogos();
  $('#mini-ext-logo').append(logoImg(16));
  $('#mini-menu-active').prepend(logoImg(12));
  $('#demo-trigger').append(logoImg(18));

  fillUiLanguageSelect($('#w-uiLanguage'));
  fillLanguageSelect($('#w-targetLang'));
  fillModifierSelect($('#w-modifierKey'));
  trigger = buildTriggerCards($('#w-trigger'), {
    compact: true,
    idPrefix: 'w-trigger',
    onChange: (mode) => save({ triggerMode: mode }),
  });
  $('#w-uiLanguage').addEventListener('change', (e) => save({ uiLanguage: e.target.value })); // → reload below
  $('#w-targetLang').addEventListener('change', (e) => save({ targetLang: e.target.value }));
  $('#w-modifierKey').addEventListener('change', (e) => save({ modifierKey: e.target.value }));

  setupDemo();
  setupTips();
  setupActions();

  render(await getSettings());
  onSettingsChanged((settings) => render(settings));
  reloadOnUiLanguageChange();
}

/* ================================================================== */
/* Settings                                                            */
/* ================================================================== */

let saveChain = Promise.resolve();
let toastTimer = 0;

function save(patch) {
  if (state.settings) render({ ...state.settings, ...patch });
  saveChain = saveChain
    .then(() => saveSettings(patch))
    .then((next) => {
      render(next);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => showToast(t('options_saved')), 80);
    })
    .catch((err) => {
      console.error('[TransPop] failed to save settings', err);
      showToast(t('options_save_failed'), { type: 'error', duration: 3200 });
    });
  return saveChain;
}

function render(s) {
  if (!s) return;
  const prev = state.settings;
  state.settings = s;

  if (s.theme !== state.theme) {
    state.theme = s.theme;
    applyTheme(s.theme);
  }

  const uiLanguage = $('#w-uiLanguage');
  if (uiLanguage.value !== s.uiLanguage) uiLanguage.value = s.uiLanguage;
  const target = $('#w-targetLang');
  if (target.value !== s.targetLang) target.value = s.targetLang;
  const modifier = $('#w-modifierKey');
  if (modifier.value !== s.modifierKey) modifier.value = s.modifierKey;

  trigger.setValue(s.triggerMode);
  trigger.setModifier(s.modifierKey);
  $('#w-modifier-row').hidden = s.triggerMode !== 'hotkey';

  if (!prev || prev.targetLang !== s.targetLang) renderDemoText(s.targetLang);
  else if (prev.triggerMode !== s.triggerMode || prev.modifierKey !== s.modifierKey) hideDemo();
}

/* ================================================================== */
/* Demo                                                                */
/* ================================================================== */

/** Sample paragraphs (source content, not UI strings). `{ hint }` parts are clickable words. */
const DEMO_TEXTS = {
  en: {
    lang: 'en',
    parts: [
      'Learning a new language opens the door to new cultures, ideas and friendships. Try selecting a word like ',
      { hint: 'serendipity' },
      ' or ',
      { hint: 'curious' },
      ', or even a whole sentence — TransPop translates it right where you are reading.',
    ],
  },
  es: {
    lang: 'es',
    parts: [
      'Aprender un idioma nuevo abre la puerta a otras culturas, ideas y amistades. Prueba a seleccionar una palabra como ',
      { hint: 'sorprendente' },
      ' o ',
      { hint: 'curiosidad' },
      ', o incluso una frase completa: TransPop la traduce justo donde estás leyendo.',
    ],
  },
  vi: {
    lang: 'vi',
    parts: [
      'Học một ngôn ngữ mới mở ra cánh cửa đến những nền văn hóa, ý tưởng và tình bạn mới. Hãy thử bôi đen một từ như ',
      { hint: 'tò mò' },
      ' hay ',
      { hint: 'bất ngờ' },
      ', hoặc cả một câu — TransPop sẽ dịch ngay tại nơi bạn đang đọc.',
    ],
  },
};

function demoTextFor(targetLang) {
  if (targetLang !== 'en') return DEMO_TEXTS.en;
  return /^vi\b/i.test(getUiLocale()) ? DEMO_TEXTS.vi : DEMO_TEXTS.es;
}

function renderDemoText(targetLang) {
  hideDemo();
  const { lang, parts } = demoTextFor(targetLang);
  const paragraph = $('#demo-text');
  paragraph.lang = lang;
  paragraph.dir = 'ltr';
  paragraph.replaceChildren(
    ...parts.map((part) =>
      typeof part === 'string' ? document.createTextNode(part) : el('span', { class: 'demo-word', text: part.hint }),
    ),
  );
}

let pending = null; // { text, rect, lastRect }
let requestId = 0;
let otherKeyPressed = false;

function setupDemo() {
  const triggerButton = $('#demo-trigger');

  // Selections must start in the paragraph; listen on the document so a drag ending outside still counts.
  let pressedInText = false;
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest?.('#demo-pop, #demo-trigger')) return;
    pressedInText = e.button === 0 && Boolean(e.target.closest?.('#demo-text'));
    hideDemo();
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !pressedInText) return;
    pressedInText = false;
    // Let the browser finalize the selection first.
    setTimeout(() => onSelection(e), 0);
  });

  // Keep the selection when the icon is pressed.
  triggerButton.addEventListener('mousedown', (e) => e.preventDefault());
  triggerButton.addEventListener('click', () => translatePending());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideDemo();
      return;
    }
    const key = state.settings?.modifierKey;
    if (e.key === key) {
      if (!e.repeat) otherKeyPressed = false;
    } else {
      otherKeyPressed = true;
    }
  });

  // Hotkey mode: tapping the modifier alone while text is selected translates it.
  document.addEventListener('keyup', (e) => {
    const s = state.settings;
    if (!pending || !s || s.triggerMode !== 'hotkey') return;
    if (e.key === s.modifierKey && !otherKeyPressed && selectionInDemo()) translatePending();
  });

  window.addEventListener('resize', () => hideDemo());
}

function selectionInDemo() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  return $('#demo-text').contains(sel.getRangeAt(0).commonAncestorContainer);
}

function onSelection(e) {
  const sel = window.getSelection();
  if (!sel) return;

  // A single click on a highlighted word selects it.
  if (sel.isCollapsed) {
    const word = e.target.closest?.('.demo-word');
    if (!word) return;
    const range = document.createRange();
    range.selectNodeContents(word);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  if (!selectionInDemo()) return;

  const text = sel.toString().replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!text) return;

  // Store geometry relative to the demo box so scrolling before clicking the icon doesn't misplace things.
  const demo = $('#demo');
  const box = demo.getBoundingClientRect();
  const ox = box.left + demo.clientLeft;
  const oy = box.top + demo.clientTop;
  const rel = (r) => ({ left: r.left - ox, right: r.right - ox, top: r.top - oy, bottom: r.bottom - oy, width: r.width });
  const range = sel.getRangeAt(0);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0);
  const rect = range.getBoundingClientRect();
  pending = { text, rect: rel(rect), lastRect: rel(rects[rects.length - 1] || rect) };

  const s = state.settings || {};
  const held = Boolean(e[MODIFIER_EVENT_PROP[s.modifierKey]]);
  if (s.triggerMode === 'auto' || held) translatePending();
  else if (s.triggerMode === 'hotkey') showHotkeyHint();
  else showTriggerButton();
}

/** Position an absolutely-positioned child of #demo just below `rect` (coords relative to #demo). */
function place(node, rect, { anchor = 'center', gap = 8 } = {}) {
  const boxWidth = $('#demo').clientWidth;
  node.hidden = false;
  const width = node.offsetWidth;
  let left = anchor === 'end' ? rect.right + 2 : rect.left + rect.width / 2 - width / 2;
  left = Math.max(8, Math.min(left, boxWidth - width - 8));
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(rect.bottom + gap)}px`;
}

function showTriggerButton() {
  hideHelpers();
  place($('#demo-trigger'), pending.lastRect, { anchor: 'end', gap: 4 });
}

function showHotkeyHint() {
  hideHelpers();
  const hint = $('#demo-hint');
  const marker = '⁣KEY⁣';
  const [before, after = ''] = t('welcome_demo_hint_hotkey', marker).split(marker);
  hint.replaceChildren(
    document.createTextNode(before),
    el('kbd', { class: 'kbd', text: modifierLabel(state.settings.modifierKey) }),
    document.createTextNode(after),
  );
  place(hint, pending.rect);
}

function hideHelpers() {
  $('#demo-trigger').hidden = true;
  $('#demo-hint').hidden = true;
}

function hideDemo() {
  hideHelpers();
  $('#demo-pop').hidden = true;
  pending = null;
  requestId += 1;
}

async function translatePending() {
  if (!pending) return;
  const { text, rect } = pending;
  hideHelpers();
  const pop = $('#demo-pop');
  const id = ++requestId;

  renderLoading(text);
  place(pop, rect, { gap: 10 });

  try {
    const { result } = await send(MSG.TRANSLATE, { text, source: 'welcome' });
    if (id !== requestId) return;
    renderResult(result);
  } catch (err) {
    if (id !== requestId) return;
    renderError(err);
  }
}

/* ---------- Result card ---------- */

function speakButton(text, lang) {
  const button = el(
    'button',
    { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': t('common_listen'), title: t('common_listen') },
    icon('volume', { size: 16 }),
  );
  button.addEventListener('click', () => {
    send(MSG.SPEAK, { text, lang }).catch((err) => showToast(errorMessage(err), { type: 'error', duration: 3200 }));
  });
  return button;
}

function closeButton() {
  const button = el(
    'button',
    { type: 'button', class: 'icon-btn icon-btn-sm pop-close', 'aria-label': t('common_close'), title: t('common_close') },
    icon('x', { size: 16 }),
  );
  button.addEventListener('click', () => hideDemo());
  return button;
}

function renderLoading(text) {
  const pop = $('#demo-pop');
  pop.setAttribute('aria-busy', 'true');
  pop.replaceChildren(
    el('div', { class: 'pop-meta' }, el('span', { text: t('common_translating') }), closeButton()),
    el('div', { class: 'pop-source-row' }, el('span', { class: 'pop-source', dir: 'auto', text })),
    el(
      'div',
      { class: 'pop-loading' },
      el('span', { class: 'skeleton pop-skel' }),
      el('span', { class: 'skeleton pop-skel pop-skel--short' }),
    ),
  );
}

function renderResult(result) {
  const pop = $('#demo-pop');
  pop.removeAttribute('aria-busy');

  const fromName = getLanguageName(result.from) || result.from;
  const toName = getLanguageName(result.to) || result.to;

  const sourceRow = el(
    'div',
    { class: 'pop-source-row' },
    el(
      'span',
      { class: 'pop-source-wrap' },
      el('span', { class: 'pop-source', dir: 'auto', lang: result.from, text: result.text }),
      result.phonetic ? el('span', { class: 'pop-phonetic', dir: 'ltr', text: result.phonetic }) : null,
    ),
    speakButton(result.text, result.from),
  );

  const translation = el('span', {
    class: 'pop-translation',
    lang: result.to,
    dir: isRtl(result.to) ? 'rtl' : 'auto',
    text: result.translation,
  });
  const translationRow = el('div', { class: 'pop-translation-row' }, translation, speakButton(result.translation, result.to));

  const provider = t(result.provider === 'microsoft' ? 'common_provider_microsoft' : 'common_provider_google');
  pop.replaceChildren(
    el('div', { class: 'pop-meta' }, el('span', { class: 'pop-pair', text: `${fromName} → ${toName}` }), closeButton()),
    sourceRow,
    translationRow,
    el('div', { class: 'pop-foot', text: t('common_powered_by', provider) }),
  );
}

function renderError(err) {
  const pop = $('#demo-pop');
  pop.removeAttribute('aria-busy');
  const retry = el('button', { type: 'button', class: 'btn btn-sm pop-retry' }, icon('refresh', { size: 16 }), el('span', { text: t('common_retry') }));
  retry.addEventListener('click', () => translatePending());
  pop.replaceChildren(
    el('div', { class: 'pop-meta' }, el('span', { text: t('common_translation') }), closeButton()),
    el('p', { class: 'pop-error' }, icon('alert', { size: 16 }), el('span', { text: errorMessage(err) })),
    retry,
  );
}

/* ================================================================== */
/* Tips & actions                                                      */
/* ================================================================== */

async function renderShortcutTips() {
  const commands = await getCommands();
  const keysOf = (name) => shortcutKeys(commands.find((c) => c.name === name)?.shortcut);

  const keys = keysOf('translate-selection');
  const holder = $('#tip-shortcut-keys');
  holder.replaceChildren(keys.length ? kbdGroup(keys) : el('span', { class: 'shortcut-unset', text: t('options_shortcut_not_set') }));
  $('#tip-shortcut-set').hidden = keys.length > 0;

  // Image translation tip: "Press [Alt][Shift][A] and drag…" — keycaps inline in the sentence.
  const ocrKeys = keysOf('crop-translate');
  const desc = $('#tip-ocr-desc');
  if (ocrKeys.length) {
    const marker = '\u2063KEY\u2063';
    const [before, after = ''] = t('welcome_tip_ocr_desc', marker).split(marker);
    desc.replaceChildren(document.createTextNode(before), kbdGroup(ocrKeys), document.createTextNode(after));
  } else {
    desc.textContent = t('welcome_tip_ocr_desc_no_shortcut');
  }
  $('#tip-ocr-set').hidden = ocrKeys.length > 0;
}

function setupTips() {
  renderShortcutTips();
  $('#tip-shortcut-set').addEventListener('click', openShortcutsPage);
  $('#tip-ocr-set').addEventListener('click', openShortcutsPage);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderShortcutTips();
  });
}

function setupActions() {
  $('#w-open-settings').addEventListener('click', () => {
    Promise.resolve()
      .then(() => chrome.runtime.openOptionsPage())
      .catch(() => send(MSG.OPEN_OPTIONS).catch(() => {}));
  });

  $('#w-start').addEventListener('click', async () => {
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) {
        await chrome.tabs.remove(tab.id);
        return;
      }
    } catch {
      /* fall through */
    }
    window.close();
  });
}

/* Boot (last, so every module-level binding above is initialised). */
init().catch((err) => console.error('[TransPop] welcome failed to initialise', err));
