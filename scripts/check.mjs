#!/usr/bin/env node
/**
 * TransPop — static checks for the extension. Zero dependencies (Node ≥ 22).
 *
 *   node scripts/check.mjs        (or: npm run check)
 *
 * Verifies:
 *  - manifest.json is valid JSON with the required MV3 fields, a valid version, sane permissions
 *  - every file referenced by the manifest exists (icons — with the right pixel size —, popup,
 *    options, service worker, content scripts, web-accessible resources, …)
 *  - every local src/href in extension HTML files and url() in CSS exists and stays inside extension/
 *  - every relative ES-module import in extension JS resolves to a file
 *  - `node --check` passes for every JS file; content scripts also compile as classic scripts
 *  - MV3/CSP rules: no inline <script> bodies, no on*= handlers, no javascript: URLs,
 *    no eval( / new Function( / string timers, no remote scripts/modules/stylesheets
 *  - i18n: __MSG_*__ keys in the manifest, data-i18n*="key" in HTML and t('key') / getMessage('key')
 *    literals in JS all exist in _locales/en/messages.json; `build-locales.mjs --check` passes
 *  - release hygiene (warnings): placeholder URLs, CHANGELOG entry for the manifest version
 *  - vendored third-party code (extension/vendor/<lib>/): LICENSE + README.md present, every file listed in the
 *    README's SHA-256 table exists and matches (no silent edits), every Tesseract core .js has its .wasm.
 *    Minified vendor code is exempt from the MV3 pattern scans and the i18n key scan (it trips them with dead
 *    fallback code such as `new Function("return this")` and unrelated `t("…")` calls) but is still syntax-checked.
 *
 * Exit code 0 = no errors (warnings allowed), 1 = at least one error.
 * Works on a partially written tree: missing files are reported, never crash the script.
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');
const VENDOR = path.join(EXT, 'vendor');
const isVendor = (p) => p.startsWith(VENDOR + path.sep);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/') || '.';

/** Permissions documented in docs/ARCHITECTURE.md §3 (each one has a Web Store justification). */
const EXPECTED_PERMISSIONS = ['storage', 'contextMenus', 'offscreen', 'tts'];
const EXPECTED_HOSTS = [
  'https://translate.googleapis.com/*',
  'https://translate.google.com/*',
  'https://edge.microsoft.com/*',
  'https://api-edge.cognitive.microsofttranslator.com/*',
  'https://www.bing.com/*',
];

// ───────────────────────────── output helpers ─────────────────────────────
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const green = paint(32);
const red = paint(31);
const yellow = paint(33);
const bold = paint(1);
const dim = paint(2);
let errorCount = 0;
let warnCount = 0;
const ok = (msg) => console.log(`  ${green('✔')} ${msg}`);
const fail = (msg) => {
  errorCount++;
  console.log(`  ${red('✖')} ${msg}`);
};
const warn = (msg) => {
  warnCount++;
  console.log(`  ${yellow('⚠')} ${msg}`);
};
const info = (msg) => console.log(`  ${dim('·')} ${dim(msg)}`);
const section = (title) => console.log(`\n${bold(title)}`);

// ───────────────────────────── fs helpers ─────────────────────────────
async function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const insideExt = (p) => p === EXT || p.startsWith(EXT + path.sep);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const stripQuery = (u) => u.split('#')[0].split('?')[0];
const safeDecode = (u) => {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
};

/** PNG width/height from the IHDR chunk, or null. */
function pngSize(file) {
  try {
    const fd = openSync(file, 'r');
    const buf = Buffer.alloc(24);
    readSync(fd, buf, 0, 24, 0);
    closeSync(fd);
    if (buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/**
 * Blank out JS comments (keeping newlines and string/regex/template literals intact) so that
 * pattern checks don't trip over documentation and line numbers stay correct.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  let last = '';
  const n = src.length;
  const regexPrefix = '(,=:[!&|?{};+-*%<>~^';
  while (i < n) {
    const ch = src[i];
    const nx = src[i + 1];
    if (ch === '/' && nx === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (ch === '/' && nx === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < n && src[j] !== ch) {
        if (src[j] === '\\') j++;
        else if (ch !== '`' && src[j] === '\n') break;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      last = ch;
    } else if (ch === '/' && (last === '' || regexPrefix.includes(last))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        const c = src[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      last = '/';
    } else {
      out += ch;
      if (!/\s/.test(ch)) last = ch;
      i++;
    }
  }
  return out;
}

async function pool(items, size, fn) {
  let next = 0;
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// ───────────────────────────── load inputs ─────────────────────────────
const allFiles = await walk(EXT);
const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));
const jsFiles = allFiles.filter((f) => /\.(m?js)$/.test(f));
const ownJsFiles = jsFiles.filter((f) => !isVendor(f)); // our code: full MV3 / i18n rules
const vendorFiles = allFiles.filter(isVendor);
const cssFiles = allFiles.filter((f) => f.endsWith('.css'));
const sources = new Map(); // file -> { raw, code (comments stripped) }
for (const f of [...htmlFiles, ...ownJsFiles, ...cssFiles]) {
  try {
    const raw = await readFile(f, 'utf8');
    sources.set(f, { raw, code: f.endsWith('.html') ? raw.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' ')) : f.endsWith('.css') ? raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) : stripComments(raw) });
  } catch (e) {
    sources.set(f, { raw: '', code: '' });
  }
}

console.log(bold('TransPop — extension checks'));
info(`${rel(EXT)}/: ${allFiles.length} files (${jsFiles.length} JS, ${htmlFiles.length} HTML, ${cssFiles.length} CSS)`);
if (vendorFiles.length) {
  const bytes = vendorFiles.reduce((n, f) => n + statSync(f).size, 0);
  info(`${rel(VENDOR)}/: ${vendorFiles.length} third-party files (${(bytes / 1048576).toFixed(1)} MB)`);
}

// ───────────────────────────── locales ─────────────────────────────
section('Locales');
let enKeys = null; // Set of lower-cased keys (chrome.i18n lookups are case-insensitive)
{
  const enPath = path.join(EXT, '_locales', 'en', 'messages.json');
  try {
    const en = JSON.parse(await readFile(enPath, 'utf8'));
    enKeys = new Set(Object.keys(en).map((k) => k.toLowerCase()));
    const bad = Object.entries(en).filter(([, v]) => !v || typeof v.message !== 'string').map(([k]) => k);
    if (bad.length) fail(`${rel(enPath)}: entries without a "message" string: ${bad.join(', ')}`);
    else ok(`${rel(enPath)}: ${enKeys.size} messages`);
  } catch (e) {
    fail(`${rel(enPath)}: ${e.code === 'ENOENT' ? 'not found — run: npm run i18n' : `invalid JSON — ${e.message}`}`);
  }
  const locDir = path.join(EXT, '_locales');
  if (existsSync(locDir)) {
    for (const ent of await readdir(locDir, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name === 'en') continue;
      const p = path.join(locDir, ent.name, 'messages.json');
      try {
        const n = Object.keys(JSON.parse(await readFile(p, 'utf8'))).length;
        ok(`${rel(p)}: ${n} messages`);
      } catch (e) {
        fail(`${rel(p)}: ${e.code === 'ENOENT' ? 'not found' : `invalid JSON — ${e.message}`}`);
      }
    }
  }
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [path.join(ROOT, 'scripts', 'build-locales.mjs'), '--check'], { cwd: ROOT });
    const lines = `${stdout}${stderr}`.trim().split('\n').filter(Boolean);
    const summary = lines.find((l) => l.startsWith('✔')) || 'build-locales --check passed';
    ok(`build-locales --check: ${summary.replace(/^✔\s*/, '')}`);
    for (const l of lines.filter((x) => x.startsWith('⚠'))) info(l.replace(/^⚠\s*/, 'i18n: '));
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message;
    fail(`build-locales --check failed:\n      ${out.split('\n').join('\n      ')}`);
  }
}
const hasKey = (k) => !enKeys || enKeys.has(k.toLowerCase());

// ───────────────────────────── manifest ─────────────────────────────
section('Manifest');
let manifest = null;
const manifestPath = path.join(EXT, 'manifest.json');
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  ok('manifest.json is valid JSON');
} catch (e) {
  fail(`manifest.json: ${e.code === 'ENOENT' ? 'not found' : `invalid JSON — ${e.message}`}`);
}

const contentScriptFiles = new Set();
if (manifest) {
  // Required fields
  const missing = [];
  if (manifest.manifest_version !== 3) fail(`manifest_version must be 3 (found ${JSON.stringify(manifest.manifest_version)})`);
  for (const k of ['name', 'version', 'description', 'icons', 'action', 'background']) if (manifest[k] === undefined) missing.push(k);
  if (missing.length) fail(`missing required field(s): ${missing.join(', ')}`);
  else ok('required fields present (manifest_version, name, version, description, icons, action, background)');

  const v = String(manifest.version ?? '');
  if (/^\d{1,5}(\.\d{1,5}){0,3}$/.test(v) && v.split('.').every((p) => Number(p) <= 65535 && (p === '0' || !p.startsWith('0')))) {
    ok(`version ${v}`);
  } else {
    fail(`invalid version "${v}" (1–4 dot-separated integers 0–65535, no leading zeros)`);
  }

  const usesMsg = JSON.stringify(manifest).includes('__MSG_');
  if (usesMsg && !manifest.default_locale) fail('manifest uses __MSG_*__ but has no default_locale');
  if (manifest.default_locale && !existsSync(path.join(EXT, '_locales', manifest.default_locale, 'messages.json'))) {
    fail(`default_locale "${manifest.default_locale}" has no _locales/${manifest.default_locale}/messages.json`);
  }

  // __MSG_*__ keys
  const msgKeys = [...new Set([...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)].map((m) => m[1]))];
  if (msgKeys.length) {
    const absent = msgKeys.filter((k) => !k.startsWith('@@') && !hasKey(k));
    if (absent.length) fail(`__MSG_*__ keys missing from _locales/en/messages.json: ${absent.join(', ')}`);
    else ok(`__MSG_*__ keys resolve: ${msgKeys.join(', ')}`);
  }

  // Referenced files
  const refs = []; // [label, relPath, expectedSize?]
  for (const [size, p] of Object.entries(manifest.icons || {})) refs.push([`icons.${size}`, p, Number(size)]);
  const di = manifest.action?.default_icon;
  if (typeof di === 'string') refs.push(['action.default_icon', di]);
  else for (const [size, p] of Object.entries(di || {})) refs.push([`action.default_icon.${size}`, p, Number(size)]);
  if (manifest.action?.default_popup) refs.push(['action.default_popup', manifest.action.default_popup]);
  if (manifest.options_ui?.page) refs.push(['options_ui.page', manifest.options_ui.page]);
  if (manifest.options_page) refs.push(['options_page', manifest.options_page]);
  if (manifest.background?.service_worker) refs.push(['background.service_worker', manifest.background.service_worker]);
  if (manifest.side_panel?.default_path) refs.push(['side_panel.default_path', manifest.side_panel.default_path]);
  if (manifest.devtools_page) refs.push(['devtools_page', manifest.devtools_page]);
  for (const [k, p] of Object.entries(manifest.chrome_url_overrides || {})) refs.push([`chrome_url_overrides.${k}`, p]);
  (manifest.content_scripts || []).forEach((cs, i) => {
    for (const p of cs.js || []) {
      refs.push([`content_scripts[${i}].js`, p]);
      contentScriptFiles.add(path.resolve(EXT, p));
    }
    for (const p of cs.css || []) refs.push([`content_scripts[${i}].css`, p]);
  });
  (manifest.web_accessible_resources || []).forEach((w, i) => {
    for (const p of w.resources || []) if (!/[*?]/.test(p)) refs.push([`web_accessible_resources[${i}]`, p]);
  });
  let refOk = 0;
  for (const [label, p, size] of refs) {
    const abs = path.resolve(EXT, String(p).replace(/^\//, ''));
    if (!insideExt(abs)) fail(`${label}: "${p}" points outside extension/`);
    else if (!isFile(abs)) fail(`${label}: missing file extension/${p}`);
    else if (size && p.endsWith('.png')) {
      const dim = pngSize(abs);
      if (!dim) fail(`${label}: extension/${p} is not a valid PNG`);
      else if (dim.w !== size || dim.h !== size) fail(`${label}: extension/${p} is ${dim.w}×${dim.h}, expected ${size}×${size}`);
      else refOk++;
    } else refOk++;
  }
  if (refs.length && refOk === refs.length) ok(`all ${refs.length} files referenced by the manifest exist`);
  else if (refs.length) info(`${refOk}/${refs.length} manifest references OK`);
  if (!manifest.icons?.['128']) fail('icons.128 is required by the Chrome Web Store');

  if (manifest.background?.service_worker && manifest.background.type !== 'module') {
    contentScriptFiles.add(path.resolve(EXT, manifest.background.service_worker)); // classic SW → classic-script check too
  }

  // Permissions (each one must be justified in the Web Store "Privacy practices" tab)
  const perms = manifest.permissions || [];
  const hosts = manifest.host_permissions || [];
  const extraPerms = perms.filter((p) => !EXPECTED_PERMISSIONS.includes(p));
  const extraHosts = hosts.filter((h) => !EXPECTED_HOSTS.includes(h));
  if (extraPerms.length || extraHosts.length) {
    warn(`permissions not documented in docs/ARCHITECTURE.md §3 (add a store justification in docs/PUBLISHING.md): ${[...extraPerms, ...extraHosts].join(', ')}`);
  } else {
    ok(`permissions: ${perms.join(', ') || '(none)'}; hosts: ${hosts.length}`);
  }
  if (hosts.some((h) => h === '<all_urls>' || /^\*:\/\/\*\//.test(h) || /^https?:\/\/\*\/\*$/.test(h))) {
    warn('host_permissions contains a match-all pattern — expect a slower, stricter Web Store review');
  }
  if (manifest.content_security_policy) info('custom content_security_policy present — make sure it does not allow remote code');
}

// ───────────────────────────── HTML ─────────────────────────────
section('HTML (extension pages)');
const i18nHtmlKeys = []; // [file, line, key]
if (!htmlFiles.length) warn('no HTML files under extension/ yet');
for (const file of htmlFiles) {
  const { code } = sources.get(file);
  const problems = [];
  let localRefs = 0;

  // Inline <script> bodies
  for (const m of code.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1];
    const isData = /\btype\s*=\s*["']?application\/(ld\+)?json/i.test(attrs);
    if (!/\bsrc\s*=/i.test(attrs) && m[2].trim() && !isData) problems.push(`line ${lineOf(code, m.index)}: inline <script> body (blocked by the MV3 CSP — move it to a .js file)`);
  }
  // Tags: inline handlers, src/href references
  for (const t of code.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const tag = t[1].toLowerCase();
    const attrs = t[2];
    const line = lineOf(code, t.index);
    const handler = attrs.match(/\s(on[a-z]+)\s*=/i);
    if (handler) problems.push(`line ${line}: inline event handler ${handler[1]}= on <${tag}> (use addEventListener)`);
    for (const a of attrs.matchAll(/\s(src|href)\s*=\s*(["'])(.*?)\2/gi)) {
      const url = a[3].trim();
      if (!url || url.startsWith('#') || /^(mailto|tel|data|blob|chrome|chrome-extension|about):/i.test(url)) continue;
      if (/^javascript:/i.test(url)) {
        problems.push(`line ${line}: javascript: URL on <${tag}>`);
        continue;
      }
      if (/^(https?:)?\/\//i.test(url)) {
        if (tag === 'script') problems.push(`line ${line}: remote <script src="${url}"> (remote code is forbidden in MV3)`);
        else if (tag === 'link') problems.push(`line ${line}: remote <link href="${url}"> (no remote CSS/fonts — bundle it)`);
        else if (tag !== 'a') warn(`${rel(file)}:${line}: remote resource <${tag} ${a[1]}="${url}"> (privacy: loads on every open)`);
        continue;
      }
      const target = url.startsWith('/') ? path.join(EXT, safeDecode(stripQuery(url))) : path.resolve(path.dirname(file), safeDecode(stripQuery(url)));
      if (!insideExt(target)) problems.push(`line ${line}: ${a[1]}="${url}" points outside extension/ (breaks in the packaged zip)`);
      else if (!isFile(target)) problems.push(`line ${line}: ${a[1]}="${url}" → missing ${rel(target)}`);
      else localRefs++;
    }
  }
  // data-i18n*="key"
  for (const m of code.matchAll(/\sdata-i18n(?:-[a-z-]+)?\s*=\s*(["'])([^"']*)\1/g)) i18nHtmlKeys.push([file, lineOf(code, m.index), m[2].trim()]);

  if (problems.length) for (const p of problems) fail(`${rel(file)}: ${p}`);
  else ok(`${rel(file)} (${localRefs} local reference${localRefs === 1 ? '' : 's'} OK, CSP-safe)`);
}

// ───────────────────────────── CSS ─────────────────────────────
if (cssFiles.length) {
  section('CSS');
  for (const file of cssFiles) {
    const { code } = sources.get(file);
    const problems = [];
    let n = 0;
    for (const m of code.matchAll(/@import\s+(?:url\()?\s*["']?(https?:)?\/\//gi)) problems.push(`line ${lineOf(code, m.index)}: remote @import (bundle it locally)`);
    for (const m of code.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
      const url = m[2].trim();
      if (/^(data|blob|chrome-extension):/i.test(url) || url.startsWith('#')) continue;
      if (/^(https?:)?\/\//i.test(url)) {
        problems.push(`line ${lineOf(code, m.index)}: remote url(${url}) (no remote fonts/images)`);
        continue;
      }
      const target = url.startsWith('/') ? path.join(EXT, stripQuery(url)) : path.resolve(path.dirname(file), stripQuery(url));
      if (!insideExt(target) || !isFile(target)) problems.push(`line ${lineOf(code, m.index)}: url(${url}) → missing ${rel(target)}`);
      else n++;
    }
    if (problems.length) for (const p of problems) fail(`${rel(file)}: ${p}`);
    else ok(`${rel(file)}${n ? ` (${n} url() reference${n === 1 ? '' : 's'} OK)` : ''}`);
  }
}

// ───────────────────────────── JS syntax ─────────────────────────────
section('JavaScript syntax (node --check)');
if (!jsFiles.length) warn('no JS files under extension/ yet');
const syntax = await pool(jsFiles, Math.max(2, os.cpus().length), async (file) => {
  try {
    await execFileP(process.execPath, ['--check', file], { cwd: ROOT });
    return null;
  } catch (e) {
    const msg = `${e.stderr || e.message}`.trim().split('\n').filter((l) => l.trim() && !l.startsWith('Node.js v')).slice(0, 4).join('\n      ');
    return `${rel(file)}:\n      ${msg}`;
  }
});
const syntaxErrors = syntax.filter(Boolean);
for (const s of syntaxErrors) fail(s);
if (jsFiles.length && !syntaxErrors.length) ok(`${jsFiles.length} JS file${jsFiles.length === 1 ? '' : 's'} parse cleanly`);
// Content scripts are injected as classic scripts: no import/export allowed.
for (const file of contentScriptFiles) {
  if (!sources.has(file)) continue;
  try {
    new vm.Script(sources.get(file).raw, { filename: rel(file) });
    ok(`${rel(file)} compiles as a classic script (content script)`);
  } catch (e) {
    fail(`${rel(file)}: not a valid classic script — ${e.message} (content scripts can't use import/export)`);
  }
}

// ───────────────────────────── JS rules ─────────────────────────────
section('JavaScript rules (MV3 / security / imports)');
const htmlSinks = [];
const i18nJsKeys = []; // [file, line, key]
let importCount = 0;
for (const file of ownJsFiles) {
  const { code } = sources.get(file);
  const problems = [];
  const at = (idx) => `${rel(file)}:${lineOf(code, idx)}`;
  for (const m of code.matchAll(/\beval\s*\(/g)) problems.push(`${at(m.index)}: eval( is forbidden (MV3 CSP)`);
  for (const m of code.matchAll(/\bnew\s+Function\s*\(/g)) problems.push(`${at(m.index)}: new Function( is forbidden (MV3 CSP)`);
  for (const m of code.matchAll(/\bset(?:Timeout|Interval)\s*\(\s*["'`]/g)) problems.push(`${at(m.index)}: string passed to setTimeout/setInterval (implicit eval)`);
  for (const m of code.matchAll(/\b(?:import|export)\s*(?:[^'"`;()]*?\s*from\s*)?["'`](https?:)?\/\//g)) problems.push(`${at(m.index)}: remote ES module import (remote code is forbidden)`);
  for (const m of code.matchAll(/\b(?:import|importScripts)\s*\(\s*["'`](https?:)?\/\//g)) problems.push(`${at(m.index)}: remote script loading (remote code is forbidden)`);
  for (const m of code.matchAll(/\.(?:innerHTML|outerHTML)\s*\+?=|\binsertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(/g)) htmlSinks.push(at(m.index));

  // Relative module specifiers must resolve
  const specs = [
    ...code.matchAll(/(?<![\w$.])(?:import|export)\s*(?:[^'"`;()]*?\sfrom\s*)?(["'])([^"'\n]+)\1/g),
    ...code.matchAll(/\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g),
  ];
  for (const m of specs) {
    const spec = m[2];
    if (!/^(\.{1,2}\/|\/)/.test(spec)) continue;
    importCount++;
    const target = spec.startsWith('/') ? path.join(EXT, stripQuery(spec)) : path.resolve(path.dirname(file), stripQuery(spec));
    if (!insideExt(target)) problems.push(`${at(m.index)}: import "${spec}" points outside extension/`);
    else if (!isFile(target)) problems.push(`${at(m.index)}: import "${spec}" → missing ${rel(target)}`);
  }
  // chrome.runtime.getURL('…') literals are relative to the extension root
  for (const m of code.matchAll(/\bgetURL\(\s*(["'])([^"'\n]+)\1\s*\)/g)) {
    const target = path.join(EXT, stripQuery(m[2]).replace(/^\//, ''));
    if (!isFile(target)) problems.push(`${at(m.index)}: getURL("${m[2]}") → missing ${rel(target)}`);
  }
  // i18n literals
  for (const m of code.matchAll(/\b(?:t|getMessage)\(\s*(["'])([A-Za-z0-9_@]+)\1/g)) i18nJsKeys.push([file, lineOf(code, m.index), m[2]]);

  for (const p of problems) fail(p);
}
if (ownJsFiles.length) {
  const skipped = jsFiles.length - ownJsFiles.length;
  info(`scanned ${ownJsFiles.length} JS file${ownJsFiles.length === 1 ? '' : 's'}: ${importCount} relative import${importCount === 1 ? '' : 's'} checked${skipped ? ` (${skipped} vendored file${skipped === 1 ? '' : 's'} exempt — see "Vendored third-party code")` : ''}`);
}
if (htmlSinks.length) {
  warn(`HTML sinks (innerHTML/insertAdjacentHTML/document.write) in ${htmlSinks.length} place(s) — only trusted static markup allowed (ARCHITECTURE §1.3):\n      ${htmlSinks.join('\n      ')}`);
}

// ───────────────────────────── i18n keys ─────────────────────────────
section('i18n keys used in code');
if (!enKeys) {
  warn('skipped: _locales/en/messages.json is missing');
} else {
  const used = [...i18nHtmlKeys, ...i18nJsKeys].filter(([, , k]) => k && !k.startsWith('@@'));
  const missingKeys = used.filter(([, , k]) => !hasKey(k));
  const byFile = new Map(); // file -> Map(key -> first line)
  for (const [file, line, key] of missingKeys) {
    if (!byFile.has(file)) byFile.set(file, new Map());
    if (!byFile.get(file).has(key)) byFile.get(file).set(key, line);
  }
  for (const [file, keys] of byFile) {
    const list = [...keys].map(([k, l]) => `${k} (line ${l})`);
    fail(`${rel(file)}: ${keys.size} unknown message key${keys.size === 1 ? '' : 's'} — add to an i18n/*.json fragment, then npm run i18n:\n      ${list.join('\n      ')}`);
    errorCount += keys.size - 1; // count every missing key
  }
  if (!missingKeys.length) ok(`${new Set(used.map((u) => u[2])).size} distinct keys referenced (${i18nHtmlKeys.length} in HTML, ${i18nJsKeys.length} in JS) — all defined`);
}

// ───────────────────────────── vendored third-party code ─────────────────────────────
if (existsSync(VENDOR)) {
  section('Vendored third-party code (extension/vendor/)');
  const libs = (await readdir(VENDOR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => path.join(VENDOR, d.name));
  const strayTop = (await readdir(VENDOR, { withFileTypes: true })).filter((d) => d.isFile() && !d.name.startsWith('.'));
  for (const f of strayTop) fail(`${rel(path.join(VENDOR, f.name))}: put vendored files in extension/vendor/<library>/`);
  for (const lib of libs) {
    const problems = [];
    for (const req of ['LICENSE', 'README.md']) if (!isFile(path.join(lib, req))) problems.push(`missing ${req}`);
    const readmePath = path.join(lib, 'README.md');
    const listed = new Map(); // file name -> sha256 (from the README table: | `file` | size | `sha256` |)
    if (isFile(readmePath)) {
      const readme = await readFile(readmePath, 'utf8');
      for (const m of readme.matchAll(/^\|\s*`([^`/\\]+)`\s*\|[^|\n]*\|\s*`([0-9a-f]{64})`\s*\|/gm)) listed.set(m[1], m[2]);
      if (!listed.size) problems.push('README.md has no "| `file` | size | `sha256` |" table');
    }
    for (const [name, sha] of listed) {
      const file = path.join(lib, name);
      if (!isFile(file)) {
        problems.push(`listed file missing: ${name}`);
        continue;
      }
      const actual = createHash('sha256').update(await readFile(file)).digest('hex');
      if (actual !== sha) problems.push(`${name}: SHA-256 mismatch (modified? re-vendor it and update README.md)`);
    }
    const present = allFiles.filter((f) => path.dirname(f) === lib).map((f) => path.basename(f));
    const unlisted = present.filter((n) => !listed.has(n) && n !== 'README.md' && n !== 'LICENSE');
    if (unlisted.length) problems.push(`files not listed in README.md (hash them or remove them): ${unlisted.join(', ')}`);
    for (const n of present.filter((x) => /^tesseract-core-.*\.js$/.test(x) && !x.endsWith('.wasm.js'))) {
      if (!present.includes(n.replace(/\.js$/, '.wasm'))) problems.push(`${n} has no matching ${n.replace(/\.js$/, '.wasm')}`);
    }
    const bytes = present.reduce((n, f) => n + statSync(path.join(lib, f)).size, 0);
    if (problems.length) for (const p of problems) fail(`${rel(lib)}: ${p}`);
    else ok(`${rel(lib)}: ${listed.size} files verified against README.md SHA-256 (${(bytes / 1048576).toFixed(1)} MB), LICENSE present`);
  }
  if (!libs.length) warn('extension/vendor/ is empty');
}

// ───────────────────────────── release hygiene ─────────────────────────────
section('Release hygiene');
{
  const constants = path.join(EXT, 'src', 'shared', 'constants.js');
  const placeholderFiles = [
    constants,
    path.join(ROOT, 'README.md'),
    path.join(ROOT, 'docs', 'PRIVACY.md'),
    path.join(ROOT, 'docs', 'STORE_LISTING.md'),
    path.join(ROOT, '.github', 'ISSUE_TEMPLATE', 'config.yml'),
  ].filter((f) => existsSync(f));
  const withPlaceholder = [];
  for (const f of placeholderFiles) {
    const txt = await readFile(f, 'utf8');
    if (/EXTENSION_ID/.test(txt)) withPlaceholder.push(rel(f));
  }
  if (withPlaceholder.length) warn(`placeholder EXTENSION_ID (Chrome Web Store ID) still in: ${withPlaceholder.join(', ')} — replace before publishing (docs/PUBLISHING.md)`);
  else ok('no placeholder URLs');

  const changelog = path.join(ROOT, 'CHANGELOG.md');
  if (manifest?.version && existsSync(changelog)) {
    const txt = await readFile(changelog, 'utf8');
    if (new RegExp(`^##\\s*\\[?${manifest.version.replace(/\./g, '\\.')}\\]?`, 'm').test(txt)) ok(`CHANGELOG.md has an entry for ${manifest.version}`);
    else warn(`CHANGELOG.md has no "## ${manifest.version}" entry`);
  }
  for (const f of ['LICENSE', 'docs/PRIVACY.md', 'store-assets/store-icon-128.png', 'store-assets/promo-small-440x280.png']) {
    if (!existsSync(path.join(ROOT, f))) warn(`missing ${f}`);
  }
  const readme = path.join(ROOT, 'README.md');
  if (existsSync(readme)) {
    const txt = await readFile(readme, 'utf8');
    const imgs = [...txt.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|<img\b[^>]*\ssrc=["']([^"']+)["']/g)].map((m) => m[1] || m[2]);
    const missingImgs = imgs.filter((u) => !/^(https?:|data:)/i.test(u) && !existsSync(path.join(ROOT, stripQuery(u))));
    if (missingImgs.length) warn(`README.md images not found yet: ${missingImgs.join(', ')}`);
    else if (imgs.length) ok(`README.md: ${imgs.length} image reference${imgs.length === 1 ? '' : 's'} OK`);
  }
  const strays = allFiles.filter((f) => /\.(map|zip|pem|log)$|(^|[\\/])(Thumbs\.db)$/.test(f));
  if (strays.length) warn(`files that should not ship: ${strays.map(rel).join(', ')}`);
}

// ───────────────────────────── summary ─────────────────────────────
console.log('');
if (errorCount) {
  console.log(red(bold(`✖ ${errorCount} error${errorCount === 1 ? '' : 's'}`)) + (warnCount ? yellow(`, ${warnCount} warning${warnCount === 1 ? '' : 's'}`) : ''));
  process.exit(1);
}
console.log(green(bold('✔ All checks passed')) + (warnCount ? yellow(` (${warnCount} warning${warnCount === 1 ? '' : 's'})`) : ''));
