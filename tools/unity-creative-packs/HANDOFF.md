# Bàn giao: Unity Creative Pack Builder → Claude in Chrome

Tài liệu này để một phiên Claude chạy trong Chrome của người dùng (Claude in Chrome) làm tiếp
phần việc mà phiên Claude Code trên cloud không làm được, vì cloud không truy cập được Chrome
và tài khoản Unity của người dùng.

## Người dùng muốn gì

- Tự động tạo **creative pack** trên Unity Ads (cloud.unity.com → Acquire → Creative Library)
  từ các creative đã tải lên, cho app họ chọn.
- Họ **không có quyền tạo Service Account key**, nên công cụ phải dùng phiên đăng nhập
  cloud.unity.com sẵn có trong Chrome.
- Họ cho phép công cụ chạy tự động trên máy họ.

## Đã làm xong

Extension Chrome (Manifest V3) ở thư mục này (`tools/unity-creative-packs`, nhánh
`claude/affectionate-galileo-gfl7fd` của repo `thanhhoai247/Game-test`). Cách dùng cho người dùng: xem `README.md`.

- Extension bắt header `Authorization: Bearer …` mà dashboard Unity gửi đi, theo hai đường:
  `webRequest` trong `src/background.js`, và script chạy trong trang (`src/content/hook.js` → `relay.js`).
  Sau đó nó gọi **Ads Unified Platform Advertiser API**:
  `https://services.api.unity.com/ads/advertiser/public/v1/organizations/{org}/applications[/{app}/creatives|/creative-packs]`.
- Bảng điều khiển (side panel, `src/panel/`) cho phép:
  - chọn app;
  - xem kế hoạch ghép pack, sửa tên, bỏ tick;
  - bấm tạo pack;
  - bật chế độ tự động theo từng app;
  - xem mục Chẩn đoán (không chứa token).
- Tạo pack: `POST …/creative-packs` với `{ name, type, creativeIds }`.
  `type` là `video` (1–2 video + 1 end card), `playable` (1–2 playable) hoặc
  `video+playable` (1–2 video + 1 playable responsive). Pack có 2 video phải là 1 dọc + 1 ngang.
- Đã kiểm thử bằng 26 unit test, và chạy extension thật trên Chromium với server **giả lập** Unity.
  Các tình huống đã qua: bắt phiên, ghép, tạo, không tạo trùng, chế độ tự động, khi bị từ chối.

## Chưa kiểm chứng với Unity thật (việc chính cần làm)

1. API có **nhận token Bearer của dashboard** không. Tài liệu Unity nói API quản trị thường
   đòi Service Account. Tài liệu migration của API Publisher cùng nền tảng nói có nhận
   Bearer JWT, nhưng chưa xác nhận được với API Advertiser.
2. **Tên trường thật** của creative trong phản hồi danh sách (loại: video / end card / playable,
   hướng dọc/ngang). Code đoán từ nhiều trường (`type`, `orientation`, `width`/`height`, tên file).
3. Tên khoá bao danh sách trong phản hồi (`data` / `results` / …). Code đã chấp nhận nhiều dạng.

## Việc cần làm trong Chrome, theo thứ tự

1. **Người dùng tự cài extension.** Claude in Chrome không thao tác được trang `chrome://`.
   - Giải nén `unity-creative-packs.zip` (hoặc tải thư mục này về).
   - Vào `chrome://extensions`, bật **Developer mode**, bấm **Load unpacked**, chọn thư mục có `manifest.json`.
2. Mở trang Creative Library của app (link người dùng đưa).
   Nhờ người dùng bấm biểu tượng extension để mở bảng điều khiển bên phải.
3. Xem dòng trạng thái ở đầu bảng:
   - **"Đã kết nối…"**: so kế hoạch với danh sách creative trên trang (loại, hướng, cách ghép có đúng không).
     Bỏ tick hết, chỉ để **1 pack**, bấm tạo. Mở tab Creative Packs trên dashboard kiểm tra pack đó
     đúng tên, đúng creative. Đúng rồi mới tạo phần còn lại, và hỏi người dùng trước.
   - **"Unity không nhận phiên đăng nhập…"** hoặc lỗi khác: nhờ người dùng mở mục **Chẩn đoán** →
     **Copy chẩn đoán**. Sau đó, trên tab Creative Library, đọc network request (`read_network_requests`)
     trong lúc:
     - tải lại trang (xem dashboard lấy danh sách creative từ URL nào);
     - người dùng tạo tay **một** creative pack trên dashboard (xem request tạo pack).

     Ghi lại method, URL (bỏ query chứa thông tin nhạy cảm), dạng body gửi đi, dạng phản hồi
     (vài trường đầu của một creative), status code.
4. Mang kết quả (chẩn đoán + danh sách request) về một phiên Claude Code để sửa extension cho khớp.
   Có thể chỉ cần đổi **API base** trong mục Chẩn đoán, có thể phải sửa `src/unity-api.js`.

### Nếu extension không dùng được

Claude in Chrome có thể tạo pack trực tiếp trên giao diện dashboard theo cùng quy tắc ghép bên dưới.
Hãy tạo thử 1 pack, cho người dùng xem, rồi mới làm tiếp.

## Quy tắc ghép creative

Ghép theo **tên gốc**: bỏ đuôi file, chữ chỉ hướng (`9x16`, `16x9`, `1080x1920`, `portrait`,
`landscape`, `_P`, `_L`…) và chữ chỉ loại (`EC`, `endcard`, `playable`, `video`).

- `Hook01_9x16.mp4` + `Hook01_16x9.mp4` + `Hook01_EC.png` → pack `Hook01_EC` (type `video`).
- Video không có end card cùng tên dùng end card mặc định (người dùng chọn; app chỉ có 1 end card thì dùng nó).
- Playable dọc + ngang cùng tên → pack `{tên}_PL` (type `playable`).
- Bỏ qua creative bị từ chối, banner, creative không rõ loại. Không tạo pack trùng bộ creative với pack đã có.

## Nguyên tắc

- **Không bao giờ** đọc, chép hay dán giá trị token (header `Authorization`, cookie) vào chat hay ghi chú.
- Hỏi người dùng trước khi tạo hàng loạt; luôn tạo thử 1 pack trước.
- Không gán pack vào campaign: API gán của Unity thay toàn bộ danh sách pack đang gán.
- Claude in Chrome không sửa được code. Thay đổi code làm ở phiên Claude Code, trên nhánh ở trên.

## Bản đồ code

| File | Vai trò |
|---|---|
| `manifest.json` | Khai báo extension (quyền, side panel, content script) |
| `src/background.js` | Bắt phiên đăng nhập, log request cho Chẩn đoán, chế độ tự động |
| `src/content/hook.js`, `relay.js` | Đường thứ hai bắt phiên (chạy trong trang Unity) |
| `src/unity-api.js` | Gọi API: phân trang, thử lại khi 429, đọc nhiều dạng phản hồi |
| `src/planner.js` | Nhận diện loại/hướng creative, ghép thành pack, lọc trùng |
| `src/runner.js` | Kết nối, lập kế hoạch, tạo pack (có khoá chống tạo trùng), chạy tự động |
| `src/panel/` | Giao diện bảng điều khiển |
| `test/` | Unit test (`npm test`) |
