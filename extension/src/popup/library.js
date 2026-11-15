/**
 * TransPop popup — History & Favorites view (ES module).
 * Segmented History | Favorites, accent-insensitive search, progressive list rendering,
 * per-item star / delete, inline "Clear all" confirmation, CSV export, live updates.
 */
import { AUTO, getLanguageName, getUiLocale } from '../shared/languages.js';
import { formatRelativeTime, t } from '../shared/i18n.js';
import {
  clearFavorites,
  clearHistory,
  getFavorites,
  getHistory,
  onFavoritesChanged,
  onHistoryChanged,
  removeFavorite,
  removeHistoryEntry,
  saveSettings,
  toggleFavorite,
} from '../shared/storage.js';
import { icon } from '../ui/icons.js';
import { $, h, iconButton, readPref, showToast, writePref } from './dom.js';
import { csvFileName, downloadText, entriesToCsv } from './csv.js';

const PAGE_SIZE = 60;
const TAB_PREF_KEY = 'transpop:popup:libraryTab';
const TABS = ['history', 'favorites'];

/** Lower-case and strip diacritics so "dich" matches "dịch" and "cafe" matches "café". */
export function foldText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase();
}

const codeLabel = (code) => (!code || code === AUTO ? 'AUTO' : String(code).toUpperCase());

/**
 * @param {{
 *   scroller: HTMLElement,                    // scroll container (for progressive rendering)
 *   onOpen: (entry: object) => void,          // load an entry into the translator
 *   onBack: () => void,                       // return to the translator
 *   getSettings: () => object | null,
 * }} opts
 */
export function createLibrary({ scroller, onOpen, onBack, getSettings }) {
  const els = {
    view: $('view-library'),
    tabs: [...document.querySelectorAll('#lib-tabs [role="radio"]')],
    tabGroup: $('lib-tabs'),
    countHistory: $('count-history'),
    countFavorites: $('count-favorites'),
    searchWrap: $('lib-search-wrap'),
    search: $('lib-search'),
    notice: $('lib-notice'),
    noticeBtn: $('btn-history-on'),
    toolbar: $('lib-toolbar'),
    count: $('lib-count'),
    exportBtn: $('btn-export'),
    clearBtn: $('btn-clear-all'),
    confirm: $('lib-confirm'),
    confirmText: $('lib-confirm-text'),
    confirmYes: $('btn-confirm-yes'),
    confirmCancel: $('btn-confirm-cancel'),
    list: $('lib-list'),
    sentinel: $('lib-sentinel'),
    empty: $('lib-empty'),
    emptyIcon: $('lib-empty-icon'),
    emptyTitle: $('lib-empty-title'),
    emptyHint: $('lib-empty-hint'),
    back: $('btn-back'),
  };

  const locale = getUiLocale();
  const numberFormat = new Intl.NumberFormat(locale);
  const plural = new Intl.PluralRules(locale);
  const fmt = (n) => numberFormat.format(n);

  const state = {
    open: false,
    loaded: false,
    tab: TABS.includes(readPref(TAB_PREF_KEY, 'history')) ? readPref(TAB_PREF_KEY, 'history') : 'history',
    query: '',
    history: [],
    favorites: [],
    favKeys: new Set(),
    filtered: [],
    rendered: 0,
    confirming: false,
  };

  const foldCache = new WeakMap();
  const folded = (entry) => {
    let value = foldCache.get(entry);
    if (value === undefined) {
      value = foldText(`${entry.text}\n${entry.translation}`);
      foldCache.set(entry, value);
    }
    return value;
  };

  /* ------------------------------ data ------------------------------ */

  const sanitize = (list) => (Array.isArray(list) ? list.filter((e) => e && typeof e.text === 'string') : []);

  function setHistory(list) {
    state.history = sanitize(list);
  }

  function setFavorites(list) {
    state.favorites = sanitize(list);
    state.favKeys = new Set(state.favorites.map((e) => e.key));
  }

  async function load() {
    const [history, favorites] = await Promise.all([getHistory().catch(() => []), getFavorites().catch(() => [])]);
    setHistory(history);
    setFavorites(favorites);
    state.loaded = true;
  }

  onHistoryChanged((list) => {
    setHistory(list);
    updateCounts();
    if (state.open) render({ keepCount: true });
  });

  onFavoritesChanged((list) => {
    setFavorites(list);
    updateCounts();
    if (state.open) render({ keepCount: true });
  });

  /* ---------------------------- rendering ---------------------------- */

  const currentList = () => (state.tab === 'history' ? state.history : state.favorites);

  function countLabel(n) {
    return n > 999 ? '999+' : fmt(n);
  }

  function updateCounts() {
    els.countHistory.textContent = state.loaded ? countLabel(state.history.length) : '';
    els.countFavorites.textContent = state.loaded ? countLabel(state.favorites.length) : '';
  }

  function itemsLabel(n) {
    return plural.select(n) === 'one' ? t('popup_items_one') : t('popup_items_other', fmt(n));
  }

  function renderItem(entry) {
    const isFav = state.tab === 'favorites' || state.favKeys.has(entry.key);
    const fromName = getLanguageName(entry.from) || t('common_detect_language');
    const toName = getLanguageName(entry.to) || entry.to || '';
    const date = Number.isFinite(entry.ts) ? new Date(entry.ts) : null;
    const langAttr = (code) => (code && code !== AUTO ? code : null);

    const main = h(
      'button',
      { type: 'button', class: 'lib-item-main', 'data-role': 'open' },
      h('span', { class: 'lib-src', dir: 'auto', lang: langAttr(entry.from) }, entry.text),
      h('span', { class: 'lib-dst', dir: 'auto', lang: langAttr(entry.to) }, entry.translation || ''),
      h(
        'span',
        { class: 'lib-meta' },
        h('span', { class: 'lang-chip', title: `${fromName} → ${toName}` }, `${codeLabel(entry.from)} → ${codeLabel(entry.to)}`),
        date
          ? h(
              'time',
              { class: 'lib-time', datetime: date.toISOString(), title: date.toLocaleString(locale) },
              formatRelativeTime(entry.ts),
            )
          : null,
      ),
    );
    main.addEventListener('click', () => onOpen(entry));

    const star = iconButton(isFav ? 'star-filled' : 'star', t(isFav ? 'common_remove_favorite' : 'common_add_favorite'), {
      className: `icon-btn-sm${isFav ? ' is-starred' : ''}`,
      pressed: isFav,
    });
    star.dataset.role = 'star';
    star.addEventListener('click', () => onStar(entry));

    const del = iconButton('trash', t('common_delete'), { className: 'icon-btn-sm btn-del' });
    del.dataset.role = 'delete';
    del.addEventListener('click', () => onDelete(entry));

    return h('li', { class: 'lib-item', 'data-id': entry.id }, main, h('div', { class: 'lib-actions' }, star, del));
  }

  function appendItems(n) {
    const end = Math.min(state.filtered.length, state.rendered + n);
    if (end > state.rendered) {
      const frag = document.createDocumentFragment();
      for (let i = state.rendered; i < end; i++) frag.append(renderItem(state.filtered[i]));
      els.list.append(frag);
      state.rendered = end;
    }
    const more = state.rendered < state.filtered.length;
    els.sentinel.hidden = !more;
    if (more) {
      // Re-observe so the observer reports the current intersection again (keeps filling tall viewports).
      observer.unobserve(els.sentinel);
      observer.observe(els.sentinel);
    }
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (state.open && entries.some((e) => e.isIntersecting)) appendItems(PAGE_SIZE);
    },
    { root: scroller, rootMargin: '0px 0px 320px 0px' },
  );

  function captureFocus() {
    const active = document.activeElement;
    const li = active?.closest?.('.lib-item');
    if (!li || !els.list.contains(li)) return null;
    return { id: li.dataset.id, role: active.dataset.role || 'open', index: [...els.list.children].indexOf(li) };
  }

  function restoreFocus(info) {
    if (!info) return;
    const items = els.list.children;
    let li = [...items].find((el) => el.dataset.id === info.id);
    let role = info.role;
    if (!li && items.length) {
      li = items[Math.min(info.index, items.length - 1)];
      role = 'open';
    }
    const target = li?.querySelector(`[data-role="${role}"]`);
    if (target) target.focus({ preventScroll: true });
    else if (!els.searchWrap.hidden) els.search.focus({ preventScroll: true });
    else els.tabs.find((b) => b.getAttribute('aria-checked') === 'true')?.focus({ preventScroll: true });
  }

  function render({ keepCount = false } = {}) {
    const all = currentList();
    const query = foldText(state.query.trim());
    state.filtered = query ? all.filter((e) => folded(e).includes(query)) : all;

    const focus = captureFocus();
    const count = keepCount ? Math.max(PAGE_SIZE, state.rendered) : PAGE_SIZE;
    els.list.replaceChildren();
    state.rendered = 0;
    appendItems(count);

    updateCounts();
    updateChrome(all.length);
    updateEmpty(all.length);
    restoreFocus(focus);
  }

  function updateChrome(total) {
    const settings = getSettings?.();
    els.notice.hidden = !(state.tab === 'history' && settings && settings.saveHistory === false);

    if (!total && state.confirming) cancelClear({ focus: false });
    const searchHadFocus = document.activeElement === els.search;
    els.searchWrap.hidden = total === 0 && !state.query;
    if (searchHadFocus && els.searchWrap.hidden) els.tabs.find((b) => b.getAttribute('aria-checked') === 'true')?.focus();

    els.toolbar.hidden = state.confirming || total === 0;
    els.count.textContent = state.query.trim() ? t('popup_items_filtered', [fmt(state.filtered.length), fmt(total)]) : itemsLabel(total);
    els.exportBtn.hidden = state.tab !== 'favorites';
    els.exportBtn.disabled = state.favorites.length === 0;
    els.clearBtn.disabled = total === 0;
  }

  function updateEmpty(total) {
    const none = state.filtered.length === 0;
    els.empty.hidden = !none;
    if (!none) return;
    let iconName;
    let title;
    let hint;
    if (total > 0 && state.query.trim()) {
      iconName = 'search';
      title = t('popup_empty_search_title');
      hint = t('popup_empty_search_hint', state.query.trim());
    } else if (state.tab === 'history') {
      iconName = 'history';
      title = t('popup_empty_history_title');
      hint = t('popup_empty_history_hint');
    } else {
      iconName = 'star';
      title = t('popup_empty_favorites_title');
      hint = t('popup_empty_favorites_hint');
    }
    els.emptyIcon.replaceChildren(icon(iconName, { size: 24 }));
    els.emptyTitle.textContent = title;
    els.emptyHint.textContent = hint;
  }

  /* ----------------------------- actions ----------------------------- */

  async function onStar(entry) {
    try {
      // History: toggle (the list re-renders via onFavoritesChanged). Favorites: un-starring removes the item.
      if (state.tab === 'favorites') await removeFavorite(entry.id);
      else await toggleFavorite(entry);
    } catch {
      showToast(t('common_error_UNKNOWN'));
    }
  }

  async function onDelete(entry) {
    try {
      if (state.tab === 'favorites') await removeFavorite(entry.id);
      else await removeHistoryEntry(entry.id);
    } catch {
      showToast(t('common_error_UNKNOWN'));
    }
  }

  function askClear() {
    if (!currentList().length) return;
    state.confirming = true;
    els.confirmText.textContent = t(state.tab === 'history' ? 'popup_confirm_clear_history' : 'popup_confirm_clear_favorites');
    els.toolbar.hidden = true;
    els.confirm.hidden = false;
    els.confirmCancel.focus();
  }

  function cancelClear({ focus = true } = {}) {
    if (!state.confirming) return;
    state.confirming = false;
    els.confirm.hidden = true;
    els.toolbar.hidden = currentList().length === 0;
    if (focus && !els.toolbar.hidden) els.clearBtn.focus();
  }

  async function confirmClear() {
    const tab = state.tab;
    cancelClear({ focus: false });
    try {
      await (tab === 'history' ? clearHistory() : clearFavorites());
    } catch {
      showToast(t('common_error_UNKNOWN'));
    }
    els.tabs.find((b) => b.dataset.tab === tab)?.focus();
  }

  function exportCsv() {
    if (!state.favorites.length) return;
    try {
      downloadText(entriesToCsv(state.favorites), csvFileName('favorites'));
      showToast(t('popup_export_done'));
    } catch {
      showToast(t('common_error_UNKNOWN'));
    }
  }

  function setTab(tab, { focus = false } = {}) {
    if (!TABS.includes(tab)) return;
    const changed = tab !== state.tab;
    state.tab = tab;
    writePref(TAB_PREF_KEY, tab);
    els.tabs.forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
      if (on && focus) btn.focus();
    });
    if (!changed) return;
    cancelClear({ focus: false });
    scroller.scrollTop = 0;
    render();
  }

  /* ------------------------------ events ------------------------------ */

  els.tabs.forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
  els.tabGroup.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const rtl = document.documentElement.dir === 'rtl';
    const idx = TABS.indexOf(state.tab);
    let next = idx;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else next = (idx + ((e.key === 'ArrowRight') !== rtl ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[next], { focus: true });
  });

  let searchTimer = 0;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.search.value;
      scroller.scrollTop = 0;
      render();
    }, 80);
  });

  els.back.addEventListener('click', () => onBack());
  els.clearBtn.addEventListener('click', askClear);
  els.confirmCancel.addEventListener('click', () => cancelClear());
  els.confirmYes.addEventListener('click', confirmClear);
  els.exportBtn.addEventListener('click', exportCsv);
  els.noticeBtn.addEventListener('click', async () => {
    try {
      await saveSettings({ saveHistory: true });
    } catch {
      showToast(t('common_error_UNKNOWN'));
    }
  });

  /* ------------------------------ public ------------------------------ */

  return {
    isOpen: () => state.open,

    async open() {
      state.open = true;
      els.view.hidden = false;
      setTab(state.tab);
      if (!state.loaded) await load();
      if (!state.open) return;
      render();
      els.search.focus({ preventScroll: true });
      if (els.searchWrap.hidden) els.tabs.find((b) => b.dataset.tab === state.tab)?.focus({ preventScroll: true });
    },

    close() {
      state.open = false;
      cancelClear({ focus: false });
      els.view.hidden = true;
    },

    /** Settings changed (e.g. saveHistory toggled). */
    onSettings() {
      if (state.open) updateChrome(currentList().length);
    },

    /** Handle view-specific keys. Returns true if the event was consumed. */
    handleKeydown(e) {
      if (e.key === 'Escape') {
        if (state.confirming) {
          e.preventDefault();
          cancelClear();
          return true;
        }
        return false;
      }
      const target = e.target;
      const typing =
        target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !els.searchWrap.hidden) {
        e.preventDefault();
        els.search.focus();
        els.search.select();
        return true;
      }
      return false;
    },
  };
}
