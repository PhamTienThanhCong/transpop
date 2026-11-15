# Changelog

All notable changes to TransPop are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). The version always matches `extension/manifest.json`.

## [Unreleased]

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

[Unreleased]: https://github.com/PhamTienThanhCong/transpop/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/PhamTienThanhCong/transpop/releases/tag/v1.0.0
