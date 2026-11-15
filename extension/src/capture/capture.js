/**
 * TransPop — screenshot page (ES module), the image-translation fallback (ARCHITECTURE §11).
 *
 * The service worker opens it in a popup window when the page itself can't show the crop overlay (Chrome's PDF
 * viewer, browser pages, the Chrome Web Store, tabs opened before the extension was installed…):
 *   ?id=<captureId>  → `get-capture` → drag a region on the screenshot → crop it here at full resolution with the same
 *                      pre-processing as the service worker (cropForOcr) → `ocr-image` → recognized text (editable)
 *                      + translation (`translate`), copy / speak, "Select again".
 *   ?error=<CODE>    → nothing could be captured: explain why.
 * The OCR language picker sends `langs` once changed; the service worker remembers them as the new default.
 * Recognized / translated text only goes through textContent / .value.
 */
import { MSG } from '../shared/constants.js';
import { send } from '../shared/messaging.js';
import { initI18n, localizeDocument, reloadOnUiLanguageChange, t } from '../shared/i18n.js';
import { getLanguageName, getLanguageOptions, isRtl } from '../shared/languages.js';
import { OCR_MAX_LANGUAGES, getOcrLanguageOptions, normalizeOcrLanguages, ocrToLang } from '../shared/ocr-languages.js';
import { getSettings } from '../shared/storage.js';
import { applyTheme } from '../ui/theme.js';
import { hydrateIcons, icon } from '../ui/icons.js';
import { cropForOcr } from '../background/capture.js';

const params = new URLSearchParams(location.search);
const CAPTURE_ID = params.get('id') || '';
const ERROR = params.get('error') || '';
const MIN_SIZE = 12; // screenshot px (CSS px of the captured page, roughly)
const SLOW_HINT_MS = 3000;
const RELANG_DEBOUNCE_MS = 700;
const LOW_CONFIDENCE = 60;
const IS_MAC = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');

applyTheme('auto'); // follow the OS until the settings arrive
hydrateIcons(document);
await initI18n();
localizeDocument();
reloadOnUiLanguageChange();

const $ = (id) => document.getElementById(id);
const els = {
  from: $('from'),
  langs: $('ocr-langs'),
  close: $('btn-close'),
  hint: $('hint'),
  stage: $('stage'),
  frame: $('frame'),
  shot: $('shot'),
  sel: $('sel'),
  selSize: $('sel-size'),
  stageMsg: $('stage-msg'),
  stageSpinner: $('stage-spinner'),
  stageMsgText: $('stage-msg-text'),
  stageMsgSub: $('stage-msg-sub'),
  panel: $('panel'),
  paneEmpty: $('pane-empty'),
  paneBusy: $('pane-busy'),
  busySlow: $('busy-slow'),
  paneError: $('pane-error'),
  errorMsg: $('error-msg'),
  retry: $('btn-retry'),
  again: $('btn-again'),
  whole: $('btn-whole'),
  paneResult: $('pane-result'),
  text: $('ocr-text'),
  lowConfidence: $('low-confidence'),
  speakSrc: $('btn-speak-src'),
  copySrc: $('btn-copy-src'),
  translateAgain: $('btn-translate-again'),
  fromLang: $('from-lang'),
  to: $('to'),
  trLoading: $('tr-loading'),
  translation: $('translation'),
  translit: $('translit'),
  trError: $('tr-error'),
  trErrorMsg: $('tr-error-msg'),
  trRetry: $('btn-tr-retry'),
  trTools: $('tr-tools'),
  speakTr: $('btn-speak-tr'),
  copyTr: $('btn-copy-tr'),
  selectAgain: $('btn-select-again'),
  powered: $('powered'),
  toast: $('toast'),
};

const state = {
  settings: null,
  shot: null, // { dataUrl, width, height, tabTitle? } — width/height in screenshot (device) px
  scale: 1, // displayed px per screenshot px
  sel: null, // selection in screenshot px {x, y, width, height}
  drag: null,
  langs: ['eng'],
  langsTouched: false,
  phase: 'empty', // 'empty' | 'busy' | 'error' | 'result'
  ocr: null,
  ocrError: null,
  ocrReq: 0,
  slowTimer: 0,
  relangTimer: 0,
  text: '', // last translated text
  to: null,
  result: null,
  trError: null,
  trReq: 0,
  trLoading: false,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
const errorText = (code) => t(`common_error_${code}`) || t('common_error_UNKNOWN');
const codeOf = (err, fallback = 'UNKNOWN') => (err?.code && err.code !== 'UNKNOWN' ? err.code : fallback);
const ocrLang = () => state.ocr?.lang || (state.ocr?.langs?.length === 1 ? ocrToLang(state.ocr.langs[0]) : null) || null;

let toastTimer = 0;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 1600);
}

/* ------------------------------------------------------------------ */
/* Stage messages (loading / expired / capture error)                  */
/* ------------------------------------------------------------------ */

function showStageMessage(text, { sub = '', spinner = false, error = false } = {}) {
  els.frame.hidden = true;
  els.stageMsg.hidden = false;
  els.stageSpinner.hidden = !spinner;
  els.stageMsg.querySelector('.error-icon')?.remove();
  if (error) els.stageMsg.prepend(icon('alert', { size: 22, className: 'error-icon' }));
  els.stageMsg.setAttribute('role', error ? 'alert' : 'status');
  els.stageMsgText.textContent = text;
  els.stageMsgSub.textContent = sub;
  els.stageMsgSub.hidden = !sub;
}

/* ------------------------------------------------------------------ */
/* OCR language picker                                                 */
/* ------------------------------------------------------------------ */

function renderLangPicker(keepFocus = false) {
  const hadFocus = keepFocus && els.langs.contains(document.activeElement);
  const nodes = [icon('languages', { size: 16 })];
  const several = state.langs.length > 1;
  for (const code of state.langs) {
    const name = getLanguageName(ocrToLang(code)) || code;
    const chip = document.createElement('span');
    chip.className = several ? 'lchip' : 'lchip is-single';
    chip.lang = ocrToLang(code) || '';
    chip.append(name);
    if (several) {
      const x = document.createElement('button');
      x.type = 'button';
      x.setAttribute('aria-label', t('bubble_crop_lang_remove', name));
      x.title = t('bubble_crop_lang_remove', name);
      x.append(icon('x', { size: 12 }));
      x.addEventListener('click', () => setLangs(state.langs.filter((c) => c !== code)));
      chip.append(x);
    }
    nodes.push(chip);
  }
  if (state.langs.length < OCR_MAX_LANGUAGES) {
    const sel = document.createElement('select');
    sel.className = 'ladd';
    sel.setAttribute('aria-label', t('bubble_crop_lang_add'));
    sel.title = t('bubble_crop_lang_add');
    const placeholder = new Option('+', '', true, true);
    placeholder.hidden = true;
    sel.append(placeholder);
    for (const o of getOcrLanguageOptions()) if (!state.langs.includes(o.code)) sel.append(new Option(o.name, o.code));
    sel.addEventListener('change', () => sel.value && setLangs([...state.langs, sel.value]));
    nodes.push(sel);
  }
  els.langs.replaceChildren(...nodes);
  if (hadFocus) (els.langs.querySelector('.ladd') || els.langs.querySelector('button'))?.focus();
}

function setLangs(list) {
  const next = normalizeOcrLanguages(list);
  if (next.join('+') === state.langs.join('+')) return;
  state.langs = next;
  state.langsTouched = true;
  renderLangPicker(true);
  clearTimeout(state.relangTimer);
  if (state.sel && state.phase !== 'empty') state.relangTimer = setTimeout(recognize, RELANG_DEBOUNCE_MS);
}

/* ------------------------------------------------------------------ */
/* Screenshot + selection                                              */
/* ------------------------------------------------------------------ */

function layoutShot() {
  const shot = state.shot;
  if (!shot || els.frame.hidden) return;
  const box = els.stage.getBoundingClientRect();
  const maxScale = 1 / (window.devicePixelRatio || 1); // never larger than the page looked
  const scale = Math.min((box.width - 8) / shot.width, (box.height - 8) / shot.height, maxScale);
  const w = Math.max(1, Math.floor(shot.width * scale));
  const h = Math.max(1, Math.floor(shot.height * scale));
  els.shot.style.width = `${w}px`;
  els.shot.style.height = `${h}px`;
  state.scale = w / shot.width;
  renderSel();
}

function renderSel() {
  const r = state.sel;
  if (!r) {
    els.sel.hidden = true;
    return;
  }
  const k = state.scale;
  els.sel.hidden = false;
  els.sel.style.left = `${r.x * k}px`;
  els.sel.style.top = `${r.y * k}px`;
  els.sel.style.width = `${r.width * k}px`;
  els.sel.style.height = `${r.height * k}px`;
  const dpr = window.devicePixelRatio || 1;
  els.selSize.textContent = `${Math.round(r.width / dpr)} × ${Math.round(r.height / dpr)}`;
  els.selSize.classList.toggle('is-inside', (r.y + r.height) * k + 28 > els.shot.clientHeight);
  els.sel.classList.toggle('is-busy', state.phase === 'busy');
}

/** Pointer position → screenshot px (clamped to the image). */
function toShot(e) {
  const r = els.shot.getBoundingClientRect();
  return {
    x: clamp((e.clientX - r.left) / state.scale, 0, state.shot.width),
    y: clamp((e.clientY - r.top) / state.scale, 0, state.shot.height),
  };
}

function rectFrom(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

els.frame.addEventListener('pointerdown', (e) => {
  if (!state.shot || e.button !== 0 || !e.isPrimary) return;
  e.preventDefault();
  els.frame.setPointerCapture(e.pointerId);
  state.drag = { start: toShot(e), id: e.pointerId, moved: false, previous: state.sel };
});

els.frame.addEventListener('pointermove', (e) => {
  const d = state.drag;
  if (!d || e.pointerId !== d.id) return;
  const p = toShot(e);
  if (!d.moved && Math.abs(p.x - d.start.x) + Math.abs(p.y - d.start.y) < 3 / state.scale) return;
  d.moved = true;
  state.sel = rectFrom(d.start, p);
  renderSel();
});

function endDrag(e, cancelled) {
  const d = state.drag;
  if (!d || (e && e.pointerId !== d.id)) return;
  state.drag = null;
  const rect = !cancelled && d.moved ? rectFrom(d.start, toShot(e)) : null;
  const bigEnough = rect && rect.width >= MIN_SIZE && rect.height >= MIN_SIZE && rect.width * state.scale >= 6 && rect.height * state.scale >= 6;
  if (bigEnough) {
    state.sel = rect;
    renderSel();
    recognize();
  } else {
    state.sel = d.previous; // a click or a tiny drag keeps the previous selection
    renderSel();
  }
}
els.frame.addEventListener('pointerup', (e) => endDrag(e, false));
els.frame.addEventListener('pointercancel', (e) => endDrag(e, true));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.drag) {
    e.preventDefault();
    endDrag(null, true);
  }
});

els.whole.addEventListener('click', () => {
  if (!state.shot) return;
  state.sel = { x: 0, y: 0, width: state.shot.width, height: state.shot.height };
  renderSel();
  recognize();
});

function selectAgain() {
  state.ocrReq++;
  state.trReq++;
  clearTimeout(state.slowTimer);
  clearTimeout(state.relangTimer);
  state.sel = null;
  state.ocr = null;
  state.result = null;
  setPhase('empty');
  renderSel();
  els.whole.focus();
}
els.again.addEventListener('click', selectAgain);
els.selectAgain.addEventListener('click', selectAgain);

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

function setPhase(phase) {
  state.phase = phase;
  els.paneEmpty.hidden = phase !== 'empty';
  els.paneBusy.hidden = phase !== 'busy';
  els.paneError.hidden = phase !== 'error';
  els.paneResult.hidden = phase !== 'result';
  if (phase !== 'busy') els.busySlow.hidden = true;
  els.sel.classList.toggle('is-busy', phase === 'busy');
  renderPowered();
}

function renderPowered() {
  const provider = state.phase === 'result' && state.result?.provider;
  els.powered.hidden = !provider;
  els.powered.textContent = provider ? t('common_powered_by', t(`common_provider_${provider}`) || provider) : '';
}

async function recognize() {
  if (!state.shot || !state.sel) return;
  const req = ++state.ocrReq;
  state.trReq++;
  state.ocr = null;
  state.result = null;
  state.text = '';
  setPhase('busy');
  clearTimeout(state.slowTimer);
  state.slowTimer = setTimeout(() => {
    if (req === state.ocrReq && state.phase === 'busy') els.busySlow.hidden = false;
  }, SLOW_HINT_MS);
  let ocr = null;
  let error = null;
  try {
    const dataUrl = await cropForOcr(state.shot.dataUrl, state.sel, { width: state.shot.width, height: state.shot.height });
    const payload = { dataUrl };
    if (state.langsTouched) payload.langs = state.langs; // otherwise the service worker uses settings.ocrLanguages
    ({ ocr } = await send(MSG.OCR_IMAGE, payload));
    if (!ocr || typeof ocr.text !== 'string' || !ocr.text.trim()) error = 'OCR_NO_TEXT';
  } catch (err) {
    error = codeOf(err, 'OCR_FAILED');
  }
  if (req !== state.ocrReq) return; // superseded
  clearTimeout(state.slowTimer);
  if (error) {
    state.ocrError = error;
    els.errorMsg.textContent = errorText(error);
    els.retry.hidden = error === 'OCR_NO_TEXT';
    setPhase('error');
    return;
  }
  state.ocr = { ...ocr, text: ocr.text.trim() };
  if (!state.langsTouched && Array.isArray(ocr.langs) && ocr.langs.length) {
    state.langs = normalizeOcrLanguages(ocr.langs);
    renderLangPicker();
  }
  showResult();
  translate(state.ocr.text);
}
els.retry.addEventListener('click', recognize);

function autosize() {
  els.text.style.height = 'auto';
  els.text.style.height = `${Math.min(els.text.scrollHeight + 2, Math.round(window.innerHeight * 0.4))}px`;
}

function showResult() {
  const lang = ocrLang();
  els.text.value = state.ocr.text;
  els.text.lang = lang || '';
  els.lowConfidence.hidden = !(Number(state.ocr.confidence) < LOW_CONFIDENCE);
  setPhase('result');
  autosize();
}

function updateTranslateAgain() {
  const value = els.text.value.trim();
  els.translateAgain.disabled = !value || state.trLoading || (!!state.result && !state.trError && value.replace(/\s+/g, ' ') === state.text.replace(/\s+/g, ' '));
}

function fillTargets(code) {
  if (!els.to.options.length) for (const o of getLanguageOptions()) els.to.append(new Option(o.name, o.code));
  if (!code) return;
  if (![...els.to.options].some((o) => o.value === code)) els.to.append(new Option(getLanguageName(code) || code, code));
  els.to.value = code;
}

function renderTranslation() {
  const r = state.result;
  const fromCode = (r?.from && r.from !== 'auto' && r.from) || ocrLang();
  els.fromLang.textContent = fromCode ? getLanguageName(fromCode) || fromCode : t('common_detect_language');
  fillTargets(r?.to || state.to || state.settings?.targetLang || '');
  els.trLoading.hidden = !state.trLoading;
  els.trError.hidden = !state.trError;
  els.trErrorMsg.textContent = state.trError ? errorText(state.trError) : '';
  const translation = r && typeof r.translation === 'string' ? r.translation : '';
  els.translation.textContent = translation;
  els.translation.lang = r?.to || '';
  els.translation.dir = r?.to && isRtl(r.to) ? 'rtl' : 'auto';
  const translit = r && typeof r.translit === 'string' ? r.translit.trim() : '';
  els.translit.hidden = !translit;
  els.translit.textContent = translit;
  els.trTools.hidden = !translation;
  updateTranslateAgain();
  renderPowered();
}

async function translate(text) {
  if (!text) return;
  const req = ++state.trReq;
  state.trLoading = true;
  state.trError = null;
  state.result = null;
  state.pendingText = text;
  renderTranslation();
  const payload = { text, from: ocrLang() || 'auto', source: 'popup' };
  if (state.to) payload.to = state.to;
  let result = null;
  let error = null;
  try {
    ({ result } = await send(MSG.TRANSLATE, payload));
    if (!result) error = 'UNKNOWN';
  } catch (err) {
    error = codeOf(err);
  }
  if (req !== state.trReq) return;
  state.trLoading = false;
  state.result = result;
  state.trError = error;
  if (result) state.text = text;
  renderTranslation();
}

els.text.addEventListener('input', () => {
  autosize();
  updateTranslateAgain();
});
els.text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!els.translateAgain.disabled) translate(els.text.value.trim());
  }
});
els.translateAgain.title = t('bubble_crop_translate_again_hint', IS_MAC ? '⌘ + Enter' : 'Ctrl + Enter');
els.translateAgain.addEventListener('click', () => translate(els.text.value.trim()));
els.trRetry.addEventListener('click', () => translate(state.pendingText || els.text.value.trim()));
els.to.addEventListener('change', () => {
  const to = els.to.value;
  if (!to || state.result?.to === to) return;
  state.to = to;
  translate(state.text || els.text.value.trim());
});

function speak(text, lang) {
  if (text) send(MSG.SPEAK, { text, lang: lang || 'auto' }).catch(() => {});
}
async function copy(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(t('common_copied'));
  } catch {
    /* clipboard blocked */
  }
}
els.speakSrc.addEventListener('click', () => speak(els.text.value.trim(), state.result?.from || ocrLang()));
els.copySrc.addEventListener('click', () => copy(els.text.value));
els.speakTr.addEventListener('click', () => speak(state.result?.translation || '', state.result?.to));
els.copyTr.addEventListener('click', () => copy(state.result?.translation || ''));
els.close.addEventListener('click', () => window.close());
window.addEventListener('beforeunload', () => send(MSG.STOP_SPEAK).catch(() => {}));

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

try {
  state.settings = await getSettings();
  applyTheme(state.settings.theme);
  state.langs = normalizeOcrLanguages(state.settings.ocrLanguages);
} catch {
  /* defaults */
}

if (!CAPTURE_ID) {
  document.documentElement.dataset.mode = 'error';
  showStageMessage(errorText(ERROR || 'CAPTURE_FAILED'), { sub: t('capture_restricted'), error: true });
} else {
  showStageMessage(t('capture_loading'), { spinner: true });
  let shot = null;
  try {
    shot = await send(MSG.GET_CAPTURE, { id: CAPTURE_ID });
  } catch {
    shot = null;
  }
  if (!shot || typeof shot.dataUrl !== 'string') {
    document.documentElement.dataset.mode = 'error';
    showStageMessage(t('capture_expired'), { error: true });
  } else {
    state.shot = shot;
    els.shot.addEventListener(
      'load',
      () => {
        state.shot.width = els.shot.naturalWidth || state.shot.width;
        state.shot.height = els.shot.naturalHeight || state.shot.height;
        els.stageMsg.hidden = true;
        els.frame.hidden = false;
        els.hint.hidden = false;
        els.panel.hidden = false;
        els.langs.hidden = false;
        if (shot.tabTitle) {
          els.from.textContent = t('capture_from', shot.tabTitle);
          els.from.hidden = false;
        }
        renderLangPicker();
        setPhase('empty');
        layoutShot();
        new ResizeObserver(layoutShot).observe(els.stage);
      },
      { once: true },
    );
    els.shot.addEventListener('error', () => showStageMessage(t('capture_expired'), { error: true }), { once: true });
    els.shot.src = shot.dataUrl;
  }
}
