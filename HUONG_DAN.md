# RusWrite AI — Những gì đã thay đổi

## 1. Cần cài thêm 1 package
```
npm install express-rate-limit
```

## 2. Chạy seed dữ liệu mẫu (1 lần duy nhất)
```
node seed.js
```
Lệnh này tạo sẵn: 10 chủ đề luyện viết (đủ 6 bậc), 5 tài liệu mẫu, và rubric mẫu cho cả 6 bậc.

**Quan trọng:** phần `criteria` trong `seed.js` (tiêu chí Hoàn thành nhiệm vụ / Từ vựng / Ngữ pháp / Bố cục) là **tôi tự soạn để bạn có dữ liệu chạy thử**, KHÔNG PHẢI rubric chính thức của VNU ULIS — tôi không có văn bản gốc đó. Sau khi seed, vào MongoDB (Compass hoặc Atlas) sửa lại đúng nội dung rubric thật bạn đang có, giữ nguyên cấu trúc `{ name, maxScore, bands: [{score, description}] }`.

Tương tự, `fileUrl` trong các tài liệu mẫu (`example.com`) là link giả — thay bằng link thật (Google Drive, S3, Cloudinary...) tới file PDF/sách của bạn.

## 3. Những gì đã sửa/thêm trong `server.js`
- **Bảo mật**: giới hạn 10 lần thử/15 phút cho `/api/register` và `/api/login` (chống brute-force); validate mật khẩu tối thiểu 8 ký tự.
- **Trình độ**: thêm field `level` cho `User`, endpoint `PUT /api/user/level` để lưu trình độ mặc định, `GET /api/levels` trả về 6 bậc.
- **Chủ đề luyện viết**: model `Topic`, endpoint `GET /api/topics`, `GET /api/topics/:id`.
- **Thư viện tài liệu**: model `Resource`, endpoint `GET /api/resources` (lọc theo `level`/`category`).
- **Rubric**: model `Rubric`, endpoint `GET /api/rubric/:level`. `/api/correct` giờ tự động lấy rubric theo trình độ và nhúng vào prompt để GPT chấm điểm từng tiêu chí.
- **Gợi ý dàn bài**: endpoint mới `POST /api/outline` — prompt được ép rõ "không viết câu hoàn chỉnh", chỉ trả về từ khóa/cụm từ gợi ý.
- **Sửa lỗi chi tiết hơn**: mỗi lỗi giờ có thêm `error_type` (phân loại lỗi) và `rule_tip` (mẹo ghi nhớ).
- `Essay` có thêm `topicId` để biết bài viết ứng với chủ đề nào.

## 4. Những gì đã sửa/thêm trong `index.html`
- **Chống XSS**: mọi nội dung động (AI trả về, lịch sử, tài liệu...) đều qua `escapeHTML()` trước khi chèn vào trang, kể cả bài đã sửa trong khung soạn thảo.
- **Giao diện Nga**: tông màu Khokhloma (đỏ #B3122B, vàng đồng #C99A2E, đen ấm, kem), font `PT Serif` + `PT Sans` (font Cyrillic do Nga thiết kế), viền trang trí dân gian ở header, huy hiệu trình độ hình búp bê Matryoshka (màu/kích cỡ tăng theo bậc), mascot gấu có hiệu ứng chớp mắt, hiệu ứng "bung ra" nhẹ khi có kết quả mới, một dải màu cờ Nga rất mỏng dùng đúng 1 chỗ dưới huy hiệu trình độ.
- **Chọn trình độ**: modal hiện khi vào lần đầu, chọn 1 trong 6 bậc; badge trên header cho phép đổi bất cứ lúc nào; nếu đã đăng nhập sẽ tự lưu vào tài khoản.
- **Ngân hàng chủ đề**: sidebar trái hiện chủ đề theo đúng trình độ đang chọn, bấm vào để hiện banner đề bài phía trên khung soạn thảo.
- **Gợi ý dàn bài**: nút riêng, không đụng vào nút "Sửa lỗi bài viết" — trả về mở bài/thân bài/kết bài dạng gợi ý, không viết sẵn câu.
- **Panel phản hồi dạng tab**: Tổng quan & Điểm rubric / Chi tiết lỗi / Dàn bài gợi ý / Từ vựng mở rộng — thay vì đổ hết vào một khối.
- **Mục Thư viện tài liệu**: tab riêng trên nav, có bộ lọc theo trình độ/loại tài liệu.

## 5. Việc bạn cần tự làm thêm
- Điền đúng nội dung rubric ULIS thật (không thể bỏ qua bước này).
- Đổi các `fileUrl` mẫu trong `seed.js` thành link tài liệu thật.
- Khi deploy: đổi `API_BASE` trong `index.html` (dòng đầu thẻ `<script>`) từ `http://localhost:5000` sang domain thật, và đổi `BASE_URL` trong `.env` tương ứng.
- Nếu muốn cho phép admin tự thêm chủ đề/tài liệu qua giao diện (thay vì sửa DB tay), cho tôi biết — tôi sẽ làm thêm trang quản trị + phân quyền `role: 'admin'`.
