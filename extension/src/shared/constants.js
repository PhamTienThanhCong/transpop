/**
 * TransPop — shared constants (ES module).
 * Used by the service worker and extension pages. The content script cannot import modules,
 * so it duplicates the few values it needs (MSG types) — keep them in sync with docs/ARCHITECTURE.md.
 */

export const APP = Object.freeze({
  name: 'TransPop',
  // storeUrl: replace EXTENSION_ID with the ID the Chrome Web Store assigns after the first upload.
  repoUrl: 'https://github.com/PhamTienThanhCong/transpop',
  issuesUrl: 'https://github.com/PhamTienThanhCong/transpop/issues',
  privacyUrl: 'https://github.com/PhamTienThanhCong/transpop/blob/main/docs/PRIVACY.md',
  storeUrl: 'https://chromewebstore.google.com/detail/EXTENSION_ID',
});

/** Message types (see docs/ARCHITECTURE.md §5). */
export const MSG = Object.freeze({
  // → background
  TRANSLATE: 'translate',
  SPEAK: 'speak',
  STOP_SPEAK: 'stop-speak',
  GET_SETTINGS: 'get-settings',
  OPEN_OPTIONS: 'open-options',
  TOGGLE_FAVORITE: 'toggle-favorite',
  CHECK_FAVORITE: 'check-favorite',
  DISABLE_SITE: 'disable-site',
  // → content script
  SHOW_TRANSLATION: 'show-translation',
  GET_SELECTION: 'get-selection',
  PING: 'ping',
  START_CROP: 'start-crop',
  // → background (UI language + image translation)
  GET_UI_MESSAGES: 'get-ui-messages',
  OCR_REGION: 'ocr-region',
  OCR_IMAGE: 'ocr-image',
  GET_CAPTURE: 'get-capture',
  START_CAPTURE: 'start-capture',
  OCR_CLEAR_CACHE: 'ocr-clear-cache',
  // → offscreen document (internal)
  OFFSCREEN_PLAY: 'offscreen-play',
  OFFSCREEN_STOP: 'offscreen-stop',
  OFFSCREEN_OCR: 'offscreen-ocr',
  OFFSCREEN_OCR_CLEAR: 'offscreen-ocr-clear',
});

export const TRANSLATE_SOURCES = Object.freeze(['bubble', 'popup', 'context-menu', 'welcome']);
export const TRIGGER_MODES = Object.freeze(['icon', 'auto', 'hotkey']);
export const MODIFIER_KEYS = Object.freeze(['Shift', 'Alt', 'Control', 'Meta']);
export const PROVIDERS = Object.freeze(['google', 'microsoft']);
export const THEMES = Object.freeze(['auto', 'light', 'dark']);
/** 'auto' = follow the browser language; others must have an extension/_locales/<code>/ folder. */
export const UI_LANGUAGES = Object.freeze(['auto', 'en', 'vi']);

export const STORAGE_KEYS = Object.freeze({
  SETTINGS: 'settings', // chrome.storage.sync
  HISTORY: 'history', // chrome.storage.local
  FAVORITES: 'favorites', // chrome.storage.local
  POPUP_STATE: 'popupState', // chrome.storage.local
});

export const LIMITS = Object.freeze({
  MAX_TEXT_LENGTH: 5000, // hard limit for a translate request
  MAX_SELECTION_LENGTH: 2000, // selections longer than this don't trigger the bubble automatically
  DICT_MAX_CHARS: 60, // request dictionary/definitions/examples only for short inputs
  DICT_MAX_WORDS: 5,
  HISTORY_MAX: 500,
  FAVORITES_MAX: 5000,
  CACHE_MAX: 300,
  TTS_CHUNK: 200,
  FONT_SIZE_MIN: 12,
  FONT_SIZE_MAX: 20,
  SPEECH_RATE_MIN: 0.5,
  SPEECH_RATE_MAX: 1.5,
});

export const ERROR_CODES = Object.freeze({
  EMPTY: 'EMPTY',
  TOO_LONG: 'TOO_LONG',
  NETWORK: 'NETWORK',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  UNSUPPORTED_LANG: 'UNSUPPORTED_LANG',
  UNKNOWN: 'UNKNOWN',
  // image translation
  CAPTURE_FAILED: 'CAPTURE_FAILED',
  OCR_FAILED: 'OCR_FAILED',
  OCR_NO_TEXT: 'OCR_NO_TEXT',
});

/**
 * Default settings. `targetLang: null` means "derive from the browser UI language"
 * (resolved by normalizeSettings() in storage.js).
 */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  targetLang: null,
  secondaryLang: null,
  triggerMode: 'icon',
  modifierKey: 'Shift',
  doubleClickOnly: false,
  provider: 'google',
  showPhonetic: true,
  showDictionary: true,
  showDefinitions: true,
  showExamples: true,
  autoSpeak: false,
  speechRate: 1,
  theme: 'auto',
  fontSize: 14,
  disableInInputs: true,
  disabledSites: [],
  saveHistory: true,
  closeOnClickOutside: true,
  uiLanguage: 'auto',
  ocrLanguages: ['eng'],
});
