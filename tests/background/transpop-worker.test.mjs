import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../extension/vendor/tesseract/transpop-worker.js', import.meta.url), 'utf8');

test('transpop-worker filters Tesseract diagnostics, keeps real errors, then loads the vendored worker', () => {
  const seen = [];
  const imported = [];
  const fakeConsole = {};
  for (const level of ['error', 'warn', 'log', 'info']) fakeConsole[level] = (...args) => seen.push([level, args.join(' ')]);
  const ctx = vm.createContext({ console: fakeConsole, importScripts: (p) => imported.push(p) });
  vm.runInContext(SRC, ctx);

  assert.deepEqual(imported, ['worker.min.js'], 'loads the vendored worker from its own folder');
  ctx.console.error('Warning: Parameter not found: language_model_ngram_on');
  ctx.console.error('Estimating resolution as 673');
  ctx.console.error('Detected 52 diacritics');
  ctx.console.warn('Warning. Invalid resolution 0 dpi. Using 70 instead.');
  assert.equal(seen.length, 0, 'informational lines are dropped');

  ctx.console.error('RuntimeError: memory access out of bounds');
  ctx.console.error(new Error('real failure'));
  ctx.console.log('progress 50%');
  assert.equal(seen.length, 3, 'everything else still reaches the console');
});
