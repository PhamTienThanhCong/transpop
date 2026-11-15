/*
 * TransPop content script — controller (file 6/6, loaded last).
 * Settings, passive triggers (icon / auto / hotkey), selection reading, messages from the
 * background/popup. All page listeners are passive + capture and never preventDefault /
 * stopPropagation. Nothing is built in the page until the first trigger.
 */
(() => {
  'use strict';
  const G = globalThis.__transpopContent;
  if (!G || G.started) return;

  const U = G.util;
  const ui = G.ui;
  const MSG = G.MSG;

  const MODIFIERS = new Set(['Shift', 'Alt', 'Control', 'Meta']);
  const MOD_PROP = { Shift: 'shiftKey', Alt: 'altKey', Control: 'ctrlKey', Meta: 'metaKey' };
  const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password']);
  const TAP_MAX_MS = 800;
  const AUTO_DEBOUNCE_MS = 150;
  const DRAG_PX = 4;
  const RAW_SELECTION_CAP = 20000; // don't regex megabytes after a select-all

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  let settingsLoaded = false;
  let settingsPromise = null;

  /** Resolve with fresh settings (cached until chrome.storage reports a change). */
  G.getSettings = () => {
    if (settingsLoaded) return Promise.resolve(G.settings);
    if (!settingsPromise) {
      settingsPromise = G.send(MSG.GET_SETTINGS)
        .then((res) => {
          G.settings = { ...G.DEFAULT_SETTINGS, ...(res.settings && typeof res.settings === 'object' ? res.settings : {}) };
          settingsLoaded = true;
          return G.settings;
        })
        .finally(() => {
          settingsPromise = null;
        });
    }
    return settingsPromise;
  };

  /** Settings for a passive trigger: fresh if possible, last known/defaults if the background is unreachable. */
  async function currentSettings() {
    try {
      return await G.getSettings();
    } catch {
      return G.settings;
    }
  }

  const warmSettings = () => {
    if (!settingsLoaded && !settingsPromise) G.getSettings().catch(() => {});
  };

  function onStorageChanged(changes, area) {
    if (area !== 'sync' || !changes || !changes.settings) return;
    if (!G.checkAlive()) return;
    settingsLoaded = false;
    if (!ui.isActive()) return; // lazily re-fetched on the next interaction
    G.getSettings().then(
      (st) => {
        if (ui.triggerVisible() && (st.triggerMode !== 'icon' || !passiveAllowed(st))) ui.hideTrigger();
        ui.refresh();
      },
      () => {},
    );
  }

  /** Hostnames that `disabledSites` is matched against: this frame + the top-level page. */
  function hostCandidates() {
    const list = [location.hostname];
    try {
      const ao = location.ancestorOrigins;
      if (ao && ao.length) list.push(ao[ao.length - 1]);
    } catch {
      /* ignore */
    }
    return list;
  }

  /** `enabled` + `disabledSites` gate passive triggers only (explicit requests always work). */
  function passiveAllowed(st) {
    return !!st.enabled && !U.isHostDisabled(hostCandidates(), st.disabledSites);
  }

  /* ------------------------------------------------------------------ */
  /* Selection                                                           */
  /* ------------------------------------------------------------------ */

  function isTextField(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(String(el.type || 'text').toLowerCase());
  }

  function isEditableNode(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el) return false;
    try {
      return !!(el.isContentEditable || (el.closest && el.closest('input, textarea')));
    } catch {
      return false;
    }
  }

  /** Caret rect at the selection's focus end (where a keyboard selection stops). */
  function focusCaretRect(sel) {
    try {
      const r = document.createRange();
      r.setStart(sel.focusNode, sel.focusOffset);
      r.collapse(true);
      const rects = r.getClientRects();
      const b = rects.length ? rects[0] : r.getBoundingClientRect();
      return b && (b.height > 0 || b.top !== 0 || b.left !== 0) ? U.rect(b) : null;
    } catch {
      return null;
    }
  }

  /**
   * Snapshot of this frame's current selection (viewport coordinates), or null.
   * @param {{allowEditable?: boolean, point?: {x:number,y:number}|null, upward?: boolean}} opts
   *        allowEditable: include input/textarea/contenteditable selections
   */
  function readSelection({ allowEditable = false, point = null, upward = false } = {}) {
    const active = G.deepActiveElement();
    if (ui.isOurs(active)) return null;

    if (isTextField(active)) {
      if (!allowEditable || String(active.type).toLowerCase() === 'password') return null;
      let start;
      let end;
      try {
        start = active.selectionStart;
        end = active.selectionEnd;
      } catch {
        return null;
      }
      if (typeof start !== 'number' || typeof end !== 'number' || start === end) return null;
      const text = U.cleanText(String(active.value || '').slice(Math.min(start, end), Math.max(start, end)).slice(0, RAW_SELECTION_CAP));
      if (!text) return null;
      const rect = point ? { left: point.x, right: point.x, top: point.y - 10, bottom: point.y + 10 } : U.rect(active.getBoundingClientRect());
      return { text, rect: U.rect(rect), line: point ? U.rect(rect) : null, point, upward, field: active, node: active };
    }

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    if (ui.isOurs(sel.anchorNode) || ui.isOurs(sel.focusNode)) return null;
    const editable = document.designMode === 'on' || isEditableNode(sel.anchorNode) || isEditableNode(sel.focusNode);
    if (editable && !allowEditable) return null;

    const raw = sel.toString();
    const text = U.cleanText(raw.length > RAW_SELECTION_CAP ? raw.slice(0, RAW_SELECTION_CAP) : raw);
    if (!text) return null;

    let range;
    try {
      range = sel.getRangeAt(0);
    } catch {
      return null;
    }
    const rects = Array.from(range.getClientRects());
    let rect = U.rect(range.getBoundingClientRect());
    if (!rect.width && !rect.height) {
      const last = U.pickLineRect(rects, null);
      rect = last ? U.rect(last) : null;
    }
    let line = null;
    let at = point;
    if (point) {
      line = U.rect(U.pickLineRect(rects, point.y));
    } else {
      line = focusCaretRect(sel) || U.rect(U.pickLineRect(rects, null));
      at = line ? { x: line.right, y: line.bottom } : null;
    }
    return { text, rect, line, point: at, upward, field: null, node: range.commonAncestorContainer };
  }

  /* ------------------------------------------------------------------ */
  /* Passive triggers                                                    */
  /* ------------------------------------------------------------------ */

  let down = null; // { x, y } of the last primary mousedown outside our UI
  let modDown = null; // { key, at, alone } — modifier currently held
  let kbdSelecting = false;
  let checkTimer = 0;
  let autoTimer = 0;
  let gestureSeq = 0; // bumped on every mousedown → stale async checks are dropped
  let lastContextMenu = null; // { x, y, at }

  const modFlags = (e) => ({ shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });

  function scheduleCheck(ev, delay) {
    G.cancel(checkTimer);
    checkTimer = G.later(() => {
      handleSelectionEnd(ev).catch(() => {});
    }, delay);
  }

  /**
   * A selection gesture just ended (mouse-up, double-click or keyboard).
   * @param {{kind:'mouse'|'keyboard', point?:object, detail?:number, dragged?:boolean, upward?:boolean, flags?:object}} ev
   */
  async function handleSelectionEnd(ev) {
    if (!G.checkAlive()) return;
    const gesture = gestureSeq;
    const st = await currentSettings();
    if (G.dead || gesture !== gestureSeq || !passiveAllowed(st)) return; // a new click started meanwhile

    const opts = { allowEditable: !st.disableInInputs, point: ev.point || null, upward: !!ev.upward };
    const snap = readSelection(opts);
    if (!snap || !U.isTranslatable(snap.text)) return;
    if (ui.bubbleVisible() && U.sameText(ui.bubbleText(), snap.text)) return;

    const modHeld = !!(ev.flags && ev.flags[MOD_PROP[st.modifierKey] || 'shiftKey']);

    if (st.triggerMode === 'auto') {
      if (st.doubleClickOnly && !(ev.kind === 'mouse' && ev.detail === 2)) return;
      G.cancel(autoTimer);
      autoTimer = G.later(() => {
        const again = readSelection(opts);
        if (again && U.sameText(again.text, snap.text) && !(ui.bubbleVisible() && U.sameText(ui.bubbleText(), again.text))) ui.open(again);
      }, AUTO_DEBOUNCE_MS);
      return;
    }

    if (st.triggerMode === 'hotkey') {
      // (a) selection made while holding the modifier: a real drag or a double-click — not a plain
      // Shift+click (extend selection / open link in new window) and not Shift+Arrow keys.
      if (ev.kind === 'mouse' && modHeld && (ev.dragged || ev.detail >= 2)) ui.open(snap);
      return;
    }

    // 'icon' (default)
    if (ui.triggerVisible() && U.sameText(ui.triggerText(), snap.text)) return;
    ui.showTrigger(snap);
  }

  /** The modifier key was pressed and released on its own (< 800 ms, nothing else in between). */
  async function onModifierTap(key) {
    const st = await currentSettings();
    if (G.dead || key !== st.modifierKey) return;
    if (ui.triggerVisible()) {
      ui.openFromTrigger();
      return;
    }
    // Icon mode: the tap only acts on a visible trigger button. Hotkey mode: this IS the trigger.
    // Auto mode: handy with doubleClickOnly (translate a drag-selected phrase on demand).
    if (st.triggerMode === 'icon' || !passiveAllowed(st)) return;
    const snap = readSelection({ allowEditable: !st.disableInInputs });
    if (!snap || !U.isTranslatable(snap.text)) return;
    if (ui.bubbleVisible() && U.sameText(ui.bubbleText(), snap.text)) return;
    ui.open(snap);
  }

  function onMouseDown(e) {
    if (!G.checkAlive()) return;
    if (modDown) modDown.alone = false; // modifier+click is a shortcut, not a tap
    gestureSeq++;
    G.cancel(checkTimer);
    G.cancel(autoTimer);
    if (ui.isOurs(e.target)) return;
    warmSettings();
    down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    ui.hideTrigger();
    if (ui.bubbleVisible() && G.settings.closeOnClickOutside) ui.close();
  }

  function onMouseUp(e) {
    if (e.button !== 0 || !G.checkAlive() || ui.isOurs(e.target)) return;
    const point = { x: e.clientX, y: e.clientY };
    const dragged = !!down && Math.abs(point.x - down.x) + Math.abs(point.y - down.y) > DRAG_PX;
    const upward = !!down && down.y - point.y > DRAG_PX;
    down = null;
    // Let the browser finish updating the selection (clicking inside a selection clears it after mouseup).
    scheduleCheck({ kind: 'mouse', point, detail: e.detail, dragged, upward, flags: modFlags(e) }, 10);
  }

  function onDblClick(e) {
    if (e.button !== 0 || !G.checkAlive() || ui.isOurs(e.target)) return;
    // Usually already handled by mouseup (detail 2); re-scheduling coalesces both into one check.
    scheduleCheck({ kind: 'mouse', point: { x: e.clientX, y: e.clientY }, detail: 2, dragged: false, upward: false, flags: modFlags(e) }, 10);
  }

  function onKeyDown(e) {
    if (!G.checkAlive()) return;
    if (e.key === 'Escape') {
      if (modDown) modDown.alone = false;
      if (ui.isActive()) ui.dismiss(); // also when focus is inside the bubble (target = our host)
      return;
    }
    if (ui.isOurs(e.target)) {
      modDown = null; // keys typed inside our UI never count as taps
      return;
    }
    if (MODIFIERS.has(e.key)) {
      warmSettings();
      if (e.repeat) return;
      if (modDown && modDown.key !== e.key) {
        modDown.alone = false; // chord (e.g. Ctrl+Shift)
      } else if (!modDown) {
        const others = Object.entries(MOD_PROP).some(([k, prop]) => k !== e.key && e[prop]);
        modDown = { key: e.key, at: performance.now(), alone: !others };
      }
      return;
    }
    if (modDown) modDown.alone = false; // Shift+Arrow, Ctrl+C, typing capitals…
    if (e.shiftKey && NAV_KEYS.has(e.key)) kbdSelecting = true;
  }

  function onKeyUp(e) {
    if (!G.checkAlive()) return;
    if (MODIFIERS.has(e.key)) {
      const m = modDown;
      if (m && m.key === e.key) {
        modDown = null;
        if (m.alone && performance.now() - m.at < TAP_MAX_MS && !ui.isOurs(e.target)) onModifierTap(e.key).catch(() => {});
      } else if (m) {
        m.alone = false;
      }
      if (e.key === 'Shift' && kbdSelecting) {
        kbdSelecting = false;
        if (!ui.isOurs(e.target)) scheduleCheck({ kind: 'keyboard' }, 30);
      }
    }
  }

  function onContextMenu(e) {
    if (ui.isOurs(e.target)) return;
    lastContextMenu = { x: e.clientX, y: e.clientY, at: performance.now() };
  }

  function onWindowBlur() {
    modDown = null;
    kbdSelecting = false;
    ui.hideTrigger();
  }

  /* ------------------------------------------------------------------ */
  /* Messages (background / popup → content)                             */
  /* ------------------------------------------------------------------ */

  /** Does this frame currently own the keyboard focus (not delegated to a child frame)? */
  function frameHasFocus() {
    try {
      const a = document.activeElement;
      return document.hasFocus() && !(a && (a.tagName === 'IFRAME' || a.tagName === 'FRAME'));
    } catch {
      return false;
    }
  }

  function showForText(rawText) {
    const text = U.cleanText(rawText).slice(0, G.LIMITS.MAX_TEXT_LENGTH + 1);
    if (!text) return false;
    // Context menu: the right-clicked selection is normally still there → anchor to it.
    const sel = readSelection({ allowEditable: true });
    if (sel && (U.sameText(sel.text, text) || U.squash(sel.text).includes(U.squash(text)))) {
      ui.open({ ...sel, text });
      return true;
    }
    const cm = lastContextMenu && performance.now() - lastContextMenu.at < 10000 ? lastContextMenu : null;
    const rect = cm ? { left: cm.x, right: cm.x, top: cm.y - 10, bottom: cm.y + 10 } : null;
    ui.open({ text, rect, line: rect, point: cm ? { x: cm.x, y: cm.y } : null });
    return true;
  }

  function handleShowTranslation(msg, sendResponse) {
    // Explicit requests work even when disabled / on disabled sites.
    if (typeof msg.text === 'string' && msg.text.trim()) {
      // Context menu: sent to the frame that was right-clicked.
      sendResponse({ ok: true, shown: showForText(msg.text) });
      return false;
    }
    // Keyboard command: sent to every frame; only the frame with a selection shows the bubble.
    const sel = readSelection({ allowEditable: true });
    const focused = frameHasFocus();
    let pageFocused = true;
    try {
      pageFocused = document.hasFocus();
    } catch {
      /* ignore */
    }
    if (sel && sel.text && (focused || (G.IS_TOP && !pageFocused))) {
      ui.open(sel, { focus: true });
      sendResponse({ ok: true, shown: true });
      return false;
    }
    if (!G.IS_TOP) return false; // sub-frames without a selection stay silent
    // Answer a little later so a sub-frame's `shown: true` reaches the sender first.
    G.later(() => {
      try {
        sendResponse({ ok: true, shown: false });
      } catch {
        /* port closed */
      }
    }, 200);
    return true;
  }

  function onMessage(msg, _sender, sendResponse) {
    if (!msg || typeof msg !== 'object' || msg.target === 'offscreen') return false;
    if (!G.checkAlive()) return false;
    try {
      switch (msg.type) {
        case MSG.PING:
          sendResponse({ ok: true });
          return false;
        case MSG.GET_SELECTION: {
          if (!G.IS_TOP) return false;
          const sel = readSelection({ allowEditable: true });
          sendResponse({ ok: true, text: sel ? sel.text.slice(0, G.LIMITS.MAX_TEXT_LENGTH) : '', hostname: location.hostname });
          return false;
        }
        case MSG.SHOW_TRANSLATION:
          return handleShowTranslation(msg, sendResponse);
        default:
          return false;
      }
    } catch (err) {
      try {
        sendResponse({ ok: false, error: { code: 'UNKNOWN', message: String((err && err.message) || err) } });
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */

  try {
    const capture = { capture: true, passive: true };
    G.listen(window, 'mousedown', onMouseDown, capture);
    G.listen(window, 'mouseup', onMouseUp, capture);
    G.listen(window, 'dblclick', onDblClick, capture);
    G.listen(window, 'keydown', onKeyDown, capture);
    G.listen(window, 'keyup', onKeyUp, capture);
    G.listen(window, 'contextmenu', onContextMenu, capture);
    G.listen(window, 'blur', onWindowBlur, { passive: true });

    chrome.runtime.onMessage.addListener(onMessage);
    G.onCleanup(() => {
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        /* context gone */
      }
    });
    chrome.storage.onChanged.addListener(onStorageChanged);
    G.onCleanup(() => {
      try {
        chrome.storage.onChanged.removeListener(onStorageChanged);
      } catch {
        /* context gone */
      }
    });
    G.started = true;
  } catch {
    // Extension context already gone (or APIs unavailable): leave the page untouched.
    G.destroy();
  }
})();
