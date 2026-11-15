/*
 * TransPop content script — styles (file 3/7).
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
    --g-brand-1: #2dd4bf;
    --g-brand-2: #22d3ee;
    --g-primary: #2dd4bf;
    --g-primary-hover: #5eead4;
    --g-primary-soft: rgba(45, 212, 191, 0.14);
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
    --g-selection: rgba(45, 212, 191, 0.35);
    --g-focus-ring: 0 0 0 3px rgba(45, 212, 191, 0.45);
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
  --g-brand-1: #0d9488;
  --g-brand-2: #0e7490;
  --g-primary: #0f766e;
  --g-primary-hover: #115e59;
  --g-primary-soft: #f0fdfa;
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
  --g-selection: rgba(13, 148, 136, 0.22);
  --g-focus-ring: 0 0 0 3px rgba(13, 148, 136, 0.35);
  --g-shadow-lg: 0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 6px rgba(15, 23, 42, 0.06);
  --g-trigger-shadow: 0 6px 16px rgba(15, 118, 110, 0.32), 0 1px 3px rgba(15, 23, 42, 0.2);
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
.g-trigger:focus-visible { box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.55), var(--g-trigger-shadow); }
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

/* ---------------- Image translation: crop overlay (crop.js) ---------------- */

.g-crop {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  margin: 0;
  padding: 0;
  background: rgba(15, 23, 42, 0.42);
  cursor: crosshair;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  outline: none;
  overflow: hidden;
  animation: g-fade-in 120ms var(--g-ease);
}
.g-crop.is-dragging { background: transparent; }
.g-crop-box {
  position: absolute;
  top: 0;
  left: 0;
  border: 2px solid #14b8a6;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.55) inset, 0 0 0 200vmax rgba(15, 23, 42, 0.42);
  pointer-events: none;
}
.g-crop-size {
  position: absolute;
  top: calc(100% + 6px);
  right: -2px;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.86);
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.g-crop-size.is-inside { top: auto; bottom: 4px; right: 4px; }
.g-crop-bar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 10px;
  width: max-content;
  max-width: calc(100% - 24px);
  padding: 6px 6px 6px 10px;
  background: var(--g-surface);
  color: var(--g-text);
  border: 1px solid var(--g-border);
  border-radius: 12px;
  box-shadow: var(--g-shadow-lg);
  font-size: 13px;
  line-height: 1.4;
  cursor: default;
  transition: opacity 120ms var(--g-ease);
}
.g-crop.is-dragging .g-crop-bar { opacity: 0; pointer-events: none; }
.g-crop-brand { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.g-crop-brand svg { width: 22px; height: 22px; }
.g-crop-hint { color: var(--g-text); font-weight: 500; }
.g-crop-actions { display: inline-flex; align-items: center; gap: 2px; }

/* OCR language picker (overlay bar + results footer) */
.g-ocr-langs { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; min-width: 0; }
.g-ocr-langs > svg { width: 16px; height: 16px; color: var(--g-muted); margin-inline-end: 2px; }
.g-ocr-langs-label { font-size: 12px; color: var(--g-text-2); margin-inline-end: 2px; }
.g-lchip {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  height: 24px;
  padding: 0 3px 0 9px;
  border-radius: 999px;
  background: var(--g-primary-soft);
  color: var(--g-primary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}
.g-lchip.is-single { padding: 0 10px; }
.g-lchip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  outline: none;
}
.g-lchip-x:hover { background: rgba(15, 118, 110, 0.14); }
.g-lchip-x:focus-visible { box-shadow: var(--g-focus-ring); }
.g-lchip-x svg { width: 12px; height: 12px; }
.g-ladd {
  appearance: none;
  -webkit-appearance: none;
  height: 24px;
  min-width: 28px;
  max-width: 120px;
  padding: 0 9px;
  border: 1px dashed var(--g-border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--g-text-2);
  font-size: 13px;
  font-weight: 600;
  line-height: 22px;
  text-align: center;
  cursor: pointer;
  outline: none;
}
.g-ladd:hover { border-color: var(--g-primary); color: var(--g-primary); }
.g-ladd:focus-visible { box-shadow: var(--g-focus-ring); }
.g-ladd option { color: var(--g-text); background: var(--g-surface); font-weight: 400; text-align: start; }
/* "Auto" pill: the text language is guessed from the page (these languages are tried too) */
.g-lauto {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border: 1px solid var(--g-primary);
  border-radius: 999px;
  color: var(--g-primary);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: help;
}

/* Region marker (document coordinates, scrolls with the page) */
.g-crop-mark {
  position: absolute;
  top: 0;
  left: 0;
  border: 2px solid #14b8a6;
  border-radius: 3px;
  background: rgba(20, 184, 166, 0.08);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.55) inset;
  pointer-events: none;
}
.g-crop-mark.is-busy { animation: g-mark-pulse 1.1s var(--g-ease) infinite; }
.g-crop-mark.is-flash { animation: g-mark-flash 450ms var(--g-ease); }

/* OCR results bubble (re-uses .g-bubble / .g-head / .g-body / .g-foot) */
.g-bubble.g-ocr { width: min(380px, calc(100vw - 16px)); min-width: 0; }
.g-ocr-head { align-items: center; gap: 6px; padding: 6px 6px 6px 12px; border-bottom: 1px solid var(--g-border); }
.g-ocr-head > svg { width: 20px; height: 20px; }
.g-ocr-title { flex: 1 1 auto; min-width: 0; font-size: 13px; font-weight: 600; color: var(--g-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.g-ocr-status { display: flex; align-items: flex-start; gap: 10px; padding: 14px 14px 8px; }
.g-ocr-status p { margin: 0; font-size: 13px; line-height: 1.45; color: var(--g-text); }
.g-ocr-status .g-ocr-slow { margin-top: 4px; font-size: 12px; color: var(--g-text-2); }
.g-spin {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border: 2px solid var(--g-border-strong);
  border-top-color: var(--g-primary);
  border-radius: 50%;
  animation: g-spin 0.8s linear infinite;
}
.g-ocr-src { padding: 10px 14px 4px; }
.g-ocr-label { display: block; margin: 0 0 4px; font-size: 11px; font-weight: 600; line-height: 1.3; letter-spacing: 0.06em; text-transform: uppercase; color: var(--g-muted); }
.g-ocr-text {
  display: block;
  width: 100%;
  min-height: 38px;
  /* ~4 lines, then scroll — keeps the translation visible without scrolling the bubble */
  max-height: min(22vh, calc((var(--g-fs) - 1px) * 1.45 * 4 + 16px));
  margin: 0;
  padding: 7px 9px;
  border: 1px solid var(--g-border);
  border-radius: 8px;
  background: var(--g-surface-2);
  color: var(--g-text);
  font-family: var(--g-font);
  font-size: calc(var(--g-fs) - 1px);
  font-weight: 400;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow-y: auto;
  resize: none;
  outline: none;
  scrollbar-width: thin;
  scrollbar-color: var(--g-border-strong) transparent;
  transition: border-color 160ms var(--g-ease), box-shadow 160ms var(--g-ease);
}
.g-ocr-text:hover { border-color: var(--g-border-strong); }
.g-ocr-text:focus { border-color: var(--g-primary); box-shadow: var(--g-focus-ring); background: var(--g-surface); }
.g-ocr-note { margin: 4px 0 0; font-size: 12px; line-height: 1.4; color: var(--g-text-2); }
.g-ocr-tools { display: flex; align-items: center; gap: 2px; margin: 4px 0 0 -6px; }
.g-ocr-tools .g-btn { margin-inline-start: auto; }
.g-btn.is-primary { border-color: transparent; background: var(--g-primary-soft); color: var(--g-primary); font-weight: 600; }
.g-btn.is-primary:hover { background: var(--g-primary-soft); border-color: var(--g-primary); }
.g-btn:disabled { opacity: 0.45; cursor: default; }
.g-btn:disabled:hover { background: var(--g-surface); border-color: var(--g-border); }
.g-btn.is-primary:disabled:hover { background: var(--g-primary-soft); border-color: transparent; }
.g-ocr .g-langs { padding: 8px 14px 9px; border-top: 1px solid var(--g-border); }
.g-error-actions { display: flex; flex-wrap: wrap; gap: 6px; }
/* "No text found with …" → one-tap retry in another language */
.g-retry-langs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
.g-rchip, .g-rmore {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--g-border);
  border-radius: 999px;
  background: var(--g-surface);
  color: var(--g-text);
  font-family: var(--g-font);
  font-size: 13px;
  font-weight: 500;
  line-height: 26px;
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  transition: background 160ms var(--g-ease), border-color 160ms var(--g-ease), color 160ms var(--g-ease);
}
.g-rchip:hover { border-color: var(--g-primary); background: var(--g-primary-soft); color: var(--g-primary); }
.g-rmore { appearance: none; -webkit-appearance: none; max-width: 140px; border-style: dashed; border-color: var(--g-border-strong); color: var(--g-text-2); }
.g-rmore:hover { border-color: var(--g-primary); color: var(--g-primary); }
.g-rmore option { color: var(--g-text); background: var(--g-surface); }
.g-rchip:focus-visible, .g-rmore:focus-visible { box-shadow: var(--g-focus-ring); }
.g-ocr-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 7px 10px 7px 14px; }
.g-ocr-foot .g-ocr-powered { margin-inline-start: auto; }

@keyframes g-shimmer { to { background-position: -200% 0; } }
@keyframes g-pulse { 50% { opacity: 0.45; } }
@keyframes g-spin { to { transform: rotate(360deg); } }
@keyframes g-fade-in { from { opacity: 0; } }
@keyframes g-mark-pulse { 50% { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.55) inset, 0 0 0 4px rgba(20, 184, 166, 0.28); } }
@keyframes g-mark-flash { from { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.55) inset, 0 0 0 10px rgba(20, 184, 166, 0.45); } }

@media (prefers-reduced-motion: reduce) {
  .g-trigger, .g-bubble, .g-ib, .g-copied, .g-src-toggle svg, .g-crop-bar, .g-ocr-text { transition: none !important; }
  .g-skel, .g-ib.is-speaking svg, .g-crop, .g-crop-mark { animation: none !important; }
  .g-spin { animation-duration: 2.4s; }
  .g-bubble, .g-bubble[data-placement="above"], .g-trigger, .g-trigger.is-visible:hover { transform: none; }
}

@media (forced-colors: active) {
  .g-bubble, .g-crop-bar { border: 1px solid CanvasText; }
  .g-crop-box, .g-crop-mark { border-color: Highlight; }
  .g-ib:focus-visible, .g-btn:focus-visible, .g-to:focus-visible, .g-more:focus-visible, .g-trigger:focus-visible,
  .g-ladd:focus-visible, .g-lchip-x:focus-visible, .g-ocr-text:focus, .g-rchip:focus-visible, .g-rmore:focus-visible {
    outline: 2px solid Highlight;
  }
}
`;
})();
