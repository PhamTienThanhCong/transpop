/*
 * TransPop — Web Worker entry for Tesseract (classic worker script). TransPop's own glue code, not third-party:
 * it lives next to the vendored files because Emscripten resolves the .wasm core relative to the WORKER script's
 * directory (self.location) — from anywhere else the core never finishes initializing.
 *
 * Tesseract's WASM core prints diagnostics through Emscripten's stderr → console.error, e.g.
 *   "Warning: Parameter not found: language_model_ngram_on"   (LSTM-only traineddata has no legacy parameters)
 *   "Estimating resolution as 673", "Detected 52 diacritics"
 * Chrome lists every console.error from an extension context under chrome://extensions → Errors, which makes a healthy
 * extension look broken. These lines are informational, so drop exactly those patterns (real errors still pass
 * through), then load the vendored tesseract.js worker unchanged.
 */
(() => {
  'use strict';
  const NOISE = [
    /^Warning: Parameter not found:/,
    /^Estimating resolution as \d+/,
    /^Detected \d+ diacritics/,
    /^Empty page!*$/,
    /^Too few characters\. Skipping this page/,
    /^Warning\. Invalid resolution \d+ dpi\. Using \d+ instead\./,
  ];
  const isNoise = (args) => typeof args[0] === 'string' && NOISE.some((re) => re.test(args[0].trim()));
  for (const level of ['error', 'warn', 'log', 'info']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      if (!isNoise(args)) original(...args);
    };
  }
})();

importScripts('worker.min.js');
