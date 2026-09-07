// ==========================================================================
// test-ai-live.js — chạy: node test-ai-live.js
//
// Test THẬT: gọi OPENAI_MODEL, đọc rubric thật trong MongoDB, chạy đủ chuỗi
//   dàn ý → túi từ vựng → chi tiết một từ → chấm bài → nhận xét
// cho A1, B1, C1, rồi tự kiểm tra 10 tiêu chí A–J.
//
// Không đi qua HTTP/JWT nên không cần đăng nhập; nó gọi thẳng cùng các module
// mà server.js dùng, nên nếu test này đạt thì API cũng đạt.
//
// CẦN: .env có OPENAI_API_KEY, OPENAI_MODEL, MONGO_URI (để lấy rubric).
// Tốn khoảng 5 lần gọi model.
// ==========================================================================

require('dotenv').config();
const mongoose = require('mongoose');
const { callJSON, MODEL } = require('./ai/openaiClient');
const { getProfile, LEVEL_CODES } = require('./ai/levelProfiles');
const { buildOutlinePrompt, buildCorrectPrompt, buildVocabDetailPrompt } = require('./ai/prompts');
const {
    OUTLINE_SCHEMA, validateOutline,
    CORRECT_SCHEMA, validateCorrection,
    VOCAB_DETAIL_SCHEMA, validateVocabDetail,
    isRussian
} = require('./ai/schemas');
const { computeFinalScoring } = require('./ai/scoring');

const rubricSchema = new mongoose.Schema({}, { strict: false, collection: 'rubrics' });
const Rubric = mongoose.model('RubricTest', rubricSchema);

// --------------------------------------------------------------------------
// BÀI TEST CHÍNH — B1, đề "Защита окружающей среды"
// Bài luận cố tình mắc những lỗi điển hình của người Việt học tiếng Nga:
// sai cách sau động từ chuyển tiếp, sai giống, thiếu giới từ, dùng khẩu ngữ.
// 👉 Bạn có thể thay bằng đúng bài bạn đã dùng để test trước đây.
// --------------------------------------------------------------------------
const B1_ESSAY = `Сегодня защищать окружающая среда очень важная проблема.
В моём городе много мусора на улице и воздух очень грязный.
Заводы делают дым, и люди болеют. Я думаю, что государство должен принимать законы.
Обычные люди тоже может помогать: не бросать мусор, экономить вода.
Я каждый день ходить пешком в университет, потому что это полезно для природа.
Я считаю, что если все люди будут делать маленькие дела, наш город будет чистый.`;

const TOPIC_B1 = {
    title: 'Bảo vệ môi trường',
    prompt: 'Защита окружающей среды: какие меры должны принимать правительства и обычные люди?'
};

const CASES = [
    { level: 'A1', topic: { title: 'Gia đình của tôi', prompt: 'Опишите свою семью: сколько человек в вашей семье, кто они и чем занимаются.' }, essay: 'Меня зовут Ань. Я живу в Ханой с мой мама и папа. Мой папа работает в школа. Я люблю читать книга.' },
    { level: 'B1', topic: TOPIC_B1, essay: B1_ESSAY },
    {
        level: 'C1',
        topic: { title: 'Toàn cầu hóa và bản sắc văn hóa', prompt: 'Глобализация угрожает культурной самобытности народов или обогащает её? Аргументируйте свою позицию.' },
        // Bài luận CỐ TÌNH gài 2 lỗi tinh tế đúng kiểu C1 — không phải lỗi ngữ pháp thô như A1/B1,
        // mà là lỗi mà chỉ trình độ cao mới mắc: dịch sát (calque) và sai chi phối động từ.
        // Bài luận trước đây "quá sạch" nên tiêu chí E (phát hiện lỗi thật) trở nên vô nghĩa —
        // model đúng khi báo 0 lỗi, chỉ là bài test không kiểm tra được gì.
        essay: `Глобализация сегодня является процессом, который затрагивает все страны и делает большое влияние на культуру.
С одной стороны, она даёт возможность узнавать другие культуры и обогащает наш кругозор.
Но с другой стороны, многие традиции постепенно исчезают, потому что молодёжь всё больше предпочитает массовую культуру, чем свою собственную.
Я думаю, что нужно сохранять баланс между открытостью и традицией, иначе через несколько поколений национальная идентичность может ослабеть.`
    }
];

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`   ✅ ${name}`); }
    else { fail++; console.log(`   ❌ ${name}${extra ? `\n        → ${String(extra).slice(0, 300)}` : ''}`); }
}

async function runCase({ level, topic, essay }) {
    console.log(`\n${'='.repeat(72)}\nTRÌNH ĐỘ ${level} — ${topic.title}\n${'='.repeat(72)}`);
    const profile = getProfile(level);
    const rubric = await Rubric.findOne({ level }).lean();

    // ---------- BƯỚC 1: DÀN Ý + TÚI TỪ VỰNG ----------
    console.log('\n▸ Bước 1: xin dàn ý…');
    const { data: outline } = await callJSON({
        system: buildOutlinePrompt({ level, topic }),
        user: `Тема сочинения: ${topic.prompt}`,
        jsonSchema: OUTLINE_SCHEMA, schemaName: `outline_${level}`,
        validate: validateOutline(level)
    });

    const allPoints = [
        ...outline.outline.introduction,
        ...outline.outline.body.flatMap(b => [b.heading_ru, ...b.points]),
        ...outline.outline.conclusion
    ];
    console.log('  Введение: ' + outline.outline.introduction.join(' / '));
    outline.outline.body.forEach((b, i) => console.log(`  ${i + 1}. ${b.heading_ru}\n     - ${b.points.join('\n     - ')}`));
    console.log('  Заключение: ' + outline.outline.conclusion.join(' / '));
    console.log('  Từ vựng: ' + outline.vocabulary.map(v => `${v.term} [${v.difficulty}]`).join(', '));

    check('A. Dàn ý bằng tiếng Nga', allPoints.every(isRussian));
    // Ngưỡng "đủ chi tiết" phải theo đúng phong cách của từng bậc: A1/A2 quy định
    // cụm 2–5 từ (levelProfiles.js), B1 trở lên mới cần cụm ý trọn vẹn hơn.
    // Trước đây bài test này đòi ≥3 từ cho MỌI bậc — tự nó sai, không phải lỗi AI.
    const minWords = ['A1', 'A2'].includes(level) ? 2 : 3;
    check(`B. Dàn ý đủ chi tiết (mỗi ý ≥${minWords} từ, đúng phong cách ${level})`,
        outline.outline.body.every(b => b.points.every(p => p.trim().split(/\s+/).length >= minWords)),
        outline.outline.body.flatMap(b => b.points).find(p => p.trim().split(/\s+/).length < minWords));
    check(`B'. Số phần thân bài hợp với ${level} (mong đợi ~${profile.outline.bodySections})`,
        Math.abs(outline.outline.body.length - profile.outline.bodySections) <= 1,
        `thực tế: ${outline.outline.body.length}`);
    check('C. Từ vựng đúng khung trình độ',
        outline.vocabulary.every(v => profile.vocabulary.allowedDifficulty.includes(v.difficulty)),
        outline.vocabulary.map(v => v.difficulty).join(','));
    check('C\'. Mỗi từ đều nêu được vì sao cần cho bài này',
        outline.vocabulary.every(v => isRussian(v.relevance_ru) && v.relevance_ru.length > 20));

    // ---------- BƯỚC 2: CHI TIẾT MỘT TỪ ----------
    const term = outline.vocabulary[0].term;
    console.log(`\n▸ Bước 2: mở chi tiết từ "${term}"…`);
    const { data: detail } = await callJSON({
        system: buildVocabDetailPrompt({ level, topic, term, essay, context: outline.vocabulary[0].relevance_ru }),
        user: `Единица для карточки: ${term}`,
        jsonSchema: VOCAB_DETAIL_SCHEMA, schemaName: `vocab_${level}`,
        validate: validateVocabDetail(level)
    });
    console.log(`  ${detail.pronunciation} · ${detail.part_of_speech_ru} · ${detail.cefr} · ${detail.register_ru}`);
    console.log(`  Значение: ${detail.meaning_ru}`);
    console.log(`  Сочетаемость: ${detail.collocations.map(c => c.phrase_ru).join('; ')}`);
    console.log(`  Пример: ${detail.examples[0].ru}`);

    check('D. Thẻ từ vựng có phát âm/trọng âm', /[\u0301]/.test(detail.pronunciation) || detail.pronunciation.includes('ё'),
        detail.pronunciation);
    check('D\'. Có từ loại, nghĩa, cách dùng, collocation, ví dụ, CEFR',
        !!detail.part_of_speech_ru && !!detail.meaning_ru && !!detail.usage_ru
        && detail.collocations.length >= 2 && detail.examples.length >= 2 && !!detail.cefr);
    check('D\'\'. Giải thích gắn với chính bài đang viết', isRussian(detail.why_relevant_ru) && detail.why_relevant_ru.length > 25);

    // ---------- BƯỚC 3: CHẤM BÀI (có ngữ cảnh dàn ý + từ vựng) ----------
    console.log('\n▸ Bước 3: chấm bài (kèm dàn ý và túi từ vựng)…');
    const { data: corr } = await callJSON({
        system: buildCorrectPrompt({ level, rubric, topic, outline, vocabulary: outline.vocabulary }),
        user: `Текст студента (проверь его дословно, ничего не додумывая):\n\n${essay}`,
        jsonSchema: CORRECT_SCHEMA, schemaName: `correct_${level}`,
        validate: validateCorrection(level, rubric, {
            essayText: essay, hasOutline: true, vocabTerms: outline.vocabulary.map(v => v.term)
        })
    });
    const scoring = computeFinalScoring(rubric, corr);

    console.log(`  Lỗi thật: ${corr.errors.length} (КЗО ${corr.errors.filter(e => e.error_class === 'КЗО').length}) · Gợi ý nâng cấp: ${corr.upgrades.length}`);
    corr.errors.slice(0, 3).forEach(e => console.log(`   • ${e.original} → ${e.correction} [${e.error_class}] ${e.explanation_ru.slice(0, 110)}…`));
    console.log(`  Отзыв: ${corr.overall_feedback_ru.slice(0, 220)}…`);
    console.log(`  Уровень: ${corr.level_position_ru}`);
    console.log(`  Điểm: ${JSON.stringify(scoring.method === 'deduction' ? { final: scoring.final_score, of: scoring.total_score, valid: scoring.is_valid } : { earned: scoring.total_score_earned, of: scoring.total_score_max })}`);

    check('E. Phát hiện được lỗi thật trong bài', corr.errors.length > 0);
    check('E\'. Mọi trích dẫn lỗi đều có thật trong bài',
        corr.errors.every(e => essay.replace(/\s+/g, ' ').includes(e.original.trim().replace(/\s+/g, ' '))),
        corr.errors.map(e => e.original).join(' | '));
    check('F. Giải thích lỗi bằng tiếng Nga và đủ sâu',
        corr.errors.every(e => isRussian(e.explanation_ru) && e.explanation_ru.length >= (profile.needViGloss ? 45 : 70)));
    check('F\'. Rule tip bằng tiếng Nga', corr.errors.every(e => isRussian(e.rule_tip_ru)));
    check('G. Overall feedback bằng tiếng Nga', isRussian(corr.overall_feedback_ru) && corr.overall_feedback_ru.length > 100);
    check('H. Feedback tham chiếu đúng nội dung bài (có đối chiếu dàn ý)',
        corr.outline_coverage.length >= 2 && corr.outline_coverage.every(c => isRussian(c.comment_ru)));
    check('I. Feedback nêu rõ trình độ hiện tại', new RegExp(level).test(corr.level_position_ru));
    check('J. Điểm số bám đúng cơ chế của rubric',
        !rubric ? scoring.method === 'none'
            : rubric.scoringMethod === scoring.method);
    check('22. Không sửa quá tay: câu đúng không bị đưa vào errors',
        corr.errors.every(e => e.original !== e.correction));
    check('22\'. Nâng cấp cách diễn đạt nằm riêng, không trừ điểm',
        Array.isArray(corr.upgrades) &&
        (scoring.method !== 'deduction' || scoring.total_deducted ===
            corr.errors.filter(e => e.error_class === 'КЗО').length * rubric.deductionRules.kzoPenalty
            + corr.errors.filter(e => e.error_class === 'КНЗО').length * rubric.deductionRules.knzoPenalty));
    check('7. Có gợi ý từ vựng bù chỗ còn thiếu', (corr.recommended_vocabulary || []).length > 0);

    if (profile.needViGloss) {
        check(`${level}: có dòng tiếng Việt hỗ trợ đọc hiểu`, corr.errors.some(e => (e.vi_gloss || '').trim().length > 0));
    }
    return { outline, corr, scoring };
}

(async () => {
    console.log(`\n🧠 Model: ${MODEL}`);
    if (!process.env.OPENAI_API_KEY) { console.error('❌ Thiếu OPENAI_API_KEY trong .env'); process.exit(1); }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Đã kết nối MongoDB (chỉ để đọc rubric).');

    const results = {};
    for (const c of CASES) {
        try { results[c.level] = await runCase(c); }
        catch (e) { fail++; console.error(`❌ ${c.level} hỏng:`, e.message, e.problems || ''); }
    }

    // ---------- SO SÁNH CHÉO: level có thực sự làm output khác nhau không? ----------
    console.log(`\n${'='.repeat(72)}\nSO SÁNH CHÉO GIỮA CÁC TRÌNH ĐỘ\n${'='.repeat(72)}`);
    if (results.A1 && results.C1) {
        const a1len = results.A1.outline.outline.body.length;
        const c1len = results.C1.outline.outline.body.length;
        check('Dàn ý C1 sâu hơn dàn ý A1', c1len > a1len, `A1=${a1len}, C1=${c1len}`);
        const a1exp = results.A1.corr.errors.map(e => e.explanation_ru.length);
        const c1exp = results.C1.corr.errors.map(e => e.explanation_ru.length);
        const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
        const avgA1 = avg(a1exp), avgC1 = avg(c1exp);
        if (avgA1 === null || avgC1 === null) {
            console.log(`   ⚠️  Bỏ qua so sánh độ sâu giải thích: một trong hai bài không có lỗi nào để so (A1: ${a1exp.length} lỗi, C1: ${c1exp.length} lỗi). Không tính là đạt hay hỏng.`);
        } else {
            check('Giải thích lỗi ở C1 dài/sâu hơn ở A1', avgC1 > avgA1, `A1≈${Math.round(avgA1)} ký tự, C1≈${Math.round(avgC1)} ký tự`);
        }
        const a1v = results.A1.outline.vocabulary.map(v => v.difficulty);
        const c1v = results.C1.outline.vocabulary.map(v => v.difficulty);
        check('Từ vựng A1 và C1 không cùng khung', JSON.stringify(a1v) !== JSON.stringify(c1v), `A1: ${a1v} | C1: ${c1v}`);
    }

    console.log(`\n${'='.repeat(72)}\nKẾT QUẢ: ${pass} đạt · ${fail} hỏng\n${'='.repeat(72)}`);
    await mongoose.disconnect();
    process.exit(fail ? 1 : 0);
})();
