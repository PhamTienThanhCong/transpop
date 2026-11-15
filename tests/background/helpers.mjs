/** Shared helpers for the background tests (not a test file itself). */
import { readFileSync } from 'node:fs';

export const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

export const jsonResponse = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export const textResponse = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

/** A syntactically valid (unsigned) JWT expiring in `seconds`. */
export function fakeJwt(seconds = 600) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + seconds, region: 'global' })}.c2ln`;
}

/**
 * Mock fetch. `routes` = [[matcher, handler], …]; matcher is a substring or RegExp tested against the URL,
 * handler(url, init, callIndex) returns a Response (or throws to simulate a network error).
 * `calls` records every request as { url, init, body }.
 */
export function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init, body: init.body == null ? '' : String(init.body) });
    for (const [matcher, handler] of routes) {
      const hit = typeof matcher === 'string' ? u.includes(matcher) : matcher.test(u);
      if (hit) return handler(u, init, calls.filter((c) => c.url.includes(typeof matcher === 'string' ? matcher : '')).length - 1);
    }
    throw new TypeError(`fetch failed: no mock route for ${u}`);
  };
  fetchImpl.calls = calls;
  fetchImpl.count = (sub) => calls.filter((c) => c.url.includes(sub)).length;
  return fetchImpl;
}

/** A fetch that never resolves until aborted (to exercise timeouts). */
export const hangingFetch = (url, init = {}) =>
  new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });

/** Minimal Google dj=1 body. */
export const googleBody = (trans, src = 'en', extra = {}) => ({
  sentences: [{ trans, orig: 'x', backend: 10 }],
  src,
  confidence: 1,
  ld_result: { srclangs: [src], srclangs_confidences: [1], extended_srclangs: [src] },
  ...extra,
});

export const GOOGLE_HOST = 'translate.googleapis.com';
export const EDGE_AUTH = 'edge.microsoft.com/translate/auth';
export const EDGE_API = 'api-edge.cognitive.microsofttranslator.com';
export const BING = 'www.bing.com';
