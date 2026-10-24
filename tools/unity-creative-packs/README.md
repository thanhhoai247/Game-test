# Unity Creative Pack Builder

Tự động tạo **creative pack** trên Unity Ads (cloud.unity.com → Acquire → Creative Library)
từ các creative bạn **đã tải lên** cho một app. Bạn chọn app; tool đọc danh sách creative, tự ghép
video dọc + ngang + end card thành pack, cho xem trước rồi mới tạo.

Chạy lại bao nhiêu lần cũng được: pack nào đã có (cùng bộ creative) sẽ được bỏ qua, nên sau mỗi
đợt upload creative mới chỉ cần chạy lại là có pack cho creative mới.

## Cài đặt

Cần **Node.js 18.3+**. Không cần cài thêm thư viện.

1. **Tạo Service Account** (cần quyền Owner của organization):
   cloud.unity.com → *Administration* → *Service accounts* → *New* → *Add key*.
   Ở *Organization roles*, mở mục **User Acquisition / Advertise API** và cấp role có quyền
   **Creative Packs** (đọc & sửa creative, creative pack).
2. Copy `.env.example` thành `.env` rồi điền:
   ```
   UNITY_KEY_ID=...
   UNITY_SECRET_KEY=...
   UNITY_ORG_ID=...   # số trong link: cloud.unity.com/organizations/<ORG_ID>/...
   ```
   File `.env` đã nằm trong `.gitignore`, không bị commit.

## Sử dụng

```bash
cd tools/unity-creative-packs

# Chọn app từ danh sách, xem kế hoạch, xác nhận rồi tạo
node src/cli.js

# Hoặc dán thẳng link Creative Library (tool tự lấy org + app từ link)
node src/cli.js --app "https://cloud.unity.com/organizations/<ORG_ID>/acquire-v2/creative-library?app=<APP_ID>"

# Chỉ xem trước, không tạo gì
node src/cli.js --app <APP_ID> --dry-run
```

Lần đầu nên chạy `--dry-run` để kiểm tra cách ghép.

### Tool ghép creative như thế nào

Creative được ghép theo **tên**. Tool bỏ phần đuôi file, chữ chỉ hướng màn hình và chữ chỉ loại
creative để lấy **tên gốc**:

| Creative | Tên gốc |
|---|---|
| `Hook01_9x16.mp4`, `Hook01_1080x1920.mp4`, `Hook01_portrait.mp4`, `Hook01_P.mp4` | `Hook01` (dọc) |
| `Hook01_16x9.mp4`, `Hook01_landscape.mp4`, `Hook01_L.mp4` | `Hook01` (ngang) |
| `Hook01_EC.png`, `Hook01_endcard.png` | `Hook01` (end card) |

- **Video pack** (`video`): video dọc + video ngang cùng tên gốc + end card cùng tên gốc.
  Video không có end card cùng tên sẽ dùng **end card mặc định**: chọn bằng `--endcard`,
  hoặc tool hỏi bạn chọn; nếu app chỉ có 1 end card thì tự dùng end card đó.
- **Playable pack** (`playable`): playable dọc + ngang cùng tên gốc, hoặc 1 playable responsive.
- **Video + playable** (`video+playable`, bật bằng `--types`): video + playable responsive cùng tên
  gốc hoặc playable mặc định (`--playable`).
- Nếu một nhóm có 2 video cùng hướng hoặc video không rõ hướng, mỗi video sẽ thành một pack riêng
  (Unity yêu cầu pack 2 video phải là 1 dọc + 1 ngang).
- Creative bị từ chối (rejected/failed…), banner và creative không rõ loại được bỏ qua và liệt kê lý do.

Tên pack mặc định là `{base}_{tag}`, ví dụ `Hook01_EC`, `Puzzle_PL`, `Hook01_VPL`.
Đổi bằng `--name`, ví dụ `--name "UA_{date}_{base}_{orient}_{tag}"`.
Biến có thể dùng: `{base}` tên gốc, `{tag}` EC/PL/VPL, `{type}` loại pack, `{orient}` P/L/PL,
`{endcard}` / `{playable}` tên gốc của end card / playable đi kèm, `{date}` ngày chạy (YYYYMMDD).
Nếu trùng tên với pack đã có, tool tự thêm `_2`, `_3`…

### Ví dụ

```bash
# Chỉ làm pack cho đợt creative mới, dùng end card "Main_EC" cho video thiếu end card
node src/cli.js --app <APP_ID> --filter "^Hook1[0-9]" --endcard Main_EC

# Tạo cả 3 loại pack, không hỏi xác nhận (dùng được trong script / cron)
node src/cli.js --app <APP_ID> --types all --playable Puzzle_playable --yes

# Muốn chỉnh tay: lưu kế hoạch ra file, sửa tên/ghép lại, rồi tạo theo file
node src/cli.js --app <APP_ID> --save-plan plan.json
node src/cli.js --app <APP_ID> --from-plan plan.json
```

### Tất cả tuỳ chọn

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `--app <id\|link>` | App ID (UUID) hoặc link Creative Library. Bỏ trống để chọn từ danh sách |
| `--org <id>` | Organization ID (mặc định lấy từ `.env` hoặc từ link) |
| `--types <list>` | `video`, `playable`, `video+playable` hoặc `all`. Mặc định `video,playable` |
| `--endcard <id\|tên>` | End card mặc định |
| `--playable <id\|tên>` | Playable mặc định cho pack video+playable |
| `--filter <regex>` | Chỉ dùng video/playable có tên khớp (không áp dụng cho end card) |
| `--name <mẫu>` | Mẫu đặt tên pack |
| `--dry-run` | Chỉ xem kế hoạch |
| `--yes`, `-y` | Không hỏi xác nhận |
| `--save-plan <file>` / `--from-plan <file>` | Lưu kế hoạch ra JSON / tạo theo file JSON |
| `--list-apps` | Liệt kê app trong organization |
| `--dump` | In dữ liệu thô của creative (để kiểm tra khi tool nhận sai loại/hướng) |

## Lưu ý

- Tool dùng **Ads Unified Platform Advertiser API** (`services.api.unity.com/ads/advertiser/public/v1`),
  là API của dashboard mới (link `acquire-v2`, app ID dạng UUID). Organization còn dùng
  Advertise API cũ (app ID 24 ký tự hex) thì không dùng được tool này.
- Tool đọc loại và hướng của creative từ nhiều trường khác nhau (type, orientation, kích thước, tên file).
  Nếu tool nhận sai, chạy `--dump` để xem dữ liệu thô rồi đặt lại tên creative theo bảng trên,
  hoặc sửa file kế hoạch (`--save-plan`).
- Tool **chỉ tạo pack**, không gán pack vào campaign.
- Gặp giới hạn tốc độ (HTTP 429), tool tự đợi rồi thử lại. Nếu tạo pack bị lỗi giữa chừng,
  cứ chạy lại: pack đã tạo sẽ được bỏ qua.

## Kiểm thử

```bash
npm test
```

Test chạy với một server Unity giả lập trên máy, không gọi API thật.
