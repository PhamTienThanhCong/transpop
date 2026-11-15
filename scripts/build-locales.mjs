#!/usr/bin/env node
/**
 * Build extension/_locales/<locale>/messages.json from the i18n/*.json fragments.
 *
 * Fragment format:  { "key": { "en": "Text with $1", "vi": "Văn bản $1", "description": "context for translators" } }
 *  - `$1`..`$9` become Chrome placeholders automatically.
 *  - Keys must be unique across all fragments.
 *  - Required locales (en, vi) must be present for every key; other locales are optional
 *    (Chrome falls back to default_locale "en").
 *
 * Usage:
 *   node scripts/build-locales.mjs          # write files
 *   node scripts/build-locales.mjs --check  # verify generated files are up to date (CI)
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'i18n');
const OUT_DIR = path.join(ROOT, 'extension', '_locales');
const REQUIRED_LOCALES = ['en', 'vi'];
const CHECK = process.argv.includes('--check');

const errors = [];
const warnings = [];

const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith('.json')).sort();
const messages = new Map(); // key -> { file, entry }
const locales = new Set(REQUIRED_LOCALES);

for (const file of files) {
  let data;
  try {
    data = JSON.parse(await readFile(path.join(SRC_DIR, file), 'utf8'));
  } catch (e) {
    errors.push(`${file}: invalid JSON — ${e.message}`);
    continue;
  }
  for (const [key, entry] of Object.entries(data)) {
    if (!/^[A-Za-z0-9_]+$/.test(key)) errors.push(`${file}: invalid key "${key}" (use [A-Za-z0-9_])`);
    if (messages.has(key)) {
      errors.push(`${file}: duplicate key "${key}" (already defined in ${messages.get(key).file})`);
      continue;
    }
    if (!entry || typeof entry !== 'object') {
      errors.push(`${file}: "${key}" must be an object`);
      continue;
    }
    for (const loc of Object.keys(entry)) if (loc !== 'description') locales.add(loc);
    messages.set(key, { file, entry });
  }
}

for (const [key, { file, entry }] of messages) {
  for (const loc of REQUIRED_LOCALES) {
    if (typeof entry[loc] !== 'string' || !entry[loc].trim()) errors.push(`${file}: "${key}" is missing "${loc}"`);
  }
  for (const loc of locales) {
    if (REQUIRED_LOCALES.includes(loc) || entry[loc] !== undefined) continue;
    warnings.push(`${file}: "${key}" has no "${loc}" translation (falls back to en)`);
  }
  // Placeholder parity between locales
  const ph = (s) => [...new Set((s || '').match(/\$[1-9]/g) || [])].sort().join(',');
  const enPh = ph(entry.en);
  for (const loc of locales) {
    if (entry[loc] !== undefined && ph(entry[loc]) !== enPh) {
      errors.push(`${file}: "${key}" placeholders differ between en (${enPh || 'none'}) and ${loc} (${ph(entry[loc]) || 'none'})`);
    }
  }
}

// Chrome Web Store limits
const limit = (key, max) => {
  const e = messages.get(key)?.entry;
  if (!e) return errors.push(`missing required key "${key}"`);
  for (const loc of locales) if (e[loc] && e[loc].length > max) errors.push(`"${key}" (${loc}) is ${e[loc].length} chars, max ${max}`);
};
limit('extName', 75);
limit('extShortName', 12);
limit('extDescription', 132);

if (errors.length) {
  console.error(`✖ i18n build failed:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}

function toChromeMessage(text, description) {
  const out = {};
  const nums = [...new Set((text.match(/\$[1-9]/g) || []).map((m) => m.slice(1)))];
  out.message = nums.length ? text.replace(/\$([1-9])/g, (_, n) => `$P${n}$`) : text;
  if (description) out.description = description;
  if (nums.length) {
    out.placeholders = Object.fromEntries(nums.sort().map((n) => [`p${n}`, { content: `$${n}` }]));
  }
  return out;
}

let stale = false;
for (const loc of [...locales].sort()) {
  const result = {};
  for (const key of [...messages.keys()].sort()) {
    const { entry } = messages.get(key);
    if (entry[loc] === undefined) continue;
    result[key] = toChromeMessage(entry[loc], loc === 'en' ? entry.description : undefined);
  }
  const outFile = path.join(OUT_DIR, loc, 'messages.json');
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (CHECK) {
    const current = existsSync(outFile) ? await readFile(outFile, 'utf8') : '';
    if (current !== json) {
      stale = true;
      console.error(`✖ ${path.relative(ROOT, outFile)} is out of date — run: node scripts/build-locales.mjs`);
    }
  } else {
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, json);
  }
}

if (warnings.length) console.warn(`⚠ ${warnings.length} warning(s):\n  - ${warnings.slice(0, 20).join('\n  - ')}`);
if (stale) process.exit(1);
console.log(`✔ i18n ${CHECK ? 'up to date' : 'built'}: ${messages.size} keys × ${locales.size} locales (${[...locales].join(', ')}) from ${files.length} fragment(s)`);
