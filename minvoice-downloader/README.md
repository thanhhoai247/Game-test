# Tải hàng loạt PDF + XML chứng từ khấu trừ thuế TNCN (M-invoice)

Script chạy **ngay trong trình duyệt của bạn** (Console), dùng phiên đăng nhập sẵn có, nên không cần mật khẩu/token.
Nó "học" các request mà chính trang M-invoice gửi khi bạn tải dữ liệu / xem PDF / tải XML **một lần**, rồi lặp lại cho
**toàn bộ** chứng từ (tự lật hết các trang, không bị giới hạn 50), và lưu về máy dưới dạng file `.zip`
(`<ký hiệu>/PDF/...pdf` và `<ký hiệu>/XML/...xml`).

## Các bước

1. Đăng nhập, vào **Chứng từ điện tử → Chứng từ khấu trừ thuế TNCN**.
2. Mở Console: `F12` → tab **Console**. Chrome sẽ cảnh báo dán code: gõ `allow pasting` + Enter.
3. Dán **toàn bộ** nội dung `minvoice-downloader.js` + Enter (hiện hộp xanh góc phải dưới "Đã sẵn sàng").
4. Trên trang (làm **sau** khi dán script):
   - Chọn ký hiệu (vd `AA/2023/E`) → bấm **Tải dữ liệu**.
   - Chọn **1 chứng từ** trong danh sách → **tải PDF** (hoặc "Xem in" nếu đó là cách bạn lấy PDF) và **tải XML** như bình thường.
5. Kiểm tra: gõ `MV.analyze()` → phải thấy `list`, `pdf`, `xml` đều có URL. (Xem chi tiết: `MV.show()`.)
6. Chạy thử 3 chứng từ: `MV.run({limit:3})` – kiểm tra file zip tải về.
7. Chạy thật: `MV.run()` — tải toàn bộ danh sách của ký hiệu đang chọn.

### Nhiều ký hiệu
- Cách 1: lần lượt đổi ký hiệu → bấm **Tải dữ liệu** → `MV.run()`.
- Cách 2: một lệnh cho nhiều ký hiệu (ký hiệu hiện đang chọn trên màn hình sẽ được thay lần lượt):
  `MV.run({kyHieu:['AA/2023/E','AA/2022/E','AA/2021/E']})`
  (nếu không tự nhận ra ký hiệu gốc, thêm `base:'AA/2023/E'`.)

Chỉ tải một loại: `MV.run({only:['xml']})` hoặc `MV.run({only:['pdf']})`.

## Tùy chỉnh (`MV.cfg`)
| Mục | Ý nghĩa |
|---|---|
| `concurrency` | số file tải song song (mặc định 3) |
| `delayMs` | nghỉ giữa các lần tải, tăng (vd 300) nếu server báo lỗi |
| `zipEvery` | số chứng từ tối đa mỗi file zip (mặc định 300) |
| `pageSize` | ép số dòng/trang khi lấy danh sách (vd 200) |
| `nameFn` | tự đặt tên: `MV.cfg.nameFn=(row)=>row.so_ct+'_'+row.ten_nguoi_nop` (xem tên trường ở dòng "Mẫu 1 dòng dữ liệu" trong console) |
| `idFields` | chỉ định tay trường mã chứng từ, vd `['inv_invoiceauth_id']` |
| `paging` | chỉ định tay tham số phân trang, vd `{offset:'start',limit:'limit'}` hoặc `{page:'page',limit:'pageSize'}` |

## Xử lý sự cố
- **Không thấy `pdf`/`xml`**: `MV.show()` để xem các request. Nếu script chọn nhầm: `MV.use('pdf', số#)`.
  Nếu PDF/XML mở bằng tab mới, thử tải lại sau khi dán script (script ghi cả `window.open`/iframe).
- **"Không tìm thấy mã chứng từ ... trong request PDF"**: chứng từ bạn tải thử phải nằm trong danh sách vừa "Tải dữ liệu". Làm lại bước 4.
- **Chỉ lấy được 50 dòng**: console sẽ in "Không thấy tham số phân trang". Bấm sang **trang 2** trên lưới một lần rồi `MV.run()`, hoặc đặt `MV.cfg.paging`.
- **Có file lỗi**: script tự thử lại 3 lần; file không tải được liệt kê trong `minvoice_<ký hiệu>_LOI.txt` và `MV.failed`.
- Phiên đăng nhập hết hạn giữa chừng: đăng nhập lại, **dán lại script** (F5 sẽ xóa script) và chạy lại.
- Trình duyệt hỏi "cho phép tải nhiều file" → chọn **Cho phép**.

## Lưu ý
Công cụ chỉ gọi lại các thao tác tải mà tài khoản của bạn vốn được phép; đã kiểm thử logic (lật trang >50 dòng, nhiều ký hiệu, PDF GET + XML POST/base64, đóng zip)
trên máy chủ giả lập, **chưa thử trên hệ thống M-invoice thật** vì cần đăng nhập. Hãy chạy `MV.run({limit:3})` trước.
