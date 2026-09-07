// ==========================================================================
// test-ai-offline.js — chạy: node test-ai-offline.js
//
// KHÔNG cần MongoDB, KHÔNG cần OPENAI_API_KEY, KHÔNG tốn tiền.
// Bộ test này kiểm tra phần mà backend TỰ chịu trách nhiệm:
//   1. Prompt có thực sự khác nhau giữa A1 / B1 / C1 không.
//   2. Lớp validate có chặn được output hời hợt, tiếng Việt, bịa trích dẫn không.
//   3. Công thức tính điểm ТРКИ có còn đúng như trước refactor không.
//   4. Gợi ý nâng cấp (upgrades) có thực sự KHÔNG ảnh hưởng điểm không.
//
// Phần cần gọi model thật (chất lượng nội dung) nằm ở test-ai-live.js.
// ==========================================================================

const { buildOutlinePrompt, buildCorrectPrompt, buildVocabDetailPrompt } = require('./ai/prompts');
const { validateOutline, validateCorrection, validateVocabDetail } = require('./ai/schemas');
const { computeFinalScoring } = require('./ai/scoring');
const { getProfile } = require('./ai/levelProfiles');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${extra ? `\n       → ${extra}` : ''}`); }
}
function group(t) { console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`); }

const TOPIC_B1 = { title: 'Bảo vệ môi trường', prompt: 'Защита окружающей среды: какие меры должны принимать государство и обычные люди?' };

// Rubric giống hệt dữ liệu seed.js (không import DB)
const RUBRIC_B1 = {
    level: 'B1', trkiName: 'ТРКИ-1', sourceConfidence: 'Cao nhất', source: 'ННГУ (2018), tr.46-47',
    scoringMethod: 'deduction', totalScore: 80,
    deductionRules: {
        kzoPenalty: 2, knzoPenalty: 0.5, invalidationThreshold: 15,
        bonusRules: { maxBonus: 6, description: 'thưởng nếu bài đầy đủ - chi tiết và có yếu tố sáng tạo ngôn ngữ' },
        taskCriteria: ['Không giải quyết đúng nhiệm vụ giao tiếp → 0 điểm toàn bài.']
    }
};
const RUBRIC_C1 = {
    level: 'C1', trkiName: 'ТРКИ-3', sourceConfidence: 'Trung bình', source: 'SPbU webinar 20/4/2020',
    scoringMethod: 'parameter', totalScore: 80,
    parameters: [
        { name: 'Интенция (Ý đồ giao tiếp)', maxScore: 5, description: '...', kzoCapsAt: null },
        { name: 'Содержание (Nội dung)', maxScore: 5, description: '...', kzoCapsAt: null },
        { name: 'Композиционная структура и форма (Cấu trúc & hình thức)', maxScore: 5, description: '...', kzoCapsAt: null },
        { name: 'Языковые средства (Phương tiện ngôn ngữ)', maxScore: 5, description: '...', kzoCapsAt: 3 }
    ],
    essayRequirements: ['Xác định rõ vấn đề', 'Nêu nguyên nhân', 'Đề xuất hướng giải quyết', 'Đánh giá xã hội', 'Đánh giá bản thân']
};

// ==========================================================================
group('1. LEVEL-FIRST — prompt có thực sự đổi theo trình độ?');
// ==========================================================================
const pA1 = buildOutlinePrompt({ level: 'A1', topic: TOPIC_B1 });
const pB1 = buildOutlinePrompt({ level: 'B1', topic: TOPIC_B1 });
const pC1 = buildOutlinePrompt({ level: 'C1', topic: TOPIC_B1 });

check('A1 và B1 nhận prompt KHÁC NHAU', pA1 !== pB1);
check('B1 và C1 nhận prompt KHÁC NHAU', pB1 !== pC1);
check('A1 bị cấm mệnh đề phụ', /Никаких придаточных/.test(pA1));
check('C1 KHÔNG bị cấm mệnh đề phụ', !/Никаких придаточных/.test(pC1));
check('A1 chỉ cho 2 phần thân bài', /примерно 2 смысловые части/.test(pA1));
check('C1 yêu cầu 5 phần thân bài', /примерно 5 смысловые части/.test(pC1));
check('A1 giới hạn difficulty ở A1/A1+/A2', /A1, A1\+, A2/.test(pA1));
check('C1 giới hạn difficulty ở B2..C2', /B2, C1, C1\+, C2/.test(pC1));
check('A1 được phép có dòng tiếng Việt hỗ trợ', /vi_gloss/.test(pA1) && /ещё не читает свободно/.test(pA1));
check('B1 KHÔNG dùng vi_gloss', /оставляй пустой строкой/.test(pB1));
check('C1 nói tới эссе-рассуждение', /контраргумент/.test(pC1));

const cA1 = buildCorrectPrompt({ level: 'A1', rubric: null, topic: TOPIC_B1 });
const cB1 = buildCorrectPrompt({ level: 'B1', rubric: RUBRIC_B1, topic: TOPIC_B1 });
const cC1 = buildCorrectPrompt({ level: 'C1', rubric: RUBRIC_C1, topic: TOPIC_B1 });
check('Cách giải thích lỗi ở A1 ≠ ở C1',
    getProfile('A1').explanationStyle_ru !== getProfile('C1').explanationStyle_ru);
check('A1: cấm thuật ngữ ngôn ngữ học phức tạp', /Никакой лингвистической терминологии/.test(cA1));
check('C1: cho phép thuật ngữ đầy đủ', /Разрешена полноценная лингвистическая терминология/.test(cC1));
check('B1 nhúng cơ chế TRỪ ĐIỂM của ТРКИ-1', /каждая КЗО −2/.test(cB1) && /ТРКИ-1/.test(cB1));
check('C1 nhúng cơ chế CHẤM THAM SỐ', /оценка по параметрам/.test(cC1) && /Языковые средства/.test(cC1));
check('C1 liệt kê 5 yêu cầu bắt buộc của bài эссе', (cC1.match(/- Xác định rõ vấn đề/) || []).length === 1);
check('Không có rubric thì cấm bịa thang điểm', /Не выдумывай шкалу/.test(cA1));

// ==========================================================================
group('2. LIÊN KẾT NGỮ CẢNH — dàn ý và túi từ vựng có được truyền vào không?');
// ==========================================================================
const OUTLINE_FIXTURE = {
    outline: {
        introduction: ['обозначение проблемы загрязнения', 'почему это важно сегодня'],
        body: [
            { heading_ru: 'Основные экологические проблемы', points: ['загрязнение воздуха в больших городах', 'большое количество бытовых отходов'], grammar_focus_ru: 'конструкция «что является чем»' },
            { heading_ru: 'Что могут сделать обычные люди', points: ['сортировка отходов дома', 'экономия воды и электричества'], grammar_focus_ru: 'глаголы долженствования' }
        ],
        conclusion: ['краткое обобщение', 'личная позиция автора']
    },
    vocabulary: [
        { term: 'защища́ть окружа́ющую среду́', difficulty: 'B1' },
        { term: 'сортирова́ть отхо́ды', difficulty: 'B1+' }
    ]
};
const withCtx = buildCorrectPrompt({ level: 'B1', rubric: RUBRIC_B1, topic: TOPIC_B1, outline: OUTLINE_FIXTURE, vocabulary: OUTLINE_FIXTURE.vocabulary });
const noCtx = buildCorrectPrompt({ level: 'B1', rubric: RUBRIC_B1, topic: TOPIC_B1 });

check('Có dàn ý → prompt chứa đúng luận điểm của dàn ý', /сортировка отходов дома/.test(withCtx));
check('Có dàn ý → yêu cầu điền outline_coverage', /Заполни outline_coverage по пунктам ЭТОГО плана/.test(withCtx));
check('Có túi từ → prompt liệt kê đúng các từ đó', /сортирова́ть отхо́ды/.test(withCtx));
check('KHÔNG có dàn ý → bắt buộc để outline_coverage rỗng', /outline_coverage должен быть ПУСТЫМ массивом/.test(noCtx));
check('KHÔNG có dàn ý → cấm bịa ra dàn ý', /Не придумывай план, которого не было/.test(noCtx));
check('Đề bài luôn được truyền vào prompt', withCtx.includes(TOPIC_B1.prompt));

const vd = buildVocabDetailPrompt({ level: 'B1', topic: TOPIC_B1, term: 'сортировать отходы', essay: 'Я думаю, что много мусора.', context: 'нужно для пункта о бытовых отходах' });
check('Thẻ từ vựng biết bài viết của học viên', /много мусора/.test(vd));
check('Thẻ từ vựng biết lý do từ được gợi ý', /нужно для пункта о бытовых отходах/.test(vd));
check('Thẻ từ vựng bắt buộc ghi trọng âm', /защища́ть/.test(vd));
check('Thẻ từ vựng cấm kiểu từ điển chung chung', /Это НЕ словарная статья вообще/.test(vd));

// ==========================================================================
group('3. QUALITY CONTROL — validator có chặn được output hời hợt không?');
// ==========================================================================
const vOutB1 = validateOutline('B1');

// (a) Dàn ý kiểu cũ: chỉ toàn từ khoá rời rạc, không có từ vựng
check('CHẶN dàn ý chỉ có từ khoá rời rạc / thiếu phần',
    vOutB1({ outline: { introduction: ['природа'], body: [], conclusion: [] }, vocabulary: [], grammar: [] }).length > 0);

// (b) Dàn ý bằng tiếng Việt
const viOutline = {
    topic_restated_ru: 'Cần viết về bảo vệ môi trường',
    outline: {
        introduction: ['nêu vấn đề', 'vì sao quan trọng'],
        body: [{ heading_ru: 'Nguyên nhân', points: ['ô nhiễm không khí', 'rác thải'], grammar_focus_ru: '' }],
        conclusion: ['tóm lại', 'quan điểm']
    }, vocabulary: [], grammar: []
};
const viErrs = vOutB1(viOutline);
check('CHẶN dàn ý viết bằng tiếng Việt', viErrs.some(e => /tiếng Nga/.test(e)), viErrs[0]);

// (c) Từ vựng sai bậc: đưa từ C2 cho học viên B1
const badLevelVocab = {
    topic_restated_ru: 'Нужно написать о защите окружающей среды.',
    outline: {
        introduction: ['обозначение проблемы', 'важность темы сегодня'],
        body: [
            { heading_ru: 'Проблемы', points: ['загрязнение воздуха', 'много отходов'], grammar_focus_ru: 'падежи' },
            { heading_ru: 'Решения', points: ['сортировка мусора', 'экономия воды'], grammar_focus_ru: 'модальность' },
            { heading_ru: 'Роль государства', points: ['законы', 'контроль предприятий'], grammar_focus_ru: 'пассив' }
        ],
        conclusion: ['обобщение сказанного', 'личная позиция']
    },
    vocabulary: [{
        term: 'экзистенциальная амбивалентность', part_of_speech_ru: 'словосочетание', difficulty: 'C2',
        short_meaning_ru: 'сложное понятие', meaning_vi: 'mơ hồ', relevance_ru: 'Помогает выразить сложную мысль в тексте.',
        collocations: ['проявлять амбивалентность'], section_ref: 'Проблемы'
    }],
    grammar: [{ name_ru: 'Падежи', why_ru: 'нужно', example_ru: 'Мы защищаем природу.', level: 'B1' },
    { name_ru: 'Модальность', why_ru: 'нужно', example_ru: 'Нужно сортировать отходы.', level: 'B1' }]
};
const lvlErrs = vOutB1(badLevelVocab);
check('CHẶN từ vựng C2 lọt vào dàn ý B1', lvlErrs.some(e => /difficulty/.test(e)), lvlErrs.find(e => /difficulty/.test(e)));
check('CHẶN túi từ vựng quá ít từ', lvlErrs.some(e => /ít nhất/.test(e)));

// (b') HỒI QUY: lỗi thật đã gặp khi chạy live — ý dàn bài chỉ vỏn vẹn 1 từ ("Я")
// lọt qua vì trước đây validator không kiểm tra độ dài từng ý, chỉ kiểm tra
// có phải tiếng Nga hay không. "Я" là tiếng Nga hợp lệ nhưng vẫn là kiểu
// "từ khoá rời rạc" mà toàn bộ yêu cầu refactor này muốn loại bỏ.
const oneWordBullet = JSON.parse(JSON.stringify(badLevelVocab));
oneWordBullet.vocabulary = []; // bỏ qua để chỉ tập trung kiểm tra độ dài ý
oneWordBullet.outline.body[0].points = ['Я', 'Мама и папа хорошо готовят'];
const oneWordErrs = validateOutline('A1')(oneWordBullet); // A1 cho phép ngắn nhất — vẫn phải chặn 1 từ
check('CHẶN ý dàn bài chỉ vỏn vẹn 1 từ (vd "Я") kể cả ở A1',
    oneWordErrs.some(e => /quá cụt/.test(e)), oneWordErrs.find(e => /quá cụt/.test(e)));

// (d) Validator chấm bài
const ESSAY = 'Я думаю, что защищать окружающая среда очень важно. В городе много мусора.';
const vCor = validateCorrection('B1', RUBRIC_B1, { essayText: ESSAY, hasOutline: true, vocabTerms: ['сортировать отходы'] });

const shallow = {
    corrected_text: 'Я думаю, что защищать окружающую среду очень важно.',
    errors: [{
        original: 'защищать окружающая среда', correction: 'защищать окружающую среду',
        error_type_ru: 'падеж', error_class: 'КЗО',
        explanation_ru: 'Правильно: защищать окружающую среду.', // hời hợt đúng kiểu cũ
        rule_tip_ru: 'винительный падеж', better_alternative_ru: '', related_vocabulary: [], vi_gloss: ''
    }],
    upgrades: [], overall_feedback_ru: 'Текст хороший, но есть ошибки.',
    main_problem_ru: 'Ошибки в падежах.', strengths_ru: ['Bài viết rõ ràng'], weaknesses_ru: ['còn lỗi'],
    next_steps_ru: ['ôn lại cách'], vocabulary_to_improve_ru: [], grammar_to_improve_ru: [],
    recommended_vocabulary: [], outline_coverage: [], vocabulary_usage: [],
    level_position_ru: 'Текст на уровне.', parameter_scores: [], bonus_awarded: 0, bonus_reason_ru: '',
    essay_requirements_check: []
};
const shErrs = vCor(shallow);
check('CHẶN giải thích lỗi quá hời hợt ("Правильно: …")', shErrs.some(e => /explanation_ru quá hời hợt/.test(e)));
check('CHẶN overall_feedback quá ngắn/rỗng nghĩa', shErrs.some(e => /overall_feedback_ru/.test(e)));
check('CHẶN strengths/weaknesses viết bằng tiếng Việt', shErrs.some(e => /strengths_ru\[0\]/.test(e)));
check('CHẶN level_position không nêu rõ trình độ B1', shErrs.some(e => /level_position_ru/.test(e)));
check('CHẶN bỏ trống đối chiếu dàn ý khi học viên CÓ dàn ý', shErrs.some(e => /outline_coverage phải đối chiếu/.test(e)));
check('CHẶN bỏ trống đánh giá dùng túi từ vựng', shErrs.some(e => /vocabulary_usage/.test(e)));

// (e) Bịa trích dẫn — mục 21
const fabricated = JSON.parse(JSON.stringify(shallow));
fabricated.errors[0].original = 'я хожу в школу каждый день'; // không hề có trong bài
check('CHẶN AI bịa trích dẫn không có trong bài',
    vCor(fabricated).some(e => /không có trong bài viết/.test(e)));

// (f) Sửa câu đúng thành "y hệt" — dấu hiệu overcorrection rỗng
const noop = JSON.parse(JSON.stringify(shallow));
noop.errors[0].correction = noop.errors[0].original;
check('CHẶN "lỗi" mà original = correction', vCor(noop).some(e => /giống hệt nhau/.test(e)));

// (g) Điểm tham số vượt trần
const vCorC1 = validateCorrection('C1', RUBRIC_C1, { essayText: ESSAY, hasOutline: false });
const overScore = JSON.parse(JSON.stringify(shallow));
overScore.outline_coverage = [];
overScore.parameter_scores = RUBRIC_C1.parameters.map(p => ({ name: p.name, score: 9, comment_ru: 'Хорошо.' }));
check('CHẶN điểm tham số vượt max (9/5)', vCorC1(overScore).some(e => /0–5/.test(e)));

// (h) error_class lạ
const badClass = JSON.parse(JSON.stringify(shallow));
badClass.errors[0].error_class = 'GRAMMAR';
check('CHẶN error_class không thuộc {КЗО, КНЗО}', vCor(badClass).some(e => /КЗО hoặc КНЗО/.test(e)));

// (i) Bonus vượt trần rubric
const overBonus = JSON.parse(JSON.stringify(shallow));
overBonus.bonus_awarded = 20;
check('CHẶN bonus vượt mức tối đa của ТРКИ-1 (6)', vCor(overBonus).some(e => /bonus_awarded/.test(e)));

// (j) Output ĐẠT chuẩn thì phải đi lọt
const good = {
    corrected_text: 'Я думаю, что защищать окружающую среду очень важно. В городе большое количество отходов.',
    errors: [{
        original: 'защищать окружающая среда', correction: 'защищать окружающую среду',
        error_type_ru: 'падежное управление глагола', error_class: 'КЗО',
        explanation_ru: 'Глагол «защищать» требует винительного падежа: защищать кого? что? Поэтому прилагательное и существительное меняют форму: окружающую среду. Сравните: защищать природу, защищать права человека.',
        rule_tip_ru: 'защищать + кого? что? → винительный падеж',
        better_alternative_ru: 'заботиться об окружающей среде', related_vocabulary: ['охрана природы'], vi_gloss: ''
    }],
    upgrades: [{
        original: 'много мусора', suggestion: 'большое количество отходов',
        upgrade_type: 'более формально',
        explanation_ru: 'В письменной речи сочетание «большое количество отходов» звучит точнее и уместнее, чем разговорное «много мусора».'
    }],
    overall_feedback_ru: 'Ваш текст понятен, мысль о важности защиты природы выражена ясно. Вы используете простые, но правильные конструкции, и читатель легко следит за логикой. Однако вторая часть текста осталась почти нераскрытой: вы назвали проблему, но не объяснили, что делать. Из-за этого текст выглядит как начало сочинения, а не как завершённая работа.',
    main_problem_ru: 'Тезис заявлен, но не подкреплён аргументами и примерами.',
    strengths_ru: ['Ясно выражена личная позиция в первом предложении.', 'Простые предложения построены правильно.'],
    weaknesses_ru: ['Нет примеров, подтверждающих мысль о загрязнении.', 'Отсутствует заключение.'],
    next_steps_ru: ['Добавьте два конкретных примера к каждому тезису.', 'Напишите заключение из двух предложений.'],
    vocabulary_to_improve_ru: ['сортировать отходы', 'загрязнение воздуха'],
    grammar_to_improve_ru: ['винительный падеж после переходных глаголов'],
    recommended_vocabulary: [{
        term: 'сокраща́ть коли́чество отхо́дов', part_of_speech_ru: 'словосочетание', difficulty: 'B1+',
        short_meaning_ru: 'делать так, чтобы мусора становилось меньше', meaning_vi: 'giảm lượng rác thải',
        relevance_ru: 'Эта единица нужна во второй части текста, где вы говорите о решениях проблемы отходов.',
        collocations: ['сокращать количество отходов', 'сократить потребление'], section_ref: 'Что могут сделать обычные люди'
    }],
    outline_coverage: [
        { point_ru: 'Основные экологические проблемы', status: 'частично', comment_ru: 'Названо только загрязнение мусором, о воздухе и воде не сказано.' },
        { point_ru: 'Что могут сделать обычные люди', status: 'не раскрыто', comment_ru: 'В плане этот пункт был, но в тексте о нём нет ни одного предложения.' }
    ],
    vocabulary_usage: [{ term: 'сортировать отходы', used: false, comment_ru: 'Это выражение не встречается в тексте, хотя оно подходило для второй части.' }],
    level_position_ru: 'Для уровня B1 вам уже хорошо удаётся выражать позицию, однако объём и аргументация пока ниже требований B1.',
    parameter_scores: [], bonus_awarded: 0, bonus_reason_ru: '', essay_requirements_check: []
};
const goodErrs = vCor(good);
check('Output đạt chuẩn thì ĐI LỌT (không báo lỗi giả)', goodErrs.length === 0, goodErrs.join(' | '));

// (k) Validator thẻ từ vựng
const vVocab = validateVocabDetail('B1');
check('CHẶN thẻ từ vựng thiếu trọng âm / giải thích chung chung',
    vVocab({ term: 'защищать', pronunciation: '', meaning_ru: '', usage_ru: '', why_relevant_ru: '', collocations: [], examples: [], cefr: '' }).length > 0);
check('Thẻ từ vựng đầy đủ thì ĐI LỌT', vVocab({
    term: 'защища́ть', headword: 'защищать', pronunciation: 'защища́ть', stress_note_ru: '',
    part_of_speech_ru: 'глагол', gender_ru: '', forms: [],
    meaning_ru: 'делать всё нужное, чтобы сохранить природу или человека от опасности.',
    meaning_vi: 'bảo vệ',
    usage_ru: 'Употребляется с винительным падежом: защищать кого? что? Часто встречается в текстах об экологии и о правах человека.',
    collocations: [{ phrase_ru: 'защищать окружающую среду', gloss_vi: 'bảo vệ môi trường' }, { phrase_ru: 'защищать природу', gloss_vi: 'bảo vệ thiên nhiên' }],
    grammar_note_ru: 'защищать + винительный падеж',
    examples: [{ ru: 'Каждый человек должен защищать окружающую среду.', vi: '...' }, { ru: 'Государство защищает природу с помощью законов.', vi: '...' }],
    why_relevant_ru: 'Это ключевой глагол темы: без него трудно сформулировать главный тезис сочинения о защите природы.',
    cefr: 'B1', register_ru: 'нейтральное'
}).length === 0);

// ==========================================================================
group('3b. HỒI QUY — lỗi thật đã gặp khi chạy live: tên tham số kèm chú thích tiếng Việt');
// ==========================================================================
// seed.js ghi tên tham số dạng "Интенция (Ý đồ giao tiếp)" để người phát triển
// dễ đọc, nhưng model viết tiếng Nga tự nhiên trả về "Интенция" gọn, không kèm
// phần chú thích. Lần chạy live đầu tiên với C1 đã treo hẳn vì so khớp tuyệt đối.
const bareNameOutput = JSON.parse(JSON.stringify(good));
bareNameOutput.outline_coverage = [];
bareNameOutput.parameter_scores = [
    { name: 'Интенция', score: 4, comment_ru: 'Позиция выражена ясно и последовательно.' },
    { name: 'Содержание', score: 4, comment_ru: 'Основные аспекты проблемы раскрыты.' },
    { name: 'Композиционная структура и форма', score: 5, comment_ru: 'Структура эссе логична.' },
    { name: 'Языковые средства', score: 4, comment_ru: 'Лексика в целом точная.' }
];
const vCorC1b = validateCorrection('C1', RUBRIC_C1, { essayText: ESSAY, hasOutline: false });
const bareErrs = vCorC1b(bareNameOutput);
check('CHẤP NHẬN tên tham số KHÔNG kèm chú thích tiếng Việt (đúng thực tế model trả về)',
    !bareErrs.some(e => /parameter_scores.*name/.test(e)), bareErrs.join(' | '));

const { normalizeParamName } = require('./ai/schemas');
check('normalizeParamName bỏ đúng phần trong ngoặc',
    normalizeParamName('Интенция (Ý đồ giao tiếp)') === normalizeParamName('Интенция'));
check('normalizeParamName không nhạy hoa/thường',
    normalizeParamName('ИНТЕНЦИЯ') === normalizeParamName('интенция'));

// Quan trọng nhất: scoring.js phải KHỚP ĐƯỢC để tính điểm, không âm thầm trả 0.
// Lưu ý: fixture `good` có sẵn 1 lỗi КЗО, nên tham số "Языковые средства" ĐÚNG RA
// phải bị áp trần 3/5 (luật ТРКИ) dù điểm thô model chấm là 4 — 4+4+5+3=16, không phải 20.
const scoreWithBareNames = computeFinalScoring(RUBRIC_C1, bareNameOutput);
check('scoring.js khớp được tên tham số và vẫn áp đúng trần КЗО (không về 0 âm thầm)',
    scoreWithBareNames.total_score_earned === 4 + 4 + 5 + 3
    && scoreWithBareNames.parameters.find(p => /Языковые/.test(p.name)).capped === true,
    JSON.stringify(scoreWithBareNames));

// ==========================================================================
group('4. CHẤM ĐIỂM — công thức ТРКИ có giữ nguyên không?');
// ==========================================================================
const s1 = computeFinalScoring(RUBRIC_B1, {
    errors: [{ error_class: 'КЗО' }, { error_class: 'КЗО' }, { error_class: 'КНЗО' }, { error_class: 'КНЗО' }],
    bonus_awarded: 0
});
check('B1: 2 КЗО + 2 КНЗО → trừ 5đ, còn 75/80', s1.final_score === 75 && s1.total_deducted === 5, JSON.stringify(s1));
check('B1: dưới ngưỡng 15đ → bài vẫn được công nhận', s1.is_valid === true);

const s2 = computeFinalScoring(RUBRIC_B1, { errors: Array(9).fill({ error_class: 'КЗО' }), bonus_awarded: 0 });
check('B1: 9 КЗО (trừ 18đ) → vượt ngưỡng 15đ, KHÔNG công nhận', s2.is_valid === false && s2.final_score === 62, JSON.stringify(s2));

const s3 = computeFinalScoring(RUBRIC_B1, { errors: [], bonus_awarded: 99, bonus_reason_ru: 'очень хорошо' });
check('B1: bonus bị chặn ở mức tối đa 6đ (80 → vẫn 80)', s3.bonus_awarded === 6 && s3.final_score === 80);

// upgrades KHÔNG được ảnh hưởng điểm — điểm mới của bản refactor
const s4 = computeFinalScoring(RUBRIC_B1, {
    errors: [{ error_class: 'КНЗО' }],
    upgrades: Array(10).fill({ upgrade_type: 'более формально' }),
    bonus_awarded: 0
});
check('10 gợi ý nâng cấp KHÔNG làm mất điểm nào', s4.final_score === 79.5 && s4.total_deducted === 0.5);

const s5 = computeFinalScoring(RUBRIC_C1, {
    errors: [{ error_class: 'КЗО' }],
    parameter_scores: RUBRIC_C1.parameters.map(p => ({ name: p.name, score: 5, comment_ru: 'ok' }))
});
const langParam = s5.parameters.find(p => /Языковые/.test(p.name));
check('C1: có КЗО → tham số Языковые средства bị áp trần còn 3', langParam.score === 3 && langParam.capped === true);
check('C1: các tham số khác KHÔNG bị áp trần', s5.parameters.filter(p => p.capped).length === 1);
check('C1: tổng điểm = 5+5+5+3 = 18/20', s5.total_score_earned === 18 && s5.total_score_max === 20);

const s6 = computeFinalScoring(null, { errors: [] });
check('Không có rubric → không bịa ra điểm', s6.method === 'none');

// ==========================================================================
console.log(`\n${'='.repeat(70)}`);
console.log(`KẾT QUẢ: ${pass} đạt · ${fail} hỏng`);
console.log('='.repeat(70));
process.exit(fail ? 1 : 0);
