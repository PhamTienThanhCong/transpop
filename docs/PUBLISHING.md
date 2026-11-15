# Hướng dẫn phát hành TransPop lên Chrome Web Store

> Dành cho người **lần đầu** phát hành tiện ích Chrome. Làm lần lượt từ trên xuống; mỗi bước đều ghi rõ cần
> chuẩn bị gì và bấm vào đâu. Nội dung để dán vào các ô trên Chrome Web Store nằm sẵn trong
> [STORE_LISTING.md](STORE_LISTING.md) (bằng tiếng Anh — ngôn ngữ mà người duyệt đọc nhanh nhất).
>
> Giao diện Developer Dashboard thỉnh thoảng được Google đổi tên nút/tab. Nếu thấy khác một chút, hãy tìm mục
> có ý nghĩa tương tự — quy trình thì không đổi.

## Mục lục

0. [Tổng quan](#0-tổng-quan)
1. [Chạy thử trên máy (Load unpacked)](#1-chạy-thử-trên-máy-load-unpacked)
2. [Tạo tài khoản nhà phát triển Chrome Web Store](#2-tạo-tài-khoản-nhà-phát-triển-chrome-web-store)
3. [Đưa mã lên GitHub và công bố chính sách quyền riêng tư](#3-đưa-mã-lên-github-và-công-bố-chính-sách-quyền-riêng-tư)
4. [Liên kết GitHub và ID tiện ích](#4-liên-kết-github-và-id-tiện-ích)
5. [Tăng phiên bản, kiểm tra và đóng gói](#5-tăng-phiên-bản-kiểm-tra-và-đóng-gói)
6. [Tải gói lên Developer Dashboard](#6-tải-gói-lên-developer-dashboard)
7. [Tab **Store listing** (Thông tin cửa hàng)](#7-tab-store-listing)
8. [Tab **Privacy** (Quyền riêng tư)](#8-tab-privacy-quyền-riêng-tư)
9. [Tab **Distribution** (Phân phối)](#9-tab-distribution-phân-phối)
10. [Tab **Test instructions** (Hướng dẫn kiểm thử)](#10-tab-test-instructions)
11. [Gửi xét duyệt và chờ kết quả](#11-gửi-xét-duyệt-và-chờ-kết-quả)
12. [Lý do bị từ chối thường gặp và cách TransPop tránh](#12-lý-do-bị-từ-chối-thường-gặp-và-cách-transpop-tránh)
13. [Phát hành bản cập nhật](#13-phát-hành-bản-cập-nhật)
14. [(Tùy chọn) Tự động hóa bằng Chrome Web Store API + GitHub Actions](#14-tùy-chọn-tự-động-hóa-bằng-chrome-web-store-api--github-actions)
15. [(Tùy chọn) Phát hành trên Microsoft Edge Add-ons](#15-tùy-chọn-phát-hành-trên-microsoft-edge-add-ons)
16. [Checklist trước khi bấm "Submit for review"](#16-checklist-trước-khi-bấm-submit-for-review)
17. [Sự cố thường gặp](#17-sự-cố-thường-gặp)

---

## 0. Tổng quan

```
Chạy thử trên máy ─► Tạo tài khoản (5 USD, 1 lần) ─► Đưa mã + chính sách lên GitHub
      ─► npm run package (tạo file .zip) ─► Tải .zip lên Dashboard ─► Điền 4 tab
      ─► Submit for review ─► (1–3 ngày, có thể lâu hơn) ─► Lên cửa hàng 🎉
```

Bạn cần:

| Thứ cần có | Ghi chú |
|---|---|
| Tài khoản Google | Nên tạo **một tài khoản riêng** cho việc phát hành (vd. `transpop.dev@gmail.com`) để tách khỏi email cá nhân. |
| Thẻ thanh toán quốc tế (Visa/Mastercard) | Để trả phí đăng ký **5 USD một lần duy nhất**. Thẻ ghi nợ nội địa thường bị từ chối — dùng thẻ tín dụng hoặc thẻ ghi nợ quốc tế đã bật thanh toán trực tuyến/quốc tế. |
| Điện thoại | Để bật xác minh 2 bước. |
| Node.js ≥ 22, Git, Google Chrome | Node để chạy `npm run check / test / package` (dự án **không cần** `npm install`, không có thư viện phụ thuộc). |
| Tài khoản GitHub | Để công khai mã nguồn và chính sách quyền riêng tư. |

Thời gian: lần đầu mất khoảng **2–3 giờ** điền thông tin + **1–3 ngày** (đôi khi tới vài tuần) chờ duyệt.

---

## 1. Chạy thử trên máy (Load unpacked)

Luôn thử kỹ trên máy trước khi gửi duyệt.

1. Mở Chrome, vào địa chỉ `chrome://extensions`.
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Bấm **Load unpacked** (Tải tiện ích đã giải nén) → chọn thư mục **`extension/`** của dự án
   (thư mục có file `manifest.json` — *không* chọn thư mục gốc của repo).
4. Bấm biểu tượng mảnh ghép 🧩 trên thanh công cụ → ghim (📌) TransPop để luôn thấy biểu tượng.
5. Mở một bài báo tiếng Anh (vd. Wikipedia), bôi đen một từ → bấm nút TransPop nhỏ hiện ra → bong bóng dịch xuất hiện.

Sau mỗi lần sửa mã:

- Bấm nút **↻ (Reload)** trên thẻ TransPop ở `chrome://extensions`.
- **Tải lại các tab đang mở** (F5) — content script không tự chèn lại vào tab cũ sau khi reload tiện ích.

Gỡ lỗi:

| Phần | Cách mở công cụ gỡ lỗi |
|---|---|
| Service worker (nền) | `chrome://extensions` → TransPop → liên kết **service worker** (Inspect views) |
| Popup | Mở popup → chuột phải bên trong → **Inspect** |
| Bong bóng trên trang | DevTools của trang (F12) → Console → chọn ngữ cảnh "TransPop" trong menu thả xuống |
| Lỗi đã ghi nhận | `chrome://extensions` → TransPop → nút **Errors** |

Mẹo:

- **Xem giao diện tiếng Việt:** trên macOS vào *System Settings → General → Language & Region → Applications*,
  thêm Google Chrome → Tiếng Việt, rồi mở lại Chrome. Trên Windows/Linux: chạy Chrome với tham số `--lang=vi`.
- `npm run dev` mở trang thử nghiệm trên localhost (có giả lập `chrome.*`) để xem nhanh popup/options mà không
  cần cài tiện ích.
- **Thử chính file .zip** sẽ nộp: giải nén `dist/transpop-v1.0.0.zip` vào một thư mục tạm rồi Load unpacked thư
  mục đó — đảm bảo gói không thiếu file.
- Giới hạn bình thường (không phải lỗi): tiện ích **không chạy** trên trang `chrome://…`, Chrome Web Store, trình
  xem PDF tích hợp của Chrome, và các trình soạn thảo vẽ bằng canvas (vd. Google Docs) — đây là giới hạn của Chrome.
  Riêng **dịch chữ trong ảnh** (`Alt+Shift+A`) vẫn dùng được ở Google Docs, trình xem PDF và phần lớn trang
  `chrome://…` (hai loại sau qua cửa sổ chụp dự phòng) — trừ Chrome Web Store (Chrome chặn chụp màn hình ở đó). Với tệp `file://`, cần bật
  *Allow access to file URLs* (Cho phép truy cập vào URL của tệp) cho TransPop ở `chrome://extensions`.
- Thử dịch chữ trong ảnh: mở một trang có ảnh chứa chữ (hoặc `npm run dev` → <http://localhost:5179/dev/ocr-test.html>),
  nhấn `Alt+Shift+A` rồi kéo chọn vùng chữ; hoặc chuột phải vào ảnh → *Translate text in image*. Lần đầu dùng mỗi
  ngôn ngữ OCR, tiện ích tải dữ liệu ngôn ngữ (~1,5–3 MB) từ jsDelivr nên cần có mạng.

---

## 2. Tạo tài khoản nhà phát triển Chrome Web Store

### 2.1. Bật xác minh 2 bước (bắt buộc)

Google **bắt buộc** tài khoản phát hành phải bật xác minh 2 bước (2-Step Verification).

1. Vào <https://myaccount.google.com/security>.
2. Mục *How you sign in to Google* → **2-Step Verification** → bật, làm theo hướng dẫn (SMS, ứng dụng
   Authenticator hoặc passkey).

### 2.2. Đăng ký và trả phí 5 USD

1. Đăng nhập tài khoản trên, mở <https://chrome.google.com/webstore/devconsole>.
2. Đọc và đồng ý **Developer Agreement** (Thỏa thuận nhà phát triển) và chính sách của Chrome Web Store.
3. Trả **phí đăng ký một lần 5 USD** qua Google Payments. Phí này dùng cho cả tài khoản, không phải trả lại cho
   mỗi tiện ích hay mỗi lần cập nhật.
4. Nếu thanh toán bị từ chối: kiểm tra thẻ đã bật giao dịch quốc tế/trực tuyến, thử thẻ khác, hoặc liên hệ ngân hàng.

### 2.3. Hoàn thiện hồ sơ (tab **Account**)

Trong Dashboard, mở **Account** (Tài khoản) ở menu bên trái:

- **Publisher name** (Tên nhà phát hành): tên hiển thị dưới tiện ích trên cửa hàng, vd. `TransPop` hoặc tên bạn.
  Không dùng tên thương hiệu của người khác (Google, Microsoft…).
- **Contact email** (Email liên hệ): nhập email rồi bấm gửi mã → mở hộp thư → bấm liên kết **xác minh email**.
  *Chưa xác minh email thì không thể xuất bản.* Google gửi mọi thông báo duyệt/vi phạm tới email này — hãy kiểm tra
  cả thư mục Spam.
- Có thể Google yêu cầu thêm **xác minh danh tính hoặc địa chỉ** — làm theo hướng dẫn trên màn hình nếu có.

### 2.4. Khai báo Trader / Non-trader (Đạo luật Dịch vụ Kỹ thuật số EU — DSA)

Từ 2024, mọi nhà phát triển phải khai báo mình là **trader** (thương nhân) hay **non-trader** — áp dụng cho người
dùng ở Liên minh châu Âu, nhưng ai phát hành cũng phải khai.

- **Non-trader:** cá nhân phát hành **không vì mục đích kinh doanh** — vd. dự án mã nguồn mở miễn phí, không
  quảng cáo, không thu phí, không bán dữ liệu. TransPop (miễn phí, MIT, không kiếm tiền) thường thuộc nhóm này.
- **Trader:** nếu bạn phát hành với tư cách doanh nghiệp/hoạt động thương mại (bán bản trả phí, quảng cáo, dùng
  để quảng bá dịch vụ kinh doanh…). Trader phải cung cấp địa chỉ, số điện thoại, email — các thông tin này sẽ
  **hiển thị công khai** cho người dùng EU.

Chọn trung thực theo tình huống của bạn (đây là trách nhiệm pháp lý của người phát hành; nếu phân vân, hãy hỏi
người có chuyên môn). Có thể đổi lại sau trong tab Account.

---

## 3. Đưa mã lên GitHub và công bố chính sách quyền riêng tư

Chrome Web Store **bắt buộc có URL chính sách quyền riêng tư** khi tiện ích xử lý dữ liệu người dùng (TransPop gửi
đoạn văn bản bạn chọn tới dịch vụ dịch, nên cần). Chính sách đã viết sẵn ở [`docs/PRIVACY.md`](PRIVACY.md) (song
ngữ Anh–Việt).

1. Tạo repo **public** trên GitHub, tên gợi ý `transpop` (các liên kết trong dự án giả định tên này).
2. Đẩy mã lên nhánh `main`.
3. Chọn **một** trong hai cách công bố chính sách:
   - **Cách A — đơn giản nhất:** dùng thẳng liên kết GitHub:
     `https://github.com/<tên-github>/transpop/blob/main/docs/PRIVACY.md`
   - **Cách B — GitHub Pages (trang gọn đẹp hơn):** repo → **Settings → Pages** → *Source: Deploy from a branch* →
     Branch `main`, thư mục `/docs` → Save. Sau 1–2 phút, chính sách có tại
     `https://<tên-github>.github.io/transpop/PRIVACY` (hoặc `…/PRIVACY.html`). Mở thử trong cửa sổ ẩn danh để chắc
     chắn ai cũng xem được.
4. Repo phải để **public** — nếu repo private, người duyệt không mở được liên kết và sẽ từ chối.

---

## 4. Liên kết GitHub và ID tiện ích

Mọi liên kết (mã nguồn, báo lỗi, chính sách quyền riêng tư) đã trỏ sẵn về
`https://github.com/PhamTienThanhCong/transpop`. Chỉ còn **`EXTENSION_ID`** — mã ID mà Chrome Web Store cấp sau lần
tải gói đầu tiên ([bước 6](#6-tải-gói-lên-developer-dashboard)). Khi đã có ID, thay nó ở:

| File | Nội dung cần sửa |
|---|---|
| `extension/src/shared/constants.js` | `APP.storeUrl` (nút "Đánh giá trên Chrome Web Store" trong Cài đặt → Giới thiệu) |
| `README.md` | Liên kết tới trang cửa hàng |

Lệnh tìm nhanh (chạy ở thư mục gốc dự án):

```bash
grep -rn "EXTENSION_ID" --exclude-dir=.git --exclude=PUBLISHING.md .
```

`npm run check` cũng cảnh báo (⚠) nếu còn sót `EXTENSION_ID`.

---

## 5. Tăng phiên bản, kiểm tra và đóng gói

### 5.1. Phiên bản

- Phiên bản nằm **duy nhất** ở trường `"version"` trong `extension/manifest.json` (vd. `"1.0.0"`).
- Lần đầu dùng `1.0.0`. Mỗi lần tải gói mới lên cửa hàng, version **phải lớn hơn** bản trước:
  sửa lỗi → `1.0.1`, thêm tính năng → `1.1.0`, thay đổi lớn → `2.0.0`.
- Thêm mục tương ứng vào `CHANGELOG.md` (vd. `## [1.0.1] — 2026-12-01`).

### 5.2. Kiểm tra và đóng gói

Ở thư mục gốc dự án:

```bash
npm run check     # kiểm tra manifest, file tham chiếu, quy tắc CSP/MV3, khóa i18n
npm test          # chạy unit test
npm run package   # build ngôn ngữ + check + tạo dist/transpop-v<version>.zip
```

- `npm run check` phải kết thúc bằng **✔ All checks passed** (các dòng ⚠ là cảnh báo, nên đọc nhưng không chặn).
- `npm run package` in ra đường dẫn và dung lượng file, vd. `✔ dist/transpop-v1.0.0.zip — 130 KB`. Từ bản
  **1.1.0**, file zip lớn hơn khoảng **3,5 MB** vì có bộ nhận dạng chữ Tesseract.js (thư viện + 3 lõi WebAssembly ở
  `extension/vendor/tesseract/`, ~8,6 MB khi chưa nén). Đây là kích thước bình thường, vẫn rất nhỏ so với giới hạn của
  cửa hàng. Dữ liệu ngôn ngữ OCR **không** nằm trong gói — tiện ích tải về khi người dùng cần.
- File zip chứa **nội dung** của thư mục `extension/` (`manifest.json` nằm ở gốc file zip — đúng yêu cầu của cửa hàng).
- Thử Load unpacked từ bản giải nén của file zip (xem [mục 1](#1-chạy-thử-trên-máy-load-unpacked)).

---

## 6. Tải gói lên Developer Dashboard

1. Mở <https://chrome.google.com/webstore/devconsole> → bấm **Add new item** (Thêm mục mới / *New item*).
2. Chọn file `dist/transpop-v1.0.0.zip` → tải lên. Nếu gói lỗi, Dashboard báo ngay (vd. manifest sai) — sửa rồi tải lại.
3. Tiện ích được tạo ở trạng thái **Draft** (bản nháp) và có ngay **Item ID** — chuỗi 32 ký tự (a–p), thấy trên URL
   của trang và trong tab Package.
4. *(Khuyến nghị)* Cập nhật đường dẫn cửa hàng trước khi gửi duyệt:
   - Sửa `APP.storeUrl` trong `extension/src/shared/constants.js` thành
     `https://chromewebstore.google.com/detail/<ITEM_ID>` và cập nhật liên kết trong `README.md`.
   - Chạy lại `npm run package`, rồi trong tab **Package** bấm **Upload new package** để thay bản nháp.
     (Còn ở trạng thái nháp nên chưa cần tăng version.)

Menu bên trái của item có các tab: **Package**, **Store listing**, **Privacy**, **Distribution**,
**Test instructions**. Phải điền đủ các tab bắt buộc thì nút gửi duyệt mới bật.

---

## 7. Tab **Store listing**

Nội dung dán lấy từ [STORE_LISTING.md](STORE_LISTING.md).

| Ô | Điền gì |
|---|---|
| **Name / Summary** | Lấy tự động từ gói (`i18n/meta.json`) — không sửa được ở đây. Muốn đổi: sửa `i18n/meta.json` → `npm run i18n` → đóng gói và tải lại. |
| **Description** | Dán khối *Detailed description — English*. Sau đó chọn ngôn ngữ **Vietnamese** ở ô chọn ngôn ngữ của trang listing và dán bản tiếng Việt. |
| **Category** | **Tools** (nhóm Productivity). Phương án khác: **Education**. |
| **Language** | **English** (ngôn ngữ mặc định — trùng `default_locale` của gói). |
| **Store icon** | `store-assets/store-icon-128.png` (128×128). |
| **Screenshots** | 1–5 ảnh **1280×800** (hoặc 640×400), PNG/JPEG, góc vuông, không viền. Xem `store-assets/screenshots/README.md`. Nên đủ 5 ảnh. |
| **Small promo tile** | `store-assets/promo-small-440x280.png` (440×280). |
| **Marquee promo tile** | `store-assets/promo-marquee-1400x560.png` (1400×560) — tùy chọn, cần nếu muốn được Google chọn giới thiệu. |
| **Promo video** | Tùy chọn — link YouTube. |
| **Official URL** | Bỏ trống (chỉ dùng khi bạn sở hữu tên miền đã xác minh trong Google Search Console). |
| **Homepage URL** | `https://github.com/<tên-github>/transpop` |
| **Support URL** | `https://github.com/<tên-github>/transpop/issues` |
| **Mature content** | Không (No). |

Bấm **Save draft** (Lưu bản nháp) thường xuyên.

---

## 8. Tab **Privacy** (Quyền riêng tư)

Đây là phần người duyệt đọc kỹ nhất. Mọi đoạn văn bản tiếng Anh để dán đều có trong
[STORE_LISTING.md §5](STORE_LISTING.md#5-privacy-practices-tab-paste-in-english).

### 8.1. Single purpose (Mục đích duy nhất)

Chrome yêu cầu mỗi tiện ích chỉ có **một mục đích** dễ hiểu. Của TransPop: *dịch văn bản người dùng chọn hoặc nhập*.
Mọi tính năng (bong bóng, popup, từ điển, phát âm, lịch sử, yêu thích, **dịch chữ trong ảnh / vùng màn hình**) đều
phục vụ mục đích đó — dịch chữ trong ảnh chỉ là một cách khác để "chọn" văn bản cần dịch. Dán khối **Single purpose**.

### 8.2. Giải thích từng quyền (Permission justification)

Dashboard hiện một ô cho **mỗi** quyền trong manifest. Dán đúng khối tương ứng:

| Quyền | Vì sao TransPop cần (tóm tắt tiếng Việt) |
|---|---|
| `storage` | Lưu cài đặt (`chrome.storage.sync`), lịch sử và yêu thích (`chrome.storage.local`) ngay trong trình duyệt. |
| `contextMenus` | Thêm mục *Translate "…"* vào menu chuột phải, và mục tắt trên trang này / tạm dừng ở menu của biểu tượng. |
| `offscreen` | Service worker MV3 không phát được âm thanh và không chạy được Web Worker → tạo **một** offscreen document với 2 lý do: `AUDIO_PLAYBACK` (phát âm) và `WORKERS` (chạy bộ nhận dạng chữ Tesseract trong Web Worker để dịch chữ trong ảnh). Không dùng cho việc gì khác. |
| `tts` | Phát âm dự phòng bằng giọng đọc có sẵn khi không tải được âm thanh trực tuyến. |
| `activeTab` | Gọi `chrome.tabs.captureVisibleTab` để chụp tab hiện tại **chỉ ngay sau thao tác của người dùng** (phím tắt `Alt+Shift+A`, menu chuột phải trên ảnh/trang, nút "Translate screen area" trong popup). Quyền chỉ áp dụng cho tab đó, hết hiệu lực khi tab chuyển trang; **không có cảnh báo khi cài**. Ảnh chụp được nhận dạng ngay trên máy, không tải lên đâu cả. |
| **Host permissions** (1 ô chung) | Giải thích content script chạy trên `<all_urls>` **và** từng tên miền dịch vụ — xem bảng dưới. |

Ô **Host permission justification** phải giải thích **tất cả**:

| Mục | Lý do |
|---|---|
| Content script `<all_urls>` (mọi trang, mọi khung) | Tính năng chính là dịch văn bản bôi đen trên **bất kỳ** trang nào, nên script phải chạy ở mọi trang để nhận biết vùng chọn và hiện nút/bong bóng. Chỉ đọc vùng chọn hiện tại; chỉ gửi đi khi người dùng yêu cầu dịch; tắt được theo từng trang hoặc tạm dừng toàn bộ. |
| `https://translate.googleapis.com/*` | Lấy bản dịch, ngôn ngữ phát hiện, từ điển, định nghĩa, ví dụ từ Google Dịch. |
| `https://translate.google.com/*` | Lấy âm thanh phát âm (text-to-speech) khi bấm Nghe. |
| `https://edge.microsoft.com/*` | Lấy mã truy cập tạm thời cho Microsoft Translator. |
| `https://api-edge.cognitive.microsofttranslator.com/*` | Microsoft Translator: dự phòng tự động khi Google lỗi, hoặc nhà cung cấp chính nếu người dùng chọn. |
| `https://www.bing.com/*` | Trình dịch web Bing của Microsoft: đường dự phòng thứ hai cho Microsoft khi không lấy được mã ở trên. |

> Vì có `<all_urls>`, Dashboard có thể hiện cảnh báo *"Due to the Host Permission, your extension may require an
> in-depth review which will delay publishing"*. Đó là bình thường với tiện ích dịch — giải thích rõ ràng như trên
> giúp duyệt nhanh hơn. **Không** thêm quyền nào khác nếu không thật sự cần (vd. `tabs`, `scripting`, `history`).
>
> `cdn.jsdelivr.net` (nơi tải dữ liệu ngôn ngữ OCR) **không** cần host permission — jsDelivr cho phép CORS công khai —
> nên không có trong manifest. Vẫn nên nhắc tới nó trong phần Remote code / Data usage để người duyệt không thắc mắc.

### 8.3. Remote code (Mã từ xa)

Chọn **"No, I am not using remote code"**. TransPop không tải hay chạy JavaScript từ máy chủ nào; chỉ nhận dữ liệu
JSON/âm thanh từ dịch vụ dịch. (`npm run check` tự động chặn `eval`, `new Function`, script từ xa.)

Về tính năng dịch chữ trong ảnh (từ bản 1.1.0), người duyệt có thể hỏi hai điểm — câu trả lời đều là *không phải mã từ xa*:

| Điểm | Giải thích |
|---|---|
| CSP `script-src 'self' 'wasm-unsafe-eval'` trong manifest | `'wasm-unsafe-eval'` là giá trị **Manifest V3 cho phép** để biên dịch WebAssembly. Chỉ dùng cho các lõi Tesseract (`.wasm`) **đóng gói sẵn** trong `extension/vendor/tesseract/` (bản chính thức từ npm, có bảng SHA-256 trong README của thư mục đó). Không cho phép `unsafe-eval` của JavaScript, không có nguồn script bên ngoài. |
| Tải `<lang>.traineddata.gz` từ `cdn.jsdelivr.net` | Đây là **dữ liệu** (trọng số mô hình nhận dạng của ngôn ngữ), không phải mã chạy được — tương tự tải từ điển. Chỉ tải khi người dùng dùng ngôn ngữ đó lần đầu, lưu trong IndexedDB; người dùng xóa được trong Cài đặt → Dịch chữ trong ảnh. |

Khối giải thích tiếng Anh để dán (nếu Dashboard có ô ghi chú) nằm trong
[STORE_LISTING.md §5](STORE_LISTING.md#remote-code).

### 8.4. Data usage (Khai báo dữ liệu)

Tick **duy nhất**:

- ☑ **Website content** (Nội dung trang web) — đoạn văn bản người dùng chọn/nhập để dịch được gửi tới dịch vụ dịch.

**Không** tick các mục khác (Personally identifiable information, Health, Financial and payment, Authentication,
Personal communications, Location, Web history, User activity). Lịch sử, yêu thích, cài đặt chỉ nằm trong bộ nhớ
trình duyệt của người dùng, không bao giờ gửi cho nhà phát triển.

Dịch chữ trong ảnh **không làm thay đổi** các mục cần tick: ảnh chụp màn hình được cắt và nhận dạng **ngay trên máy**,
không bao giờ rời khỏi thiết bị (nên không tính là "thu thập"); phần chữ nhận dạng được gửi tới dịch vụ dịch thuộc
đúng mục **Website content** đã tick ở trên.

Tick **cả ba** cam kết:

1. ☑ *I do not sell or transfer user data to third parties, outside of the approved use cases.*
   (Không bán/chuyển dữ liệu cho bên thứ ba ngoài các trường hợp được phép — gửi văn bản tới dịch vụ dịch để
   thực hiện chức năng chính là trường hợp được phép.)
2. ☑ *I do not use or transfer user data for purposes that are unrelated to my item's single purpose.*
3. ☑ *I do not use or transfer user data to determine creditworthiness or for lending purposes.*

### 8.5. Privacy policy URL

Dán URL chính sách ở [bước 3](#3-đưa-mã-lên-github-và-công-bố-chính-sách-quyền-riêng-tư). Nội dung chính sách
**phải khớp** với phần khai báo ở trên (TransPop đã viết khớp sẵn).

---

## 9. Tab **Distribution** (Phân phối)

| Ô | Lựa chọn |
|---|---|
| **Payments** | Free (miễn phí). |
| **Visibility** | **Public** — ai cũng tìm thấy. Hoặc **Unlisted** — chỉ ai có link mới cài được (hợp để thử với bạn bè trước). **Private** — chỉ người thử nghiệm được chỉ định. Có thể chuyển Unlisted → Public sau mà không cần duyệt lại từ đầu. |
| **Regions** (Khu vực) | **All regions** (tất cả). |

---

## 10. Tab **Test instructions**

Không bắt buộc nhưng **nên điền**: giúp người duyệt thử đúng tính năng, giảm nguy cơ bị từ chối vì "không hoạt
động". Dán khối trong [STORE_LISTING.md §6](STORE_LISTING.md#6-test-instructions-tab-for-the-reviewer). TransPop
không cần tài khoản đăng nhập nên không phải cung cấp mật khẩu thử.

---

## 11. Gửi xét duyệt và chờ kết quả

1. Kiểm tra lại [checklist ở mục 16](#16-checklist-trước-khi-bấm-submit-for-review).
2. Bấm **Submit for review** (Gửi xét duyệt) ở góc trên.
3. Hộp thoại hỏi có **tự động xuất bản sau khi duyệt xong** không:
   - Để bật → tiện ích lên cửa hàng ngay khi được duyệt.
   - Tắt (*deferred publishing*) → sau khi duyệt, bạn tự bấm **Publish** khi sẵn sàng (trong thời hạn Google quy
     định — hiện là 30 ngày).
4. Trạng thái chuyển sang **Pending review** (Đang chờ duyệt). Trong lúc chờ không sửa được bản đang duyệt (có thể
   hủy gửi để sửa, nhưng sẽ xếp hàng lại từ đầu).

**Thời gian duyệt:** thường **1–3 ngày làm việc**; theo Google, phần lớn bản gửi được duyệt trong vòng vài ngày.
Lần đầu tiên, hoặc tiện ích có quyền rộng như `<all_urls>`, có thể mất **1–3 tuần**. Nếu quá 3 tuần, liên hệ
*Chrome Web Store developer support* (đường dẫn "Contact support"/"One Stop Support" trong Dashboard).

**Kết quả** được gửi qua email liên hệ:

- **Published / Approved** → tiện ích có trang tại `https://chromewebstore.google.com/detail/<ITEM_ID>`.
- **Rejected** → email ghi rõ chính sách bị vi phạm (kèm mã như *Purple Potassium*, *Blue Argon*…). Sửa theo
  [mục 12](#12-lý-do-bị-từ-chối-thường-gặp-và-cách-transpop-tránh), tăng version nếu đã sửa mã, rồi gửi lại. Nếu cho
  rằng bị từ chối nhầm, có thể kháng nghị (appeal) qua liên kết trong email.

---

## 12. Lý do bị từ chối thường gặp và cách TransPop tránh

| Vấn đề | Mã vi phạm thường gặp | TransPop đã làm gì / bạn cần lưu ý |
|---|---|---|
| **Xin quyền quá rộng hoặc không dùng tới** | Purple Potassium | Chỉ 5 quyền (`storage`, `contextMenus`, `offscreen`, `tts`, `activeTab`) + 5 tên miền dịch vụ cụ thể, đều đang dùng. `<all_urls>` chỉ dành cho content script và được giải thích kỹ ([8.2](#82-giải-thích-từng-quyền-permission-justification)). Chụp màn hình dùng `activeTab` (hẹp nhất có thể, chỉ sau thao tác của người dùng) thay vì `<all_urls>`/`tabs`. Không xin `tabs`, `scripting`, `history`, `webRequest`… `npm run check` cảnh báo nếu có quyền lạ. |
| **Chạy mã từ xa** (Manifest V3 cấm) | Blue Argon | Toàn bộ mã nằm trong gói; không `eval`, không `new Function`, không `<script src="https://…">`, không import từ URL — `npm run check` kiểm tra tự động. Dữ liệu JSON từ API dịch không phải là mã. Tesseract.js + lõi WASM được đóng gói sẵn (`'wasm-unsafe-eval'` chỉ để biên dịch WASM trong gói); dữ liệu ngôn ngữ OCR tải từ jsDelivr là dữ liệu, không phải mã ([8.3](#83-remote-code-mã-từ-xa)). |
| **Thương hiệu gây hiểu nhầm / mạo danh** | — | **Không bao giờ** dùng chữ "Google", "Google Translate", "Microsoft" hay logo của họ trong **tên, biểu tượng, ảnh chụp quảng cáo**. TransPop có tên và logo riêng; mô tả có câu "not affiliated with Google or Microsoft". |
| **Nhồi từ khóa** | Yellow Argon | Mô tả viết tự nhiên, không liệt kê danh sách ngôn ngữ/từ khóa, không nhắc tên đối thủ. Xem [STORE_LISTING.md §7](STORE_LISTING.md#7-keywords--wording-guidance). |
| **Thiếu hoặc sai thông tin listing** (mô tả sơ sài, thiếu ảnh, ảnh không đúng thực tế) | Yellow Zinc | Mô tả đầy đủ, icon + ảnh chụp thật của tiện ích. Ảnh chụp phải là giao diện thật, không phóng đại tính năng. |
| **Không hoạt động khi người duyệt thử** | Yellow Magnesium | Thử kỹ file zip; điền tab Test instructions. TransPop tự chuyển sang Microsoft khi Google lỗi và hiện thông báo lỗi thân thiện thay vì im lặng. |
| **Chính sách quyền riêng tư thiếu/không khớp khai báo** | Purple Lithium | `docs/PRIVACY.md` công khai, song ngữ, khớp đúng phần Data usage (chỉ "Website content"). Liên kết phải mở được khi chưa đăng nhập. |
| **Mã bị làm rối (obfuscation)** | Red Titanium | Mã JavaScript thuần, không minify/obfuscate, không build step — người duyệt đọc được ngay. (Minify thông thường được phép, nhưng TransPop không cần.) Ngoại lệ duy nhất: thư viện **Tesseract.js** trong `extension/vendor/tesseract/` là bản **minify chính thức** từ npm (minify được phép, khác với obfuscate); README của thư mục ghi rõ phiên bản, nguồn và SHA-256 để người duyệt đối chiếu. |
| **Nhiều mục đích không liên quan** | — | Mọi tính năng đều phục vụ việc dịch. Đừng thêm tính năng lạc đề (chặn quảng cáo, tải video…) vào cùng tiện ích. |

Lưu ý về dịch vụ dịch: TransPop dùng các điểm truy cập web **miễn phí, không chính thức** của Google/Microsoft
(giống nhiều tiện ích dịch phổ biến). Điều này không bị Chrome Web Store cấm, nhưng các dịch vụ này có thể thay
đổi hoặc chặn bất cứ lúc nào — đó là lý do TransPop có cơ chế dự phòng. Nếu một ngày dịch vụ ngừng hoạt động, hãy
phát hành bản cập nhật sửa provider (xem `src/background/providers/`).

---

## 13. Phát hành bản cập nhật

1. Sửa mã → thử bằng Load unpacked.
2. Tăng `"version"` trong `extension/manifest.json` (vd. `1.0.0` → `1.0.1`) và thêm mục vào `CHANGELOG.md`.
3. `npm run check && npm test && npm run package`.
4. Dashboard → chọn TransPop → tab **Package** → **Upload new package** → chọn zip mới.
5. Cập nhật Store listing/Privacy nếu có thay đổi (vd. thêm quyền mới **bắt buộc** phải thêm giải thích).
6. **Submit for review**.

Sau khi được duyệt, Chrome của người dùng **tự cập nhật** trong vòng vài giờ (Chrome kiểm tra định kỳ).

Lưu ý:

- **Tránh thêm quyền mới.** Nếu bản cập nhật xin thêm quyền có cảnh báo, Chrome sẽ **tạm vô hiệu hóa** tiện ích cho
  tới khi người dùng đồng ý — nhiều người sẽ không bật lại.
- Bản **1.1.0** thêm quyền `activeTab` (và lý do `WORKERS` cho offscreen, CSP `'wasm-unsafe-eval'`). `activeTab`
  **không có cảnh báo** nên Chrome không vô hiệu hóa tiện ích khi cập nhật — nhưng trước khi gửi duyệt vẫn phải vào tab
  **Privacy** điền ô giải thích cho `activeTab` và cập nhật ô `offscreen` (dán từ
  [STORE_LISTING.md §5](STORE_LISTING.md#permission-justifications)), đồng thời cập nhật mô tả trong Store listing.
- Muốn tạo bản phát hành trên GitHub: `git tag v1.0.1 && git push origin v1.0.1` → workflow
  `.github/workflows/release.yml` tự đóng gói và đính kèm file zip vào GitHub Release (tag phải trùng version
  trong manifest).
- Tiện ích có nhiều người dùng (trên ~10.000) có thể dùng **phát hành theo tỷ lệ** (staged rollout) trong tab
  Distribution.

---

## 14. (Tùy chọn) Tự động hóa bằng Chrome Web Store API + GitHub Actions

Khi đã quen quy trình, bạn có thể để GitHub tự tải gói lên cửa hàng mỗi khi đẩy tag `v*`. **Lần tải đầu tiên vẫn
phải làm thủ công** (để có Item ID và điền listing).

### 14.1. Lấy CLIENT_ID và CLIENT_SECRET

1. Vào <https://console.cloud.google.com/> → tạo project mới (vd. `transpop-publish`).
2. **APIs & Services → Library** → tìm **Chrome Web Store API** → **Enable**.
3. **OAuth consent screen** (màn hình xin quyền, nay nằm trong *Google Auth Platform*):
   - User type: **External**; điền tên ứng dụng (vd. `TransPop publisher`), email hỗ trợ, email liên hệ.
   - Thêm chính email phát hành của bạn vào **Test users**.
   - Sau khi tạo xong, bấm **Publish app** (chuyển sang *In production*). Nếu để ở chế độ *Testing*, refresh token
     **hết hạn sau 7 ngày** và workflow sẽ lỗi. (Google có thể hiện cảnh báo "ứng dụng chưa xác minh" — với mục đích
     dùng riêng thì bỏ qua được.)
4. **Credentials → Create credentials → OAuth client ID** → Application type **Desktop app** → Create.
   Ghi lại **Client ID** và **Client secret**.

### 14.2. Lấy REFRESH_TOKEN

Cách dễ nhất — công cụ dòng lệnh của tác giả `chrome-webstore-upload`:

```bash
npx chrome-webstore-upload-keys
```

Làm theo hướng dẫn: nhập Client ID/secret → trình duyệt mở trang đăng nhập Google → chọn **đúng tài khoản phát
hành** → cho phép → công cụ in ra **refresh token**.

Cách thủ công (thay thế): dùng [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) — tạo OAuth
client loại *Web application* với Authorized redirect URI `https://developers.google.com/oauthplayground`; trong
Playground bấm ⚙ → *Use your own OAuth credentials*; nhập scope
`https://www.googleapis.com/auth/chromewebstore` → *Authorize APIs* → *Exchange authorization code for tokens* →
sao chép *Refresh token*.

### 14.3. Thêm secrets vào GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**, tạo 4 secret:

| Tên | Giá trị |
|---|---|
| `EXTENSION_ID` | Item ID 32 ký tự của TransPop |
| `CLIENT_ID` | từ 14.1 |
| `CLIENT_SECRET` | từ 14.1 |
| `REFRESH_TOKEN` | từ 14.2 |

**Tuyệt đối không** commit các giá trị này vào mã nguồn.

### 14.4. Bật bước tải lên trong workflow

Mở `.github/workflows/release.yml`, bỏ dấu `#` ở bước **Upload to Chrome Web Store** (dùng
[`chrome-webstore-upload-cli`](https://github.com/fregante/chrome-webstore-upload-cli)). Kiểm tra README của công
cụ để chắc chắn tham số còn đúng (Google có thể nâng cấp API — vd. phiên bản API mới hỗ trợ service account).

Từ đó, quy trình phát hành chỉ còn:

```bash
# 1) sửa version trong extension/manifest.json + CHANGELOG.md, commit
git tag v1.0.1
git push origin main --tags
# 2) GitHub Actions: test → đóng gói → tạo GitHub Release → tải lên Chrome Web Store → gửi duyệt
```

---

## 15. (Tùy chọn) Phát hành trên Microsoft Edge Add-ons

Edge dùng nhân Chromium nên **dùng lại đúng file zip** của Chrome.

1. Đăng ký tài khoản tại <https://partner.microsoft.com/dashboard/microsoftedge/> (Microsoft Partner Center) —
   **miễn phí**.
2. **Create new extension** → tải `dist/transpop-v<version>.zip`.
3. **Availability:** Public, chọn thị trường (tất cả).
4. **Properties:** Category (Productivity), URL chính sách quyền riêng tư, website, email hỗ trợ.
5. **Store listings:** thêm ngôn ngữ English + Vietnamese, dán mô tả từ STORE_LISTING.md; logo vuông (có thể dùng
   `store-assets/logo-512.png`), ảnh chụp 1280×800, small/large promo tile 440×280 và 1400×560.
6. **Submission options:** ghi chú cho người duyệt (dán Test instructions) → **Publish**.
7. Thời gian duyệt của Edge: thường vài ngày, tối đa khoảng **7 ngày làm việc**.

Edge cũng có API riêng (Edge Add-ons API) nếu muốn tự động hóa sau này.

---

## 16. Checklist trước khi bấm "Submit for review"

**Mã & gói**

- [ ] Đã thử Load unpacked: bong bóng (3 chế độ kích hoạt), popup, từ điển, phát âm, lịch sử, yêu thích, cài đặt,
      menu chuột phải, phím tắt `Alt+Shift+S` / `Alt+Shift+T`, giao diện sáng/tối, tiếng Anh/tiếng Việt.
- [ ] Đã thử **ngôn ngữ giao diện** (Cài đặt → Chung → Ngôn ngữ giao diện: Tự động / English / Tiếng Việt).
- [ ] Đã thử **dịch chữ trong ảnh**: `Alt+Shift+A` rồi kéo chọn vùng; chuột phải vào ảnh → *Translate text in image*;
      nút "Translate screen area" trong popup; một file PDF (cửa sổ chụp dự phòng); Cài đặt → Dịch chữ trong ảnh
      (chọn ngôn ngữ, *Xóa* dữ liệu ngôn ngữ đã tải).
- [ ] Thử trên vài trang khác nhau (báo, Wikipedia, GitHub, trang nền tối, trang có iframe).
- [ ] Đã thay `EXTENSION_ID` bằng ID thật (lệnh `grep` ở [mục 4](#4-liên-kết-github-và-id-tiện-ích)) — có thể làm ngay sau lần tải gói đầu tiên.
- [ ] `version` trong manifest đúng và lớn hơn bản trước; `CHANGELOG.md` có mục cho version này.
- [ ] `npm run check` → ✔ All checks passed.
- [ ] `npm test` → không có test lỗi.
- [ ] `npm run package` → có `dist/transpop-v<version>.zip`; đã thử Load unpacked từ bản giải nén của zip.

**Tài khoản & chính sách**

- [ ] Đã bật xác minh 2 bước, trả phí 5 USD, xác minh email liên hệ, khai báo trader/non-trader.
- [ ] Repo GitHub để public; liên kết chính sách quyền riêng tư mở được trong cửa sổ ẩn danh.

**Dashboard**

- [ ] Store listing: mô tả EN (+ VI), category, icon 128, ít nhất 1 (nên 5) ảnh 1280×800, small promo tile.
- [ ] Tên, icon, ảnh **không** chứa "Google"/"Microsoft" hay logo của họ.
- [ ] Privacy: single purpose; giải thích cho `storage`, `contextMenus`, `offscreen` (AUDIO_PLAYBACK + WORKERS),
      `tts`, `activeTab` và host permissions (gồm `<all_urls>` content script + 5 tên miền); remote code = No; chỉ
      tick "Website content"; tick đủ 3 cam kết; URL chính sách (đã có mục dịch chữ trong ảnh).
- [ ] Distribution: Free, Public (hoặc Unlisted để thử trước), All regions.
- [ ] Test instructions đã điền.

---

## 17. Sự cố thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Nút **Submit for review** bị mờ | Còn tab chưa điền đủ (thường là Privacy) hoặc chưa xác minh email — Dashboard ghi rõ mục thiếu khi rê chuột/bấm vào. |
| Tải zip lên báo lỗi manifest | Bạn đã nén cả thư mục thay vì nội dung bên trong. Luôn dùng `npm run package`. |
| "The version must be greater than…" | Tăng `version` trong manifest, đóng gói lại. |
| Cài từ cửa hàng nhưng bong bóng không hiện ở tab đang mở | Tải lại trang (content script chỉ chèn vào trang mở sau khi cài). |
| Không thấy biểu tượng TransPop | Bấm 🧩 trên thanh công cụ → ghim TransPop. |
| Bị từ chối vì quyền `<all_urls>` | Viết lại phần giải thích host permission rõ ràng hơn (vì sao cần chạy trên mọi trang, dữ liệu nào được đọc, khi nào gửi đi) rồi gửi lại; có thể kháng nghị kèm giải thích. |
| Dịch lỗi hàng loạt sau một thời gian | Dịch vụ dịch không chính thức có thể đã đổi; kiểm tra `node tests/background/live-smoke.mjs`, sửa provider, phát hành bản cập nhật. |
| Dịch chữ trong ảnh báo lỗi ngay lần đầu dùng một ngôn ngữ | Lần đầu cần tải dữ liệu ngôn ngữ từ `cdn.jsdelivr.net` — kiểm tra mạng / tường lửa / tiện ích chặn quảng cáo có chặn jsDelivr không. Sau khi tải xong, việc nhận dạng chạy được không cần mạng (dịch thì vẫn cần). |
| Nút "Translate screen area" bị mờ / không chụp được | Chrome không cho chụp Chrome Web Store; với tệp `file://` phải bật *Allow access to file URLs* cho TransPop. Trang mở từ trước khi cài/cập nhật tiện ích sẽ dùng cửa sổ chụp dự phòng — tải lại trang để dùng khung chọn ngay trên trang. |
