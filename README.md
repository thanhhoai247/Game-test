# 🏝️ Grow Island

Game giải đố kiểu **GROW** chơi trên iPhone (HTML5, không cần cài đặt thêm gì).
Chạm vào các biểu tượng để chúng lớn lên. Vật này cần vật kia đạt cấp nhất định mới lớn được,
và có thứ còn cản nhau, nên **thứ tự bấm** là mấu chốt. Đưa cả 8 vật lên MAX trong ít lượt nhất (hoàn hảo = 24 lượt).

## Chơi trên iPhone
1. Bật GitHub Pages: *Settings → Pages → Deploy from a branch → chọn nhánh + thư mục `/ (root)`*.
2. Mở `https://<tên-user>.github.io/Game-test/` bằng Safari.
3. Bấm nút Chia sẻ → **Thêm vào Màn hình chính** để chơi toàn màn hình như app.

Chạy thử trên máy tính: `npx http-server .` rồi mở trang bằng trình duyệt.

## Kiểm tra màn chơi
`node solve.js` xác nhận màn chơi thắng được và in một lời giải mẫu.
Luật chơi nằm trong `rules.js`, có thể sửa để tạo màn mới.
