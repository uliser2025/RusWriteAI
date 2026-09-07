require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer'); // Khai báo thư viện gửi mail
const rateLimit = require('express-rate-limit'); // Chống brute-force đăng nhập/đăng ký

const app = express();
// Nền tảng hosting (Render, Railway...) tự cấp cổng qua biến môi trường PORT
// và không cho tự chọn cổng khác — giữ 5000 cứng sẽ khiến server không nhận
// được traffic khi deploy. Local dev không có PORT thì vẫn chạy ở 5000 như cũ.
const port = process.env.PORT || 5000;

// PDF.js cần đọc được các header Range khi tải sách từ origin khác (vd frontend chạy
// ở cổng khác), nếu không expose thì trình duyệt sẽ giấu header và sách không mở được.
app.use(cors({
    exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges', 'ETag']
}));
app.use(express.json());
app.use(express.static('./'));
// Danh sách 6 bậc theo Khung năng lực ngoại ngữ 6 bậc dùng cho Việt Nam,
// quy đổi tương đương sang CEFR. Từ bản refactor này, danh sách được lấy từ
// ai/levelProfiles.js — nơi duy nhất định nghĩa hành vi của AI theo trình độ,
// nên backend và AI không bao giờ lệch nhau về danh sách bậc.
const { LEVELS, LEVEL_CODES } = require('./ai/levelProfiles');

// 1. KẾT NỐI MONGODB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Kết nối MongoDB thành công!'))
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// CẤU HÌNH NODEMAILER GỬI EMAIL
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// HÀM XÁC THỰC CLOUDFLARE TURNSTILE
async function verifyTurnstile(token) {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${process.env.TURNSTILE_SECRET_KEY}&response=${token}`
    });
    const data = await res.json();
    return data.success;
}

// CHỐNG BRUTE-FORCE: giới hạn số lần thử đăng nhập/đăng ký theo IP
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 10, // tối đa 10 request/IP trong khoảng thời gian trên
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.' }
});

// 2. KHAI BÁO CẤU TRÚC DỮ LIỆU (MODELS)
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isVerified: { type: Boolean, default: false }, // Thêm trường xác thực email
    verificationToken: String, // Lưu token xác thực tạm thời
    level: { type: String, enum: [...LEVEL_CODES, null], default: null } // Trình độ mặc định của học viên
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const essaySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic', default: null },
    original_text: String,
    corrected_text: String,
    level: String,
    // Ngữ cảnh học tập tại thời điểm chấm — nhờ đó mở lại bài cũ vẫn thấy đúng
    // dàn ý và túi từ vựng mà bài đó được viết theo.
    outline: { type: Object, default: null },
    vocabulary: { type: Array, default: [] },
    feedback: Object
}, { timestamps: true });
const Essay = mongoose.model('Essay', essaySchema);

// Ngân hàng chủ đề luyện viết
const topicSchema = new mongoose.Schema({
    title: { type: String, required: true },
    prompt_text: { type: String, required: true },
    level: { type: String, enum: LEVEL_CODES, required: true },
    category: { type: String, default: 'Разное' }
}, { timestamps: true });
const Topic = mongoose.model('Topic', topicSchema);

// Thư viện tài liệu học tập (sách, tài liệu ngữ pháp, bài mẫu...)
// Từ phiên bản này, sách PDF được lưu TRỰC TIẾP trong MongoDB dưới dạng BSON Binary
// (mỗi file < 16 MiB nên chưa cần GridFS). Trường fileUrl vẫn giữ lại để tương thích
// ngược với các tài liệu cũ chỉ là đường link ngoài.
const resourceSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: '' },
    level: { type: String, enum: [...LEVEL_CODES, 'all'], default: 'all' },
    category: { type: String, default: 'Разное' },
    fileUrl: { type: String, default: '' },            // chỉ dùng cho tài liệu dạng link ngoài
    fileType: { type: String, default: 'link' },       // pdf | docx | link
    // --- Sách PDF lưu trong DB ---
    fileName: { type: String, default: '' },           // tên file gốc, dùng cho Content-Disposition
    fileData: { type: Buffer, select: false },         // KHÔNG bao giờ trả kèm trong truy vấn thường
    fileSize: { type: Number, default: 0 },            // byte — dùng để biết sách có sẵn file hay không
    pageCount: { type: Number, default: 0 },           // số trang, hiển thị trên bìa sách
    author: { type: String, default: '' },             // tác giả / nguồn, hiển thị dưới tên sách
    accentColor: { type: String, default: '' },        // màu gáy sách, để trống thì sinh tự động
    featured: { type: Boolean, default: false }        // sách nổi bật, đặt lên đầu thư viện
}, { timestamps: true });
const Resource = mongoose.model('Resource', resourceSchema);

// Rubric chấm điểm theo chuẩn ТРКИ/TORFL cho từng trình độ (dữ liệu thật nạp qua seed.js)
// Hai cơ chế chấm khác nhau theo đúng tài liệu tổng hợp ТРКИ:
//   - 'deduction' (A1, A2, B1): trừ điểm trực tiếp trên thang totalScore, mỗi lỗi КЗО/КНЗО trừ 1 mức cố định.
//   - 'parameter' (B2, C1, C2): chấm theo 4 tham số, mỗi tham số thang 0-5, có lỗi КЗО thì tham số liên quan bị giới hạn điểm tối đa.
const rubricSchema = new mongoose.Schema({
    level: { type: String, enum: LEVEL_CODES, required: true, unique: true },
    trkiName: String, // Vd: 'ТЭУ', 'ТБУ', 'ТРКИ-1', 'ТРКИ-2', 'ТРКИ-3', 'ТРКИ-4'
    source: String, // Trích dẫn nguồn để minh bạch, giữ nguyên theo tài liệu tổng hợp
    sourceConfidence: { type: String, enum: ['Thấp', 'Trung bình', 'Cao nhất'], default: 'Trung bình' },
    scoringMethod: { type: String, enum: ['deduction', 'parameter'], required: true },
    totalScore: { type: Number, default: 80 },
    // Dùng khi scoringMethod = 'deduction'
    deductionRules: {
        kzoPenalty: { type: Number, default: 2 },      // trừ điểm mỗi lỗi КЗО
        knzoPenalty: { type: Number, default: 0.5 },   // trừ điểm mỗi lỗi КНЗО
        invalidationThreshold: { type: Number, default: null }, // vượt quá => bài không được công nhận (chỉ xác nhận có ở B1)
        bonusRules: { maxBonus: Number, description: String }, // chỉ có ở B1
        taskCriteria: [String] // các quy tắc trừ/thưởng điểm bổ sung, hiển thị cho AI tham khảo
    },
    // Dùng khi scoringMethod = 'parameter'
    parameters: [{
        name: String,           // Интенция / Содержание / Композиция / Языковые средства
        maxScore: { type: Number, default: 5 },
        description: String,
        kzoCapsAt: { type: Number, default: null } // nếu có lỗi КЗО liên quan, điểm tối đa của tham số này (chỉ áp cho "Языковые средства")
    }],
    essayRequirements: [String] // riêng ТРКИ-3/C1 (và tạm áp dụng cho C2): các ý bắt buộc của bài эссе nghị luận
});
const Rubric = mongoose.model('Rubric', rubricSchema);

// 3. MIDDLEWARE: KIỂM TRA ĐĂNG NHẬP (Xác thực JWT)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Vui lòng đăng nhập.' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token không hợp lệ hoặc đã hết hạn.' });
        req.user = user;
        next();
    });
};

// 4. API ĐĂNG KÝ (REGISTER) - Có xác thực Captcha, validate mật khẩu và Gửi mail
app.post('/api/register', authLimiter, async (req, res) => {
    try {
        const { email, password, captchaToken } = req.body;
        if (!email || !password || !captchaToken) return res.status(400).json({ error: 'Vui lòng điền đủ thông tin và xác nhận Captcha.' });

        // 4.1 Validate độ dài mật khẩu tối thiểu
        if (password.length < 8) return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 8 ký tự.' });

        // 4.2 Kiểm tra Captcha
        const isCaptchaValid = await verifyTurnstile(captchaToken);
        if (!isCaptchaValid) return res.status(400).json({ error: 'Xác thực Captcha thất bại. Vui lòng thử lại.' });

        // 4.3 Kiểm tra Email tồn tại
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: 'Email này đã được đăng ký.' });

        // 4.4 Mã hóa mật khẩu và tạo token xác thực
        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationToken = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // 4.5 Lưu user vào database với trạng thái chưa xác thực
        const newUser = new User({ email, password: hashedPassword, verificationToken });
        await newUser.save();

        // 4.6 Gửi email xác nhận
        const verifyLink = `${process.env.BASE_URL}/api/verify?token=${verificationToken}`;
        await transporter.sendMail({
            from: `"RusWrite AI" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Xác nhận đăng ký tài khoản RusWrite AI',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Chào mừng bạn đến với RusWrite AI! 🎓</h2>
                    <p>Vui lòng nhấp vào nút bên dưới để kích hoạt tài khoản của bạn:</p>
                    <a href="${verifyLink}" style="display: inline-block; padding: 10px 20px; background-color: #B3122B; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Xác thực Email</a>
                    <p style="margin-top: 20px; font-size: 12px; color: #666;">Link này sẽ hết hạn trong 1 giờ. Nếu bạn không đăng ký tài khoản này, vui lòng bỏ qua email.</p>
                </div>
            `
        });

        res.status(201).json({ message: 'Đăng ký thành công! Vui lòng kiểm tra email để xác nhận.' });
    } catch (error) {
        console.error("Lỗi đăng ký:", error);
        res.status(500).json({ error: 'Lỗi server khi đăng ký.' });
    }
});

// API XÁC THỰC EMAIL (KHI NGƯỜI DÙNG CLICK VÀO LINK)
app.get('/api/verify', async (req, res) => {
    try {
        const { token } = req.query;
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findOne({ email: decoded.email, verificationToken: token });
        if (!user) return res.status(400).send('<h3>❌ Link xác thực không hợp lệ hoặc tài khoản đã được xác thực trước đó.</h3>');

        user.isVerified = true;
        user.verificationToken = null;
        await user.save();

        res.send(`
            <div style="text-align: center; font-family: sans-serif; padding: 50px;">
                <h2 style="color: #16a34a;">✅ Xác thực thành công!</h2>
                <p>Tài khoản của bạn đã được kích hoạt. Bạn có thể đóng trang này và đăng nhập vào RusWrite AI.</p>
            </div>
        `);
    } catch (error) {
        res.status(400).send('<h3>❌ Link xác thực đã hết hạn. Vui lòng đăng ký lại.</h3>');
    }
});

// 5. API ĐĂNG NHẬP (LOGIN) - Yêu cầu isVerified và Captcha
app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const { email, password, captchaToken } = req.body;

        // 5.1 Kiểm tra Captcha
        if (!captchaToken) return res.status(400).json({ error: 'Vui lòng xác nhận Captcha.' });
        const isCaptchaValid = await verifyTurnstile(captchaToken);
        if (!isCaptchaValid) return res.status(400).json({ error: 'Xác thực Captcha thất bại.' });

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: 'Email không tồn tại.' });

        // 5.2 CHẶN NẾU CHƯA XÁC THỰC EMAIL
        if (!user.isVerified) return res.status(403).json({ error: 'Tài khoản chưa kích hoạt. Vui lòng kiểm tra email để xác thực.' });

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'Mật khẩu không đúng.' });

        const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.json({ message: 'Đăng nhập thành công', token, user: { id: user._id, email: user.email, level: user.level } });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server khi đăng nhập.' });
    }
});

// API CẬP NHẬT TRÌNH ĐỘ MẶC ĐỊNH CỦA HỌC VIÊN
app.put('/api/user/level', authenticateToken, async (req, res) => {
    try {
        const { level } = req.body;
        if (!LEVEL_CODES.includes(level)) return res.status(400).json({ error: 'Trình độ không hợp lệ.' });

        const user = await User.findByIdAndUpdate(req.user.id, { level }, { new: true });
        res.json({ message: 'Đã lưu trình độ.', user: { id: user._id, email: user.email, level: user.level } });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server khi cập nhật trình độ.' });
    }
});

// ==========================================================================
// HỆ THỐNG AI — MỘT PIPELINE HỌC TẬP LIÊN KẾT
//
//   TRÌNH ĐỘ → ĐỀ BÀI → DÀN Ý → TỪ VỰNG/NGỮ PHÁP → BÀI VIẾT
//            → PHÂN TÍCH → SỬA LỖI → NHẬN XÉT → BƯỚC TIẾP THEO
//
// Toàn bộ lời gọi OpenAI đi qua ai/openaiClient.js (một chỗ duy nhất đọc
// process.env.OPENAI_MODEL). Prompt được lắp từ ai/prompts.js theo trình độ.
// Output bị ràng buộc bởi JSON Schema và được validate lại ở ai/schemas.js.
//
// Nguyên tắc chấm điểm GIỮ NGUYÊN như trước: AI chỉ làm việc ĐỊNH TÍNH
// (phân loại КЗО/КНЗО, chấm thô từng tham số 0-5); MỌI PHÉP TÍNH do backend
// làm bằng JS để AI không cộng trừ sai.
// ==========================================================================

const { callJSON, MODEL } = require('./ai/openaiClient');
const { getProfile } = require('./ai/levelProfiles');
const { buildOutlinePrompt, buildCorrectPrompt, buildVocabDetailPrompt } = require('./ai/prompts');
const {
    OUTLINE_SCHEMA, validateOutline,
    CORRECT_SCHEMA, validateCorrection,
    VOCAB_DETAIL_SCHEMA, validateVocabDetail
} = require('./ai/schemas');
// Tính điểm ТРКИ tách riêng sang ai/scoring.js để kiểm thử được mà không cần DB.
const { computeFinalScoring } = require('./ai/scoring');

console.log(`🧠 Model AI đang dùng: ${MODEL} (đổi bằng biến môi trường OPENAI_MODEL)`);

// --------------------------------------------------------------------------
// CACHE CHI TIẾT TỪ VỰNG (mục 23 & 24 — không gọi AI thừa)
// Cùng một term + level + topic thì chỉ tốn tiền AI đúng một lần.
// --------------------------------------------------------------------------
const vocabDetailSchema = new mongoose.Schema({
    cacheKey: { type: String, required: true, unique: true, index: true },
    term: String,
    level: String,
    topicKey: String,
    detail: Object,
    hits: { type: Number, default: 0 }
}, { timestamps: true });
const VocabDetail = mongoose.model('VocabDetail', vocabDetailSchema);

function normalizeTerm(s) {
    return String(s || '').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}
function topicKeyOf(topic) {
    return normalizeTerm((topic && (topic.title || topic.prompt)) || 'general').slice(0, 80);
}

// --------------------------------------------------------------------------
// DỰNG LEARNING CONTEXT (mục 12)
// Gom trình độ + đề bài + dàn ý + túi từ vựng + bài viết thành một khối duy nhất
// để mọi bước AI cùng nhìn thấy một sự thật.
// --------------------------------------------------------------------------
async function buildLearningContext({ level, topicId, topic, outline, vocabulary, essayText }) {
    const profile = getProfile(level);
    const rubric = await Rubric.findOne({ level });

    // Đề bài: ưu tiên topic thật trong DB, sau đó mới đến đề tự nhập
    let topicObj = null;
    if (topicId) {
        const t = await Topic.findById(topicId).lean().catch(() => null);
        if (t) topicObj = { id: String(t._id), title: t.title, prompt: t.prompt_text };
    }
    if (!topicObj && topic) {
        topicObj = typeof topic === 'string'
            ? { id: null, title: '', prompt: topic }
            : { id: null, title: topic.title || '', prompt: topic.prompt || topic.prompt_text || '' };
    }

    // Túi từ vựng: lấy từ tham số, nếu không có thì lấy từ chính dàn ý
    let vocab = Array.isArray(vocabulary) ? vocabulary : [];
    if (!vocab.length && outline && Array.isArray(outline.vocabulary)) vocab = outline.vocabulary;

    return {
        level,
        levelDescription: profile.description_ru,
        levelDescriptionVi: profile.description_vi,
        rubric,
        topic: topicObj,
        outline: outline && outline.outline ? outline : null,
        vocabulary: vocab,
        essay: { originalText: essayText || '' }
    };
}

// Trả lỗi cho frontend một cách rõ ràng, không để frontend tự đoán (mục 17)
function sendAiError(res, error, what) {
    if (error && error.message === 'AI_OUTPUT_INVALID') {
        console.error(`❌ ${what}: AI trả sai schema sau nhiều lần thử →`, error.problems);
        return res.status(502).json({
            error: `Мишка trả lời chưa đúng định dạng nên mình không dám hiển thị. Bạn thử lại giúp mình nhé.`,
            details: error.problems
        });
    }
    console.error(`❌ ${what}:`, error);
    return res.status(500).json({ error: 'Lỗi máy chủ nội bộ.' });
}

// ==========================================================================
// 6. API DÀN Ý + TÚI TỪ VỰNG + NGỮ PHÁP  (một lần gọi AI duy nhất — mục 24)
// ==========================================================================
app.post('/api/outline', authenticateToken, async (req, res) => {
    try {
        const { topic, level, topicId } = req.body;
        if (!topic || !level) return res.status(400).json({ error: 'Thiếu đề bài hoặc trình độ.' });
        if (!LEVEL_CODES.includes(level)) return res.status(400).json({ error: 'Trình độ không hợp lệ.' });

        const ctx = await buildLearningContext({ level, topicId, topic });
        const profile = getProfile(level);

        console.log(`⏳ Dựng dàn ý ${level} (${profile.trki}) cho đề: ${String(ctx.topic?.prompt || '').slice(0, 60)}…`);

        const { data } = await callJSON({
            system: buildOutlinePrompt({ level, topic: ctx.topic }),
            user: `Тема сочинения: ${ctx.topic.prompt}${ctx.topic.title ? `\n(рабочее название: ${ctx.topic.title})` : ''}`,
            jsonSchema: OUTLINE_SCHEMA,
            schemaName: `outline_${level}`,
            validate: validateOutline(level)
        });

        res.json({
            level,
            level_description_ru: profile.description_ru,
            level_description_vi: profile.description_vi,
            trki_name: profile.trki,
            topic: ctx.topic,
            topic_restated_ru: data.topic_restated_ru,
            outline: data.outline,
            speech_patterns: data.speech_patterns || [],
            vocabulary: data.vocabulary || [],
            grammar: data.grammar || [],
            writing_tips_ru: data.writing_tips_ru || [],
            target_length_ru: data.target_length_ru || ''
        });
    } catch (error) {
        sendAiError(res, error, 'Gợi ý dàn bài');
    }
});

// ==========================================================================
// 6b. API CHẤM BÀI — nhận cả learningContext mà frontend đang giữ
// ==========================================================================
app.post('/api/correct', authenticateToken, async (req, res) => {
    try {
        const { text, level, topicId, topic, outline, vocabulary } = req.body;
        if (!text || !level) return res.status(400).json({ error: 'Thiếu bài viết hoặc trình độ.' });
        if (!LEVEL_CODES.includes(level)) return res.status(400).json({ error: 'Trình độ không hợp lệ.' });

        const ctx = await buildLearningContext({ level, topicId, topic, outline, vocabulary, essayText: text });
        const profile = getProfile(level);

        console.log(`⏳ Chấm bài ${level} (${ctx.rubric ? ctx.rubric.trkiName : 'không có rubric'})` +
            `${ctx.outline ? ' · có dàn ý' : ' · không có dàn ý'}` +
            `${ctx.vocabulary.length ? ` · ${ctx.vocabulary.length} từ trong túi` : ''}…`);

        const { data } = await callJSON({
            system: buildCorrectPrompt({
                level,
                rubric: ctx.rubric,
                topic: ctx.topic,
                outline: ctx.outline,
                vocabulary: ctx.vocabulary
            }),
            user: `Текст студента (проверь его дословно, ничего не додумывая):\n\n${text}`,
            jsonSchema: CORRECT_SCHEMA,
            schemaName: `correct_${level}`,
            validate: validateCorrection(level, ctx.rubric, {
                essayText: text,
                hasOutline: !!ctx.outline,
                vocabTerms: ctx.vocabulary.map(v => v.term)
            })
        });

        const finalScoring = computeFinalScoring(ctx.rubric, data);

        const result = {
            level,
            level_description_ru: profile.description_ru,
            trki_name: ctx.rubric ? ctx.rubric.trkiName : null,
            corrected_text: data.corrected_text,
            errors: data.errors || [],
            upgrades: data.upgrades || [],
            overall_feedback_ru: data.overall_feedback_ru || '',
            main_problem_ru: data.main_problem_ru || '',
            strengths_ru: data.strengths_ru || [],
            weaknesses_ru: data.weaknesses_ru || [],
            next_steps_ru: data.next_steps_ru || [],
            vocabulary_to_improve_ru: data.vocabulary_to_improve_ru || [],
            grammar_to_improve_ru: data.grammar_to_improve_ru || [],
            recommended_vocabulary: data.recommended_vocabulary || [],
            outline_coverage: data.outline_coverage || [],
            vocabulary_usage: data.vocabulary_usage || [],
            level_position_ru: data.level_position_ru || '',
            essay_requirements_check: (data.essay_requirements_check || []).map(r => ({
                requirement: r.requirement,
                addressed: r.addressed,
                note: r.note_ru || ''
            })),
            scoring: finalScoring
        };

        const newEssay = new Essay({
            userId: req.user.id,
            topicId: (ctx.topic && ctx.topic.id) || topicId || null,
            original_text: text,
            corrected_text: result.corrected_text,
            level,
            outline: ctx.outline || null,
            vocabulary: ctx.vocabulary || [],
            feedback: result
        });
        await newEssay.save();

        res.json(result);
    } catch (error) {
        sendAiError(res, error, 'Chấm bài');
    }
});

// ==========================================================================
// 6c. API CHI TIẾT MỘT TỪ TRONG TÚI TỪ VỰNG (chỉ gọi khi người dùng bấm vào từ)
// ==========================================================================
app.post('/api/vocabulary/detail', authenticateToken, async (req, res) => {
    try {
        const { term, level, topic, topicId, essay, context } = req.body;
        if (!term || !level) return res.status(400).json({ error: 'Thiếu từ hoặc trình độ.' });
        if (!LEVEL_CODES.includes(level)) return res.status(400).json({ error: 'Trình độ không hợp lệ.' });

        const ctx = await buildLearningContext({ level, topicId, topic });
        const cacheKey = `${normalizeTerm(term)}|${level}|${topicKeyOf(ctx.topic)}`;

        // 1) Đã có trong cache thì trả luôn, không tốn một đồng nào
        const cached = await VocabDetail.findOne({ cacheKey });
        if (cached) {
            cached.hits += 1;
            cached.save().catch(() => { });
            return res.json({ ...cached.detail, _cached: true });
        }

        console.log(`⏳ Soạn thẻ từ vựng "${term}" cho trình độ ${level}…`);

        const { data } = await callJSON({
            system: buildVocabDetailPrompt({ level, topic: ctx.topic, term, essay, context }),
            user: `Единица для карточки: ${term}`,
            jsonSchema: VOCAB_DETAIL_SCHEMA,
            schemaName: `vocab_${level}`,
            validate: validateVocabDetail(level)
        });

        const detail = { ...data, level, topic_title: ctx.topic ? ctx.topic.title : '' };
        // Cache theo (từ + trình độ + đề bài): cùng từ ở B1 và C1 vẫn là hai thẻ khác nhau
        await VocabDetail.findOneAndUpdate(
            { cacheKey },
            { cacheKey, term, level, topicKey: topicKeyOf(ctx.topic), detail },
            { upsert: true, setDefaultsOnInsert: true }
        ).catch(() => { });

        res.json({ ...detail, _cached: false });
    } catch (error) {
        sendAiError(res, error, 'Chi tiết từ vựng');
    }
});

// 7. API LẤY LỊCH SỬ BÀI VIẾT
app.get('/api/history', authenticateToken, async (req, res) => {
    try {
        const history = await Essay.find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .select('original_text createdAt level topicId');
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi khi tải lịch sử.' });
    }
});

// 8. API LẤY CHI TIẾT MỘT BÀI VIẾT
app.get('/api/essay/:id', authenticateToken, async (req, res) => {
    try {
        const essay = await Essay.findOne({ _id: req.params.id, userId: req.user.id });
        if (!essay) return res.status(404).json({ error: 'Không tìm thấy bài viết.' });
        res.json(essay);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server khi lấy bài viết.' });
    }
});

// 9. API NGÂN HÀNG CHỦ ĐỀ LUYỆN VIẾT (không cần đăng nhập để xem)
app.get('/api/topics', async (req, res) => {
    try {
        const filter = {};
        if (req.query.level) filter.level = req.query.level;
        if (req.query.category) filter.category = req.query.category;
        const topics = await Topic.find(filter).sort({ createdAt: -1 });
        res.json(topics);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi khi tải danh sách chủ đề.' });
    }
});

app.get('/api/topics/:id', async (req, res) => {
    try {
        const topic = await Topic.findById(req.params.id);
        if (!topic) return res.status(404).json({ error: 'Không tìm thấy chủ đề.' });
        res.json(topic);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server.' });
    }
});

// 10. API THƯ VIỆN TÀI LIỆU (không cần đăng nhập để xem)
// Không bao giờ trả fileData ở đây — schema đã đặt select:false, nên payload luôn nhẹ.
app.get('/api/resources', async (req, res) => {
    try {
        const filter = {};
        if (req.query.level) filter.level = { $in: [req.query.level, 'all'] };
        if (req.query.category) filter.category = req.query.category;
        const resources = await Resource.find(filter)
            .sort({ featured: -1, createdAt: -1 })
            .lean();
        // hasFile cho frontend biết nên hiện nút "Đọc sách" hay "Mở liên kết"
        res.json(resources.map(r => ({ ...r, hasFile: !!r.fileSize })));
    } catch (error) {
        res.status(500).json({ error: 'Lỗi khi tải thư viện tài liệu.' });
    }
});

// 10b. API LẤY METADATA MỘT TÀI LIỆU
app.get('/api/resources/:id', async (req, res) => {
    try {
        const r = await Resource.findById(req.params.id).lean();
        if (!r) return res.status(404).json({ error: 'Không tìm thấy tài liệu.' });
        res.json({ ...r, hasFile: !!r.fileSize });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server.' });
    }
});

// 10c. API TRẢ FILE PDF BINARY TRỰC TIẾP TỪ MONGODB
// Trả đúng Content-Type: application/pdf (KHÔNG bọc JSON, KHÔNG Base64) để PDF.js
// đọc thẳng. Có hỗ trợ HTTP Range để PDF.js tải từng phần khi cần.
//
// MUỐN CHỈ CHO NGƯỜI ĐÃ ĐĂNG NHẬP ĐỌC SÁCH?
// Thêm authenticateToken vào route: app.get('/api/resources/:id/pdf', authenticateToken, ...)
// Khi đó frontend phải gửi kèm token, sửa lời gọi trong index.html thành:
//   pdfjsLib.getDocument({ url: ..., httpHeaders: { Authorization: 'Bearer ' + getAuthToken() } })
app.get('/api/resources/:id/pdf', async (req, res) => {
    try {
        const doc = await Resource.findById(req.params.id).select('+fileData');
        if (!doc || !doc.fileData || !doc.fileData.length) {
            return res.status(404).json({ error: 'Tài liệu này không có file PDF trong hệ thống.' });
        }

        const buf = doc.fileData;
        const total = buf.length;
        const fileName = encodeURIComponent(doc.fileName || `${doc.title || 'tai-lieu'}.pdf`);
        const etag = `"${doc._id}-${new Date(doc.updatedAt || 0).getTime()}"`;

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename*=UTF-8''${fileName}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, max-age=86400',
            'ETag': etag
        });

        // Trình duyệt đã có bản mới nhất trong cache
        if (req.headers['if-none-match'] === etag) return res.status(304).end();

        // Yêu cầu tải một phần (Range) — PDF.js dùng để mở nhanh sách nhiều trang
        const range = req.headers.range;
        if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range);
            if (m) {
                let start = m[1] ? parseInt(m[1], 10) : 0;
                let end = m[2] ? parseInt(m[2], 10) : total - 1;
                if (isNaN(start) || start < 0) start = 0;
                if (isNaN(end) || end >= total) end = total - 1;
                if (start > end) {
                    res.set('Content-Range', `bytes */${total}`);
                    return res.status(416).end();
                }
                res.status(206).set({
                    'Content-Range': `bytes ${start}-${end}/${total}`,
                    'Content-Length': end - start + 1
                });
                return res.end(buf.subarray(start, end + 1));
            }
        }

        res.set('Content-Length', total).end(buf);
    } catch (error) {
        console.error('❌ Lỗi khi trả file PDF:', error);
        res.status(500).json({ error: 'Lỗi server khi mở tài liệu.' });
    }
});

// 11. API LẤY RUBRIC THEO TRÌNH ĐỘ (để hiển thị minh bạch tiêu chí chấm điểm)
app.get('/api/rubric/:level', async (req, res) => {
    try {
        const rubric = await Rubric.findOne({ level: req.params.level });
        if (!rubric) return res.status(404).json({ error: 'Chưa có rubric cho trình độ này.' });
        res.json(rubric);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server.' });
    }
});

app.get('/api/levels', (req, res) => res.json(LEVELS));

app.listen(port, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${port}`);
});
