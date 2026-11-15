/**
 * TransPop dev harness — OCR engine test page (dev/ocr-test.html). DEV ONLY, never packaged.
 * Runs the real engine (extension/src/offscreen/ocr-engine.js → vendored Tesseract.js) inside this page, optionally
 * after the real crop pre-processing (extension/src/background/capture.js → cropForOcr).
 *
 *   npm run dev → http://localhost:5179/dev/ocr-test.html
 */
import { clearCache, detectCoreVariant, getStatus, recognize, terminate, vendorBaseUrl, CORE_FILES } from '../extension/src/offscreen/ocr-engine.js';
import { cropForOcr } from '../extension/src/background/capture.js';
import { OCR_LANGUAGES, OCR_MAX_LANGUAGES } from '../extension/src/shared/ocr-languages.js';

const FIXTURES = [
  {
    id: 'en',
    label: 'English paragraph',
    src: './fixtures/en-paragraph.png',
    langs: ['eng'],
    expected:
      'Unemployment has been the most obvious cost of the recession,\nbut economists warn that the long-term consequences may be\nfar more subtle. Productivity growth has stalled, and many\nbusinesses remain reluctant to invest in new equipment while\ndemand is uncertain.',
  },
  {
    id: 'vi',
    label: 'Vietnamese (diacritics)',
    src: './fixtures/vi-sentence.png',
    langs: ['vie'],
    expected: 'Tiếng Việt có sáu thanh điệu: ngang, huyền, sắc,\nhỏi, ngã và nặng. Chúc bạn một ngày tốt lành!',
  },
  { id: 'ja', label: 'Japanese line', src: './fixtures/ja-line.png', langs: ['jpn'], expected: '今日はとても良い天気ですね。' },
  {
    id: 'zh',
    label: 'Chinese paragraph (Simplified)',
    src: './fixtures/zh-paragraph.png',
    langs: ['chi_sim'],
    expected: '机器翻译在过去十年里取得了巨大的进步。\n然而，在文学、法律和市场营销等领域，\n人工翻译仍然是不可或缺的。',
  },
];

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
};

const state = { dataUrl: null, fixture: null, langs: ['eng'], busy: false, t0: 0 };
const names = new Intl.DisplayNames(['en'], { type: 'language' });
const langName = (lang) => {
  try {
    return names.of(lang.replace('iw', 'he').replace('tl', 'fil'));
  } catch {
    return lang;
  }
};

/* ---------------- environment ---------------- */

$('env').textContent = `core: ${CORE_FILES[detectCoreVariant()]} · vendor: ${vendorBaseUrl()} · language data: jsDelivr @tesseract.js-data (cached in IndexedDB)`;

/* ---------------- image input ---------------- */

const readAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

async function setImage(dataUrl, fixture = null) {
  state.dataUrl = dataUrl;
  state.fixture = fixture;
  const img = el('img', { src: dataUrl, alt: fixture ? fixture.label : 'Selected image' });
  $('drop').replaceChildren(img);
  for (const b of document.querySelectorAll('#fixtures button')) b.setAttribute('aria-pressed', String(b.dataset.id === fixture?.id));
  if (fixture) setLangs(fixture.langs);
}

async function loadFixture(fx) {
  const res = await fetch(fx.src);
  if (!res.ok) throw new Error(`${fx.src}: HTTP ${res.status}`);
  await setImage(await readAsDataUrl(await res.blob()), fx);
}

for (const fx of FIXTURES) {
  const b = el('button', { type: 'button', textContent: fx.label });
  b.dataset.id = fx.id;
  b.addEventListener('click', () => loadFixture(fx).catch(showError));
  $('fixtures').append(b);
}

$('file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (file) await setImage(await readAsDataUrl(file));
});
const drop = $('drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) await setImage(await readAsDataUrl(file));
});
document.addEventListener('paste', async (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) await setImage(await readAsDataUrl(item.getAsFile()));
});

/* ---------------- languages ---------------- */

function setLangs(list) {
  state.langs = [...list];
  for (const box of document.querySelectorAll('#langs input')) box.checked = state.langs.includes(box.value);
  $('chosen').textContent = `Selected: ${state.langs.join(' + ') || '(none → eng)'}`;
}

for (const l of [...OCR_LANGUAGES].sort((a, b) => langName(a.lang).localeCompare(langName(b.lang)))) {
  const box = el('input', { type: 'checkbox', value: l.ocr });
  box.addEventListener('change', () => {
    if (box.checked) {
      if (state.langs.length >= OCR_MAX_LANGUAGES) state.langs.shift();
      state.langs.push(l.ocr);
    } else state.langs = state.langs.filter((c) => c !== l.ocr);
    setLangs(state.langs);
  });
  $('langs').append(el('label', {}, box, `${langName(l.lang)} (${l.ocr})`));
}
setLangs(state.langs);

/* ---------------- helpers ---------------- */

function similarity(a, b) {
  const x = a.replace(/\s+/g, ' ').trim();
  const y = b.replace(/\s+/g, ' ').trim();
  if (!x && !y) return 1;
  const prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

const imageSizeOf = (dataUrl) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Unreadable image'));
    img.src = dataUrl;
  });

/** Run the real crop pre-processing on the whole image, as if it were a screenshot at the given DPR. */
async function preprocess(dataUrl) {
  if (!$('pre').checked) return dataUrl;
  const dpr = Math.max(0.5, Number($('dpr').value) || 1);
  const { width, height } = await imageSizeOf(dataUrl);
  const viewport = { width: width / dpr, height: height / dpr };
  return cropForOcr(dataUrl, { x: 0, y: 0, width: viewport.width, height: viewport.height }, viewport);
}

function log(msg) {
  const t = ((performance.now() - state.t0) / 1000).toFixed(2);
  $('log').append(el('li', { textContent: `+${t}s ${msg}` }));
  $('log').lastElementChild.scrollIntoView({ block: 'nearest' });
}

let lastStatus = '';
function onProgress({ status, progress }) {
  const key = `${status}:${Math.round((progress || 0) * 10)}`;
  if (key === lastStatus) return;
  lastStatus = key;
  log(`${status} ${Math.round((progress || 0) * 100)}%`);
}

function stat(label, value) {
  return el('div', { className: 'stat' }, el('b', { textContent: value }), el('span', { textContent: label }));
}

function showError(err) {
  $('error').textContent = `${err?.code || 'ERROR'}: ${err?.message || err}`;
}

function setBusy(busy) {
  state.busy = busy;
  for (const id of ['run', 'runAll', 'clear', 'terminate']) $(id).disabled = busy;
}

/* ---------------- run ---------------- */

async function runOnce(dataUrl, langs, fixture) {
  const warm = getStatus().ready;
  const t0 = performance.now();
  const input = await preprocess(dataUrl);
  const t1 = performance.now();
  $('sent').src = input;
  const psm = $('psm').value || undefined;
  const ocr = await recognize(input, langs, { psm, onProgress });
  const t2 = performance.now();
  return { ocr, warm, prepMs: t1 - t0, ocrMs: t2 - t1, match: fixture ? similarity(ocr.text, fixture.expected) : null };
}

function render({ ocr, warm, prepMs, ocrMs, match }) {
  $('stats').replaceChildren(
    stat('confidence', `${ocr.confidence}`),
    stat(warm ? 'OCR (warm worker)' : 'OCR (incl. worker start)', `${Math.round(ocrMs)} ms`),
    stat('pre-process', `${Math.round(prepMs)} ms`),
    stat('lang hint', ocr.lang || '—'),
    stat('langs', ocr.langs.join('+')),
    ...(match == null ? [] : [stat('match vs expected', `${(match * 100).toFixed(1)}%`)]),
  );
  $('text').value = ocr.text;
  $('lines').replaceChildren(
    ...(ocr.lines || []).map((l, i) =>
      el(
        'tr',
        {},
        el('td', { textContent: String(i + 1) }),
        el('td', { textContent: l.text, dir: 'auto' }),
        el('td', { textContent: String(l.confidence) }),
        el('td', { textContent: l.bbox ? `${l.bbox.x0},${l.bbox.y0} → ${l.bbox.x1},${l.bbox.y1}` : '—' }),
      ),
    ),
  );
  $('json').textContent = JSON.stringify(ocr, null, 2);
}

function resetOutput() {
  $('error').textContent = '';
  $('stats').replaceChildren();
  $('text').value = '';
  $('lines').replaceChildren();
  $('json').textContent = '';
  $('log').replaceChildren();
  lastStatus = '';
  state.t0 = performance.now();
}

$('run').addEventListener('click', async () => {
  if (state.busy) return;
  if (!state.dataUrl) await loadFixture(FIXTURES[0]).catch(showError);
  resetOutput();
  setBusy(true);
  log(`start · langs ${state.langs.join('+') || 'eng'} · psm ${$('psm').value || 'auto'}`);
  try {
    const r = await runOnce(state.dataUrl, state.langs, state.fixture);
    render(r);
    log(`done · ${r.ocr.text.length} chars · engine ${JSON.stringify(getStatus())}`);
  } catch (err) {
    showError(err);
    log(`failed · ${err?.code}: ${err?.message}`);
  } finally {
    setBusy(false);
  }
});

$('runAll').addEventListener('click', async () => {
  if (state.busy) return;
  resetOutput();
  setBusy(true);
  $('summarySection').hidden = false;
  $('summary').replaceChildren();
  for (const fx of FIXTURES) {
    try {
      await loadFixture(fx);
      log(`fixture ${fx.id} · langs ${fx.langs.join('+')}`);
      const r = await runOnce(state.dataUrl, fx.langs, fx);
      render(r);
      const pass = r.match >= 0.95;
      $('summary').append(
        el(
          'tr',
          {},
          el('td', { textContent: fx.label }),
          el('td', { textContent: fx.langs.join('+') }),
          el('td', { className: pass ? 'ok' : 'err', textContent: `${(r.match * 100).toFixed(1)}%` }),
          el('td', { textContent: String(r.ocr.confidence) }),
          el('td', { textContent: `${Math.round(r.ocrMs)} ms${r.warm ? '' : ' (cold)'}` }),
          el('td', { textContent: r.ocr.text, dir: 'auto' }),
        ),
      );
    } catch (err) {
      $('summary').append(
        el('tr', {}, el('td', { textContent: fx.label }), el('td', { className: 'err', colSpan: 5, textContent: `${err?.code}: ${err?.message}` })),
      );
    }
  }
  log(`all fixtures done · engine ${JSON.stringify(getStatus())}`);
  setBusy(false);
});

$('clear').addEventListener('click', async () => {
  resetOutput();
  setBusy(true);
  try {
    await clearCache();
    log('worker terminated, IndexedDB language cache deleted — the next run downloads traineddata again');
  } catch (err) {
    showError(err);
  } finally {
    setBusy(false);
  }
});

$('terminate').addEventListener('click', async () => {
  await terminate();
  resetOutput();
  log('worker terminated — the next run starts a new one (language data from the IndexedDB cache)');
});

loadFixture(FIXTURES[0]).catch(showError);
