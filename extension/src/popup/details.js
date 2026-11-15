/**
 * TransPop popup — details card renderer: dictionary, definitions, examples, synonyms, alternatives.
 * Only sections with data are rendered. Remote text is always inserted as text nodes; the only markup
 * honoured is Google's <b>…</b> in example sentences, via a whitelist splitter (never innerHTML).
 */
import { t } from '../shared/i18n.js';
import { icon } from '../ui/icons.js';
import { h } from './dom.js';

const LIMIT = Object.freeze({
  dictEntries: 5,
  dictTerms: 12,
  defItems: 3,
  examples: 3,
  synonyms: 12,
  alternatives: 6,
});

const NAMED_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });

/** Decode the few HTML entities providers may leave in text (pure string work, no DOM parsing). */
export function decodeEntities(input) {
  return String(input ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

const B_TAG = /(<\/?b\s*>)/i;
const B_OPEN = /^<b\s*>$/i;
const B_CLOSE = /^<\/b\s*>$/i;

/** Whitelist renderer: `<b>…</b>` → <strong>, everything else → text nodes. Returns a DocumentFragment. */
export function renderBoldText(raw) {
  const frag = document.createDocumentFragment();
  let bold = false;
  for (const part of String(raw ?? '').split(B_TAG)) {
    if (!part) continue;
    if (B_OPEN.test(part)) {
      bold = true;
      continue;
    }
    if (B_CLOSE.test(part)) {
      bold = false;
      continue;
    }
    const text = decodeEntities(part);
    frag.append(bold ? h('strong', null, text) : document.createTextNode(text));
  }
  return frag;
}

const plain = (s) => decodeEntities(String(s ?? '').replace(/<\/?b\s*>/gi, '')).trim();
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * Show the first `limit` children; the rest are hidden behind a "Show more" toggle.
 * Returns the container (or a wrapper with the toggle button).
 */
function limited(container, items, limit) {
  items.forEach((el, i) => {
    if (i >= limit) el.hidden = true;
    container.append(el);
  });
  if (items.length <= limit) return container;

  const extra = items.slice(limit);
  const btn = h('button', { type: 'button', class: 'more-btn', 'aria-expanded': 'false' });
  const label = h('span');
  btn.append(label, icon('chevron-down', { size: 14 }));
  const update = (open) => {
    btn.setAttribute('aria-expanded', String(open));
    label.textContent = open ? t('common_show_less') : `${t('common_show_more')} (${extra.length})`;
    extra.forEach((el) => {
      el.hidden = !open;
    });
  };
  btn.addEventListener('click', () => update(btn.getAttribute('aria-expanded') !== 'true'));
  update(false);
  return h('div', { class: 'limited' }, container, btn);
}

function section(id, title, ...content) {
  return {
    title,
    el: h('section', { class: `d-section d-${id}` }, h('h3', { class: 'd-title' }, title), ...content),
  };
}

const posLabel = (pos) => (nonEmpty(pos) ? h('div', { class: 'd-pos' }, pos.trim()) : null);

function dictionarySection(dictionary, from, to) {
  const groups = asArray(dictionary)
    .map((group) => {
      const entries = asArray(group?.entries).filter((e) => nonEmpty(e?.word));
      const terms = asArray(group?.terms).filter(nonEmpty);
      if (!entries.length && !terms.length) return null;
      let body;
      if (entries.length) {
        const rows = entries.map((entry) =>
          h(
            'div',
            { class: 'dict-row' },
            h('span', { class: 'dict-term', lang: to, dir: 'auto' }, entry.word),
            h('span', { class: 'dict-reverse', lang: from, dir: 'auto' }, asArray(entry.reverse).filter(nonEmpty).join(', ')),
          ),
        );
        body = limited(h('div', { class: 'dict-rows' }), rows, LIMIT.dictEntries);
      } else {
        const chips = terms.map((term) => h('span', { class: 'chip', lang: to, dir: 'auto' }, term));
        body = limited(h('div', { class: 'chips' }), chips, LIMIT.dictTerms);
      }
      return h('div', { class: 'd-group' }, posLabel(group?.pos), body);
    })
    .filter(Boolean);
  return groups.length ? section('dictionary', t('common_dictionary'), groups) : null;
}

function definitionsSection(definitions, from) {
  const groups = asArray(definitions)
    .map((group) => {
      const items = asArray(group?.items).filter((item) => nonEmpty(item?.definition));
      if (!items.length) return null;
      const lis = items.map((item) =>
        h(
          'li',
          { class: 'def-item' },
          h('div', { class: 'def-text', lang: from, dir: 'auto' }, plain(item.definition)),
          nonEmpty(item.example)
            ? h('div', { class: 'def-example', lang: from, dir: 'auto' }, '“', renderBoldText(item.example.trim()), '”')
            : null,
        ),
      );
      return h('div', { class: 'd-group' }, posLabel(group?.pos), limited(h('ol', { class: 'def-list' }), lis, LIMIT.defItems));
    })
    .filter(Boolean);
  return groups.length ? section('definitions', t('common_definitions'), groups) : null;
}

function examplesSection(examples, from) {
  const list = asArray(examples).filter(nonEmpty);
  if (!list.length) return null;
  const lis = list.map((ex) => h('li', { class: 'ex-item', lang: from, dir: 'auto' }, renderBoldText(ex.trim())));
  return section('examples', t('common_examples'), limited(h('ul', { class: 'ex-list' }), lis, LIMIT.examples));
}

function synonymsSection(synonyms, from, onWord) {
  const groups = asArray(synonyms)
    .map((group) => {
      const terms = [...new Set(asArray(group?.terms).filter(nonEmpty).map((s) => s.trim()))];
      if (!terms.length) return null;
      const chips = terms.map((term) => {
        if (typeof onWord !== 'function') return h('span', { class: 'chip', lang: from, dir: 'auto' }, term);
        const label = t('popup_translate_word', term);
        return h('button', { type: 'button', class: 'chip', lang: from, dir: 'auto', title: label, onClick: () => onWord(term) }, term);
      });
      return h('div', { class: 'd-group' }, posLabel(group?.pos), limited(h('div', { class: 'chips' }), chips, LIMIT.synonyms));
    })
    .filter(Boolean);
  return groups.length ? section('synonyms', t('common_synonyms'), groups) : null;
}

function alternativesSection(alternatives, translation, to) {
  const norm = (s) => s.trim().toLocaleLowerCase();
  const seen = new Set([norm(String(translation ?? ''))]);
  const list = [];
  for (const alt of asArray(alternatives)) {
    if (!nonEmpty(alt) || seen.has(norm(alt))) continue;
    seen.add(norm(alt));
    list.push(alt.trim());
  }
  if (!list.length) return null;
  const short = list.every((s) => s.length <= 40);
  const container = short ? h('div', { class: 'chips' }) : h('ul', { class: 'alt-list' });
  const items = list.map((alt) =>
    short ? h('span', { class: 'chip', lang: to, dir: 'auto' }, alt) : h('li', { lang: to, dir: 'auto' }, alt),
  );
  return section('alternatives', t('common_alternatives'), limited(container, items, LIMIT.alternatives));
}

/**
 * Render every available section of `result` into `container` (replacing its content).
 * @param {HTMLElement} container
 * @param {object} result  TranslationResult
 * @param {{onWord?: (word: string) => void}} [opts]  click handler for synonym chips
 * @returns {string[]} titles of the rendered sections (empty → nothing to show)
 */
export function renderDetails(container, result, { onWord } = {}) {
  container.replaceChildren();
  if (!result) return [];
  const langAttr = (code) => (typeof code === 'string' && code && code !== 'auto' ? code : null);
  const from = langAttr(result.from);
  const to = langAttr(result.to);
  const sections = [
    dictionarySection(result.dictionary, from, to),
    definitionsSection(result.definitions, from),
    examplesSection(result.examples, from),
    synonymsSection(result.synonyms, from, onWord),
    alternativesSection(result.alternatives, result.translation, to),
  ].filter(Boolean);
  for (const s of sections) container.append(s.el);
  return sections.map((s) => s.title);
}
