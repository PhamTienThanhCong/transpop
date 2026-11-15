/**
 * TransPop — on-demand content-script injection.
 *
 * Tabs that were already open when TransPop was installed, updated or reloaded have no (live) content script, so
 * explicit actions (crop, context menu, keyboard command) would fall back to a separate page. Instead, inject the
 * manifest's content scripts into the tab's top frame right then. Explicit actions are user gestures, so `activeTab`
 * grants the temporary host access `chrome.scripting` needs (no install warning). The content script's own
 * double-injection guard replaces an orphaned instance and ignores a live one.
 */

/** Content-script files in load order, straight from the manifest (single source of truth). */
export function contentScriptFiles(manifest = globalThis.chrome?.runtime?.getManifest?.()) {
  const files = manifest?.content_scripts?.[0]?.js;
  return Array.isArray(files) ? files.filter((f) => typeof f === 'string' && f) : [];
}

/**
 * Inject TransPop's content scripts into a tab's top frame.
 * @returns {Promise<boolean>} true when injected; false on restricted pages (PDF viewer, chrome://, Web Store…)
 */
export async function injectContentScripts(tabId, chromeApi = globalThis.chrome) {
  if (typeof tabId !== 'number' || tabId < 0 || !chromeApi?.scripting?.executeScript) return false;
  const files = contentScriptFiles(chromeApi.runtime?.getManifest?.());
  if (!files.length) return false;
  try {
    await chromeApi.scripting.executeScript({ target: { tabId, frameIds: [0] }, files });
    return true;
  } catch {
    return false; // restricted page or no host access — callers fall back
  }
}
