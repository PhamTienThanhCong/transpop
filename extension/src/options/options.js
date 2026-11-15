/**
 * TransPop — Settings page.
 * Every control auto-saves through saveSettings(); the page live-syncs with onSettingsChanged().
 */
import { APP, MSG } from '../shared/constants.js';
import { getLanguageName, getUiLocale } from '../shared/languages.js';
import { initI18n, localizeDocument, reloadOnUiLanguageChange, t } from '../shared/i18n.js';
import { send } from '../shared/messaging.js';
import {
  clearFavorites,
  clearHistory,
  exportData,
  getFavorites,
  getHistory,
  getSettings,
  importData,
  normalizeHostname,
  onFavoritesChanged,
  onHistoryChanged,
  onSettingsChanged,
  resetSettings,
  saveSettings,
} from '../shared/storage.js';
import { applyTheme } from '../ui/theme.js';
import { hydrateIcons, icon } from '../ui/icons.js';
import {
  buildTriggerCards,
  commandLabel,
  createToast,
  el,
  errorMessage,
  fillLanguageSelect,
  fillModifierSelect,
  fillUiLanguageSelect,
  getCommands,
  hydrateExtraIcons,
  kbdGroup,
  openShortcutsPage,
  prefersReducedMotion,
  setupLogos,
  setupRadioGroup,
  shortcutKeys,
} from './ui-kit.js';
import { createOcrPicker } from './ocr-picker.js';

const root = document.documentElement;
root.classList.add('is-loading');
applyTheme('auto');

const $ = (sel, scope = document) => scope.querySelector(sel);
const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];

const SECTIONS = ['general', 'trigger', 'appearance', 'bubble', 'ocr', 'sites', 'shortcuts', 'data', 'about'];
const MOBILE_QUERY = '(max-width: 760px)';

const state = {
  settings: null,
  theme: null,
  lastAddedSite: null,
  activeSection: null,
};

/** Controllers keyed by setting name (provider, theme, triggerMode, ocrLanguages) — each has setValue(value). */
const controls = {};
const showToast = createToast($('#toast'));
// Locale-dependent formatters: created in init(), after initI18n() applied the Display-language setting.
let numberFormat;
let rateFormat;
let pluralRules;

async function init() {
  await initI18n();
  const locale = getUiLocale();
  numberFormat = new Intl.NumberFormat(locale);
  rateFormat = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  pluralRules = new Intl.PluralRules(locale);

  hydrateIcons();
  hydrateExtraIcons();
  localizeDocument();
  setupLogos();
  renderMeta();
  setupControls();
  setupNav();
  setupSites();
  setupShortcuts();

  render(await getSettings());
  onSettingsChanged((settings) => render(settings));
  reloadOnUiLanguageChange(() => flushRangeSaves()); // new display language → reload with the new strings

  setupData();
}

/* ================================================================== */
/* Static bits                                                         */
/* ================================================================== */

function renderMeta() {
  let version = '';
  try {
    version = chrome.runtime.getManifest()?.version || '';
  } catch {
    /* ignore */
  }
  $('#brand-version').textContent = version ? `v${version}` : '';
  $('#about-version').textContent = version ? t('options_version', version) : '';
  $('#link-repo').href = APP.repoUrl;
  $('#link-issues').href = APP.issuesUrl;
  $('#link-store').href = APP.storeUrl;
  $('#privacy-link').href = APP.privacyUrl;
}

/* ================================================================== */
/* Settings controls                                                   */
/* ================================================================== */

function setupControls() {
  fillUiLanguageSelect($('#s-uiLanguage'));
  fillLanguageSelect($('#s-targetLang'));
  fillLanguageSelect($('#s-secondaryLang'));
  fillModifierSelect($('#s-modifierKey'));

  $$('input[type="checkbox"][data-setting]').forEach((input) => {
    input.addEventListener('change', () => save({ [input.dataset.setting]: input.checked }));
  });

  $$('select[data-setting]').forEach((select) => {
    select.addEventListener('change', () => save({ [select.dataset.setting]: select.value }));
  });

  $$('input[type="range"][data-setting]').forEach((range) => {
    const key = range.dataset.setting;
    range.addEventListener('input', () => {
      updateRangeLabel(range);
      if (key === 'fontSize' && state.settings) updatePreview({ ...state.settings, fontSize: Number(range.value) });
    });
    range.addEventListener('change', () => queueRangeSave(key, Number(range.value)));
  });

  $$('.segmented[data-setting]').forEach((group) => {
    const key = group.dataset.setting;
    controls[key] = setupRadioGroup(group, (value) => save({ [key]: value }));
  });

  controls.triggerMode = buildTriggerCards($('#trigger-cards'), {
    idPrefix: 'opt-trigger',
    onChange: (value) => save({ triggerMode: value }),
  });

  // Image translation: OCR languages (Tesseract codes, priority order, 1…OCR_MAX_LANGUAGES).
  controls.ocrLanguages = createOcrPicker($('#ocr-picker'), {
    idPrefix: 'opt-ocr',
    onChange: (codes) => save({ ocrLanguages: codes }),
  });

  $('#test-voice').addEventListener('click', testVoice);
  buildPreview();

  window.addEventListener('pagehide', () => flushRangeSaves());
}

/* ---------- Saving ---------- */

let saveChain = Promise.resolve();
let savedToastTimer = 0;

/** Optimistically render, then persist (serialized so quick successive changes never overwrite each other). */
function save(patch) {
  if (state.settings) render({ ...state.settings, ...patch });
  saveChain = saveChain
    .then(() => saveSettings(patch))
    .then((next) => {
      render(next);
      notifySaved();
    })
    .catch(async (err) => {
      console.error('[TransPop] failed to save settings', err);
      showToast(t('options_save_failed'), { type: 'error', duration: 3200 });
      try {
        render(await getSettings());
      } catch {
        /* ignore */
      }
    });
  return saveChain;
}

function notifySaved() {
  clearTimeout(savedToastTimer);
  savedToastTimer = setTimeout(() => showToast(t('options_saved')), 80);
}

/* Range inputs are debounced so dragging / arrow keys don't hammer chrome.storage.sync quotas. */
const pendingRange = {};
let rangeTimer = 0;

function queueRangeSave(key, value) {
  pendingRange[key] = value;
  clearTimeout(rangeTimer);
  rangeTimer = setTimeout(flushRangeSaves, 250);
}

function flushRangeSaves() {
  clearTimeout(rangeTimer);
  const patch = { ...pendingRange };
  for (const key of Object.keys(pendingRange)) delete pendingRange[key];
  return Object.keys(patch).length ? save(patch) : saveChain;
}

/* ---------- Rendering ---------- */

function render(settings) {
  if (!settings) return;
  const s = { ...settings, ...pendingRange };
  state.settings = s;

  if (s.theme !== state.theme) {
    state.theme = s.theme;
    applyTheme(s.theme);
  }

  $$('input[type="checkbox"][data-setting]').forEach((input) => {
    input.checked = Boolean(s[input.dataset.setting]);
  });

  $$('select[data-setting]').forEach((select) => {
    const value = String(s[select.dataset.setting] ?? '');
    if (select.value !== value) select.value = value;
  });

  $$('input[type="range"][data-setting]').forEach((range) => {
    const value = s[range.dataset.setting];
    if (!range.matches(':active') && Number(range.value) !== value) range.value = String(value);
    updateRangeLabel(range);
  });

  for (const [key, control] of Object.entries(controls)) control.setValue(s[key]);
  controls.triggerMode?.setModifier(s.modifierKey);

  // A secondary language equal to the target makes no sense — disable it in the list.
  for (const option of $('#s-secondaryLang').options) option.disabled = option.value === s.targetLang;

  // Mode-dependent rows
  $('#row-doubleClickOnly').hidden = s.triggerMode !== 'auto';
  $('#row-modifier').hidden = s.triggerMode === 'auto';
  $('#s-modifierKey-desc').textContent = t(
    s.triggerMode === 'hotkey' ? 'options_modifier_desc_hotkey' : 'options_modifier_desc_icon',
  );

  updatePreview(s);
  renderSites(s.disabledSites);
}

function updateRangeLabel(range) {
  const min = Number(range.min);
  const max = Number(range.max);
  const value = Number(range.value);
  range.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);
  const text =
    range.dataset.setting === 'fontSize'
      ? t('options_font_size_value', numberFormat.format(value))
      : t('options_speech_rate_value', rateFormat.format(value));
  const output = $(`#${range.id}-value`);
  if (output) output.textContent = text;
  range.setAttribute('aria-valuetext', text);
}

/* ---------- Live bubble preview (static mock) ---------- */

const preview = {};

function fakeIconButton(name) {
  return el('span', { class: 'icon-btn icon-btn-sm' }, icon(name, { size: 16 }));
}

function buildPreview() {
  const stage = $('#preview');

  const sentence = el(
    'p',
    { class: 'preview-sentence', lang: 'en', dir: 'ltr' },
    document.createTextNode('The answer seemed '),
    el('span', { class: 'preview-mark', text: 'obvious' }),
    document.createTextNode(' at first.'),
  );

  preview.phonetic = el('span', { class: 'pb-phonetic', text: '/ˈɒb.vi.əs/' });
  const head = el(
    'div',
    { class: 'pb-head' },
    el('span', { class: 'pb-word-wrap' }, el('span', { class: 'pb-word', lang: 'en', text: 'obvious' }), preview.phonetic),
    el('span', { class: 'pb-actions' }, fakeIconButton('volume'), fakeIconButton('star'), fakeIconButton('settings')),
  );

  const translation = el(
    'div',
    { class: 'pb-translation-row' },
    el('span', { class: 'pb-translation', lang: 'vi', text: 'hiển nhiên' }),
    fakeIconButton('copy'),
  );

  preview.dictionary = el(
    'div',
    { class: 'pb-section' },
    el('div', { class: 'pb-label', text: t('common_dictionary') }),
    el(
      'div',
      { class: 'pb-dict-line' },
      el('span', { class: 'pb-pos', text: t('options_preview_pos') }),
      el('span', { class: 'pb-terms', lang: 'vi', text: 'rõ ràng, hiển nhiên, rành rành' }),
    ),
  );

  preview.definitions = el(
    'div',
    { class: 'pb-section' },
    el('div', { class: 'pb-label', text: t('common_definitions') }),
    el('p', { class: 'pb-def', lang: 'en', text: 'Easily seen, recognized or understood.' }),
  );

  preview.examples = el(
    'div',
    { class: 'pb-section' },
    el('div', { class: 'pb-label', text: t('common_examples') }),
    el(
      'p',
      { class: 'pb-example', lang: 'en' },
      document.createTextNode('“It was '),
      el('strong', { text: 'obvious' }),
      document.createTextNode(' that something was wrong.”'),
    ),
  );

  preview.pair = el('span', { class: 'pb-pair' });
  preview.provider = el('span');
  const foot = el('div', { class: 'pb-foot' }, preview.pair, preview.provider);

  preview.bubble = el('div', { class: 'pb', dir: 'ltr' }, head, translation, preview.dictionary, preview.definitions, preview.examples, foot);
  stage.append(sentence, preview.bubble);
}

function updatePreview(s) {
  if (!preview.bubble) return;
  preview.bubble.style.fontSize = `${s.fontSize}px`;
  preview.phonetic.hidden = !s.showPhonetic;
  preview.dictionary.hidden = !s.showDictionary;
  preview.definitions.hidden = !s.showDefinitions;
  preview.examples.hidden = !s.showExamples;
  preview.pair.textContent = `${getLanguageName('en')} → ${getLanguageName('vi')}`;
  preview.provider.textContent = t(s.provider === 'microsoft' ? 'common_provider_microsoft' : 'common_provider_google');
}

/* ---------- Voice test ---------- */

async function testVoice() {
  const button = $('#test-voice');
  button.disabled = true;
  try {
    await flushRangeSaves();
    await send(MSG.SPEAK, { text: t('options_voice_sample'), lang: t('options_voice_sample_lang') });
  } catch (err) {
    showToast(errorMessage(err), { type: 'error', duration: 3200 });
  } finally {
    setTimeout(() => {
      button.disabled = false;
    }, 500);
  }
}

/* ================================================================== */
/* Navigation: hash routing + scroll-spy                               */
/* ================================================================== */

let navLocked = false;
let navLockTimer = 0;
let scrollFrame = 0;

function setupNav() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-section]');
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    goTo(link.dataset.section, { smooth: true, focus: true });
  });

  window.addEventListener('hashchange', () => {
    const id = sectionFromHash();
    if (id) goTo(id, { smooth: true });
  });

  window.addEventListener(
    'scroll',
    () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        updateActive();
      });
    },
    { passive: true },
  );
  // After a programmatic (nav) scroll finishes, resume scroll-spy on the next user scroll.
  window.addEventListener('scrollend', () => {
    navLocked = false;
  });
  window.addEventListener('resize', () => updateActive(), { passive: true });
}

function sectionFromHash() {
  let id = '';
  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    /* ignore */
  }
  return SECTIONS.includes(id) ? id : null;
}

function goTo(id, { smooth = false, focus = false } = {}) {
  const section = document.getElementById(id);
  if (!section) return;
  setActive(id);
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);

  navLocked = true;
  clearTimeout(navLockTimer);
  navLockTimer = setTimeout(() => {
    navLocked = false;
  }, 1500);

  section.scrollIntoView({ behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'instant', block: 'start' });
  if (focus) section.querySelector('.section-title')?.focus({ preventScroll: true });
}

function updateActive() {
  if (navLocked) return;
  const mobile = matchMedia(MOBILE_QUERY).matches;
  const offset = mobile ? $('.sidebar').offsetHeight + 32 : 120;
  let current = SECTIONS[0];
  for (const id of SECTIONS) {
    const section = document.getElementById(id);
    if (section && section.getBoundingClientRect().top - offset <= 0) current = id;
  }
  const doc = document.documentElement;
  if (window.scrollY > 0 && Math.ceil(window.scrollY + window.innerHeight) >= doc.scrollHeight - 2) {
    current = SECTIONS[SECTIONS.length - 1];
  }
  if (current === state.activeSection) return;
  setActive(current);
  if (location.hash || window.scrollY > 0) history.replaceState(null, '', `#${current}`);
}

function setActive(id) {
  state.activeSection = id;
  let activeLink = null;
  $$('.nav-link').forEach((link) => {
    if (link.dataset.section === id) {
      link.setAttribute('aria-current', 'location');
      activeLink = link;
    } else {
      link.removeAttribute('aria-current');
    }
  });
  // Keep the active tab visible in the horizontal (mobile) nav.
  const nav = $('#nav');
  if (activeLink && nav.scrollWidth > nav.clientWidth + 1) {
    const navRect = nav.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    const delta = linkRect.left - navRect.left - (navRect.width - linkRect.width) / 2;
    nav.scrollBy({ left: delta, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
  }
}

/* ================================================================== */
/* Sites                                                               */
/* ================================================================== */

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/** Turn user input ("https://www.Example.com/page", "*.example.com", "ví-dụ.vn") into a hostname, or ''. */
function parseSite(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  let host = normalizeHostname(value);
  if (!host) {
    // Internationalized domains → punycode (what location.hostname reports).
    try {
      const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value.replace(/^\*\./, '')}`;
      host = normalizeHostname(new URL(withScheme).hostname);
    } catch {
      host = '';
    }
  }
  host = host.replace(/\.+$/, '');
  return host === 'localhost' || HOST_RE.test(host) || IPV4_RE.test(host) ? host : '';
}

function setupSites() {
  const input = $('#site-input');
  $('#site-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addSite();
  });
  input.addEventListener('input', () => setSiteError(''));
  $('#site-list').addEventListener('click', (e) => {
    const button = e.target.closest('[data-remove-site]');
    if (button) removeSite(button.dataset.removeSite, button);
  });
}

function setSiteError(message) {
  $('#site-error').textContent = message;
  $('#site-input').setAttribute('aria-invalid', message ? 'true' : 'false');
}

function addSite() {
  const input = $('#site-input');
  const host = parseSite(input.value);
  if (!host) {
    setSiteError(t('options_sites_error_invalid'));
    input.focus();
    return;
  }
  const list = state.settings?.disabledSites || [];
  if (list.includes(host)) {
    setSiteError(t('options_sites_error_duplicate', host));
    input.select();
    return;
  }
  state.lastAddedSite = host;
  input.value = '';
  setSiteError('');
  save({ disabledSites: [...list, host] });
  input.focus();
}

function removeSite(host, button) {
  const list = state.settings?.disabledSites || [];
  const item = button.closest('li');
  const neighbour = item?.nextElementSibling || item?.previousElementSibling;
  const neighbourHost = neighbour?.querySelector('[data-remove-site]')?.dataset.removeSite;
  save({ disabledSites: list.filter((h) => h !== host) });
  const target = neighbourHost && $(`[data-remove-site="${CSS.escape(neighbourHost)}"]`);
  (target || $('#site-input')).focus();
}

function hueFor(text) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % 360;
}

function renderSites(list = []) {
  const ul = $('#site-list');
  const key = list.join('\n');
  if (ul.dataset.key === key) return; // unchanged → keep DOM (and focus) intact
  ul.dataset.key = key;

  const items = [...list].reverse().map((host) => {
    const avatar = el('span', { class: 'site-avatar', 'aria-hidden': 'true', text: host.charAt(0) });
    avatar.style.setProperty('--hue', String(hueFor(host)));
    const label = t('options_sites_remove', host);
    const item = el(
      'li',
      { class: 'site-item' },
      avatar,
      el('span', { class: 'site-host', dir: 'ltr', title: host, text: host }),
      el(
        'button',
        { type: 'button', class: 'icon-btn site-remove', 'data-remove-site': host, 'aria-label': label, title: label },
        icon('x', { size: 16 }),
      ),
    );
    if (host === state.lastAddedSite) item.classList.add('is-new');
    return item;
  });
  ul.replaceChildren(...items);
  state.lastAddedSite = null;
  $('#site-empty').hidden = list.length > 0;
}

/* ================================================================== */
/* Keyboard shortcuts                                                  */
/* ================================================================== */

function setupShortcuts() {
  renderShortcuts();
  $('#customize-shortcuts').addEventListener('click', openShortcutsPage);
  $('#ocr-shortcut-set').addEventListener('click', openShortcutsPage);
  // The user may change shortcuts in another tab — refresh when we come back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderShortcuts();
  });
}

async function renderShortcuts() {
  const list = $('#shortcut-list');
  const commands = await getCommands();
  renderOcrShortcut(commands);
  if (!commands.length) {
    list.replaceChildren(el('li', { class: 'shortcut-empty', text: t('options_shortcuts_unavailable') }));
    return;
  }
  list.replaceChildren(
    ...commands.map((command) => {
      const name = commandLabel(command);
      const keys = shortcutKeys(command.shortcut);
      return el(
        'li',
        { class: 'shortcut-item' },
        el('span', { class: 'shortcut-name', text: name }),
        keys.length ? kbdGroup(keys) : el('span', { class: 'shortcut-unset', text: t('options_shortcut_not_set') }),
      );
    }),
  );
}

/** "How to start" tile in the Image translation section: the crop-translate shortcut, or a way to set one. */
function renderOcrShortcut(commands) {
  const keys = shortcutKeys(commands.find((c) => c.name === 'crop-translate')?.shortcut);
  $('#ocr-shortcut').replaceChildren(
    keys.length ? kbdGroup(keys) : el('span', { class: 'shortcut-unset', text: t('options_shortcut_not_set') }),
  );
  $('#ocr-shortcut-set').hidden = keys.length > 0;
}

/* ================================================================== */
/* Data & privacy                                                      */
/* ================================================================== */

function setupData() {
  getHistory()
    .then((list) => setCount('history', list.length))
    .catch(() => {});
  getFavorites()
    .then((list) => setCount('favorites', list.length))
    .catch(() => {});
  onHistoryChanged((list) => setCount('history', list.length));
  onFavoritesChanged((list) => setCount('favorites', list.length));

  setupConfirm($('#confirm-history'), async () => {
    await clearHistory();
    showToast(t('options_history_cleared'));
  });
  setupConfirm($('#confirm-favorites'), async () => {
    await clearFavorites();
    showToast(t('options_favorites_cleared'));
  });
  // Image translation: delete the downloaded Tesseract language data (re-downloaded on next use).
  setupConfirm($('#confirm-ocr-cache'), async () => {
    await send(MSG.OCR_CLEAR_CACHE);
    showToast(t('options_ocr_cache_cleared'));
  });
  setupConfirm($('#confirm-reset'), async () => {
    for (const key of Object.keys(pendingRange)) delete pendingRange[key];
    clearTimeout(rangeTimer);
    const run = saveChain.then(() => resetSettings());
    saveChain = run.catch(() => {});
    render(await run);
    showToast(t('options_reset_done'));
  });

  $('#export-btn').addEventListener('click', exportBackup);
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', importBackup);
}

function formatCount(n) {
  const key = pluralRules.select(n) === 'one' ? 'options_items_one' : 'options_items_other';
  return t(key, numberFormat.format(n));
}

function setCount(kind, n) {
  $(`#${kind}-count`).textContent = formatCount(n);
  const container = $(`#confirm-${kind}`);
  const trigger = $('[data-confirm-trigger]', container);
  trigger.disabled = n === 0;
  if (n === 0 && !$('[data-confirm-actions]', container).hidden) container.dispatchEvent(new Event('confirm:close'));
}

/** Inline two-step confirmation: trigger → "Are you sure? [Cancel] [Confirm]". */
function setupConfirm(container, action) {
  const trigger = $('[data-confirm-trigger]', container);
  const actions = $('[data-confirm-actions]', container);
  const ok = $('[data-confirm-ok]', container);
  const cancel = $('[data-confirm-cancel]', container);
  let busy = false;

  const open = () => {
    actions.hidden = false;
    ok.focus();
    trigger.hidden = true;
  };
  const close = (focusTrigger) => {
    if (actions.hidden) return;
    trigger.hidden = false;
    if (focusTrigger && !trigger.disabled) trigger.focus();
    actions.hidden = true;
  };

  trigger.addEventListener('click', open);
  cancel.addEventListener('click', () => close(true));
  ok.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    ok.disabled = true;
    cancel.disabled = true;
    try {
      await action();
    } catch (err) {
      console.error('[TransPop]', err);
      showToast(t('common_error_UNKNOWN'), { type: 'error', duration: 3200 });
    } finally {
      busy = false;
      ok.disabled = false;
      cancel.disabled = false;
      close(true);
    }
  });
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !actions.hidden) {
      e.stopPropagation();
      close(true);
    }
  });
  container.addEventListener('focusout', (e) => {
    if (!busy && !actions.hidden && !container.contains(e.relatedTarget)) close(false);
  });
  container.addEventListener('confirm:close', () => close(false));
}

function dateStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function exportBackup() {
  const button = $('#export-btn');
  button.disabled = true;
  try {
    await flushRangeSaves();
    const data = await exportData();
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `transpop-backup-${dateStamp()}.json`, hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast(t('options_export_done'));
  } catch (err) {
    console.error('[TransPop] export failed', err);
    showToast(t('common_error_UNKNOWN'), { type: 'error', duration: 3200 });
  } finally {
    button.disabled = false;
  }
}

async function importBackup(e) {
  const input = e.target;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('INVALID_FILE');
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error('INVALID_FILE');
    }
    await flushRangeSaves();
    const result = await importData(data);
    showToast(t('options_import_done', [numberFormat.format(result.history), numberFormat.format(result.favorites)]), {
      duration: 4000,
    });
  } catch (err) {
    const invalid = err?.message === 'INVALID_FILE';
    if (!invalid) console.error('[TransPop] import failed', err);
    showToast(invalid ? t('options_import_invalid') : t('common_error_UNKNOWN'), { type: 'error', duration: 4000 });
  }
}

/* ================================================================== */
/* Boot (last, so every module-level binding above is initialised)     */
/* ================================================================== */

init()
  .catch((err) => console.error('[TransPop] options failed to initialise', err))
  .finally(() => {
    const id = sectionFromHash();
    if (id) goTo(id);
    else updateActive();
    root.classList.remove('is-loading');
  });
