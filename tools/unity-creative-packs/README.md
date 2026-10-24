# Unity Creative Pack Builder (Chrome extension)

Extension Chrome tự động tạo **creative pack** trên Unity Ads (cloud.unity.com → Acquire → Creative Library)
từ các creative bạn **đã tải lên** cho một app.

**Không cần API key / Service Account.** Extension dùng chính phiên đăng nhập cloud.unity.com của bạn
trên Chrome, nên làm được đúng những gì tài khoản của bạn làm được trên dashboard.

## Cài đặt

1. Tải thư mục `tools/unity-creative-packs` về máy (hoặc giải nén file `unity-creative-packs.zip`).
2. Mở Chrome, vào `chrome://extensions`, bật **Developer mode** (góc trên bên phải).
3. Bấm **Load unpacked** và chọn thư mục `unity-creative-packs` (thư mục chứa `manifest.json`).
4. Ghim extension lên thanh công cụ (biểu tượng mảnh ghép → ghim *Unity Creative Pack Builder*).

Cần Chrome 116 trở lên.

## Sử dụng

1. Mở cloud.unity.com, đăng nhập, vào **Acquire → Creative Library** của app.
2. Bấm biểu tượng extension: bảng điều khiển mở ở cạnh phải trình duyệt.
3. Extension tự kết nối, tự chọn app đang mở, tải danh sách creative và hiện **kế hoạch**:
   những pack sẽ tạo, gồm creative nào.
4. Chỉnh nếu cần: chọn loại pack, end card mặc định, sửa tên pack, bỏ tick pack không muốn tạo.
5. Bấm **Tạo N creative pack**.

Nếu báo "Chưa bắt được phiên đăng nhập", bấm F5 tải lại trang Unity: extension sẽ tự kết nối.

### Extension ghép creative như thế nào

Creative được ghép theo **tên**. Extension bỏ phần đuôi file, chữ chỉ hướng màn hình và chữ chỉ loại
creative để lấy **tên gốc**:

| Creative | Tên gốc |
|---|---|
| `Hook01_9x16.mp4`, `Hook01_1080x1920.mp4`, `Hook01_portrait.mp4`, `Hook01_P.mp4` | `Hook01` (dọc) |
| `Hook01_16x9.mp4`, `Hook01_landscape.mp4`, `Hook01_L.mp4` | `Hook01` (ngang) |
| `Hook01_EC.png`, `Hook01_endcard.png` | `Hook01` (end card) |

- **Video + end card**: video dọc + video ngang cùng tên gốc + end card cùng tên gốc. Video không có
  end card cùng tên sẽ dùng **End card mặc định** (app chỉ có 1 end card thì tự dùng end card đó).
- **Playable**: playable dọc + ngang cùng tên gốc, hoặc 1 playable responsive.
- **Video + playable**: video + playable cùng tên gốc, hoặc **Playable mặc định**.
- Nhóm có 2 video cùng hướng (hoặc không rõ hướng) sẽ tách mỗi video một pack,
  vì Unity yêu cầu pack 2 video phải là 1 dọc + 1 ngang.
- Pack đã có (cùng bộ creative) được bỏ qua, nên bấm tạo nhiều lần cũng không bị trùng.
- Creative bị từ chối, banner và creative không rõ loại được bỏ qua, có ghi lý do.

Tên pack mặc định là `{base}_{tag}`, ví dụ `Hook01_EC`, `Puzzle_PL`, `Hook01_VPL`. Biến dùng được:
`{base}` tên gốc, `{tag}` EC/PL/VPL, `{type}` loại pack, `{orient}` P/L/PL, `{endcard}` / `{playable}`
tên gốc của end card / playable đi kèm, `{date}` ngày tạo (YYYYMMDD).

### Chế độ tự động

Bật **Tự động tạo pack cho app này** trong bảng điều khiển. Từ đó extension tự tạo pack cho creative mới
theo cài đặt bạn đã chọn cho app đó, mỗi khi:

- bạn mở Creative Library của app,
- bạn vừa tải creative lên (khoảng 15 giây sau),
- và cứ 15 phút một lần khi trang Unity còn mở.

Mỗi lần tối đa 20 pack; bạn nhận thông báo của Chrome khi có pack mới hoặc khi gặp lỗi. Pack nào bạn đã bỏ tick
trong bảng điều khiển thì chế độ tự động cũng không tạo. Chế độ tự động chỉ chạy khi Chrome đang mở và bạn
còn đăng nhập Unity.

## Khi gặp lỗi

- **"Unity không nhận phiên đăng nhập cho API"**: tài khoản cần quyền User Acquisition trong organization.
  Nếu bạn đã có quyền mà vẫn lỗi, mở mục **Chẩn đoán**, bấm **Copy chẩn đoán** rồi gửi nội dung đó.
  Nội dung chẩn đoán **không chứa token**, chỉ có danh sách địa chỉ API mà dashboard gọi, để chỉnh extension cho khớp.
- **Nhận sai loại / hướng creative**: đặt lại tên creative theo bảng ở trên, hoặc sửa tay trong kế hoạch.

## Quyền riêng tư & quyền của extension

- Extension đọc header `Authorization` mà dashboard Unity gửi đi (chỉ đọc, không sửa request nào),
  lưu trong bộ nhớ tạm của Chrome (`chrome.storage.session`, tự xoá khi đóng Chrome) và chỉ gửi nó tới
  các địa chỉ `*.unity.com`. Không có dữ liệu nào gửi đi nơi khác.
- Quyền xin cấp: truy cập `*.unity.com` / `*.unity3d.com` (đọc phiên đăng nhập, gọi API), `webRequest`
  (thấy request của dashboard), `storage` (lưu cài đặt), `sidePanel`, `alarms` (chạy tự động định kỳ),
  `notifications` (báo khi tạo xong).
- Extension dùng **Ads Unified Platform Advertiser API** của Unity
  (`services.api.unity.com/ads/advertiser/public/v1`), API của dashboard mới (link `acquire-v2`).
- Extension **chỉ tạo pack**, không gán pack vào campaign.

## Phát triển

```bash
npm test   # test logic ghép pack, API client, kết nối (Node 18+)
```

Cấu trúc: `src/planner.js` (ghép creative thành pack), `src/unity-api.js` (gọi API),
`src/runner.js` (kết nối, lập kế hoạch, tạo pack), `src/background.js` (bắt phiên đăng nhập, chế độ tự động),
`src/content/` (script chạy trong trang Unity), `src/panel/` (bảng điều khiển).
