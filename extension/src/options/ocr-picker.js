/**
 * TransPop — OCR-language picker for the settings page (private to the options agent).
 *
 *   const picker = createOcrPicker(container, { onChange: (codes) => save({ ocrLanguages: codes }) });
 *   picker.setValue(settings.ocrLanguages);
 *
 * Two parts:
 *  - an ordered list of chips = the selected Tesseract codes in priority order (move earlier / remove);
 *  - a searchable checkbox list of every OCR language (checking appends to the end of the priority list).
 * Never more than OCR_MAX_LANGUAGES, never fewer than one. Language names come from Intl.DisplayNames (in the
 * effective UI locale) plus each language's own name, so a language can be found in either spelling.
 * Everything is built with DOM nodes / textContent.
 */
import { OCR_MAX_LANGUAGES, getOcrLanguageOptions } from '../shared/ocr-languages.js';
import { t } from '../shared/i18n.js';
import { icon } from '../ui/icons.js';
import { el, endonym } from './ui-kit.js';

/** Case- and accent-insensitive search key ("Tiếng Việt" → "tieng viet"). */
const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase();

/**
 * @param {HTMLElement} root  empty container (give it aria-labelledby / aria-describedby)
 * @param {{onChange?: (codes: string[]) => void, max?: number, idPrefix?: string}} [options]
 * @returns {{ setValue(codes: string[]): void, getValue(): string[] }}
 */
export function createOcrPicker(root, { onChange, max = OCR_MAX_LANGUAGES, idPrefix = 'ocr' } = {}) {
  const languages = getOcrLanguageOptions().map((o) => {
    const native = endonym(o.lang);
    return {
      ...o,
      native: fold(native) === fold(o.name) ? '' : native,
      haystack: fold(`${o.name} ${native} ${o.code} ${o.lang}`),
    };
  });
  const byCode = new Map(languages.map((l) => [l.code, l]));
  const nameOf = (code) => byCode.get(code)?.name || code;
  let value = [];

  /* ---------- DOM ---------- */

  const chips = el('ol', { class: 'ocr-chips', 'aria-label': t('options_ocr_selected_label') });

  const searchInput = el('input', {
    type: 'search',
    class: 'input',
    id: `${idPrefix}-search`,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: t('options_ocr_search_placeholder'),
    'aria-label': t('options_ocr_search_placeholder'),
    'aria-controls': `${idPrefix}-list`,
  });
  const search = el(
    'div',
    { class: 'input-icon-wrap ocr-search' },
    icon('search', { size: 16, className: 'input-icon' }),
    searchInput,
  );

  const list = el('div', {
    class: 'ocr-list',
    id: `${idPrefix}-list`,
    role: 'group',
    'aria-label': t('options_ocr_list_label'),
    'aria-describedby': `${idPrefix}-status`,
  });
  const empty = el('p', { class: 'ocr-empty', hidden: true });
  const status = el('p', { class: 'ocr-status', id: `${idPrefix}-status`, 'aria-live': 'polite' });

  const items = new Map(); // code → { label, input, rank }
  for (const l of languages) {
    const input = el('input', { type: 'checkbox', class: 'ocr-check', value: l.code });
    const rank = el('span', { class: 'ocr-option-rank', 'aria-hidden': 'true' });
    const label = el(
      'label',
      { class: 'ocr-option' },
      input,
      el(
        'span',
        { class: 'ocr-option-text' },
        el('span', { class: 'ocr-option-name', text: l.name }),
        l.native ? el('span', { class: 'ocr-option-native', lang: l.lang, dir: 'auto', text: l.native }) : null,
      ),
      rank,
    );
    items.set(l.code, { label, input, rank });
    list.append(label);
  }

  /* ---------- Rendering ---------- */

  function chip(code, index) {
    const name = nameOf(code);
    const up =
      index > 0
        ? el(
            'button',
            {
              type: 'button',
              class: 'icon-btn icon-btn-sm ocr-chip-btn',
              'data-ocr-action': 'up',
              'data-code': code,
              'aria-label': t('options_ocr_move_up', name),
              title: t('options_ocr_move_up', name),
            },
            icon('chevron-left', { size: 14, className: 'flip-rtl' }),
          )
        : null;
    const removeLabel = value.length > 1 ? t('options_ocr_remove', name) : t('options_ocr_min');
    const remove = el(
      'button',
      {
        type: 'button',
        class: 'icon-btn icon-btn-sm ocr-chip-btn ocr-chip-remove',
        'data-ocr-action': 'remove',
        'data-code': code,
        'aria-label': t('options_ocr_remove', name),
        title: removeLabel,
        disabled: value.length <= 1,
      },
      icon('x', { size: 14 }),
    );
    return el(
      'li',
      { class: 'ocr-chip', 'data-code': code },
      el('span', { class: 'ocr-chip-rank', 'aria-hidden': 'true', text: String(index + 1) }),
      el('span', { class: 'ocr-chip-name', text: name }),
      up,
      remove,
    );
  }

  function render() {
    chips.replaceChildren(...value.map(chip));
    const full = value.length >= max;
    for (const [code, item] of items) {
      const index = value.indexOf(code);
      const on = index >= 0;
      const disabled = on ? value.length <= 1 : full;
      item.input.checked = on;
      item.input.disabled = disabled;
      item.label.classList.toggle('is-checked', on);
      item.label.classList.toggle('is-disabled', disabled);
      item.rank.textContent = on ? String(index + 1) : '';
      if (disabled) item.label.title = on ? t('options_ocr_min') : t('options_ocr_limit', String(max));
      else item.label.removeAttribute('title');
    }
    status.textContent = full ? t('options_ocr_limit', String(max)) : t('options_ocr_count', [String(value.length), String(max)]);
    status.classList.toggle('is-full', full);
  }

  function filter() {
    const raw = searchInput.value.trim();
    const q = fold(raw);
    let shown = 0;
    for (const l of languages) {
      const match = !q || l.haystack.includes(q);
      items.get(l.code).label.hidden = !match;
      if (match) shown += 1;
    }
    list.hidden = shown === 0;
    empty.hidden = shown > 0;
    empty.textContent = shown ? '' : t('options_ocr_no_match', raw);
  }

  /* ---------- Changes ---------- */

  function commit(next) {
    value = next;
    render();
    onChange?.([...value]);
  }

  list.addEventListener('change', (e) => {
    const input = e.target.closest('input.ocr-check');
    if (!input) return;
    const code = input.value;
    if (input.checked) {
      if (value.includes(code) || value.length >= max) return render();
      commit([...value, code]);
    } else {
      if (value.length <= 1) return render();
      commit(value.filter((c) => c !== code));
    }
  });

  chips.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-ocr-action]');
    if (!button || button.disabled) return;
    const code = button.dataset.code;
    const index = value.indexOf(code);
    if (index < 0) return;
    if (button.dataset.ocrAction === 'up' && index > 0) {
      const next = [...value];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      commit(next);
      // Keep focus on the moved chip (its "move earlier" button disappears once it is first).
      const target =
        chips.querySelector(`[data-ocr-action="up"][data-code="${CSS.escape(code)}"]`) ||
        chips.querySelector(`[data-ocr-action="remove"][data-code="${CSS.escape(code)}"]`);
      target?.focus();
    } else if (button.dataset.ocrAction === 'remove' && value.length > 1) {
      commit(value.filter((c) => c !== code));
      const removeButtons = chips.querySelectorAll('[data-ocr-action="remove"]');
      const target = removeButtons[Math.min(index, removeButtons.length - 1)];
      (target && !target.disabled ? target : searchInput).focus();
    }
  });

  /** Visible, enabled checkboxes in display order (arrow-key navigation). */
  const focusable = () => [...items.values()].filter((item) => !item.label.hidden && !item.input.disabled).map((item) => item.input);

  searchInput.addEventListener('input', filter);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) {
      e.preventDefault();
      e.stopPropagation();
      searchInput.value = '';
      filter();
    } else if (e.key === 'ArrowDown') {
      const first = focusable()[0]; // jump into the list
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // Up/Down move between languages; Up on the first one goes back to the search field.
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const inputs = focusable();
    const index = inputs.indexOf(e.target);
    if (index < 0) return;
    e.preventDefault();
    const next = index + (e.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) searchInput.focus();
    else inputs[Math.min(next, inputs.length - 1)].focus();
  });

  // Fill everything before inserting it, so the live status region doesn't announce on page load.
  render();
  filter();
  root.classList.add('ocr-picker');
  root.replaceChildren(chips, search, list, empty, status);

  return {
    setValue(codes) {
      const next = (Array.isArray(codes) ? codes : []).filter((c) => byCode.has(c)).slice(0, max);
      if (next.join('|') === value.join('|')) return;
      value = next;
      render();
    },
    getValue: () => [...value],
  };
}
