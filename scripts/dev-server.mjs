#!/usr/bin/env node
/**
 * TransPop dev server — preview extension pages in a normal browser tab, no extension install needed.
 *
 *   npm run dev            → http://localhost:5179
 *
 * - Serves the repo root as static files.
 * - Injects /dev/chrome-mock.js (a fake `chrome.*` API backed by localStorage) into every HTML page
 *   under /extension/, so popup/options/welcome pages run as-is.
 * - /dev/demo.html is a sample article that loads the content script(s) listed in the manifest,
 *   so the selection bubble can be tested.
 * - POST /__dev/translate runs the REAL background translator (extension/src/background/translator.js)
 *   in Node, so previews show live translations.
 *
 * Dev-only: never shipped (only extension/ is packaged).
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5179;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
};

const MOCK_TAG = '<script src="/dev/chrome-mock.js"></script>';

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

let translatorModule = null;
async function getTranslator() {
  if (!translatorModule) {
    const file = path.join(ROOT, 'extension/src/background/translator.js');
    translatorModule = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  }
  return translatorModule;
}

async function handleTranslate(req, res) {
  try {
    const payload = JSON.parse((await readBody(req)) || '{}');
    const mod = await getTranslator();
    const fn = mod.translate || mod.default?.translate || mod.default;
    if (typeof fn !== 'function') throw Object.assign(new Error('translator.js has no translate() export'), { code: 'UNKNOWN' });
    const result = await fn(payload);
    send(res, 200, JSON.stringify({ ok: true, result }), MIME['.json']);
  } catch (err) {
    translatorModule = null; // allow hot reload after a fix
    send(res, 200, JSON.stringify({ ok: false, error: { code: err.code || 'UNKNOWN', message: String(err.message || err) } }), MIME['.json']);
  }
}

async function demoPage() {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
  const scripts = (manifest.content_scripts?.[0]?.js || []).map((s) => `<script src="/extension/${s}"></script>`).join('\n');
  const html = await readFile(path.join(ROOT, 'dev/demo.html'), 'utf8');
  return html.replace('<!--CONTENT_SCRIPTS-->', `${MOCK_TAG}\n${scripts}`);
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'POST' && url.pathname === '/__dev/translate') return handleTranslate(req, res);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return send(
        res,
        200,
        `<!doctype html><meta charset="utf-8"><title>TransPop dev</title>
<style>body{font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:48px auto;padding:0 16px}a{display:block;margin:6px 0}</style>
<h1>TransPop dev harness</h1>
<p>Language: <a style="display:inline" href="?" onclick="localStorage.setItem('transpop-dev-lang','vi')">vi</a> · <a style="display:inline" href="?" onclick="localStorage.setItem('transpop-dev-lang','en')">en</a>
 · Theme follows the extension setting.</p>
<a href="/dev/demo.html">Content script demo page (select text)</a>
<a href="/extension/src/popup/popup.html">Popup</a>
<a href="/extension/src/popup/popup.html?view=tab">Popup — full page</a>
<a href="/extension/src/options/options.html">Options</a>
<a href="/extension/src/welcome/welcome.html">Welcome</a>`,
        MIME['.html'],
      );
    }
    if (url.pathname === '/dev/demo.html') return send(res, 200, await demoPage(), MIME['.html']);

    const filePath = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');
    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) return send(res, 404, `Not found: ${url.pathname}`);
    const ext = path.extname(filePath).toLowerCase();
    let body = await readFile(filePath);
    if (ext === '.html' && url.pathname.startsWith('/extension/')) {
      body = body.toString('utf8').replace(/<head([^>]*)>/i, (m) => `${m}\n${MOCK_TAG}`);
    }
    send(res, 200, body, MIME[ext] || 'application/octet-stream');
  } catch (err) {
    send(res, 500, String(err?.stack || err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`TransPop dev server → http://localhost:${PORT}`);
});
