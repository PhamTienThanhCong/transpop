/*
 * TransPop content script — styles (file 3/6).
 * The whole stylesheet of the in-page UI, injected as a <style> element inside the CLOSED shadow
 * root (no external CSS file, no web_accessible_resources). Token VALUES mirror src/ui/tokens.css
 * (ARCHITECTURE §7) but are prefixed `--g-` because custom properties inherit from the host page
 * through the shadow boundary (`all: initial` does not reset them).
 * Rules: px units only (rem would follow the page's <html> font-size), no url()/data: resources
 * (strict page CSPs could block them), every element we render is styled explicitly.
 */
(() => {
  'use strict';
  const G = globalThis.__transpopContent;
  if (!G || G.started) return;

  const DARK_TOKENS = `
    color-scheme: dark;
    --g-brand-1: #818cf8;
    --g-brand-2: #a78bfa;
    --g-primary: #818cf8;
    --g-primary-hover: #a5b4fc;
    --g-primary-soft: rgba(129, 140, 248, 0.14);
    --g-surface: #171a23;
    --g-surface-2: #1e2230;
    --g-surface-3: #262b3b;
    --g-border: #2a2f3d;
    --g-border-strong: #3a4052;
    --g-text: #e8eaf2;
    --g-text-2: #a3a9bc;
    --g-muted: #6b7287;
    --g-star: #fbbf24;
    --g-danger: #f87171;
    --g-success: #4ade80;
    --g-selection: rgba(129, 140, 248, 0.35);
    --g-focus-ring: 0 0 0 3px rgba(129, 140, 248, 0.45);
    --g-shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3);
    --g-trigger-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 6px 16px rgba(0, 0, 0, 0.45);
  `;

  G.CSS = `
:host {
  all: initial !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 0 !important;
  height: 0 !important;
  display: block !important;
  overflow: visible !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
}

[hidden] { display: none !important; }

.g-root {
  color-scheme: light;
  --g-brand-1: #6366f1;
  --g-brand-2: #8b5cf6;
  --g-primary: #4f46e5;
  --g-primary-hover: #4338ca;
  --g-primary-soft: #eef2ff;
  --g-surface: #ffffff;
  --g-surface-2: #f6f7fb;
  --g-surface-3: #eef0f6;
  --g-border: #e5e7ef;
  --g-border-strong: #d4d8e3;
  --g-text: #0f172a;
  --g-text-2: #475569;
  --g-muted: #94a3b8;
  --g-star: #f59e0b;
  --g-danger: #dc2626;
  --g-success: #16a34a;
  --g-selection: rgba(99, 102, 241, 0.22);
  --g-focus-ring: 0 0 0 3px rgba(99, 102, 241, 0.35);
  --g-shadow-lg: 0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 6px rgba(15, 23, 42, 0.06);
  --g-trigger-shadow: 0 6px 16px rgba(79, 70, 229, 0.32), 0 1px 3px rgba(15, 23, 42, 0.2);
  --g-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  --g-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --g-fs: 14px;

  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  margin: 0;
  padding: 0;
  font-family: var(--g-font);
  font-size: var(--g-fs);
  font-weight: 400;
  font-style: normal;
  line-height: 1.5;
  letter-spacing: normal;
  color: var(--g-text);
  text-align: start;
  text-transform: none;
  text-shadow: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
.g-root[data-theme="dark"] { ${DARK_TOKENS} }
@media (prefers-color-scheme: dark) {
  .g-root[data-theme="auto"] { ${DARK_TOKENS} }
}

.g-root *, .g-root *::before, .g-root *::after { box-sizing: border-box; }
.g-root ::selection { background: var(--g-selection); }
.g-root svg { display: block; flex: none; overflow: visible; }
.g-root button, .g-root select { font-family: inherit; margin: 0; -webkit-tap-highlight-color: transparent; }

.g-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* ---------------- Floating trigger button ---------------- */

.g-trigger {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: 30px;
  height: 30px;
  padding: 3px;
  border: 0;
  border-radius: 9px;
  background: #ffffff;
  overflow: hidden;
  cursor: pointer;
  pointer-events: auto;
  outline: none;
  box-shadow: var(--g-trigger-shadow);
  opacity: 0;
  transform: scale(0.6);
  transform-origin: center;
  transition: opacity 140ms var(--g-ease), transform 180ms var(--g-ease), box-shadow 160ms var(--g-ease);
}
.g-trigger.is-visible { opacity: 1; transform: scale(1); }
.g-trigger.is-visible:hover { transform: scale(1.08); }
.g-trigger.is-visible:active { transform: scale(0.95); }
.g-trigger:focus-visible { box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.55), var(--g-trigger-shadow); }
.g-trigger svg { display: block; width: 24px; height: 24px; }

/* ---------------- Bubble ---------------- */

.g-bubble {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: min(300px, calc(100vw - 16px));
  max-width: min(400px, calc(100vw - 16px));
  max-height: min(70vh, 520px);
  background: var(--g-surface);
  color: var(--g-text);
  border: 1px solid var(--g-border);
  border-radius: 14px;
  box-shadow: var(--g-shadow-lg);
  overflow: hidden;
  pointer-events: auto;
  outline: none;
  opacity: 0;
  transform: translateY(4px) scale(0.985);
  transform-origin: top center;
  transition: opacity 150ms var(--g-ease), transform 180ms var(--g-ease);
}
.g-bubble[data-placement="above"] { transform-origin: bottom center; transform: translateY(-4px) scale(0.985); }
.g-bubble.is-open { opacity: 1; transform: none; }
.g-bubble.is-dragging { transition: none; }

/* Header */
.g-head, .g-langs { flex: none; }
.g-head {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 6px 2px;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
}
.g-bubble.is-dragging .g-head { cursor: grabbing; }
.g-src-wrap { flex: 1 1 auto; min-width: 0; padding: 5px 6px 0 2px; }
.g-src {
  font-size: calc(var(--g-fs) + 1px);
  font-weight: 600;
  line-height: 1.4;
  color: var(--g-text);
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.g-src.is-clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
.g-src:not(.is-clamped) {
  max-height: min(30vh, 180px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--g-border-strong) transparent;
}
.g-src-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin: 2px 0 0 -5px;
  padding: 1px 7px 1px 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--g-primary);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  cursor: pointer;
  outline: none;
}
.g-src-toggle:hover { background: var(--g-primary-soft); }
.g-src-toggle:focus-visible { box-shadow: var(--g-focus-ring); }
.g-src-toggle svg { width: 14px; height: 14px; transition: transform 160ms var(--g-ease); }
.g-src-toggle[aria-expanded="true"] svg { transform: rotate(180deg); }
.g-phon {
  margin-top: 1px;
  font-family: "Segoe UI", "Lucida Sans Unicode", "Arial Unicode MS", "Noto Sans", var(--g-font);
  font-size: 13px;
  line-height: 1.4;
  color: var(--g-text-2);
  overflow-wrap: anywhere;
}
.g-head-actions { display: flex; align-items: center; flex: none; }

/* Language row */
.g-langs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
  padding: 3px 14px 9px;
  border-bottom: 1px solid var(--g-border);
  font-size: 12px;
  line-height: 1.4;
  color: var(--g-text-2);
}
.g-from { max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.g-arrow { width: 14px; height: 14px; color: var(--g-muted); }
.g-root[dir="rtl"] .g-arrow { transform: scaleX(-1); }
.g-select { position: relative; display: inline-flex; align-items: center; min-width: 0; }
.g-to {
  appearance: none;
  -webkit-appearance: none;
  max-width: 190px;
  height: 24px;
  padding: 0 22px 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--g-primary-soft);
  color: var(--g-primary);
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  transition: border-color 160ms var(--g-ease);
}
.g-to:hover { border-color: var(--g-border-strong); }
.g-to:focus-visible { box-shadow: var(--g-focus-ring); }
.g-to option { color: var(--g-text); background: var(--g-surface); font-weight: 400; }
.g-select svg { position: absolute; right: 5px; width: 14px; height: 14px; color: var(--g-primary); pointer-events: none; }

/* Icon buttons — 32px hit area, 18px glyph */
.g-ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--g-text-2);
  cursor: pointer;
  outline: none;
  transition: background 160ms var(--g-ease), color 160ms var(--g-ease);
}
.g-ib svg { width: 18px; height: 18px; }
.g-ib:hover { background: var(--g-surface-2); color: var(--g-text); }
.g-ib:active { background: var(--g-surface-3); }
.g-ib:focus-visible { box-shadow: var(--g-focus-ring); }
.g-ib:disabled { opacity: 0.4; cursor: default; background: transparent; color: var(--g-text-2); }
.g-ib.is-starred, .g-ib.is-starred:hover { color: var(--g-star); }
.g-ib.is-speaking { color: var(--g-primary); }
.g-ib.is-speaking svg { animation: g-pulse 0.9s var(--g-ease) infinite; }
.g-ib.is-done, .g-ib.is-done:hover { color: var(--g-success); }
.g-ib-sm { width: 28px; height: 28px; }
.g-ib-sm svg { width: 16px; height: 16px; }

/* Body */
.g-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 0 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--g-border-strong) transparent;
}
.g-main { padding: 10px 14px 0; }
.g-tr {
  font-size: calc(var(--g-fs) + 2px);
  font-weight: 500;
  line-height: 1.45;
  color: var(--g-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.g-tr.is-short {
  font-size: calc(var(--g-fs) + 6px);
  font-weight: 650;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: var(--g-primary);
}
.g-empty { color: var(--g-muted); font-style: italic; font-weight: 400; }
.g-translit {
  margin-top: 2px;
  font-size: calc(var(--g-fs) - 1px);
  line-height: 1.4;
  color: var(--g-muted);
  overflow-wrap: anywhere;
}
.g-actions { display: flex; align-items: center; gap: 2px; margin: 4px 0 0 -6px; }
.g-copied { margin-left: 2px; font-size: 12px; font-weight: 500; color: var(--g-success); opacity: 0; transition: opacity 150ms var(--g-ease); }
.g-copied.is-visible { opacity: 1; }

/* Sections */
.g-sec { margin: 10px 14px 0; padding-top: 9px; border-top: 1px solid var(--g-border); }
.g-sec-title {
  margin: 0 0 5px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--g-muted);
}
.g-grid {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 10px;
  row-gap: 4px;
  align-items: baseline;
}
.g-pos {
  font-size: 12.5px;
  font-weight: 600;
  font-variant-caps: all-small-caps;
  letter-spacing: 0.03em;
  line-height: 1.45;
  color: var(--g-text-2);
}
.g-terms { line-height: 1.45; color: var(--g-text); overflow-wrap: anywhere; }
.g-term[title] {
  cursor: help;
  text-decoration: underline dotted transparent;
  text-underline-offset: 3px;
  transition: text-decoration-color 120ms var(--g-ease);
}
.g-term[title]:hover { text-decoration-color: var(--g-muted); }
.g-count { margin-left: 4px; font-size: 12px; color: var(--g-muted); white-space: nowrap; }
.g-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.g-chip {
  padding: 1px 9px;
  border: 1px solid var(--g-border);
  border-radius: 999px;
  background: var(--g-surface-2);
  color: var(--g-text);
  font-size: calc(var(--g-fs) - 1px);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.g-def-group + .g-def-group { margin-top: 6px; }
.g-defs { margin: 2px 0 0; padding: 0 0 0 20px; list-style: decimal outside; }
.g-defs li { margin: 3px 0; padding-left: 2px; line-height: 1.45; }
.g-defs li::marker { color: var(--g-muted); font-size: 12px; font-weight: 600; }
.g-def-ex { margin-top: 1px; color: var(--g-text-2); font-style: italic; }
.g-examples { margin: 0; padding: 0; list-style: none; }
.g-examples li {
  margin: 5px 0 0;
  padding: 1px 0 1px 10px;
  border-left: 2px solid var(--g-border-strong);
  line-height: 1.45;
  color: var(--g-text-2);
}
.g-examples strong, .g-def-ex strong { color: var(--g-text); font-weight: 600; }
.g-body:not(.is-expanded) .g-extra { display: none; }
.g-body.is-expanded .g-collapsed-only { display: none; }
.g-more {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin: 8px 0 0 8px;
  padding: 3px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--g-primary);
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.5;
  cursor: pointer;
  outline: none;
}
.g-more:hover { background: var(--g-primary-soft); }
.g-more:focus-visible { box-shadow: var(--g-focus-ring); }
.g-more svg { width: 14px; height: 14px; }

/* Footer */
.g-foot {
  flex: none;
  padding: 7px 14px;
  border-top: 1px solid var(--g-border);
  font-size: 11px;
  line-height: 1.3;
  color: var(--g-muted);
}

/* Loading skeleton */
.g-skel-wrap { padding: 13px 14px 6px; }
.g-skel {
  height: 12px;
  margin: 0 0 9px;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--g-surface-2) 25%, var(--g-surface-3) 50%, var(--g-surface-2) 75%);
  background-size: 200% 100%;
  animation: g-shimmer 1.2s linear infinite;
}
.g-skel-lg { height: 16px; width: 70%; }
.g-skel-md { width: 92%; }
.g-skel-sm { width: 46%; margin-bottom: 2px; }

/* Error */
.g-error { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px 4px; }
.g-error > svg { width: 20px; height: 20px; margin-top: 1px; color: var(--g-danger); }
.g-error-msg { margin: 0 0 8px; font-size: 13px; line-height: 1.45; color: var(--g-text); }
.g-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--g-border);
  border-radius: 8px;
  background: var(--g-surface);
  color: var(--g-text);
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  outline: none;
  transition: background 160ms var(--g-ease);
}
.g-btn:hover { background: var(--g-surface-2); }
.g-btn:focus-visible { box-shadow: var(--g-focus-ring); }
.g-btn svg { width: 14px; height: 14px; }

.g-clip { position: fixed; top: 0; left: -9999px; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

@keyframes g-shimmer { to { background-position: -200% 0; } }
@keyframes g-pulse { 50% { opacity: 0.45; } }

@media (prefers-reduced-motion: reduce) {
  .g-trigger, .g-bubble, .g-ib, .g-copied, .g-src-toggle svg { transition: none !important; }
  .g-skel, .g-ib.is-speaking svg { animation: none !important; }
  .g-bubble, .g-bubble[data-placement="above"], .g-trigger, .g-trigger.is-visible:hover { transform: none; }
}

@media (forced-colors: active) {
  .g-bubble { border: 1px solid CanvasText; }
  .g-ib:focus-visible, .g-btn:focus-visible, .g-to:focus-visible, .g-more:focus-visible, .g-trigger:focus-visible {
    outline: 2px solid Highlight;
  }
}
`;
})();
