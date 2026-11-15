import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentScriptFiles, injectContentScripts } from '../../extension/src/background/inject.js';

const manifest = { content_scripts: [{ js: ['src/content/core.js', 'src/content/content.js'] }] };

test('contentScriptFiles reads the manifest list in order', () => {
  assert.deepEqual(contentScriptFiles(manifest), ['src/content/core.js', 'src/content/content.js']);
  assert.deepEqual(contentScriptFiles({}), []);
  assert.deepEqual(contentScriptFiles(undefined), []);
});

test('injectContentScripts: top frame only, true on success, false on restricted pages / bad input', async () => {
  const calls = [];
  const ok = {
    runtime: { getManifest: () => manifest },
    scripting: { executeScript: async (opts) => calls.push(opts) },
  };
  assert.equal(await injectContentScripts(12, ok), true);
  assert.deepEqual(calls[0], { target: { tabId: 12, frameIds: [0] }, files: manifest.content_scripts[0].js });

  const restricted = {
    runtime: { getManifest: () => manifest },
    scripting: {
      executeScript: async () => {
        throw new Error('Cannot access contents of the page');
      },
    },
  };
  assert.equal(await injectContentScripts(12, restricted), false);
  assert.equal(await injectContentScripts(-1, ok), false);
  assert.equal(await injectContentScripts(12, { runtime: { getManifest: () => manifest } }), false, 'no scripting API');
});
