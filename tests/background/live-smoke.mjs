#!/usr/bin/env node
/**
 * Live smoke test against the real translation services (NOT run by `node --test`).
 * Usage: node tests/background/live-smoke.mjs
 * Exit code 1 if any Google sample fails (Microsoft failures are reported but tolerated:
 * the free endpoints are unofficial and may be unavailable in some regions).
 */
if (process.env.NODE_TEST_CONTEXT) {
  console.log('live-smoke: skipped under the test runner (run it directly)');
  process.exit(0);
}

const { translate } = await import('../../extension/src/background/translator.js');
const { translateMicrosoft, resetMicrosoftState } = await import('../../extension/src/background/providers/microsoft.js');
const { buildTtsUrls } = await import('../../extension/src/background/tts.js');

// Simulate the browser: in the extension Chrome sends its own User-Agent (Bing's web endpoint rejects Node's "node" UA).
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const fetchImpl = (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers || {}), 'User-Agent': UA } });

const SAMPLES = [
  { text: 'obvious', to: 'vi' },
  { text: 'good morning', to: 'ja' },
  { text: '你好世界', to: 'en' },
  { text: 'rõ ràng', to: 'vi', swapTo: 'en' }, // smart swap: vi detected → en
  { text: 'The weather is nice today. Let\'s go for a walk in the park!', to: 'vi' },
  { text: 'שלום עולם', to: 'en' },
];

const summarize = (r) => ({
  provider: r.provider,
  from: r.from,
  to: r.to,
  translation: r.translation,
  ...(r.phonetic ? { phonetic: r.phonetic } : {}),
  ...(r.translit ? { translit: r.translit } : {}),
  ...(r.alternatives ? { alternatives: r.alternatives.slice(0, 3) } : {}),
  ...(r.dictionary ? { dictionary: r.dictionary.map((d) => `${d.pos}: ${d.terms.slice(0, 4).join(', ')}`) } : {}),
  ...(r.definitions ? { definitions: r.definitions.reduce((n, d) => n + d.items.length, 0) } : {}),
  ...(r.examples ? { examples: r.examples.length } : {}),
  ...(r.synonyms ? { synonyms: r.synonyms.reduce((n, s) => n + s.terms.length, 0) } : {}),
});

let failures = 0;

console.log('== translator.js (provider: google, automatic fallback) ==');
for (const s of SAMPLES) {
  const t0 = Date.now();
  try {
    const r = await translate({ ...s, provider: 'google', uiLang: 'en', fetchImpl });
    console.log(`✔ ${JSON.stringify(s.text)} (${Date.now() - t0} ms)`, summarize(r));
    if (r.provider !== 'google') console.log('  ⚠ served by fallback provider');
  } catch (err) {
    failures++;
    console.log(`✖ ${JSON.stringify(s.text)}: ${err.code} ${err.message}`);
  }
}

console.log('\n== microsoft provider, per transport ==');
for (const transport of ['edge', 'bing']) {
  resetMicrosoftState();
  for (const s of SAMPLES.slice(0, 3)) {
    try {
      const r = await translateMicrosoft({ ...s, transports: [transport], fetchImpl });
      console.log(`✔ [${transport}] ${JSON.stringify(s.text)}`, summarize(r));
    } catch (err) {
      console.log(`✖ [${transport}] ${JSON.stringify(s.text)}: ${err.code} ${err.message}`);
    }
  }
}

console.log('\n== translator.js (provider: microsoft → falls back to google if Microsoft is unavailable) ==');
resetMicrosoftState();
try {
  const r = await translate({ text: 'light', to: 'vi', provider: 'microsoft', fetchImpl });
  console.log(`✔ "light"`, summarize(r));
} catch (err) {
  failures++;
  console.log(`✖ "light": ${err.code} ${err.message}`);
}

console.log('\n== Google TTS ==');
try {
  const [url] = buildTtsUrls('Xin chào thế giới', 'vi');
  const res = await fetch(url);
  const bytes = (await res.arrayBuffer()).byteLength;
  console.log(`${res.ok ? '✔' : '✖'} translate_tts → HTTP ${res.status} ${res.headers.get('content-type')} ${bytes} bytes`);
  if (!res.ok) failures++;
} catch (err) {
  failures++;
  console.log(`✖ translate_tts: ${err.message}`);
}

process.exit(failures ? 1 : 0);
