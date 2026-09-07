# Thư viện sách điện tử RusWrite AI — hướng dẫn triển khai

## Những file đã thay đổi

| File | Trạng thái | Nội dung |
|---|---|---|
| `server.js` | đã sửa | Mở rộng `resourceSchema`, thêm endpoint trả PDF binary |
| `index.html` | đã sửa | Thư viện mới + trình đọc flipbook bằng PDF.js |
| `seed.js` | đã sửa | Không còn xoá mất sách PDF khi chạy lại |
| `upload-books.js` | **file mới** | Script nạp PDF vào MongoDB |

Toàn bộ phần đăng nhập, đăng ký, Turnstile, chọn trình độ, đề bài, soạn bài,
dàn ý, chấm bài AI và lịch sử **giữ nguyên**, không đụng tới.

---

## Các bước chạy

### 1. Tạo thư mục chứa PDF

```bash
mkdir books
```

Đặt 3 file PDF vào đó và **đổi tên cho gọn** (tên có dấu và ký tự Cyrillic dễ gây
lỗi đường dẫn trên một số hệ điều hành):

```
books/rubric-trki-viet.pdf     ← Tổng hợp Rubric ТРКИ/TORFL
books/zolotoe-pero.pdf         ← Золотое перо
books/uchimsya-pisat.pdf       ← Учимся писать по-русски
```

Nếu bạn muốn dùng tên khác, sửa `fileName` trong mảng `BOOKS` ở đầu
`upload-books.js` cho khớp.

### 2. Nạp sách vào MongoDB

```bash
node upload-books.js
```

Kết quả mong đợi:

```
✅ Đã kết nối MongoDB.

📚 Rubric chấm thi Viết ТРКИ / TORFL
    0.16 MiB · 9 trang · all · Chuẩn chấm thi

📚 Золотое перо
    3.19 MiB · 97 trang · B2 · Kỹ năng viết

📚 Учимся писать по-русски
    1.61 MiB · 241 trang · A2 · Sách giáo trình

🎉 Xong: nạp 3 sách, bỏ qua 0.
```

Script chạy lại được nhiều lần: sách trùng `fileName` sẽ được cập nhật chứ không
tạo bản mới.

### 3. Chạy server và mở trang

```bash
node server.js
```

Vào tab **Thư viện** → bấm **Đọc sách**.

### 4. Kiểm tra nhanh endpoint

```bash
curl -I http://localhost:5000/api/resources/<id>/pdf
```

Phải thấy `Content-Type: application/pdf` và `Accept-Ranges: bytes`.

---

## Cách hoạt động

```
MongoDB (fileData: BSON Binary)
    ↓
GET /api/resources/:id/pdf   →  application/pdf, hỗ trợ Range + ETag
    ↓
PDF.js  →  dựng từng trang ra <canvas>
    ↓
Flipbook UI: 2 trang cạnh nhau, lật bằng CSS 3D transform
```

**Chỉ dựng trang đang cần.** Mỗi lần chỉ render trang hiện tại và các trang liền
kề, thêm bộ nhớ đệm tối đa 12 canvas rồi tự dọn trang cũ. Sách 241 trang cũng
không làm nặng máy.

**Bố cục như sách thật:** trang 1 đứng một mình bên phải, sau đó ghép (2,3),
(4,5)… Nửa không có trang được vẽ thành giấy gác có hoa văn chìm.

---

## Điều khiển trong trình đọc

| Thao tác | Cách dùng |
|---|---|
| Trang sau / trước | Nút mũi tên hai bên sách, nút dưới cùng, phím `←` `→` |
| Phóng to / thu nhỏ | Nút kính lúp, phím `+` `−` (60%–260%) |
| Toàn màn hình | Nút góc trên phải |
| Đóng sách | Nút `✕` hoặc phím `Esc` |
| Điện thoại | Vuốt trái/phải để lật, tự chuyển sang chế độ 1 trang khi màn hình hẹp hơn 820px |

---

## Thêm sách mới sau này

Chỉ cần thêm một khối vào mảng `BOOKS` trong `upload-books.js` rồi chạy lại
script. Các trường có thể dùng:

```js
{
    fileName: 'ten-file.pdf',   // bắt buộc, khớp file trong ./books
    title: 'Tên sách',          // bắt buộc
    author: 'Tác giả',
    description: 'Mô tả ngắn hiển thị dưới bìa',
    level: 'B1',                // A1 A2 B1 B2 C1 C2 hoặc 'all'
    category: 'Ngữ pháp',       // nên trùng với option trong bộ lọc ở index.html
    accentColor: '#2E5EAA',     // màu bìa, bỏ trống thì tự sinh theo tên sách
    featured: false             // true thì sách được đưa lên khu nổi bật
}
```

Nếu thêm `category` mới, nhớ bổ sung một dòng `<option>` tương ứng vào
`#resource-category-filter` trong `index.html`.

---

## Giới hạn cần biết

- **16 MiB mỗi file.** Đây là giới hạn cứng của một document MongoDB. Script sẽ
  báo lỗi và bỏ qua file vượt ngưỡng. Nếu sau này có sách lớn hơn, lúc đó mới cần
  chuyển sang GridFS.
- **Dung lượng MongoDB Atlas.** Gói M0 miễn phí có 512 MB. Ba cuốn hiện tại chiếm
  khoảng 5 MB nên còn rất rộng.
- **Bản quyền.** `Золотое перо` và `Учимся писать по-русски` là giáo trình có bản
  quyền. Nếu trang web mở công khai, cân nhắc giới hạn cho người đã đăng nhập —
  xem ghi chú ngay trên route `/api/resources/:id/pdf` trong `server.js`, chỉ cần
  thêm một middleware là xong.
