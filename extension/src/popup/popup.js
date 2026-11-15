/**
 * TransPop — toolbar popup / full-page translator (ES module entry).
 *
 * Views (URL `?view=`): default = toolbar popup (400px), `tab` = full-page layout, `window` = fluid popup window
 * (context-menu fallback). `?text=` prefills + translates. See docs/ARCHITECTURE.md §5.
 */
import { ERROR_CODES, LIMITS, MSG } from '../shared/constants.js';
import { AUTO, getLanguageName, getLanguageOptions, getUiLocale, isSupportedLang, normalizeLangCode } from '../shared/languages.js';
import { send, sendToTab } from '../shared/messaging.js';
import { localizeDocument, t } from '../shared/i18n.js';
import {
  getPopupState,
  getSettings,
  isFavorite,
  isSiteDisabled,
  normalizeHostname,
  onFavoritesChanged,
  onSettingsChanged,
  savePopupState,
  saveSettings,
  toggleFavorite,
} from '../shared/storage.js';
import { applyTheme } from '../ui/theme.js';
import { hydrateIcons } from '../ui/icons.js';
import { $, readPref, setIcon, setLabel, showToast, sleep, withTimeout, writePref } from './dom.js';
import { renderDetails } from './details.js';
import { createLibrary } from './library.js';

/* ------------------------------------------------------------------ */
/* Constants & view mode                                               */
/* ------------------------------------------------------------------ */

const DEBOUNCE_MS = 400; // live translation while typing (record: false)
const SETTLE_MS = 1500; // input settled → record in history (served from cache)
const SAVE_STATE_MS = 250;
const SELECTION_TIMEOUT_MS = 600;
const COPY_FEEDBACK_MS = 1500;
const MAX_LEN = LIMITS.MAX_TEXT_LENGTH;
const DETAILS_PREF_KEY = 'transpop:popup:detailsCollapsed';

const params = new URLSearchParams(location.search);
const VIEW = ['tab', 'window'].includes(params.get('view')) ? params.get('view') : 'popup';
document.documentElement.dataset.view = VIEW;
applyTheme('auto'); // follow the OS until settings arrive (avoids a light flash in dark mode)

/* ------------------------------------------------------------------ */
/* Elements & state                                                    */
/* ------------------------------------------------------------------ */

hydrateIcons(document);
localizeDocument(document);

const els = {
  main: $('main'),
  brandMark: $('brand-mark'),
  brandLogo: $('brand-logo'),
  btnLibrary: $('btn-library'),
  btnExpand: $('btn-expand'),
  btnSettings: $('btn-settings'),
  viewTranslator: $('view-translator'),
  fromSel: $('from-lang'),
  toSel: $('to-lang'),
  btnSwap: $('btn-swap'),
  inputCard: $('input-card'),
  input: $('input'),
  srcLang: $('src-lang'),
  srcPhonetic: $('src-phonetic'),
  btnSpeakSrc: $('btn-speak-src'),
  btnClear: $('btn-clear'),
  kbdMod: $('kbd-mod'),
  counter: $('counter'),
  outputCard: $('output-card'),
  dstLang: $('dst-lang'),
  outPlaceholder: $('out-placeholder'),
  outSkeleton: $('out-skeleton'),
  outText: $('out-text'),
  outTranslit: $('out-translit'),
  outError: $('out-error'),
  errorMsg: $('error-msg'),
  btnRetry: $('btn-retry'),
  btnSpeakDst: $('btn-speak-dst'),
  btnCopy: $('btn-copy'),
  btnStar: $('btn-star'),
  powered: $('powered'),
  details: $('details'),
  detailsToggle: $('details-toggle'),
  detailsSummary: $('details-summary'),
  detailsBody: $('details-body'),
  swEnabled: $('sw-enabled'),
  siteSwitch: $('site-switch'),
  siteSwitchText: $('site-switch-text'),
  swSite: $('sw-site'),
};

const state = {
  settings: null,
  from: AUTO,
  to: 'en',
  result: null, // last rendered TranslationResult
  resultKey: null, // request key of `result`
  error: null, // error code currently shown
  reqId: 0, // increments per request; stale responses are ignored
  recordedKey: null, // last key sent with record: true
  speaking: null, // 'src' | 'dst' | null
  speakToken: 0,
  hostname: '', // active tab hostname (toolbar popup only)
  userTyped: false,
};

let debounceTimer = 0;
let settleTimer = 0;
let saveTimer = 0;
let copyTimer = 0;

const numberFormat = new Intl.NumberFormat(getUiLocale());

const library = createLibrary({
  scroller: els.main,
  onOpen: openEntry,
  onBack: () => showTranslator(),
  getSettings: () => state.settings,
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const langName = (code) => getLanguageName(code) || code || '';
const requestKey = (text) => `${state.from}\u0001${state.to}\u0001${text}`;
const currentKey = () => requestKey(els.input.value.trim());
const isShortText = (s) => s.length <= LIMITS.DICT_MAX_CHARS && s.trim().split(/\s+/).length <= 3;

function sourceSpeakLang() {
  if (state.from !== AUTO) return state.from;
  const detected = state.result?.from;
  return detected && detected !== AUTO ? detected : null;
}

function detectedSource() {
  if (state.from !== AUTO) return state.from;
  const detected = state.result && !state.error ? state.result.from : null;
  return detected && detected !== AUTO && isSupportedLang(detected) ? detected : null;
}

/** Rough speech duration (the background resolves `speak` when playback *starts*). */
function estimateSpeechMs(text, rate) {
  let units = 0;
  for (const ch of text) units += /[぀-ヿ㐀-鿿가-힯]/.test(ch) ? 3 : 1;
  return Math.min(120_000, 700 + (units * 72) / (rate || 1));
}

/* ------------------------------------------------------------------ */
/* Static UI setup                                                     */
/* ------------------------------------------------------------------ */

function setupStaticUi() {
  // Logo fallback (gradient tile) if the SVG is missing.
  const onLogoError = () => els.brandMark.classList.add('is-fallback');
  els.brandLogo.addEventListener('error', onLogoError);
  if (els.brandLogo.complete && !els.brandLogo.naturalWidth) {
    // Either it already failed before this module ran, or it's an SVG without intrinsic size — check for real.
    fetch(els.brandLogo.src)
      .then((res) => {
        if (!res.ok) onLogoError();
      })
      .catch(onLogoError);
  }

  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  els.kbdMod.textContent = /mac|iphone|ipad/i.test(platform) ? '⌘' : 'Ctrl';

  if (VIEW === 'tab') document.title = t('popup_page_title');

  const collapsed = readPref(DETAILS_PREF_KEY, false) === true;
  els.detailsToggle.setAttribute('aria-expanded', String(!collapsed));

  buildLanguageSelects();
  updateCounter();
  renderPowered();
  updateLabels();
  updateSwapState();
}

function buildLanguageSelects() {
  const options = getLanguageOptions();
  const option = (code, name) => {
    const el = document.createElement('option');
    el.value = code;
    el.textContent = name;
    return el;
  };
  els.fromSel.replaceChildren(option(AUTO, t('common_detect_language')), ...options.map((o) => option(o.code, o.name)));
  els.toSel.replaceChildren(...options.map((o) => option(o.code, o.name)));
}

function syncSelects() {
  els.fromSel.value = state.from;
  if (els.fromSel.value !== state.from) {
    state.from = AUTO;
    els.fromSel.value = AUTO;
  }
  els.toSel.value = state.to;
  if (els.toSel.value !== state.to) {
    state.to = state.settings?.targetLang || 'en';
    els.toSel.value = state.to;
  }
  els.fromSel.title = els.fromSel.selectedOptions[0]?.textContent || '';
  els.toSel.title = els.toSel.selectedOptions[0]?.textContent || '';
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

function autoGrow() {
  const ta = els.input;
  const scrollTop = els.main.scrollTop; // collapsing to 'auto' could clamp the scroller → keep position
  ta.style.height = 'auto';
  const max = parseFloat(getComputedStyle(ta).maxHeight);
  const limit = Number.isFinite(max) ? max : Infinity;
  ta.style.height = `${Math.min(ta.scrollHeight, limit)}px`;
  ta.style.overflowY = ta.scrollHeight > limit + 1 ? 'auto' : 'hidden';
  els.main.scrollTop = scrollTop;
}

function updateCounter() {
  const n = els.input.value.length;
  els.counter.textContent = `${numberFormat.format(n)} / ${numberFormat.format(MAX_LEN)}`;
  els.counter.setAttribute('aria-label', t('popup_char_count', [numberFormat.format(n), numberFormat.format(MAX_LEN)]));
  els.counter.classList.toggle('is-warn', n >= MAX_LEN * 0.9 && n < MAX_LEN);
  els.counter.classList.toggle('is-limit', n >= MAX_LEN);
}

function updateInputChrome() {
  autoGrow();
  updateCounter();
  els.btnClear.classList.toggle('is-hidden', !els.input.value);
  updateLabels();
}

function setInputText(text) {
  els.input.value = String(text ?? '').slice(0, MAX_LEN);
  updateInputChrome();
}

function focusInput({ select = false } = {}) {
  els.input.focus({ preventScroll: true });
  if (select && els.input.value) els.input.select();
  else {
    const end = els.input.value.length;
    els.input.setSelectionRange(end, end);
  }
}

function onInput() {
  state.userTyped = true;
  updateInputChrome();
  saveStateSoon();
  scheduleTranslation(DEBOUNCE_MS);
}

/* ------------------------------------------------------------------ */
/* Translation                                                         */
/* ------------------------------------------------------------------ */

/** Live translate after `delay` (record: false), then record once the input has settled. */
function scheduleTranslation(delay = DEBOUNCE_MS) {
  clearTimeout(debounceTimer);
  clearTimeout(settleTimer);
  if (!els.input.value.trim()) {
    resetOutput();
    return;
  }
  debounceTimer = setTimeout(() => runTranslate(false), delay);
  settleTimer = setTimeout(() => runTranslate(true), SETTLE_MS);
}

/** Translate immediately and record (Ctrl/Cmd+Enter, blur, retry). */
function translateNow() {
  clearTimeout(debounceTimer);
  clearTimeout(settleTimer);
  runTranslate(true);
}

async function runTranslate(record) {
  clearTimeout(debounceTimer);
  if (record) clearTimeout(settleTimer);

  const text = els.input.value.trim();
  if (!text) {
    resetOutput();
    return;
  }

  const key = requestKey(text);
  const showing = state.resultKey === key && !state.error;
  const needsRecord = record && state.recordedKey !== key;

  const id = ++state.reqId; // always supersedes older in-flight requests
  if (showing) {
    setLoading(false); // e.g. the user typed and then reverted to the text already on screen
    if (!needsRecord) return;
  } else {
    setLoading(true);
  }
  if (needsRecord) state.recordedKey = key;

  try {
    const { result } = await send(MSG.TRANSLATE, {
      text,
      from: state.from,
      to: state.to,
      source: 'popup',
      record: needsRecord,
    });
    if (!result || typeof result.translation !== 'string') {
      throw Object.assign(new Error('Invalid response'), { code: ERROR_CODES.UNKNOWN });
    }
    // Ignore: superseded, input changed meanwhile (a new request is scheduled), or a silent "record" call.
    if (id !== state.reqId || key !== currentKey() || showing) return;
    state.resultKey = key;
    renderResult(result);
  } catch (err) {
    if (needsRecord && state.recordedKey === key) state.recordedKey = null;
    // Never replace a valid on-screen translation with the error of a silent "record" call.
    if (id !== state.reqId || key !== currentKey() || showing) return;
    renderError(err?.code);
  }
}

function setLoading(on) {
  const hasText = Boolean(state.result) && !state.error;
  els.outputCard.classList.toggle('is-loading', on);
  els.outputCard.classList.toggle('is-stale', on && hasText);
  els.details.classList.toggle('is-stale', on && hasText);
  els.outputCard.setAttribute('aria-busy', String(on));
  if (on) {
    els.outError.hidden = true;
    els.outPlaceholder.hidden = true;
    els.outSkeleton.hidden = hasText;
    if (!hasText) {
      els.outText.hidden = true;
      els.outTranslit.hidden = true;
    }
  } else {
    els.outSkeleton.hidden = true;
  }
}

function renderResult(result) {
  const fromSkeleton = !els.outSkeleton.hidden;
  state.result = result;
  state.error = null;
  setLoading(false);

  els.outPlaceholder.hidden = true;
  els.outError.hidden = true;
  els.outText.textContent = result.translation;
  els.outText.lang = result.to || '';
  els.outText.hidden = false;
  if (fromSkeleton) {
    els.outText.classList.remove('fade-in');
    void els.outText.offsetWidth; // restart the animation
    els.outText.classList.add('fade-in');
  }

  const translit = typeof result.translit === 'string' ? result.translit.trim() : '';
  els.outTranslit.textContent = translit;
  els.outTranslit.hidden = !translit;

  renderPowered(result.provider);
  setOutputActionsEnabled(true);
  updateLabels();
  updateSwapState();
  refreshFavorite();
  renderDetailsCard(result);
}

function renderError(code) {
  state.result = null;
  state.resultKey = null;
  state.error = ERROR_CODES[code] ? code : ERROR_CODES.UNKNOWN;
  setLoading(false);
  els.outPlaceholder.hidden = true;
  els.outText.hidden = true;
  els.outTranslit.hidden = true;
  els.errorMsg.textContent = t(`common_error_${state.error}`);
  els.outError.hidden = false;
  setOutputActionsEnabled(false);
  hideDetails();
  updateLabels();
  updateSwapState();
}

function resetOutput() {
  clearTimeout(debounceTimer);
  clearTimeout(settleTimer);
  state.reqId++; // invalidate in-flight requests
  state.result = null;
  state.resultKey = null;
  state.error = null;
  setLoading(false);
  els.outText.hidden = true;
  els.outText.textContent = '';
  els.outTranslit.hidden = true;
  els.outError.hidden = true;
  els.outPlaceholder.hidden = false;
  setOutputActionsEnabled(false);
  setStar(false);
  hideDetails();
  renderPowered();
  updateLabels();
  updateSwapState();
}

function setOutputActionsEnabled(on) {
  if (!on && state.speaking === 'dst') stopSpeaking();
  els.btnSpeakDst.disabled = !on;
  els.btnCopy.disabled = !on;
  els.btnStar.disabled = !on;
}

function renderPowered(provider = state.settings?.provider) {
  const name = t(provider === 'microsoft' ? 'common_provider_microsoft' : 'common_provider_google');
  els.powered.textContent = t('common_powered_by', name);
}

function updateLabels() {
  const r = state.error ? null : state.result;
  let source;
  if (state.from !== AUTO) source = langName(state.from);
  else if (r?.from && r.from !== AUTO) source = t('common_detected_language', langName(r.from));
  else source = t('common_detect_language');
  els.srcLang.textContent = source;

  const phonetic = typeof r?.phonetic === 'string' ? r.phonetic.trim() : '';
  els.srcPhonetic.hidden = !phonetic;
  els.srcPhonetic.textContent = phonetic ? (isShortText(r.text || '') ? `/${phonetic}/` : phonetic) : '';
  if (phonetic) els.srcPhonetic.title = phonetic;
  else els.srcPhonetic.removeAttribute('title');

  els.dstLang.textContent = state.settings ? langName(state.to) : '';
  // Keep the button usable while it is playing so it can always be stopped.
  els.btnSpeakSrc.disabled = state.speaking !== 'src' && (!els.input.value.trim() || !sourceSpeakLang());
}

function updateSwapState() {
  els.btnSwap.disabled = !detectedSource();
}

/* ------------------------------------------------------------------ */
/* Details card                                                        */
/* ------------------------------------------------------------------ */

function renderDetailsCard(result) {
  const titles = renderDetails(els.detailsBody, result, { onWord: lookupWord });
  els.detailsSummary.textContent = titles.join(' · ');
  els.details.classList.toggle('has-many', titles.length > 1);
  els.details.hidden = titles.length === 0;
}

function hideDetails() {
  els.details.hidden = true;
  els.details.classList.remove('is-stale');
  els.detailsBody.replaceChildren();
  els.detailsSummary.textContent = '';
}

/** Click on a synonym chip → translate that word (same language pair). */
function lookupWord(word) {
  setInputText(word);
  saveStateSoon();
  els.main.scrollTo({ top: 0, behavior: 'smooth' });
  focusInput();
  translateNow();
}

/* ------------------------------------------------------------------ */
/* Languages                                                           */
/* ------------------------------------------------------------------ */

function onLanguageChange() {
  state.from = els.fromSel.value || AUTO;
  state.to = els.toSel.value || state.settings?.targetLang || 'en';
  syncSelects();
  saveStateSoon();
  updateLabels();
  updateSwapState();
  scheduleTranslation(0);
}

function swapLanguages() {
  const source = detectedSource();
  if (!source) return;
  const translation = state.result && !state.error ? state.result.translation : '';
  let nextTo = source;
  const nextFrom = state.to;
  if (nextTo === nextFrom) {
    const { targetLang, secondaryLang } = state.settings || {};
    nextTo = targetLang && targetLang !== nextFrom ? targetLang : secondaryLang || (nextFrom === 'en' ? 'vi' : 'en');
  }
  state.from = nextFrom;
  state.to = nextTo;
  syncSelects();
  els.btnSwap.classList.toggle('is-flipped');
  if (translation) setInputText(translation);
  saveStateSoon();
  updateLabels();
  updateSwapState();
  focusInput();
  scheduleTranslation(0);
}

/* ------------------------------------------------------------------ */
/* Speech / copy / favorite                                            */
/* ------------------------------------------------------------------ */

function setSpeaking(which) {
  state.speaking = which;
  const buttons = [
    ['src', els.btnSpeakSrc, 'popup_listen_source'],
    ['dst', els.btnSpeakDst, 'popup_listen_translation'],
  ];
  for (const [key, btn, labelKey] of buttons) {
    const on = which === key;
    setIcon(btn, on ? 'stop' : 'volume');
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
    setLabel(btn, on ? t('common_stop') : t(labelKey));
  }
  els.btnSpeakSrc.disabled = which !== 'src' && (!els.input.value.trim() || !sourceSpeakLang());
}

function stopSpeaking() {
  state.speakToken++;
  setSpeaking(null);
  send(MSG.STOP_SPEAK).catch(() => {});
}

async function toggleSpeak(which) {
  if (state.speaking === which) {
    stopSpeaking();
    return;
  }
  const text = which === 'src' ? els.input.value.trim() : state.result?.translation?.trim();
  const lang = which === 'src' ? sourceSpeakLang() : state.result?.to;
  if (!text || !lang) return;

  const token = ++state.speakToken;
  setSpeaking(which);
  try {
    await send(MSG.SPEAK, { text: text.slice(0, MAX_LEN), lang });
    if (token !== state.speakToken) return;
    // `speak` resolves when playback starts; keep the stop state for the estimated duration.
    await sleep(estimateSpeechMs(text, state.settings?.speechRate));
    if (token === state.speakToken) setSpeaking(null);
  } catch {
    if (token !== state.speakToken) return;
    setSpeaking(null);
    showToast(t('popup_speak_failed'));
  }
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

async function copyTranslation() {
  const text = state.result?.translation;
  if (!text) return;
  let ok = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    ok = legacyCopy(text);
  }
  if (!ok) {
    showToast(t('popup_copy_failed'));
    return;
  }
  setIcon(els.btnCopy, 'check');
  els.btnCopy.classList.add('is-copied');
  setLabel(els.btnCopy, t('common_copied'));
  showToast(t('common_copied'));
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    setIcon(els.btnCopy, 'copy');
    els.btnCopy.classList.remove('is-copied');
    setLabel(els.btnCopy, t('popup_copy_translation'));
  }, COPY_FEEDBACK_MS);
}

function setStar(on, { animate = false } = {}) {
  setIcon(els.btnStar, on ? 'star-filled' : 'star');
  els.btnStar.classList.toggle('is-starred', on);
  els.btnStar.setAttribute('aria-pressed', String(on));
  setLabel(els.btnStar, t(on ? 'common_remove_favorite' : 'common_add_favorite'));
  if (animate && on) {
    els.btnStar.classList.remove('pop');
    void els.btnStar.offsetWidth;
    els.btnStar.classList.add('pop');
  }
}

async function refreshFavorite() {
  const r = state.result;
  if (!r || state.error) {
    setStar(false);
    return;
  }
  try {
    const fav = await isFavorite(r.text, r.to);
    if (state.result === r) setStar(fav);
  } catch {
    /* ignore */
  }
}

async function onStarClick() {
  const r = state.result;
  if (!r || state.error) return;
  try {
    const fav = await toggleFavorite(r);
    if (state.result === r) setStar(fav, { animate: true });
  } catch {
    showToast(t('common_error_UNKNOWN'));
  }
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function showLibrary() {
  els.viewTranslator.hidden = true;
  els.btnLibrary.setAttribute('aria-pressed', 'true');
  els.btnLibrary.classList.add('is-active');
  els.main.scrollTop = 0;
  library.open();
}

function showTranslator({ focus = true } = {}) {
  library.close();
  els.viewTranslator.hidden = false;
  els.btnLibrary.setAttribute('aria-pressed', 'false');
  els.btnLibrary.classList.remove('is-active');
  els.main.scrollTop = 0;
  if (focus) focusInput();
}

/** Load a history / favorites entry into the translator (not re-recorded). */
function openEntry(entry) {
  if (isSupportedLang(entry.to)) state.to = entry.to;
  if (state.from !== AUTO) state.from = isSupportedLang(entry.from) ? entry.from : AUTO;
  syncSelects();
  setInputText(entry.text);
  showTranslator({ focus: false });
  focusInput();
  saveStateSoon();
  state.recordedKey = currentKey();
  scheduleTranslation(0);
}

/* ------------------------------------------------------------------ */
/* Footer switches                                                     */
/* ------------------------------------------------------------------ */

function renderFooter() {
  const s = state.settings;
  if (!s) return;
  els.swEnabled.checked = s.enabled;
  const host = state.hostname;
  els.siteSwitch.hidden = !host;
  if (!host) return;
  els.siteSwitchText.textContent = t('popup_enable_site', host);
  els.siteSwitch.title = t('popup_enable_site_title', host);
  els.swSite.checked = !isSiteDisabled(s, host);
  els.swSite.disabled = !s.enabled;
  els.siteSwitch.classList.toggle('is-disabled', !s.enabled);
}

async function onEnabledChange() {
  try {
    state.settings = await saveSettings({ enabled: els.swEnabled.checked });
  } catch {
    showToast(t('common_error_UNKNOWN'));
  }
  renderFooter();
}

async function onSiteChange() {
  const host = state.hostname;
  if (!host) return;
  try {
    const current = (await getSettings()).disabledSites || [];
    const disabledSites = els.swSite.checked
      ? current.filter((site) => !(host === site || host.endsWith(`.${site}`)))
      : [...new Set([...current, host])];
    state.settings = await saveSettings({ disabledSites });
  } catch {
    showToast(t('common_error_UNKNOWN'));
  }
  renderFooter();
}

/* ------------------------------------------------------------------ */
/* Popup state                                                         */
/* ------------------------------------------------------------------ */

function snapshotState() {
  // `targetLang` lets us detect a changed default target language since the state was saved.
  return { text: els.input.value, from: state.from, to: state.to, targetLang: state.settings?.targetLang || null };
}

function saveStateNow() {
  clearTimeout(saveTimer);
  return savePopupState(snapshotState()).catch(() => {});
}

function saveStateSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateNow, SAVE_STATE_MS);
}

function resolveTarget(saved, settings) {
  const to = normalizeLangCode(saved?.to);
  const defaultChanged = saved?.targetLang && saved.targetLang !== settings.targetLang;
  return to && to !== AUTO && isSupportedLang(to) && !defaultChanged ? to : settings.targetLang;
}

function resolveSource(saved) {
  const from = normalizeLangCode(saved?.from);
  return from && (from === AUTO || isSupportedLang(from)) ? from : AUTO;
}

/* ------------------------------------------------------------------ */
/* Active tab (selection + hostname)                                   */
/* ------------------------------------------------------------------ */

async function querySelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== 'number' || tab.id < 0) return null;
    return await sendToTab(tab.id, MSG.GET_SELECTION); // null on restricted pages / no content script
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function bindEvents() {
  els.input.addEventListener('input', onInput);
  els.input.addEventListener('blur', () => {
    if (els.input.value.trim() && state.recordedKey !== currentKey()) translateNow();
  });

  els.fromSel.addEventListener('change', onLanguageChange);
  els.toSel.addEventListener('change', onLanguageChange);
  els.btnSwap.addEventListener('click', swapLanguages);

  // Keep focus in the textarea when clearing (no blur → no history record of discarded text).
  els.btnClear.addEventListener('pointerdown', (e) => e.preventDefault());
  els.btnClear.addEventListener('click', () => {
    if (state.speaking) stopSpeaking();
    setInputText('');
    state.recordedKey = null;
    resetOutput();
    saveStateSoon();
    focusInput();
  });

  els.btnSpeakSrc.addEventListener('click', () => toggleSpeak('src'));
  els.btnSpeakDst.addEventListener('click', () => toggleSpeak('dst'));
  els.btnCopy.addEventListener('click', copyTranslation);
  els.btnStar.addEventListener('click', onStarClick);
  els.btnRetry.addEventListener('click', translateNow);

  els.detailsToggle.addEventListener('click', () => {
    const expanded = els.detailsToggle.getAttribute('aria-expanded') !== 'true';
    els.detailsToggle.setAttribute('aria-expanded', String(expanded));
    writePref(DETAILS_PREF_KEY, !expanded);
  });

  els.btnLibrary.addEventListener('click', () => (library.isOpen() ? showTranslator() : showLibrary()));
  els.btnExpand.addEventListener('click', async () => {
    await saveStateNow();
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/popup.html?view=tab') });
    } catch {
      /* ignore */
    }
    window.close();
  });
  els.btnSettings.addEventListener('click', async () => {
    try {
      await chrome.runtime.openOptionsPage();
    } catch {
      /* ignore */
    }
    if (VIEW === 'popup') window.close();
  });

  els.swEnabled.addEventListener('change', onEnabledChange);
  els.swSite.addEventListener('change', onSiteChange);

  document.addEventListener('keydown', (e) => {
    if (library.isOpen()) {
      if (library.handleKeydown(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        showTranslator();
      }
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      translateNow();
    }
  });

  onSettingsChanged((settings) => {
    state.settings = settings;
    applyTheme(settings.theme);
    renderFooter();
    if (!state.result) renderPowered();
    library.onSettings(settings);
  });

  onFavoritesChanged(() => refreshFavorite());

  window.addEventListener('pagehide', saveStateNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveStateNow();
  });

  if (VIEW === 'tab') {
    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(autoGrow);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  // Start the selection lookup right away (toolbar popup only; in tab/window views the active tab is ourselves).
  const selectionPromise = VIEW === 'popup' ? querySelection() : Promise.resolve(null);
  selectionPromise.then((sel) => {
    const host = normalizeHostname(sel?.hostname || '');
    if (host) {
      state.hostname = host;
      renderFooter();
    }
  });

  const savedPromise = getPopupState().catch(() => null);
  const settings = await getSettings();
  state.settings = settings;
  applyTheme(settings.theme);
  renderPowered();
  renderFooter();

  const saved = await savedPromise;
  state.to = resolveTarget(saved, settings);
  state.from = resolveSource(saved);
  syncSelects();
  updateLabels();

  const urlText = (params.get('text') || '').trim();
  const selection = urlText ? null : await withTimeout(selectionPromise, SELECTION_TIMEOUT_MS, null);
  const selectedText = typeof selection?.text === 'string' ? selection.text.trim() : '';
  const prefill = urlText || selectedText;

  if (state.userTyped) {
    // The user started typing before the selection arrived — keep their text.
    return;
  }

  if (prefill) {
    state.from = AUTO; // unknown language of the selection
    syncSelects();
    setInputText(prefill);
    saveStateNow();
    focusInput({ select: true });
    translateNow();
  } else if (typeof saved?.text === 'string' && saved.text.trim()) {
    setInputText(saved.text);
    state.recordedKey = currentKey(); // restored, not a new lookup
    focusInput({ select: true });
    runTranslate(false);
  } else {
    updateInputChrome();
    focusInput();
  }
}

setupStaticUi();
bindEvents();
focusInput();
init().catch((err) => {
  console.error('[TransPop] Popup failed to initialise:', err);
  renderError(err?.code);
});
