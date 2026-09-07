// ==========================================================================
// SCRIPT NẠP SÁCH PDF VÀO MONGODB — chạy bằng lệnh: node upload-books.js
//
// Cách dùng:
//   1. Đặt các file PDF vào thư mục ./books (tạo thư mục này cạnh server.js).
//   2. Khai báo metadata cho từng file trong mảng BOOKS bên dưới.
//   3. Chạy: node upload-books.js
//
// Script này CHẠY LẠI ĐƯỢC NHIỀU LẦN: sách đã có sẽ được cập nhật theo tên file,
// không tạo bản trùng. Nó KHÔNG xoá các tài liệu dạng link ngoài đang có sẵn.
//
// Giới hạn: mỗi document MongoDB tối đa 16 MiB. Script sẽ tự chặn file quá lớn
// và nhắc bạn nén PDF lại trước khi nạp.
// ==========================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const LEVEL_CODES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const BOOKS_DIR = path.join(__dirname, 'books');
const MAX_BYTES = 16 * 1024 * 1024; // giới hạn cứng của một BSON document

// --------------------------------------------------------------------------
// KHAI BÁO SÁCH — sửa phần này theo tài liệu của bạn
// fileName phải khớp CHÍNH XÁC tên file trong thư mục ./books
// accentColor là màu gáy sách hiển thị ở thư viện (để trống thì sinh tự động)
// --------------------------------------------------------------------------
const BOOKS = [
    // title / author / description / category HIỂN THỊ THẲNG trên thư viện,
    // mà giao diện đã chuyển hoàn toàn sang tiếng Nga — nên phần này cũng phải
    // là tiếng Nga, nếu không kệ sách sẽ lẫn hai thứ tiếng.
    // category phải trùng khớp giữa các sách: bộ lọc "Все разделы" được sinh
    // từ chính các giá trị này, mỗi cách viết khác nhau sẽ thành một mục riêng.
    {
        fileName: 'rubric-trki-viet.pdf',
        title: 'Критерии оценивания ТРКИ / TORFL. Субтест «Письмо»',
        author: 'По открытым материалам СПбГУ и ННГУ',
        description: 'Критерии оценивания письменной части всех шести уровней ТРКИ: классификация ошибок КЗО и КНЗО, механизм снятия баллов и подробная шкала ТРКИ-1. По этим критериям Миша и проверяет ваши работы.',
        level: 'all',
        category: 'Критерии оценивания',
        accentColor: '#FFFFFF',
        featured: true
    },
    {
        fileName: 'zolotoe-pero.pdf',
        title: 'Золотое перо',
        author: 'Д. В. Колесова, А. А. Харитонов',
        description: 'Курс письменной речи: построение абзаца, связь предложений, выбор стиля и развёртывание аргументации. Подходит тем, кто уже прошёл пороговый уровень и хочет писать точнее и компактнее.',
        level: 'B2',
        category: 'Навыки письма',
        accentColor: '#0039A6'
    },
    {
        fileName: 'uchimsya-pisat.pdf',
        title: 'Учимся писать по-русски',
        author: 'О. Е. Каган, А. С. Кудыма',
        description: 'Интенсивный курс письма: орфография, употребление падежей, пунктуация и самые частые ошибки. Начинается с самых основ, поэтому хорошо подходит для первых шагов.',
        level: 'A2',
        category: 'Учебники',
        accentColor: '#D52B1E'
    },
    {
        fileName: '01_Пишем эссе.pdf',
        title: 'Пишем эссе',
        author: 'Д. В. Колесова, А. А. Харитонов',
        description: 'Подробное руководство по четырём основным типам эссе: повествование, сравнение, причина и следствие, доказательство. Даёт структуру, лексику и практические задания. Ключевой материал для подготовки к субтесту «Письмо» ТРКИ-3 (C1).',
        level: 'C1',
        category: 'Навыки письма',
        accentColor: '#6B21A8' // Màu gáy sách tím đậm hoàng gia
    }
];

// --------------------------------------------------------------------------
// Model — khai báo trùng khớp với resourceSchema trong server.js
// --------------------------------------------------------------------------
const resourceSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: '' },
    level: { type: String, enum: [...LEVEL_CODES, 'all'], default: 'all' },
    category: { type: String, default: 'Разное' },
    fileUrl: { type: String, default: '' },
    fileType: { type: String, default: 'link' },
    fileName: { type: String, default: '' },
    fileData: { type: Buffer, select: false },
    fileSize: { type: Number, default: 0 },
    pageCount: { type: Number, default: 0 },
    author: { type: String, default: '' },
    accentColor: { type: String, default: '' },
    featured: { type: Boolean, default: false }
}, { timestamps: true });
const Resource = mongoose.model('Resource', resourceSchema);

// Đếm số trang gần đúng mà không cần cài thêm thư viện.
// Nếu PDF dùng object stream nén thì có thể đếm không ra — khi đó trả 0 và
// frontend sẽ tự lấy số trang thật từ PDF.js lúc mở sách.
function countPages(buffer) {
    const head = buffer.toString('latin1');
    const byCount = /\/Count\s+(\d+)/g;
    let max = 0, m;
    while ((m = byCount.exec(head)) !== null) max = Math.max(max, parseInt(m[1], 10));
    if (max > 0) return max;
    const matches = head.match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : 0;
}

function mb(bytes) {
    return (bytes / 1048576).toFixed(2) + ' MiB';
}

async function run() {
    if (!fs.existsSync(BOOKS_DIR)) {
        console.error(`❌ Chưa có thư mục ${BOOKS_DIR}. Hãy tạo thư mục "books" và bỏ file PDF vào đó.`);
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Đã kết nối MongoDB.\n');

    let ok = 0, skipped = 0;

    for (const book of BOOKS) {
        const filePath = path.join(BOOKS_DIR, book.fileName);

        if (!fs.existsSync(filePath)) {
            console.warn(`⏭️  Bỏ qua "${book.title}" — không tìm thấy file ${book.fileName} trong ./books`);
            skipped++;
            continue;
        }

        const data = fs.readFileSync(filePath);

        if (data.length > MAX_BYTES) {
            console.error(`❌ "${book.title}" nặng ${mb(data.length)}, vượt giới hạn 16 MiB của MongoDB. Hãy nén PDF rồi chạy lại.`);
            skipped++;
            continue;
        }

        const pageCount = countPages(data);

        await Resource.findOneAndUpdate(
            { fileName: book.fileName },
            {
                title: book.title,
                author: book.author || '',
                description: book.description || '',
                level: book.level || 'all',
                category: book.category || 'Разное',
                accentColor: book.accentColor || '',
                featured: !!book.featured,
                fileName: book.fileName,
                fileType: 'pdf',
                fileData: data,
                fileSize: data.length,
                pageCount,
                fileUrl: ''
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        console.log(`📚 ${book.title}`);
        console.log(`    ${mb(data.length)} · ${pageCount ? pageCount + ' trang' : 'số trang sẽ lấy khi mở sách'} · ${book.level} · ${book.category}\n`);
        ok++;
    }

    const totalBytes = await Resource.aggregate([
        { $group: { _id: null, total: { $sum: '$fileSize' } } }
    ]);
    console.log(`🎉 Xong: nạp ${ok} sách, bỏ qua ${skipped}.`);
    if (totalBytes[0]) console.log(`   Tổng dung lượng sách đang lưu trong DB: ${mb(totalBytes[0].total)}`);

    await mongoose.disconnect();
}

run().catch(err => {
    console.error('❌ Lỗi khi nạp sách:', err);
    process.exit(1);
});
