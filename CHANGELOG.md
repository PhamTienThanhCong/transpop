# Changelog

All notable changes to TransPop are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). The version always matches `extension/manifest.json`.

## [Unreleased]

## [1.1.0] — 2026-11-15

### Added

- **Image translation (phase 1)** — translate text you can see but can't select: images, videos, scanned PDFs,
  canvases.
  - Start it with `Alt+Shift+A`, the right-click menu (*Translate text in image* on images, *Translate screen
    area…* on pages) or the new *Translate screen area* button in the toolbar popup, then drag over an area.
  - Text recognition (OCR) runs **on your device** with Tesseract.js 7 (bundled, Apache-2.0); the screenshot is
    never uploaded. The recognized text is editable and translated in a bubble next to the area.
  - Settings → *Image translation*: up to 3 recognition languages in priority order (39 available), and a button to
    delete the downloaded language data. Each language's data (~1.5–3 MB) is downloaded once from jsDelivr on first
    use and cached locally.
  - Also works where scripts can't run (Chrome's PDF viewer) through a capture page that opens in a tab next to
    the page.
  - New `activeTab` and `scripting` permissions (no install warning) — used only after you start an action: to
    capture the current tab, and to load TransPop into a tab that was open before install.
- **Display language** setting (Settings → General, and on the welcome page): follow the browser or choose English /
  Vietnamese for the whole interface, including the bubble and the right-click menu.

### Changed

- Tabs that were open before installing/updating now work right away: explicit actions (shortcut, right-click, popup button) inject TransPop on demand. Pages TransPop can't script (PDF viewer, `chrome://`) open the capture page in a tab next to the page — never a separate window.
- New teal brand colour and a new icon (two speech bubbles).
- Keyboard-shortcut names in Settings follow the display language.
- Privacy policy updated for image translation (screenshots stay on your device; OCR data from jsDelivr).
- Repository: development happens on the `dev` branch; `main` holds only the shippable extension and is generated
  from `dev`.

## [1.0.0] — 2026-11-15

First public release. 🎉

### Added

- **Select to translate** — select any word or phrase on a web page and a translation bubble appears next to it.
  - Three trigger modes: **Icon** (a small TransPop button appears near the selection — click it), **Auto**
    (the bubble opens right away, optionally on double-click only) and **Hotkey** (hold or tap a modifier key).
  - Works in iframes, on dark sites, RTL pages and pages with strict CSP; the bubble lives in a Shadow DOM so it
    never breaks the page.
  - Rich results for words and short phrases: phonetic transcription, parts of speech with alternative
    translations, monolingual definitions, example sentences and synonyms.
  - Listen (text-to-speech) for the source text and the translation, copy, add to favorites.
- **Translator popup** (toolbar button, `Alt+Shift+T`) with automatic language detection, language swap,
  dictionary/definitions/examples, pronunciation, and a full-page translator view.
- **History & favorites** — searchable, stored only on your device, exportable to CSV.
- **Context menu** — right-click a selection → *Translate “…”*; toolbar-icon menu to turn TransPop off on the
  current site or pause it everywhere.
- **Keyboard shortcuts** — `Alt+Shift+S` translates the current selection; an optional shortcut toggles in-page
  translation (customisable at `chrome://extensions/shortcuts`).
- **130+ languages** with a *smart swap*: when the text is already in your language, TransPop translates it into
  your secondary language instead.
- **Two providers** — Google Translate (default) with automatic fallback to Microsoft Translator.
- **Settings page** — target/secondary language, trigger mode and modifier key, theme (auto/light/dark),
  bubble font size, which sections to show, auto-pronounce and speech rate, disabled sites, data export/import,
  reset.
- **Welcome page** on install with an interactive demo.
- **Localized UI** — English and Vietnamese.
- **Privacy by design** — no analytics, no tracking, no ads, no remote code; text is sent only to the translation
  provider when you ask for a translation.

[Unreleased]: https://github.com/PhamTienThanhCong/transpop/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/PhamTienThanhCong/transpop/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/PhamTienThanhCong/transpop/releases/tag/v1.0.0
