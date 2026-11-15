#!/usr/bin/env node
/**
 * Re-capture the real provider responses used by the background tests (NOT run by `node --test`).
 * One live request per case. Usage: node tests/background/capture-fixtures.mjs
 *
 * Microsoft fixtures: the free Edge token endpoint (edge.microsoft.com/translate/auth) returned 404 when these were
 * captured, so the Microsoft-shaped fixtures come from Bing's web translator (ttranslatev3 / tlookupv3), which returns
 * exactly the Translator v3 `/translate` and `/dictionary/lookup` JSON schema.
 */
// Never run (live network + overwriting fixtures) when picked up by a `node --test` glob.
if (process.env.NODE_TEST_CONTEXT) {
  console.log('capture-fixtures: skipped under the test runner');
  process.exit(0);
}

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGoogleRequest } from '../../extension/src/background/providers/google.js';
import { BING_BASE, parseBingSession } from '../../extension/src/background/providers/microsoft.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
await mkdir(DIR, { recursive: true });

const save = async (name, data) => {
  await writeFile(path.join(DIR, name), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`saved ${name}`);
};

const GOOGLE_CASES = [
  { file: 'google-word-en-vi.json', text: 'obvious', from: 'auto', to: 'vi' }, // dict + definitions + examples + synsets
  { file: 'google-sentence-en-vi.json', text: "The weather is nice today. Let's go for a walk in the park!", from: 'auto', to: 'vi' },
  { file: 'google-nonlatin-zh-en.json', text: '你好世界', from: 'auto', to: 'en' }, // src_translit (pinyin)
  { file: 'google-translit-en-ja.json', text: 'good morning', from: 'auto', to: 'ja' }, // translit of the translation + score
];

for (const c of GOOGLE_CASES) {
  const { url, init } = buildGoogleRequest({ text: c.text, from: c.from, to: c.to, uiLang: 'en' });
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${c.file}: HTTP ${res.status}`);
  await save(c.file, await res.json());
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const page = await fetch(`${BING_BASE}/translator`, { headers: { 'User-Agent': UA } });
const session = parseBingSession(await page.text());
if (!session) throw new Error('bing session not found');

const bing = async (endpoint, fields) => {
  const qs = new URLSearchParams({ isVertical: '1', IG: session.ig, IID: session.iid });
  const res = await fetch(`${BING_BASE}/${endpoint}?${qs}`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, key: session.key, token: session.token }),
  });
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
  return res.json();
};

await save('microsoft-translate-word-en-vi.json', await bing('ttranslatev3', { fromLang: 'auto-detect', to: 'vi', text: 'obvious' }));
await save('microsoft-translate-zh-en.json', await bing('ttranslatev3', { fromLang: 'auto-detect', to: 'en', text: '你好世界' }));
await save('microsoft-translate-translit-en-ja.json', await bing('ttranslatev3', { fromLang: 'auto-detect', to: 'ja', text: 'good morning' }));
await save('microsoft-lookup-en-vi.json', await bing('tlookupv3', { from: 'en', to: 'vi', text: 'obvious' }));
