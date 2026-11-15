# TransPop — Privacy Policy / Chính sách quyền riêng tư

**Effective date / Ngày hiệu lực: 2026-11-15**

[English](#english) · [Tiếng Việt](#tiếng-việt)

---

## English

TransPop ("the extension") is a free, open-source (MIT) browser extension that translates text you select or type.
It is built to collect as little as possible: **the developer does not run any server and never receives your data.**

### 1. What is processed, and when

| Data | When | Sent to | Why |
|---|---|---|---|
| The **text you choose to translate** — the words you select on a page and then trigger TransPop on (icon click, auto mode, hotkey, context menu or keyboard shortcut), or text you type/paste into the TransPop popup | Only when you request a translation | The translation provider you use: **Google Translate** (`translate.googleapis.com`) or, as an automatic fallback / if you choose it, **Microsoft Translator** (`api-edge.cognitive.microsofttranslator.com`, or Microsoft's Bing web translator at `www.bing.com`) | To return the translation, detected language, dictionary entries, definitions and examples |
| The **text you ask TransPop to pronounce** | Only when you press a Listen button, or when you enable "auto-pronounce" | Google's text-to-speech endpoint (`translate.google.com`). If it is unavailable, your browser's built-in speech engine (`chrome.tts`) is used, whose voices are provided by your operating system or browser | To play the pronunciation |
| A short-lived **access token / session** request (contains no personal data and none of your text) | Only when Microsoft Translator is used | `edge.microsoft.com` or `www.bing.com` | Microsoft's free endpoints require a temporary token |

Important details:

- TransPop reads the page's selected text locally to decide whether to show its button or bubble, but **nothing
  leaves your device until you trigger a translation**. TransPop never reads, stores or sends whole pages, form
  fields, passwords, the address of the pages you visit, or your browsing history.
- Requests go **directly from your browser** to the provider. The developer has no server in between and cannot
  see them. As with any web request, the provider receives your IP address and standard browser headers; its
  own privacy policy applies:
  [Google Privacy Policy](https://policies.google.com/privacy) ·
  [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement).
- TransPop uses unofficial, free web endpoints of these services. TransPop is **not affiliated with, endorsed by or
  sponsored by Google or Microsoft**.
- Please don't translate highly sensitive information (passwords, health or financial data) with any online
  translator, including this one.

### 2. What is stored — only on your device

| Data | Where | Notes |
|---|---|---|
| Settings (target languages, trigger mode, theme, disabled sites, …) | `chrome.storage.sync` | If you are signed in to your browser with sync enabled, the browser syncs them between your own devices through your browser account. The developer never receives them. |
| Translation **history** (up to 500 entries: text, translation, languages, time) | `chrome.storage.local` | Can be turned off in Settings → Data. |
| **Favorites** you save | `chrome.storage.local` | |
| The last text typed in the popup | `chrome.storage.local` | So the popup can restore it when reopened. |
| A temporary cache of recent translations | Memory only | Discarded when the browser stops the extension's background worker. |

None of this is ever transmitted to the developer or to anyone else.

### 3. What TransPop does NOT do

- No analytics, telemetry, crash reporting, advertising, tracking pixels or fingerprinting.
- No accounts, no sign-in, no cookies of its own.
- No selling, renting, sharing or transferring of user data, and no use of data for any purpose other than
  translating the text you asked to translate. No use for creditworthiness or lending purposes.
- No remote code: all of the extension's code ships inside the package reviewed by the browser store.

### 4. Permissions

| Permission | Why it's needed |
|---|---|
| Read the text you select on websites (content script on all sites) | To show the translation button/bubble next to your selection on any page you choose to use it on. |
| `storage` | To save your settings, history and favorites on your device. |
| `contextMenus` | To add "Translate …" to the right-click menu. |
| `offscreen` | To play pronunciation audio from the background (Manifest V3 requirement). |
| `tts` | Fallback pronunciation with your browser's built-in voices. |
| Access to `translate.googleapis.com`, `translate.google.com`, `edge.microsoft.com`, `api-edge.cognitive.microsofttranslator.com`, `www.bing.com` | To request translations and pronunciation from the providers listed above — and nothing else. |

### 5. Your choices — how to delete your data

- **Clear history / favorites:** TransPop popup → History & favorites → *Clear all*, or Settings → Data.
- **Stop saving history:** Settings → Data → turn off *Save history*.
- **Reset settings:** Settings → Data → *Reset*.
- **Pause or limit TransPop:** right-click the toolbar icon to turn it off on a site or pause it everywhere, or add
  sites in Settings → Sites.
- **Remove everything:** uninstall the extension (`chrome://extensions` → TransPop → *Remove*). The browser deletes
  all of TransPop's stored data.

### 6. Children

TransPop is a general-purpose tool and is not directed to children under 13. It does not knowingly collect any
personal information from anyone.

### 7. Changes to this policy

If this policy changes, the new version will be published at the same address with a new effective date, and
the change will be noted in the project's [CHANGELOG](../CHANGELOG.md). Material changes will never apply
retroactively without your consent.

### 8. Contact

Questions or concerns: open an issue at
**https://github.com/PhamTienThanhCong/transpop/issues** (please don't include private text you translated).
The full source code is available in the same repository, so anyone can verify this policy.

---

## Tiếng Việt

TransPop ("tiện ích") là tiện ích trình duyệt miễn phí, mã nguồn mở (giấy phép MIT), dùng để dịch đoạn văn bản bạn
bôi đen hoặc nhập vào. Tiện ích được thiết kế để thu thập ít nhất có thể: **nhà phát triển không vận hành máy chủ
nào và không bao giờ nhận được dữ liệu của bạn.**

### 1. Dữ liệu nào được xử lý, và khi nào

| Dữ liệu | Khi nào | Gửi tới | Mục đích |
|---|---|---|---|
| **Đoạn văn bản bạn chọn để dịch** — từ/câu bạn bôi đen trên trang rồi kích hoạt TransPop (bấm biểu tượng, chế độ tự động, phím tắt, menu chuột phải), hoặc văn bản bạn nhập/dán vào cửa sổ TransPop | Chỉ khi bạn yêu cầu dịch | Dịch vụ dịch bạn đang dùng: **Google Dịch** (`translate.googleapis.com`) hoặc, khi dự phòng tự động / khi bạn chọn, **Microsoft Translator** (`api-edge.cognitive.microsofttranslator.com`, hoặc trình dịch web Bing của Microsoft tại `www.bing.com`) | Để trả về bản dịch, ngôn ngữ được phát hiện, mục từ điển, định nghĩa và ví dụ |
| **Văn bản bạn muốn nghe phát âm** | Chỉ khi bạn bấm nút Nghe, hoặc khi bạn bật "tự động phát âm" | Dịch vụ đọc văn bản của Google (`translate.google.com`). Nếu không dùng được, TransPop dùng bộ đọc có sẵn của trình duyệt (`chrome.tts`), giọng đọc do hệ điều hành hoặc trình duyệt cung cấp | Để phát âm |
| Yêu cầu **mã truy cập / phiên tạm thời** (không chứa dữ liệu cá nhân hay văn bản của bạn) | Chỉ khi dùng Microsoft Translator | `edge.microsoft.com` hoặc `www.bing.com` | Dịch vụ miễn phí của Microsoft yêu cầu mã tạm thời này |

Lưu ý quan trọng:

- TransPop đọc đoạn văn bản đang được bôi đen **ngay trên máy bạn** để quyết định có hiện nút/bong bóng hay không,
  nhưng **không có gì rời khỏi máy cho tới khi bạn yêu cầu dịch**. TransPop không bao giờ đọc, lưu hay gửi toàn bộ
  trang web, nội dung ô nhập liệu, mật khẩu, địa chỉ trang bạn truy cập hay lịch sử duyệt web.
- Yêu cầu được gửi **trực tiếp từ trình duyệt của bạn** tới nhà cung cấp dịch vụ, không qua máy chủ trung gian
  nào của nhà phát triển. Như mọi yêu cầu web khác, nhà cung cấp nhận được địa chỉ IP và thông tin trình duyệt
  tiêu chuẩn; chính sách quyền riêng tư của họ được áp dụng:
  [Chính sách quyền riêng tư của Google](https://policies.google.com/privacy?hl=vi) ·
  [Tuyên bố về quyền riêng tư của Microsoft](https://privacy.microsoft.com/vi-vn/privacystatement).
- TransPop dùng các điểm truy cập web miễn phí, không chính thức của các dịch vụ trên. TransPop **không liên kết,
  không được bảo trợ hay tài trợ bởi Google hoặc Microsoft**.
- Không nên dịch thông tin cực kỳ nhạy cảm (mật khẩu, dữ liệu sức khỏe, tài chính) bằng bất kỳ công cụ dịch trực
  tuyến nào, kể cả TransPop.

### 2. Dữ liệu được lưu — chỉ trên máy của bạn

| Dữ liệu | Nơi lưu | Ghi chú |
|---|---|---|
| Cài đặt (ngôn ngữ đích, chế độ kích hoạt, giao diện, danh sách trang bị tắt, …) | `chrome.storage.sync` | Nếu bạn đăng nhập trình duyệt và bật đồng bộ, trình duyệt sẽ đồng bộ cài đặt giữa các thiết bị của chính bạn qua tài khoản trình duyệt. Nhà phát triển không bao giờ nhận được. |
| **Lịch sử** dịch (tối đa 500 mục: văn bản, bản dịch, ngôn ngữ, thời gian) | `chrome.storage.local` | Có thể tắt trong Cài đặt → Dữ liệu. |
| Mục **yêu thích** bạn lưu | `chrome.storage.local` | |
| Nội dung nhập gần nhất trong cửa sổ dịch | `chrome.storage.local` | Để khôi phục khi bạn mở lại. |
| Bộ nhớ đệm tạm thời các bản dịch gần đây | Chỉ trong bộ nhớ | Bị xóa khi trình duyệt dừng tiến trình nền của tiện ích. |

Không dữ liệu nào trong số này được gửi cho nhà phát triển hay bất kỳ ai khác.

### 3. Những điều TransPop KHÔNG làm

- Không phân tích hành vi, không thu thập số liệu sử dụng, không báo cáo lỗi tự động, không quảng cáo, không
  theo dõi.
- Không tài khoản, không đăng nhập, không cookie riêng.
- Không bán, cho thuê, chia sẻ hay chuyển giao dữ liệu người dùng; không dùng dữ liệu cho bất kỳ mục đích nào
  ngoài việc dịch đoạn văn bản bạn yêu cầu. Không dùng để đánh giá tín dụng hay cho vay.
- Không tải mã từ xa: toàn bộ mã của tiện ích nằm trong gói đã được cửa hàng tiện ích xét duyệt.

### 4. Quyền truy cập

| Quyền | Lý do |
|---|---|
| Đọc đoạn văn bản bạn bôi đen trên các trang web (content script trên mọi trang) | Để hiện nút/bong bóng dịch cạnh đoạn bạn chọn, trên bất kỳ trang nào bạn muốn dùng. |
| `storage` | Lưu cài đặt, lịch sử và mục yêu thích trên máy bạn. |
| `contextMenus` | Thêm mục "Dịch …" vào menu chuột phải. |
| `offscreen` | Phát âm thanh phát âm từ tiến trình nền (yêu cầu của Manifest V3). |
| `tts` | Phát âm dự phòng bằng giọng đọc có sẵn của trình duyệt. |
| Truy cập `translate.googleapis.com`, `translate.google.com`, `edge.microsoft.com`, `api-edge.cognitive.microsofttranslator.com`, `www.bing.com` | Chỉ để gửi yêu cầu dịch và phát âm tới các nhà cung cấp nêu trên. |

### 5. Lựa chọn của bạn — cách xóa dữ liệu

- **Xóa lịch sử / yêu thích:** cửa sổ TransPop → Lịch sử & yêu thích → *Xóa tất cả*, hoặc Cài đặt → Dữ liệu.
- **Ngừng lưu lịch sử:** Cài đặt → Dữ liệu → tắt *Lưu lịch sử*.
- **Khôi phục cài đặt gốc:** Cài đặt → Dữ liệu → *Đặt lại*.
- **Tạm dừng hoặc giới hạn TransPop:** nhấp chuột phải vào biểu tượng trên thanh công cụ để tắt trên một trang hoặc
  tạm dừng trên mọi trang, hoặc thêm trang trong Cài đặt → Trang web.
- **Xóa toàn bộ:** gỡ cài đặt tiện ích (`chrome://extensions` → TransPop → *Xóa*). Trình duyệt sẽ xóa toàn bộ dữ
  liệu TransPop đã lưu.

### 6. Trẻ em

TransPop là công cụ đa dụng, không hướng tới trẻ em dưới 13 tuổi và không cố ý thu thập thông tin cá nhân của bất
kỳ ai.

### 7. Thay đổi chính sách

Nếu chính sách này thay đổi, phiên bản mới sẽ được đăng tại cùng địa chỉ kèm ngày hiệu lực mới và được ghi lại
trong [CHANGELOG](../CHANGELOG.md). Các thay đổi quan trọng sẽ không áp dụng hồi tố nếu không có sự đồng ý của bạn.

### 8. Liên hệ

Câu hỏi hoặc góp ý: tạo issue tại **https://github.com/PhamTienThanhCong/transpop/issues** (vui lòng không đính kèm nội
dung riêng tư bạn đã dịch). Toàn bộ mã nguồn có trong cùng kho mã, nên ai cũng có thể kiểm chứng chính sách này.
