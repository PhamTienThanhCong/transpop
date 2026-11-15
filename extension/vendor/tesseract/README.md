# Tesseract.js (vendored)

On-device OCR for TransPop's image translation. Loaded only from the extension package (Chrome Web Store
remote-code policy) — never from a CDN. Used by `src/offscreen/ocr-engine.js`. Only the language data
(`<lang>.traineddata.gz`, data — not code) is downloaded at runtime, from jsDelivr
`https://cdn.jsdelivr.net/npm/@tesseract.js-data/<lang>/4.0.0_best_int/`, and cached in IndexedDB by Tesseract.

| Package | Version | Published | npm `dist.integrity` | `dist.shasum` |
|---|---|---|---|---|
| [`tesseract.js`](https://www.npmjs.com/package/tesseract.js) | 7.0.0 | 2025-12-15 | `sha512-exPBkd+z+wM1BuMkx/Bjv43OeLBxhL5kKWsz/9JY+DXcXdiBjiAch0V49QR3oAJqCaL5qURE0vx9Eo+G5YE7mA==` | `4106fb6245efab40c57b94bc1798368807526be8` |
| [`tesseract.js-core`](https://www.npmjs.com/package/tesseract.js-core) | 7.0.0 | 2025-12-15 | `sha512-WnNH518NzmbSq9zgTPeoF8c+xmilS8rFIl1YKbk/ptuuc7p6cLNELNuPAzcmsYw450ca6bLa8j3t0VAtq435Vw==` | `596aa1ab5c130adab12f21059e6aa1a1cecc0bab` |

Both are Apache-2.0 (`LICENSE` = the license file shipped in both packages; they are identical). The minified builds
bundle permissively licensed dependencies: regenerator-runtime, buffer, zlib.js, is-url, bmp-js (MIT), ieee754
(BSD-3-Clause), idb-keyval, wasm-feature-detect (Apache-2.0) — notices in the two `*.LICENSE.txt` files. Inside the
WASM core: Tesseract OCR (Apache-2.0) and Leptonica (BSD-2-Clause style).

## Files

Copied byte-for-byte from the npm tarballs (verified against the registry integrity above). `npm run check` verifies
every file against this table, so do not edit them — re-vendor instead.

| File | Bytes | SHA-256 |
|---|---|---|
| `tesseract.esm.min.js` | 63220 | `64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29` |
| `worker.min.js` | 111307 | `576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d` |
| `tesseract.min.js.LICENSE.txt` | 149 | `cdf963ced7d25a0f98901a547647b4d6e2dbe0197fd78c87a059a87b0e542fe2` |
| `worker.min.js.LICENSE.txt` | 466 | `45f54171aeaa1d10c0c1a66f374b7bba1f02472b1487fbe892eec04f840002ac` |
| `tesseract-core-relaxedsimd-lstm.js` | 89360 | `a37ac78b707e8d5d3d2e532cc3c4e69b04d127ea44a608f1e7de17640402aa5c` |
| `tesseract-core-relaxedsimd-lstm.wasm` | 2862266 | `7985c92d4c64e7267d24cadffe1b2a1da6bf8aa55fdcaf953fe94fe122a24545` |
| `tesseract-core-simd-lstm.js` | 89271 | `e48e2f02ddae3716c8dd24bf41cd290d4efa96892d689cdc4013c2545d63f469` |
| `tesseract-core-simd-lstm.wasm` | 2857601 | `34e8d50cac216427d86bf397d610fdd9f49492539bbcdfbfccc4eda20c810bea` |
| `tesseract-core-lstm.js` | 89261 | `6510efc4e8b45c5465df30679b9911ffe0071cd2ee982fa064e6f5136ef2de85` |
| `tesseract-core-lstm.wasm` | 2855361 | `66b17df6e20c5329a17ffa9c202a47eaa3e32500b253d4c7f38e7f2bc01457c3` |

Sources inside the tarballs: `package/dist/{tesseract.esm.min.js, worker.min.js, *.LICENSE.txt}` (tesseract.js) and
`package/tesseract-core-{relaxedsimd-lstm,simd-lstm,lstm}.{js,wasm}` (tesseract.js-core). Not copied: source maps,
the UMD build, the legacy-engine cores (`tesseract-core{,-simd,-relaxedsimd}.*` — TransPop uses the LSTM engine only)
and the `*.wasm.js` variants (same cores with the WASM inlined as base64: ~30% bigger).

## How it is wired

- `workerPath` = `worker.min.js`, `workerBlobURL: false` (no blob: worker → works under the extension CSP).
- `corePath` = one of the `tesseract-core-*-lstm.js` files, picked by `ocr-engine.js` with the same WebAssembly
  feature probes tesseract.js uses (relaxed SIMD → SIMD → baseline). The core's Emscripten loader fetches its `.wasm`
  relative to the **worker** script, so the cores must stay in the same folder as `worker.min.js`.
- WebAssembly compilation needs `'wasm-unsafe-eval'` in the extension CSP (already in `manifest.json`).
- The `Function(…)` calls in the minified code are dead fallbacks (`globalThis` exists), never executed.

## Updating

```sh
mkdir -p "$TMP/vendor-dl" && cd "$TMP/vendor-dl"
npm view tesseract.js@<v> dist.integrity dependencies     # pick a release ≥ 2 weeks old + its tesseract.js-core
npm pack tesseract.js@<v> tesseract.js-core@<core-v> --ignore-scripts
openssl dgst -sha512 -binary <tgz> | base64               # must equal dist.integrity
tar -xzf <tgz>                                            # then copy the files listed above
```

Then refresh the tables above (`shasum -a 256 *`) and run `npm run check` + the dev harness
(`npm run dev` → http://localhost:5179/dev/ocr-test.html).

## TransPop glue (not third-party)

`transpop-worker.js` is TransPop's own worker entry (MIT): it filters Tesseract's informational stderr lines
("Warning: Parameter not found…", "Estimating resolution…", "Detected N diacritics") that Chrome would otherwise list
as extension errors, then `importScripts('worker.min.js')`. It sits in this folder because Emscripten resolves the
`.wasm` core relative to the worker script's location. `npm run check` treats `transpop-*` files as our code (full
MV3 rules, not hash-listed).
