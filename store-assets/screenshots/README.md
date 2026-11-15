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

### Image translation shot (since v1.1.0)

The store shows at most 5 screenshots, so for the 1.1.0 listing swap one of the shots above (suggested: `05-settings.png`)
for an image-translation shot. Keep the five file names above for the README; store the new one separately:

| File | What it should show |
|---|---|
| `06-image-translation.png` (+ `en/`, `vi/`) | A page with **text inside an image** (e.g. a photo of a sign or a scanned page — public-domain content). The crop rectangle (teal border) around the text and the result bubble next to it: recognized text, translation, 🔊 / copy buttons. Optionally a second capture of the drag state with the hint bar "Drag to select an area · Esc to cancel". |

The dev harness can produce it: `npm run dev` → <http://localhost:5179/dev/ocr-test.html> has sample images
(`dev/fixtures/`). Don't reference `06-image-translation.png` from `README.md` until the file exists.

## After capturing

1. Save the files here with the names above.
2. Run `npm run check` — the README image warning disappears once all five exist.
3. Upload them in the Developer Dashboard → **Store listing → Screenshots** (in this order).

## Captured (v1.0.0)

Real screenshots (1280×800 PNG) captured from the dev harness (`npm run dev`):

- `en/` — English UI, translating German/Portuguese/French → English (use for the default English listing).
- `vi/` — Vietnamese UI, translating English → Vietnamese (use for the Vietnamese localized listing).
- The PNGs at this folder's root are copies of `en/` (referenced by the README).
