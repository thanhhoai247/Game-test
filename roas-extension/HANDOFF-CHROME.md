# Bàn giao sang Claude Chrome: extension "Xuất số-multichannel"

Người dùng: chị Thanh Hoài. Xưng "chị", Claude xưng "tôi", trao đổi tiếng Việt. Dữ liệu là bí mật kinh doanh, không gửi ra ngoài máy. Extension chỉ ĐỌC, không sửa gì trên Google Ads / TikTok / Unity.
Mã nguồn: repo `thanhhoai247/game-test`, nhánh `claude/eloquent-hamilton-ialll1`, thư mục `roas-extension/` (đã push, chưa tạo PR). Đọc thêm `HANDOFF.md` (bối cảnh Google Ads, cấu trúc DOM đã kiểm tra thật).

## Việc Claude Chrome cần làm (vì có quyền điều khiển trình duyệt)
1. **Trang ITG TikTok** `https://marketing.itgproduct.com/tiktok/ads-editor` (cost ở đây gọi là "spend"): mở trang, xem cấu trúc bảng camp (tiêu đề cột, cột ID camp có không, tiền tệ IDR hay VND hiển thị ở đâu, có chia trang/bảng ảo không, chọn ngày/app ở đâu). Sửa `scraper-table.js` (hàm `scrapeGenericTable`, hiện là bản ĐOÁN, chưa thử trang thật) cho đọc đúng, đủ camp, kể cả cuộn bảng ảo. Kết quả trả về dạng `{ok, headers, rows, currencyHint, pagerText}`; `sidepanel.js` (`runTikTok`, `setTkTable`, `buildTk`) đã sẵn sàng nhận.
2. **Trang Unity** `https://cloud.unity.com/organizations/18967561323381/acquire-v2/reporting?reportConfigId=ff1f91cddabb15c2e4e10659fb69d935`: hiện tab Unity mới chỉ nhận FILE spend theo giờ (CSV/XLSX) hoặc dán bảng. Xem trang thật: tên cột thời gian/spend, múi giờ hiển thị, có nhóm theo campaign/country không, rồi (a) chỉnh tự nhận cột trong `setUnity()` cho đúng, (b) nếu làm được, thêm nút đọc thẳng bảng theo giờ từ trang (cần thêm `https://cloud.unity.com/*` vào `host_permissions` trong `manifest.json`).
   Quy tắc: spend ngày D = từ **17:00 ngày D-1 đến 16:59 ngày D** (`C.unityWindow`, đã có test). Cần xác nhận múi giờ file/trang Unity so với giờ Việt Nam (ô "Lệch giờ" đang để 0).
3. **Google Ads**: chạy thử thật `scraper.js` (xem mục 6 trong HANDOFF.md: lấy Campaign ID từ `a[href*="campaignId="]`, nhãn dòng tổng). Với nhiều tài khoản: mỗi tài khoản mở ở 1 tab Campaigns, extension tự chuyển tab để đọc.
4. Cài thử extension (chrome://extensions → Developer mode → Load unpacked → thư mục `roas-extension`) và chạy end-to-end với file Adjust thật, báo/sửa lỗi.

## Yêu cầu đã chốt của chị
- Tên: **Xuất số-multichannel**, 3 chức năng: (1) Xuất số Google Ads, (2) Xuất số TikTok Ads, (3) Check spend Unity.
- (1) Nhiều tài khoản Google Ads: tick chọn tài khoản; lọc camp theo chữ trong tên (mã app như SPL_009, SGT_001); chọn ngày xuất số.
- (2) TikTok: chọn theo app, đọc spend từng camp từ ITG, ghép revenue Adjust tính ROAS; chọn ngày + app; **hiển thị đúng mệnh giá IDR hay VND**, chị tự điền tỷ giá so với USD.
- (3) Unity: spend của hôm nay = 17:00 hôm qua → 16:00 hôm nay (tổng theo giờ), thay cho việc xuất file hourly rồi lập hàm.
- (1) và (2): lưu kết quả ROAS mỗi lần xuất số, vẽ biểu đồ ROAS tăng/giảm theo từng khung giờ check.
- Màu: ROAS >= 100% xanh lá nhạt; 85–99% vàng; < 85% đỏ. Ngưỡng này đã chốt.
- Revenue: dùng cột `cohort_ad_revenue` trong file Adjust. ROAS = Revenue USD / Cost USD.
- File Adjust mỗi lần chị gửi: CSV cột `day, channel, campaign_network (tên camp, có dấu phẩy trong ngoặc kép), campaign_id_network, cohort_ad_revenue`. Kênh: "Google Ads", "TikTok for Business". Khớp theo ID trước, không có thì theo tên.

## Trạng thái code (`roas-extension/`)
| File | Trạng thái |
|---|---|
| `core.js` | Xong, 16 test đạt (`node test/core.test.js`): số, CSV, khớp camp, nhiều tiền tệ, `roasClass`, lọc app, Unity window, đọc bảng TikTok |
| `scraper.js` | Đọc bảng Google Ads (đã chạy thật ở phiên đầu; 2 chỗ sửa sau đó chưa chạy lại) |
| `scraper-table.js` | Đọc bảng chung cho ITG: **CHƯA thử trang thật** |
| `sidepanel.html/.css/.js` | 3 tab, nạp Adjust dùng chung, lịch sử + biểu đồ SVG, xuất Excel tô màu, Copy. Đã thử bằng Chromium + chrome API giả, không lỗi console |
| `manifest.json` | MV3, quyền `sidePanel, scripting, storage`; host `ads.google.com`, `marketing.itgproduct.com` |
| `HUONG-DAN-CAI.txt`, `Xuat-so-multichannel.zip` | Hướng dẫn cài/dùng và gói zip (đóng lại sau khi sửa code) |
| `lib/` | `read-excel-file` 9.3.12, `write-excel-file` 4.1.1 (chạy offline) |

Lịch sử lưu trong `chrome.storage.local` (khóa `xshist`, tối đa 600 lần lưu); cài đặt ở khóa `xs`. Cột Δ so với lần lưu trước cùng ngày.

## Câu hỏi còn mở
- Múi giờ file Unity (UTC hay giờ VN?) — quyết định giá trị "Lệch giờ".
- Bảng ITG có cột ID camp không? Nếu không thì chỉ khớp theo tên với Adjust.
- Có cần đọc thẳng trang Unity hay file hourly là đủ?
