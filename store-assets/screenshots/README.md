# Store screenshots

The Chrome Web Store shows up to **5 screenshots**. Capture them from the real extension (no mock-ups — the
store requires screenshots to reflect the actual product).

## Specs

- **1280×800 px**, PNG (or JPEG), square corners, no transparent padding, no device frame needed.
- Chrome window at **100% zoom**, clean profile (no other extensions' icons, no bookmarks bar, no personal tabs,
  no notifications). TransPop pinned in the toolbar.
- Light theme for 1–4, optionally dark theme for one shot to show it off. English UI (a Vietnamese set can be
  uploaded for the Vietnamese listing later).
- Use neutral, public, non-branded content (Wikipedia / public-domain text). **Never show "Google" branding as if
  it were part of TransPop** and don't show other people's personal data.
- Tip (macOS): set the window to exactly 1280×800 with a tool such as Rectangle, or capture larger at 2× and
  downscale to 1280×800 so text stays crisp.

## The five shots

File names are referenced by `README.md` — keep them.

| # | File | What it should show |
|---|---|---|
| 1 | `01-bubble.png` | **The hero shot.** An English article (e.g. a Wikipedia page) with the word **"obvious"** (or a similar single word) selected and the TransPop **translation bubble** open below it: word, phonetic line, 🔊 and ⭐ buttons, Vietnamese translation ("hiển nhiên"), dictionary rows (parts of speech + alternatives) and an example sentence. |
| 2 | `02-icon-trigger.png` | **Icon trigger mode.** A short phrase selected on a page with the small TransPop button floating next to the selection (before clicking). Optionally overlay a subtle caption: "Select → click → translated". |
| 3 | `03-popup-dictionary.png` | **Translator popup** opened from the toolbar: source text (e.g. "run"), detected language, swap button, translation, and the expanded dictionary / definitions / examples section. |
| 4 | `04-history-favorites.png` | **History & favorites** view in the popup (or full-page translator) with ~6–8 realistic entries, a few starred, search box visible. |
| 5 | `05-settings.png` | **Settings page**: the Trigger section (Icon / Auto / Hotkey cards) or General section with target language, plus the theme selector — showing how customizable TransPop is. |

### Image translation shots (since v1.1.0)

| File | What it shows |
|---|---|
| `06-image-translation.png` | A travel article with a photo of a café notice in Simplified Chinese: the selected area (teal border) and the result bubble beside it — recognized text (line breaks kept), auto-detected language chips, translation. |
| `07-crop-area.png` | The crop overlay: dimmed page, hint bar "Drag to select an area · Esc to cancel" with the OCR language chips. |

Captured from the dev showcase page: `npm run dev` → <http://localhost:5179/dev/showcase.html>, then in the console
`localStorage.setItem('transpop-dev-dpr', '2')` (emulates a Retina capture, like the real extension on a Mac) and
`chrome.runtime.sendMessage({type: 'start-capture', mode: 'region'})`, then drag over the notice board.

## Which 5 to upload to the Chrome Web Store

The store accepts at most 5 screenshots. Upload, in this order: **`01-bubble`, `06-image-translation`,
`03-popup-dictionary`, `04-history-favorites`, `05-settings`** (from `en/` for the English listing, `vi/` for the
Vietnamese one). `02-icon-trigger` and `07-crop-area` are shown in the README only.

## Captured (v1.0.0)

Real screenshots (1280×800 PNG) captured from the dev harness (`npm run dev`):

- `en/` — English UI, translating German/Portuguese/French → English (use for the default English listing).
- `vi/` — Vietnamese UI, translating English → Vietnamese (use for the Vietnamese localized listing).
- The PNGs at this folder's root are copies of `en/` (referenced by the README).
