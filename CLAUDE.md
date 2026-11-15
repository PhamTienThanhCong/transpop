# TransPop — project notes for Claude

TransPop ("Select to translate") is an open-source (MIT) Chrome MV3 extension: select text on any page → a translation
bubble (DDict-style), plus a toolbar popup translator, history/favorites, options and onboarding pages.
Public repo: https://github.com/PhamTienThanhCong/transpop — owner **PhamTienThanhCong**, who writes in Vietnamese
(reply in Vietnamese).

## ⚠️ Branch workflow — mandatory on every change

| Branch | Purpose | Contents |
|---|---|---|
| `dev` | Development + guides | Everything: extension code, docs/guides, tests, dev harness/demo, tooling, CI |
| `main` | Product | Only the shippable extension and essentials. **Generated from `dev` — never commit to it directly.** |

1. Always work and commit on **`dev`** (`git switch dev`). If `CLAUDE.md` is missing you are on `main` — switch to `dev`.
2. Before committing: `npm run check` and `npm test` (and `npm run i18n` if `i18n/*.json` changed).
3. After committing, publish **both branches** with `npm run sync:main` (`scripts/sync-main.sh`): it pushes `dev`,
   rebuilds `main` from dev's committed tree minus every path in **`.mainignore`**, and pushes `main`.
4. Guide / demo / test / tooling files stay on `dev` only: when you add one, add its path to `.mainignore`.
   Never list product files there: `extension/`, `README.md`, `LICENSE`, `CHANGELOG.md`, `docs/PRIVACY.md` (the Chrome
   Web Store privacy-policy URL points at `main`), images shown by `README.md`, `.github/ISSUE_TEMPLATE`, `.gitignore`.
5. `README.md` is shared by both branches: link dev-only files with absolute URLs on the dev branch
   (`https://github.com/PhamTienThanhCong/transpop/blob/dev/<path>`), never relative paths.
6. Release tags `vX.Y.Z` go on `dev` (the CI and release workflows exist only on `dev`).

> Tóm tắt: code chính ở `dev`. Mỗi lần code xong phải push song song cả 2 nhánh bằng `npm run sync:main`. Nhánh `main`
> là bản product, tự động bỏ các file hướng dẫn, demo, test và công cụ (liệt kê trong `.mainignore`); nhánh `dev` giữ
> nguyên tất cả.

## Commands (run on `dev`)

| Command | What it does |
|---|---|
| `npm run check` | Static checks: manifest + referenced files, MV3/CSP rules, JS syntax, i18n keys |
| `npm test` | Unit tests (`tests/**/*.test.{js,mjs}`) |
| `npm run i18n` | Build `extension/_locales/*/messages.json` from `i18n/*.json` fragments (never hand-edit `_locales`) |
| `npm run package` | Zip `extension/` → `dist/transpop-v<version>.zip` (Chrome Web Store upload) |
| `npm run dev` | Dev harness on http://localhost:5179 with a mocked `chrome.*` API (visual QA via Claude in Chrome) |
| `npm run icons` | Re-render PNG icons + store graphics from SVG sources (needs `rsvg-convert`) |
| `npm run sync:main` | Push `dev` and regenerate + push `main` |

## Conventions

- No build step, no npm dependencies: plain ES2022/HTML/CSS. MV3 CSP: no inline scripts/handlers, no `eval`, no remote code.
- The team contract (messaging envelope, settings schema, providers, design tokens, file layout) is `docs/ARCHITECTURE.md`.
- Never put translated or user text into `innerHTML`; the content-script UI lives in a closed Shadow DOM.
- All UI strings go through i18n (`en` + `vi` required). Language names come from `Intl.DisplayNames`.
- Brand: teal — primary `#0F766E`, gradient `#0D9488 → #0E7490`. Icon = two speech bubbles ("A" solid, "文" outlined);
  sources `extension/icons/logo.svg`, bold variant `store-assets/src/icon-32.svg` (also inlined as `LOGO_SVG` in
  `extension/src/content/icons.js`), 16px variant `store-assets/src/icon-16.svg`. Never imitate Google Translate branding.
- Store screenshots: `store-assets/screenshots/{en,vi}/` at 1280×800 (root copies = `en`, used by README).
- Remaining placeholder: `EXTENSION_ID` (fill in after the first Chrome Web Store upload — see `docs/PUBLISHING.md` §4).
