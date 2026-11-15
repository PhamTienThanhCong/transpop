# TransPop — Chrome Web Store listing (ready to paste)

Everything you need to fill in the Chrome Web Store **Developer Dashboard**. Copy the blocks as-is
(they're plain text — the store doesn't render Markdown). Step-by-step instructions (in Vietnamese)
are in [PUBLISHING.md](PUBLISHING.md).

| Field | Limit | Source |
|---|---|---|
| Name | 75 chars | From the package: `extName` in `i18n/meta.json` |
| Summary | 132 chars | From the package: `extDescription` in `i18n/meta.json` (the dashboard shows it read-only — edit the fragment, run `npm run i18n` and re-upload to change it) |
| Detailed description | 16,000 chars | Paste from this file, once per language |

---

## 1. Name & summary (already in the package)

**English**

- Name (28/75): `TransPop — Select to Translate`
- Summary (124/132): `Select any word or phrase to translate it instantly. Dictionary, pronunciation, history and favorites. Free and open source.`

**Tiếng Việt**

- Name (24/75): `TransPop — Bôi đen là dịch`
- Summary (110/132): `Bôi đen từ hoặc câu bất kỳ để dịch ngay. Có từ điển, phát âm, lịch sử và mục yêu thích. Miễn phí, mã nguồn mở.`

---

## 2. Detailed description

### English (default language)

```text
Select any word or phrase on a web page and TransPop shows its translation right next to it — no copying, no switching tabs.

★ HOW IT WORKS
1. Select a word or phrase on any page.
2. Click the small TransPop button that appears next to it (or let the bubble open automatically, or use a hotkey — your choice).
3. Read the translation, listen to the pronunciation, and save it to your favorites.

★ FEATURES
• Instant translation bubble on any website — also inside frames, on dark sites and right-to-left pages
• Three trigger modes: icon (default), automatic, or hotkey (Shift / Alt / Ctrl / ⌘)
• Dictionary for words and short phrases: phonetics, parts of speech, alternative translations, definitions, examples and synonyms
• Pronunciation for the original text and the translation
• Translator popup (Alt+Shift+T) with automatic language detection and a full-page view
• Translate the current selection with Alt+Shift+S or from the right-click menu
• Translate text in images and on screen (Alt+Shift+A): drag over any area — photos, videos, scanned PDFs, comics — and TransPop reads the text on your device and translates it. Or right-click an image → "Translate text in image"
• History and favorites — searchable, exportable to CSV, stored only on your device
• 130+ languages, with smart swap: text that is already in your language is translated into your second language
• Light and dark themes, adjustable bubble font size
• Turn TransPop off on specific sites, or pause it everywhere in one click
• Interface in English or Vietnamese — follow the browser language or pick one in Settings

★ PRIVACY FIRST
• No account, no ads, no analytics, no tracking.
• Text is sent to the translation service only when you ask for a translation.
• Images you translate are processed on your device and never uploaded — only the recognized text is translated.
• Your settings, history and favorites stay in your browser.
Privacy policy: https://github.com/PhamTienThanhCong/transpop/blob/main/docs/PRIVACY.md

★ FREE & OPEN SOURCE
TransPop is free and open source (MIT license). Read the code, report a problem or contribute:
https://github.com/PhamTienThanhCong/transpop

Translations are provided by Google Translate (default) with automatic fallback to Microsoft Translator. TransPop is an independent project and is not affiliated with, endorsed by or sponsored by Google or Microsoft.
```

### Tiếng Việt

```text
Bôi đen từ hoặc câu bất kỳ trên trang web, TransPop hiện bản dịch ngay bên cạnh — không cần sao chép, không cần chuyển tab.

★ CÁCH DÙNG
1. Bôi đen một từ hoặc một câu trên trang bất kỳ.
2. Bấm vào nút TransPop nhỏ xuất hiện bên cạnh (hoặc để bong bóng dịch tự hiện, hoặc dùng phím tắt — tùy bạn chọn).
3. Xem bản dịch, nghe phát âm và lưu vào mục yêu thích.

★ TÍNH NĂNG
• Bong bóng dịch tức thì trên mọi trang web — kể cả trong khung (iframe), trang nền tối và trang viết từ phải sang trái
• Ba chế độ kích hoạt: biểu tượng (mặc định), tự động, hoặc phím tắt (Shift / Alt / Ctrl / ⌘)
• Từ điển cho từ và cụm từ ngắn: phiên âm, từ loại, các nghĩa khác, định nghĩa, ví dụ và từ đồng nghĩa
• Phát âm cả văn bản gốc lẫn bản dịch
• Cửa sổ dịch (Alt+Shift+T) tự nhận diện ngôn ngữ, có chế độ toàn trang
• Dịch đoạn đang chọn bằng Alt+Shift+S hoặc menu chuột phải
• Dịch chữ trong ảnh và trên màn hình (Alt+Shift+A): kéo chọn vùng bất kỳ — ảnh, video, PDF dạng ảnh, truyện tranh — TransPop nhận dạng chữ ngay trên máy và dịch. Hoặc chuột phải vào ảnh → "Dịch chữ trong ảnh"
• Lịch sử và mục yêu thích — tìm kiếm được, xuất ra CSV, chỉ lưu trên máy bạn
• Hơn 130 ngôn ngữ, tự đảo chiều thông minh: văn bản đã là ngôn ngữ của bạn sẽ được dịch sang ngôn ngữ thứ hai
• Giao diện sáng và tối, chỉnh được cỡ chữ bong bóng
• Tắt TransPop trên từng trang, hoặc tạm dừng trên mọi trang chỉ với một cú nhấp
• Giao diện tiếng Việt hoặc tiếng Anh — theo ngôn ngữ trình duyệt hoặc tự chọn trong Cài đặt

★ TÔN TRỌNG QUYỀN RIÊNG TƯ
• Không tài khoản, không quảng cáo, không phân tích hành vi, không theo dõi.
• Văn bản chỉ được gửi tới dịch vụ dịch khi bạn yêu cầu dịch.
• Ảnh bạn dịch được xử lý ngay trên máy, không bao giờ được tải lên — chỉ phần chữ nhận dạng được mới được dịch.
• Cài đặt, lịch sử và mục yêu thích nằm trong trình duyệt của bạn.
Chính sách quyền riêng tư: https://github.com/PhamTienThanhCong/transpop/blob/main/docs/PRIVACY.md

★ MIỄN PHÍ & MÃ NGUỒN MỞ
TransPop miễn phí và mã nguồn mở (giấy phép MIT). Xem mã nguồn, báo lỗi hoặc đóng góp:
https://github.com/PhamTienThanhCong/transpop

Bản dịch được cung cấp bởi Google Dịch (mặc định), tự động chuyển sang Microsoft Translator khi cần. TransPop là dự án độc lập, không liên kết, không được bảo trợ hay tài trợ bởi Google hoặc Microsoft.
```

---

## 3. Category, language, links

| Field | Value |
|---|---|
| Category | **Tools** (Productivity group). Alternative: **Education** — good for language learners. Pick one; don't change it often. |
| Language | **English** (default). Add **Vietnamese** in the listing's language selector and paste the Vietnamese description. |
| Homepage URL | `https://github.com/PhamTienThanhCong/transpop` |
| Support URL | `https://github.com/PhamTienThanhCong/transpop/issues` |
| Privacy policy URL | `https://github.com/PhamTienThanhCong/transpop/blob/main/docs/PRIVACY.md` (or your GitHub Pages URL) |
| Mature content | No |

## 4. Graphics (all in `store-assets/`)

| Asset | Size | File | Required? |
|---|---|---|---|
| Store icon | 128×128 PNG (96×96 artwork + 16px transparent padding) | `store-icon-128.png` | Yes |
| Screenshots | 1280×800 (or 640×400), PNG/JPEG, 1–5 images, square corners, no padding | `screenshots/*.png` (see `screenshots/README.md`) | At least 1 |
| Small promo tile | 440×280 PNG/JPEG | `promo-small-440x280.png` | Recommended (needed to be featured) |
| Marquee promo tile | 1400×560 PNG/JPEG | `promo-marquee-1400x560.png` | Optional (needed for the top carousel) |
| Promo video | YouTube URL | — | Optional |

All graphics are re-generated from SVG sources with `npm run icons` (`store-assets/render.sh`).

Since 1.1.0, consider swapping one screenshot (e.g. the settings shot) for an **image translation** shot — see
`screenshots/README.md` (the store shows at most 5).

---

## 5. Privacy practices tab (paste in English)

### Single purpose

```text
TransPop translates text that the user selects on a web page or types into its popup. Every feature serves this single purpose: the in-page translation bubble, the translator popup with dictionary, definitions, examples and pronunciation, image translation (the user selects an area of the screen or an image and the text in it is recognized on the device and translated), and the history and favorites of the user's own translations.
```

### Permission justifications

**storage**

```text
Saves the user's settings (target languages, trigger mode, theme, list of disabled sites) in chrome.storage.sync, and the user's translation history and favorites in chrome.storage.local. This data stays in the user's browser and is never sent to the developer.
```

**contextMenus**

```text
Adds a "Translate “<selection>”" item to the right-click menu for selected text, "Translate text in image" on images and "Translate screen area…" on pages (image translation), and items to the toolbar icon's menu to turn in-page translation off for the current site or pause it everywhere.
```

**offscreen**

```text
Manifest V3 service workers cannot play audio or start Web Workers. TransPop creates a single offscreen document with two reasons: AUDIO_PLAYBACK, to play the pronunciation of a word or translation when the user presses a Listen button or has enabled auto-pronounce; and WORKERS, to run the bundled Tesseract text-recognition engine (a Web Worker with WebAssembly, shipped inside the package) on the screen area the user selected for image translation. The offscreen document is used for nothing else.
```

**activeTab**

```text
Image translation: when the user explicitly starts it — the keyboard shortcut (Alt+Shift+A), the "Translate text in image" / "Translate screen area…" right-click items, or the "Translate screen area" button in the popup — TransPop calls chrome.tabs.captureVisibleTab on that tab, lets the user select an area, and recognizes the text in it locally with the bundled OCR engine. activeTab is the narrowest way to do this: access is granted only for the current tab after that user gesture, and no broad host or tabs permission is needed. The screenshot is processed in memory and is never uploaded or stored; only the recognized text is sent to the translation service, like selected text.
```

**scripting**

```text
Used only to re-inject TransPop's own content scripts (files shipped in the package) into the current tab when the user explicitly starts a translation — keyboard shortcut, right-click menu or the popup button — on a tab that was already open before TransPop was installed or updated. Without it, those tabs would need a manual reload. It runs under the temporary activeTab grant for that tab only, never injects remote code, and is never used in the background.
```

**tts**

```text
Fallback pronunciation: when the online pronunciation audio is unavailable (offline, blocked, or unsupported language), TransPop uses chrome.tts to read the word aloud with the browser's built-in voices.
```

**Host permissions** (also covers the content script that matches `<all_urls>`)

```text
Content script on all URLs: TransPop's single purpose is translating text the user selects on any web page, so the content script must run on every site (including frames) to notice a selection and show the translation button/bubble next to it. It only reads the current selection — it does not collect page content, form data or browsing history — and the selected text is sent to a translation service only after the user triggers a translation (clicking the TransPop button, the automatic mode the user chose, a hotkey, the right-click menu or a keyboard shortcut). Users can turn it off per site or pause it globally.

https://translate.googleapis.com/* — Google Translate web endpoint: returns the translation, detected language, dictionary entries, definitions and examples for the text the user asked to translate.
https://translate.google.com/* — Google text-to-speech endpoint: plays the pronunciation when the user presses Listen.
https://edge.microsoft.com/* — obtains the temporary access token required by the Microsoft Translator endpoint.
https://api-edge.cognitive.microsofttranslator.com/* — Microsoft Translator endpoint: automatic fallback when Google is unavailable, or the primary provider if the user selects Microsoft in Settings.
https://www.bing.com/* — Microsoft's Bing web translator: second transport for the Microsoft provider when the token endpoint above is unavailable (temporary session from /translator, translation from /ttranslatev3, dictionary from /tlookupv3).

No other hosts are contacted. All requests go directly from the user's browser to these services; there is no developer server.
```

### Remote code

Select **"No, I am not using remote code."** All JavaScript ships inside the package; the extension only
fetches JSON/audio data from the translation services.

If a reviewer asks about image translation (or the dashboard offers a free-text field), paste:

```text
No remote code is used. The OCR engine (Tesseract.js 7.0.0 and its WebAssembly cores, Apache-2.0) is bundled in the package under vendor/tesseract/ — unmodified official builds from npm, with SHA-256 checksums listed in vendor/tesseract/README.md. The "wasm-unsafe-eval" source in the extension CSP is only there to compile those packaged WebAssembly files, as allowed by Manifest V3. The only thing downloaded at runtime is language data for text recognition (<language>.traineddata.gz from cdn.jsdelivr.net, the @tesseract.js-data packages): model weights, not executable code, fetched once when the user first uses that language and cached locally.
```

### Data usage

Check only:

- ☑ **Website content** — the text the user selects or types and chooses to translate is sent to the translation
  provider to produce the translation.

Leave everything else unchecked (personally identifiable info, health, financial/payment, authentication,
personal communications, location, web history, user activity). History, favorites and settings are stored only
in the user's own browser storage and are never transmitted to the developer.

Image translation doesn't change this: screenshots are cropped and recognized on the device and never leave it;
the recognized text sent to the translation provider is covered by **Website content**.

Certify all three statements:

- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## 6. Test instructions tab (for the reviewer)

```text
No account or login is needed.
1. Open any article, e.g. https://en.wikipedia.org/wiki/Language
2. Select a word with the mouse — a small TransPop button appears next to the selection. Click it to open the translation bubble (dictionary, pronunciation, favorites).
3. Right-click a selection → "Translate “…”" also opens the bubble. Alt+Shift+S translates the current selection.
4. Click the TransPop toolbar icon (or press Alt+Shift+T) for the translator popup; the book icon opens history & favorites.
5. Settings: the gear icon in the popup (or right-click the toolbar icon → Options). "Trigger" lets you switch to automatic or hotkey mode.
6. Image translation: press Alt+Shift+A on any page and drag over some text (e.g. text inside an image) — the recognized text and its translation appear in a bubble. Also: right-click an image → "Translate text in image", or the scan button ("Translate screen area") at the top of the popup. The first use of a recognition language downloads its data (~2 MB) once, so it takes a few seconds; recognition languages are in Settings → Image translation.
The default target language follows the browser UI language (English browsers translate into English and use the secondary language for English text — set a target language such as Vietnamese in Settings → General to test quickly).
```

---

## 7. Keywords & wording guidance

The Chrome Web Store has **no keyword field**: search uses the name, summary, description, ratings and usage.

Do:

- Describe features in natural sentences; the words *translate, translator, translation, dictionary,
  pronunciation, vocabulary, language learning* appear naturally in the copy above — that's enough.
- Keep the name short and brand-first (`TransPop — Select to Translate`).
- Mention Google/Microsoft only to say where translations come from, together with the "not affiliated"
  disclaimer.

Don't (common causes of rejection for "keyword spam" or "misleading" listings):

- Repeat keywords, or paste lists of languages/keywords ("translate English Vietnamese Chinese Japanese …").
- Put **Google**, **Microsoft**, **Translate** (as a product name) or another brand in the extension name or
  icon, or imply an official relationship ("Google Translate for Chrome", "official").
- Name competitors ("DDict alternative", "better than …"), or claim features that don't exist.
- Ask for ratings in exchange for anything, or use fake reviews.
- Use unrelated popular terms (e.g. "AI", "ChatGPT", "VPN") to attract searches.
