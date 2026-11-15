# Contributing to TransPop

Thanks for helping! Bug reports, ideas, translations and pull requests are all welcome.
*Góp ý bằng tiếng Việt cũng hoàn toàn được nhé.*

## Ground rules

TransPop is intentionally simple. Please keep these properties:

1. **No build step, no dependencies.** Plain ES2022 JavaScript, HTML and CSS. The `extension/` folder must load
   unpacked exactly as it is in the repo.
2. **Manifest V3 rules.** No remote code, no `eval` / `new Function`, no inline `<script>` or `on*=` handlers.
3. **Security.** Never put translated, remote or user text into `innerHTML` — use `textContent` or build DOM nodes.
4. **Privacy.** Text is sent only to the selected translation provider, only when the user asks. No analytics,
   tracking, remote fonts or third-party scripts.
5. **Minimal permissions.** New permissions need a very good reason (they're reviewed by the Chrome Web Store and
   shown to users). Open an issue first.
6. **Accessible and localized.** Keyboard reachable, `aria-label` on icon buttons, light + dark themes, and every
   user-visible string goes through `chrome.i18n`.

The full contract (file layout, messaging, settings, design tokens) is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Branches

- **`dev`** — where all development happens: the extension source plus guides, tests, the dev harness and tooling.
  Branch off `dev` and open pull requests against `dev`.
- **`main`** — the product branch: only the extension and the essentials (README, LICENSE, CHANGELOG, privacy
  policy). It is **generated** from `dev` by `npm run sync:main`, which removes every path listed in `.mainignore`.
  Never commit to `main` directly.

When you add a guide, demo, test or tooling file, list it in `.mainignore` so it stays off `main`.

## Getting started

Requirements: **Node.js 22+** and **Chrome 116+**. Nothing to install.

```bash
git clone -b dev https://github.com/PhamTienThanhCong/transpop.git
cd transpop
npm run check
npm test
```

Load the extension: `chrome://extensions` → **Developer mode** → **Load unpacked** → select `extension/`.
After editing, click ↻ on the extension card and refresh the page you're testing on.
`npm run dev` serves the extension pages on localhost with a mocked `chrome.*` API for quick UI work.

## Making a change

1. Fork and create a branch: `git checkout -b fix/bubble-position`.
2. Make your change. Keep functions small and files focused; follow the style of the surrounding code
   (2-space indent, single quotes, semicolons).
3. If you add or change user-visible text, edit the matching `i18n/<area>.json` fragment (**English and
   Vietnamese**) and run `npm run i18n`. Never edit `extension/_locales/` by hand.
4. Add or update tests in `tests/` for logic that can run in Node (providers, parsers, helpers). Test files are
   named `*.test.js` / `*.test.mjs`.
5. Run `npm run check` and `npm test` — both must pass (CI runs them on every push and PR).
6. Test manually with **Load unpacked**: light and dark theme, a couple of real websites.
7. Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for user-facing changes.
8. Open a pull request and fill in the checklist.

Commit messages: short imperative summary (`Fix bubble position in iframes`), details in the body if useful.

## Translating the UI

Strings live in `i18n/<area>.json`:

```json
{
  "popup_translate": { "en": "Translate", "vi": "Dịch", "description": "Primary button" }
}
```

- `$1`…`$9` are placeholders — keep them in your translation.
- To **add a new UI language**, add its [Chrome locale code](https://developer.chrome.com/docs/extensions/reference/api/i18n#locales)
  (e.g. `"fr"`, `"pt_BR"`) to entries in every fragment. Partial translations are fine — missing strings fall back
  to English. Run `npm run i18n` to generate `extension/_locales/<code>/messages.json`.
- Store listing text for new languages can be added to [docs/STORE_LISTING.md](docs/STORE_LISTING.md).

## Reporting bugs

Use the **Bug report** issue template. Include the TransPop version, browser + OS, the page URL (if public) and
the steps to reproduce. Please **don't paste private text** you translated.

## Security

If you find a security problem, please **don't open a public issue**. Use GitHub's
[private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (Security → Report a vulnerability).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
