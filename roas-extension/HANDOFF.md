# Bàn giao: Extension Chrome "ROAS nhanh" – Cost Google Ads × Revenue Adjust

> Gom ngày 13/10/2026 từ phiên chat Claude (claude.ai, Project "UA") để làm tiếp trên Claude Code.
> Người dùng: chị Thanh Hoài. Xưng "chị", Claude xưng "tôi", trao đổi bằng tiếng Việt. Coi mọi dữ liệu là bí mật kinh doanh, không gửi ra ngoài máy.

## 0. Lời nhắn mở đầu cho Claude Code

Làm tiếp extension Chrome (Manifest V3) trong thư mục này. Đã có `core.js` (logic tính toán) và `scraper.js` (đọc bảng Google Ads). Cần làm nốt: `manifest.json`, `background.js`, giao diện side panel (`sidepanel.html/.css/.js`), icon, bài test, file hướng dẫn cài. Đọc hết file này trước, đặc biệt mục 3 (cấu trúc trang Google Ads đã kiểm tra thực tế) và mục 6 (việc còn lại).

## 1. Mục tiêu

Ở công ty chị, "xuất số" nghĩa là: xuất **Cost** từng camp từ Google Ads, xuất **Revenue** từng camp từ Adjust, rồi đưa cả hai file vào Excel và lập hàm tính ROAS. Phải xuất số hai lần nên mất thời gian.

Chị muốn một extension Chrome:
- **Tự đọc Cost từng camp** ngay trên trang Campaigns của Google Ads (chị đã đăng nhập sẵn).
- Chị **chỉ xuất Revenue từ Adjust** rồi nạp vào extension (file hoặc dán).
- Extension **ghép theo camp và tính ROAS** từng camp, xuất ra Excel được.

Lưu ý: đây là công cụ **chỉ đọc**. Không bật/tắt camp, không sửa gì trong Google Ads.

## 2. Bối cảnh

- Máy Windows, trình duyệt Chrome. Chị không phải lập trình viên, nên cần hướng dẫn cài từng bước (Load unpacked).
- Tài khoản Google Ads đã thử: **ITG_Jsc_062_ThuyNT**, mã KH **632-199-8835**. Trang Campaigns:
  `https://ads.google.com/aw/campaigns?ocid=8515804291&euid=6605516058&__u=6076823242&uscid=8515804291&__c=3768598059&authuser=1&workspaceId=0`
- Giao diện Google Ads tiếng Anh (`lang="en-GB"`). Tiền tệ tài khoản là **IDR**, số dạng `IDR43,371`.
- Bảng có một **cột tự tạo tên "USD"** (cost quy ra USD, làm tròn 2 số lẻ). Tỷ giá ngầm suy ra từ dòng tổng: 452,523 / 25.27 ≈ 740,711 / 41.36 ≈ **17,908 IDR/USD**.
- Camp đang chạy là App campaign tROAS, tên dạng `SPL_009_TNT_Global_ROAS_70_BS1_4-5-6`, `13/10_SPL_009_TNT_Global_ROAS_70%_BS2_6,7,8,9,10`. **Tên camp có dấu phẩy** nên khi đọc CSV phải xử lý ngoặc kép đúng chuẩn.
- Revenue lấy từ Adjust. Mặc định giả định **revenue tính bằng USD**. App AI Health (com.aihealth.bp.blood.tracker.app) cũng đo bằng Adjust.
- Cùng Project "UA" có brief khác về tự tắt camp FB/TikTok qua ITG Marketing Tool (`claude/brief-tu-dong-tat-camp-roas.md`). **Không thuộc việc này.**

## 3. Cấu trúc trang Google Ads (đã kiểm tra trực tiếp ngày 13/10/2026)

- Bảng chiến dịch là `ess-particle-table`.
  - Dòng tiêu đề: `.particle-table-header`, ô tiêu đề `[role="columnheader"]`. Chữ trong ô có lẫn tên icon (`help_outline`…) nên phải lọc bỏ.
  - Dòng dữ liệu: `.particle-table-row`, ô `[role="gridcell"]`. Bỏ qua `.summary-draft-overview-row` ("Drafts in progress") và `.particle-table-summary-row` (dòng tổng).
- Các cột đang bật: Campaign, Budget, Status, Cost, USD, Conv. value / cost, Campaign type, Bid strategy type, Conv. value, Avg. target ROAS, Conversions, Conv. rate, Cost / conv., Impr., Clicks, CTR, Optimisation score.
- **Tên camp:** lấy chữ của thẻ `a` trong ô Campaign. `innerText` của cả ô có thêm chữ " settings" ở cuối.
- **Campaign ID:**
  - Camp cũ có thẻ `a[href*="campaignId="]` ở đâu đó trong dòng. Thẻ này không nhất thiết là link tên camp, nên phải tìm trong cả dòng.
  - Camp mới (tiền tố `13/10_`) **không có ID trong DOM**. Vì vậy phải khớp chủ yếu bằng **tên**.
  - Có thể bật thêm cột "Campaign ID" trong Google Ads; scraper đã hỗ trợ đọc cột này.
- **Bảng ảo (virtualized):** chỉ vẽ khoảng 12 dòng đang nhìn thấy, trong khi pager ghi `1 - 21 of 21`. Thùng cuộn là `div.main` (overflow auto). Cuộn từng bước (60% chiều cao) và gom dòng theo khóa → đọc đủ **21/21 camp trong khoảng 2,3 giây**. Sau đó trả vị trí cuộn về chỗ cũ.
- **Dòng tổng:**
  - "Total: Filtered campaigns" = IDR452,523 / 25.27 USD.
  - "Total: Account" = IDR740,711 / 41.36 USD.
  - Dòng tổng **lệch 1 ô** so với tiêu đề, nên phải map cột theo **vị trí (getBoundingClientRect)**, không theo thứ tự ô.
- **Khoảng ngày:** `material-date-range-picker`, chữ hiện "Today 13 Oct 2026".
- **Tên tài khoản:** lấy từ `document.title` = "Campaigns - ITG_Jsc_062_ThuyNT - Google Ads". Mã KH tìm theo mẫu `ddd-ddd-dddd`.
- Bộ lọc đang bật trên bảng (ví dụ "Campaign name contains SPL_009") ảnh hưởng tới số camp đọc được. Extension chỉ đọc những gì đang hiển thị.
- Google Ads có chia trang. Nếu pager báo tổng nhiều hơn số dòng đọc được thì phải cảnh báo, bảo chị tăng "Show rows".

## 4. Thiết kế đã chốt

- **Manifest V3, giao diện Side Panel.** Lý do: side panel nằm cạnh trang Google Ads và không bị đóng khi mở hộp chọn file, khác với popup.
  - `permissions`: `sidePanel`, `scripting`, `storage`.
  - `host_permissions`: `https://ads.google.com/*`. Không xin quyền `tabs` để tránh cảnh báo "đọc lịch sử duyệt web".
  - `background.js`: `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
- **Luồng 3 bước trong side panel:**
  1. **Đọc cost:**
     - Tìm tab đang mở (`chrome.tabs.query({active:true,lastFocusedWindow:true})`) và kiểm tra đúng là `ads.google.com/aw/campaigns`.
     - Gọi `chrome.scripting.executeScript({target:{tabId}, func: scrapeGoogleAdsCampaigns})`. Hàm async này tự chứa, nằm trong `scraper.js`, nạp vào sidepanel.html bằng `<script>`.
     - Hiển thị tên tài khoản, khoảng ngày, số camp, tổng cost và cảnh báo nếu có.
  2. **Nạp revenue:**
     - Kéo-thả hoặc chọn file CSV/TSV/XLSX, hoặc dán bảng copy từ web Adjust.
     - Tự đoán cột tên camp và cột revenue. Có dropdown để đổi, và nhớ lựa chọn trong `chrome.storage.local`.
  3. **Kết quả:**
     - Bảng gồm Camp | Cost | Cost USD | Revenue | ROAS. Bấm tiêu đề để sắp xếp, mặc định sắp theo cost giảm dần.
     - Tô đỏ dòng có ROAS < ngưỡng (mặc định 100%, chỉnh được). Có ô tick "Ẩn camp không chi tiêu".
     - Thẻ tổng: Cost USD, Revenue, ROAS tổng.
     - Phần "Revenue không khớp camp nào" (gập lại được).
     - Nút **Tải Excel** (.xlsx, số thật, ROAS định dạng `0.00%`) và nút **Copy bảng** (TSV).
- **Khớp camp:**
  - Ưu tiên theo ID: Adjust thường ghi tên camp Google dạng `Tên camp (1234567890)`, cắt lấy số trong ngoặc ở cuối.
  - Sau đó khớp theo tên đã chuẩn hóa: NFC, gộp khoảng trắng, chữ thường. Thử cả phần tên đã bỏ "(id)" lẫn tên gốc.
  - Tên trùng nhau thì không khớp, coi là không chắc chắn.
  - Nhiều dòng revenue cùng một camp (ví dụ chia theo ngày hoặc quốc gia) thì **cộng dồn**. Bỏ qua dòng "Total/Tổng".
- **Quy đổi tiền:**
  - Đọc đơn vị tiền từ chữ cost (`IDR`, `₫`, `$`…).
  - Nếu không phải USD:
    - Tỷ giá tự động = cost tổng / cột USD tổng, lấy từ dòng "Total: Filtered campaigns".
    - Nếu không có cột USD: lấy tỷ giá chị đã nhập trước đó cho loại tiền này (lưu storage), hoặc bắt nhập.
  - Ô tỷ giá luôn sửa tay được.
  - Có chọn "Đơn vị revenue": USD (mặc định) hoặc cùng đơn vị với cost.
  - **ROAS = Revenue (USD) / Cost (USD).**
- **Đọc số:**
  - Cost Google Ads: dùng dấu thập phân theo `lang` của trang (`Intl.NumberFormat(lang).formatToParts`).
  - Revenue: tự đoán dấu thập phân theo cả cột (`detectDecimal`). Ô XLSX dạng số thì dùng thẳng.
- **Kiểm tra chéo:** so tổng cost các dòng đọc được với dòng "Total: Filtered campaigns". Lệch quá 0,5% thì cảnh báo. Nhắc chị đối chiếu khoảng ngày Google Ads với ngày của file Adjust.
- **Thư viện Excel** (đã chép vào `lib/`, chạy offline vì MV3 cấm tải code từ xa):
  - `read-excel-file` 9.3.12: biến toàn cục `readXlsxFile(file)`. Ở v9, hàm trả về **`[{sheet, data}]`** (mảng các sheet), nên xử lý cả hai dạng.
  - `write-excel-file` 4.1.1: `writeXlsxFile(data, {columns:[{width}], sheets:[...]}).toBlob()` hoặc `.toFile(name)`. Ô có định dạng: `{value, type: Number, format: '0.00%'}`.
  - `npm audit`: 0 lỗ hổng. Không dùng SheetJS bản npm 0.18.5 vì có CVE; bản vá chỉ có trên CDN của SheetJS, môi trường cũ không tải được.

## 5. Trạng thái code

| File | Trạng thái |
|---|---|
| `core.js` | Xong. Các hàm: `parseNum`, `detectDecimal`, `currencyOf`, `parseDelimited` (CSV/TSV, tự đoán dấu phân cách, xử lý ngoặc kép), `findHeaderRow`, `guessColumns`, `splitAdjustName`, `aggregateRevenue`, `buildCampaigns`, `autoRate`, `compute`. Đã test nhanh bằng Node: tỷ giá tự động ra 17,908; khớp ID và tên đúng; bỏ được dòng Total. |
| `scraper.js` | Xong. Chạy thật trên tài khoản của chị: đọc đủ 21/21 camp, đúng tên, cost, cột USD, tài khoản, khoảng ngày, pager. Hai lỗi phát hiện khi chạy thử **đã sửa nhưng chưa chạy lại** (xem mục 6). |
| `lib/read-excel-file.min.js`, `lib/write-excel-file.min.js` (+ LICENSE) | Đã có. |
| `manifest.json`, `background.js`, `sidepanel.html/.css/.js`, `icons/` | **Chưa làm.** |
| Hướng dẫn cài cho chị (`HUONG-DAN-CAI.txt`) | **Chưa làm.** |

## 6. Việc còn lại

1. **Chạy lại `scraper.js` trên trang Google Ads** để xác nhận hai chỗ đã sửa:
   - Lấy Campaign ID từ `a[href*="campaignId="]` trong cả dòng. Lần chạy đầu ra `id: null` hết vì chỉ tìm trong link tên.
   - Nhãn dòng tổng lấy từ chữ của cả dòng. Lần chạy đầu nhãn rỗng nên dòng "Filtered" bị dòng "Account" ghi đè.
2. Viết `manifest.json`, `background.js`, `sidepanel.*` theo mục 4. Giao diện tiếng Việt, gọn ở bề rộng khoảng 360px, tên camp dài thì cắt và hiện tooltip.
3. Tạo icon 16/48/128 (Python PIL có sẵn trong môi trường cũ).
4. Viết test cho `core.js`, nhất là CSV có tên camp chứa dấu phẩy (phải nằm trong ngoặc kép). Thử side panel với file Adjust mẫu thật.
5. Viết hướng dẫn cài: giải nén → `chrome://extensions` → bật Developer mode → Load unpacked → ghim icon → mở trang Campaigns → bấm icon.
6. Đóng gói zip gửi chị.

## 7. Câu hỏi còn mở (hỏi chị khi cần)

- **File revenue Adjust trông thế nào?** Xuất từ Adjust gốc (suite.adjust.com) hay từ trang Adjust của ITG Marketing Tool? CSV hay XLSX? Tên cột camp và cột revenue là gì? Tên camp có kèm "(campaign id)" không? Revenue tính bằng USD không? → Xin **một file mẫu** để chỉnh phần tự đoán cột.
- Dùng loại revenue nào để tính ROAS: Ad revenue (IAA), All revenue, hay cohort D0?
- Công ty hiển thị ROAS dạng % (85%) hay số lần (0.85)? Ngưỡng tô đỏ là bao nhiêu?
- Công ty có tỷ giá IDR/USD cố định không, hay cứ theo cột USD trên Google Ads?
- Có cần đọc nhiều tài khoản Google Ads rồi gộp lại không?
