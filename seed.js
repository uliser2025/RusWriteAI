// SCRIPT NẠP DỮ LIỆU MẪU — chạy 1 lần bằng lệnh: node seed.js
// - Topic/Resource: dữ liệu ví dụ, bạn nên thay bằng nội dung thật của bạn.
// - Rubric: dữ liệu THẬT, chuyển thể từ tài liệu "Tổng hợp Rubric ТРКИ/TORFL -
//   Phần thi Viết" (nguồn công khai SPbU/ННГУ). Nếu sau này bạn có thêm nguồn
//   chính thức chi tiết hơn (đặc biệt cho B2/C1/C2), nên cập nhật lại.

require('dotenv').config();
const mongoose = require('mongoose');

const LEVEL_CODES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const topicSchema = new mongoose.Schema({
    title: String, prompt_text: String, level: String, category: String
}, { timestamps: true });
const Topic = mongoose.model('Topic', topicSchema);

const resourceSchema = new mongoose.Schema({
    title: String, description: String, level: String, category: String, fileUrl: String, fileType: String,
    fileName: String, fileData: { type: Buffer, select: false }, fileSize: { type: Number, default: 0 },
    pageCount: Number, author: String, accentColor: String, featured: Boolean
}, { timestamps: true });
const Resource = mongoose.model('Resource', resourceSchema);

const rubricSchema = new mongoose.Schema({
    level: String, trkiName: String, source: String, sourceConfidence: String,
    scoringMethod: String, totalScore: Number,
    deductionRules: {
        kzoPenalty: Number, knzoPenalty: Number, invalidationThreshold: Number,
        bonusRules: { maxBonus: Number, description: String },
        taskCriteria: [String]
    },
    parameters: [{ name: String, maxScore: Number, description: String, kzoCapsAt: Number }],
    essayRequirements: [String]
});
const Rubric = mongoose.model('Rubric', rubricSchema);

const topics = [
    // Tiêu đề và chuyên mục hiển thị THẲNG trên giao diện, mà giao diện đã chuyển
    // hoàn toàn sang tiếng Nga — nên phần này cũng phải là tiếng Nga, nếu không
    // danh sách nhiệm vụ sẽ lẫn hai thứ tiếng.
    { title: 'О себе',                    prompt_text: 'Расскажите о себе: как вас зовут, сколько вам лет, где вы живёте и что вы любите делать.', level: 'A1', category: 'Повседневная жизнь' },
    { title: 'Моя семья',                 prompt_text: 'Опишите свою семью: сколько человек в вашей семье, кто они и чем занимаются.', level: 'A1', category: 'Повседневная жизнь' },
    { title: 'Мой день',                  prompt_text: 'Опишите свой обычный день от утра до вечера.', level: 'A2', category: 'Повседневная жизнь' },
    { title: 'Мой город',                 prompt_text: 'Расскажите о городе, в котором вы живёте: что вам нравится и что бы вы изменили.', level: 'A2', category: 'Повседневная жизнь' },
    { title: 'Зачем учить языки',         prompt_text: 'Напишите эссе о пользе изучения иностранных языков в современном мире.', level: 'B1', category: 'Образование' },
    { title: 'Социальные сети',           prompt_text: 'Выразите своё мнение: социальные сети приносят больше пользы или вреда?', level: 'B1', category: 'Технологии' },
    { title: 'Защита окружающей среды',   prompt_text: 'Какие меры должны принимать правительства и обычные люди для защиты окружающей среды?', level: 'B1', category: 'Общество' },
    { title: 'Технологии в обучении',     prompt_text: 'Как технологии изменили способ обучения студентов за последние 10 лет?', level: 'B2', category: 'Технологии' },
    { title: 'Город и экология',          prompt_text: 'Напишите письмо в администрацию города о проблеме загрязнения и предложите меры.', level: 'B2', category: 'Общество' },
    { title: 'Глобализация и культура',   prompt_text: 'Глобализация угрожает культурной самобытности народов или, наоборот, обогащает её? Аргументируйте свою позицию.', level: 'C1', category: 'Общество' },
    { title: 'Искусственный интеллект',   prompt_text: 'Проанализируйте, как искусственный интеллект изменит рынок труда в ближайшие десятилетия.', level: 'C2', category: 'Технологии' },
];

const resources = [];

// RUBRIC ТРКИ/TORFL THẬT — chuyển thể từ "Tổng hợp Rubric ТРКИ/TORFL - Phần thi Viết"
// (tài liệu tổng hợp tháng 9/2026, dựa trên nguồn công khai của SPbU và ННГУ).
// Đây là hệ thống chấm thi CHÍNH THỨC của Nga, không phải rubric tự soạn.
// Lưu ý: công cụ này chấm 1 bài luận đơn (không tách nhiều bài như đề thi thật),
// nên áp dụng chung 1 thang điểm/1 bộ tham số cho toàn bộ trình độ đó.
// Bốn tên tham số này HIỂN THỊ THẲNG trong bảng điểm trên giao diện, nên phải
// thuần tiếng Nga đúng như SPbU công bố — không kèm chú thích tiếng Việt.
// (Phần khớp tên ở ai/scoring.js dùng normalizeParamName nên vẫn hoạt động
// bình thường dù trước đây tên có ngoặc đơn.)
const PARAM_NAMES = {
    intention: 'Интенция',
    content: 'Содержание',
    composition: 'Композиционная структура и форма',
    language: 'Языковые средства'
};

function parameterSet(descriptions) {
    return Object.entries(PARAM_NAMES).map(([key, name]) => ({
        name,
        maxScore: 5,
        description: descriptions[key],
        // Chỉ tham số "Ngôn ngữ" bị áp trần điểm khi có lỗi КЗО, theo diễn giải hợp lý nhất
        // từ tài liệu gốc (КЗО về bản chất là lỗi thuộc phạm trù ngôn ngữ) — nếu cách hiểu
        // thực tế của bạn khác (áp trần cho MỌI tham số), báo lại để tôi chỉnh.
        kzoCapsAt: key === 'language' ? 3 : null
    }));
}

const rubrics = [
    {
        level: 'A1', trkiName: 'ТЭУ', sourceConfidence: 'низкая',
        source: 'ТЭУ/A1 — bgpu.ru/testing/levels.html; nguyên tắc trừ điểm chung theo Dubinina & Rakitina (Trung tâm Khảo thí SPbU)',
        scoringMethod: 'deduction', totalScore: 80,
        deductionRules: {
            kzoPenalty: 2, knzoPenalty: 0.5, invalidationThreshold: null,
            taskCriteria: ['На этом уровне письмо носит репродуктивный характер (по образцу) — не снижай оценку строго, если текст следует образцу.']
        }
    },
    {
        level: 'A2', trkiName: 'ТБУ', sourceConfidence: 'низкая',
        source: 'ТБУ/A2 — bgpu.ru/testing/levels.html; testrf.rudn.ru/index.php/trki-sertifikatsionnye-urovni',
        scoringMethod: 'deduction', totalScore: 80,
        deductionRules: {
            kzoPenalty: 2, knzoPenalty: 0.5, invalidationThreshold: null,
            taskCriteria: ['Репродуктивно-продуктивный текст, не менее 15 предложений по опорным вопросам — если текст заметно короче, прямо укажи это в отзыве.']
        }
    },
    {
        level: 'B1', trkiName: 'ТРКИ-1', sourceConfidence: 'высокая',
        source: 'ТРКИ-1/B1 — ННГУ (2018), "Учебно-тренировочные тесты по РКИ, Уровень B1", tr.46-47 (Добрякова, Калистратова, Макарова, Смирнова, Черемисина). Đây là cấp độ có bảng điểm công khai đầy đủ nhất trong tài liệu tổng hợp.',
        scoringMethod: 'deduction', totalScore: 80,
        deductionRules: {
            kzoPenalty: 2, knzoPenalty: 0.5, invalidationThreshold: 15,
            bonusRules: { maxBonus: 6, description: 'бонус за полноту и детальность изложения, а также за языковое творчество; максимум +3 балла за каждый пункт' },
            taskCriteria: [
                'Если коммуникативная задача задания не решена — 0 баллов за всю работу, каким бы хорошим ни был язык.',
                'Снижай оценку за пропущенные пункты и неотвеченные опорные вопросы задания.',
                'Минус 2 балла за каждое нарушение логики и связности между предложениями или абзацами.',
                'Минус 3 балла за каждый абзац, дословно списанный из формулировки задания вместо собственного текста.',
                'Языковые средства ВЫШЕ уровня B1 (конструкции сложнее требуемых) НЕ считаются ошибкой и не штрафуются.'
            ]
        }
    },
    {
        level: 'B2', trkiName: 'ТРКИ-2', sourceConfidence: 'средняя',
        source: 'ТРКИ-2/B2 — SPbU, webinar "Подготовка к уровню ТРКИ-2/В2" (15/3/2020) và "Субтест «Письмо» ТРКИ-2/В2 — ТРКИ-3/С1" (20/4/2020), Тимофеева М.А., Дубинина Н.А. SPbU chỉ công bố TÊN 4 tham số, không công bố thang điểm chi tiết nội bộ giám khảo.',
        scoringMethod: 'parameter',
        parameters: parameterSet({
            intention: 'Умение реализовать коммуникативное намерение, соответствующее жанру (рекомендательное письмо, официальный документ и т. п.).',
            content: 'Полнота и точность содержания в соответствии с заданием.',
            composition: 'Ясная композиция и соответствие требуемой форме текста (письмо, заявление, жалоба).',
            language: 'Точность и уместность лексики, грамматики и стиля относительно норм современного русского языка.'
        })
    },
    {
        level: 'C1', trkiName: 'ТРКИ-3', sourceConfidence: 'средняя',
        source: 'ТРКИ-3/C1 — SPbU, webinar "Субтест «Письмо» ТРКИ-2/В2 — ТРКИ-3/С1. Практический аспект" (20/4/2020, slide 27-29), Дубинина Н.А. Đây là cấp độ đầu tiên xuất hiện dạng bài luận эссе-рассуждение.',
        scoringMethod: 'parameter',
        parameters: parameterSet({
            intention: 'Умение выразить отношение к проблеме и чётко обозначить собственную позицию.',
            content: 'Умение излагать и классифицировать информацию по заданию; выявлять и характеризовать проблему.',
            composition: 'Форма и структура текста (вступление — основная часть — заключение); использование средств внутренней связности.',
            language: 'Соответствие языковых средств нормам современного русского языка; уместный выбор лексики и грамматики.'
        }),
        essayRequirements: [
            'Xác định rõ vấn đề của đề bài là gì (в чём состоит проблема).',
            'Nêu nguyên nhân khách quan và chủ quan của vấn đề.',
            'Đề xuất hướng giải quyết vấn đề.',
            'Đánh giá mức độ xã hội đã nhận thức về vấn đề này.',
            'Đánh giá mức độ bản thân người viết tham gia giải quyết vấn đề.'
        ]
    },
    {
        level: 'C2', trkiName: 'ТРКИ-4', sourceConfidence: 'низкая',
        source: 'ТРКИ-4/C2 — Dubinina & Rakitina (SPbU) chỉ xác nhận: vẫn tổng 80 điểm, dùng chung cơ chế chấm theo tham số như B2/C1. KHÔNG có nguồn công khai xác nhận thang điểm chi tiết riêng cho C2 — tạm dùng chung bộ tham số với B2/C1, cần kiểm tra lại nếu có nguồn chính thức hơn.',
        scoringMethod: 'parameter',
        parameters: parameterSet({
            intention: 'Умение реализовать сложное, тонко нюансированное коммуникативное намерение на уровне свободного владения.',
            content: 'Глубина, точность и полнота содержания на академическом и профессиональном уровне.',
            composition: 'Строгая структура текста и связность высокой степени сложности.',
            language: 'Точность и тонкость языка на уровне, близком к образованному носителю.'
        })
    }
];

async function seed() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Đã kết nối MongoDB, bắt đầu seed...');

    await Topic.deleteMany({});
    await Topic.insertMany(topics);
    console.log(`✅ Đã thêm ${topics.length} chủ đề luyện viết.`);

    // CHÚ Ý: chỉ xoá các tài liệu dạng LINK NGOÀI. Sách PDF đã nạp bằng upload-books.js
    // (có fileSize > 0) phải được giữ nguyên, nếu không chạy seed lại sẽ mất hết sách.
    await Resource.deleteMany({ $or: [{ fileSize: { $exists: false } }, { fileSize: 0 }] });
    await Resource.insertMany(resources);
    console.log(`✅ Đã thêm ${resources.length} tài liệu dạng link (sách PDF trong DB được giữ nguyên).`);

    await Rubric.deleteMany({});
    await Rubric.insertMany(rubrics);
    console.log(`✅ Đã thêm rubric ТРКИ/TORFL thật cho ${rubrics.length} trình độ.`);

    console.log('🎉 Seed hoàn tất.');
    await mongoose.disconnect();
}

seed().catch(err => {
    console.error('❌ Lỗi khi seed:', err);
    process.exit(1);
});
