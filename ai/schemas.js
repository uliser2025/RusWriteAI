// ==========================================================================
// ai/schemas.js
// 1) JSON Schema (strict) gửi kèm mỗi lần gọi model → model bị RÀNG BUỘC về hình dạng.
// 2) Validator ngữ nghĩa chạy ở backend → bắt những thứ schema không bắt được:
//    trường rỗng, giải thích không phải tiếng Nga, điểm vượt trần, từ vựng sai bậc…
//
// Đây chính là mục 17 (QUALITY CONTROL): frontend không bao giờ phải đoán cấu trúc.
// ==========================================================================

const { getProfile } = require('./levelProfiles');

// ---------- Tiện ích kiểm tra ngôn ngữ ----------
const CYRILLIC = /[\u0400-\u04FF]/;

function letterStats(str) {
    const s = String(str || '');
    let cyr = 0, lat = 0;
    for (const ch of s) {
        if (/[\u0400-\u04FF]/.test(ch)) cyr++;
        else if (/[A-Za-zÀ-ỹ]/.test(ch)) lat++;
    }
    return { cyr, lat };
}

/** Trường này có thực sự được viết bằng tiếng Nga không? */
function isRussian(str) {
    const { cyr, lat } = letterStats(str);
    if (cyr === 0) return false;
    return cyr >= lat; // cho phép lẫn thuật ngữ Latin/tên riêng, nhưng phần lớn phải là Kirin
}

function nonEmpty(str, min = 1) {
    return typeof str === 'string' && str.trim().length >= min;
}

/**
 * Chuẩn hoá tên tham số rubric để so khớp.
 *
 * Tên trong seed.js có dạng "Интенция (Ý đồ giao tiếp)" — phần tiếng Việt trong
 * ngoặc chỉ để người phát triển đọc hiểu, nhưng model được yêu cầu viết tiếng Nga
 * nên tự nhiên trả về "Интенция" gọn, không kèm chú thích. So khớp tuyệt đối sẽ
 * trượt 100% các lần — và nguy hiểm hơn, scoring.js dùng cùng kiểu so khớp để
 * TÍNH ĐIỂM, nên nếu không chuẩn hoá, điểm parameter sẽ âm thầm về 0.
 * Quy tắc: bỏ phần trong ngoặc, bỏ khoảng trắng thừa, so sánh không phân biệt hoa/thường.
 */
function normalizeParamName(s) {
    return String(s || '')
        .replace(/\([^)]*\)/g, '')   // bỏ mọi phần "(...)"
        .trim()
        .toLowerCase();
}

// ==========================================================================
// SCHEMA 1 — /api/outline
// ==========================================================================
const VOCAB_ITEM_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['term', 'part_of_speech_ru', 'difficulty', 'short_meaning_ru', 'meaning_vi', 'relevance_ru', 'collocations', 'section_ref'],
    properties: {
        term: { type: 'string', description: 'Слово или словосочетание на русском языке, в начальной форме, с ударением (например: защища́ть)' },
        part_of_speech_ru: { type: 'string', description: 'Часть речи по-русски: существительное, глагол, прилагательное, словосочетание…' },
        difficulty: { type: 'string', description: 'Уровень единицы: A1, A2, B1, B1+, B2, C1, C2' },
        short_meaning_ru: { type: 'string', description: 'Значение простыми русскими словами, доступными для данного уровня' },
        meaning_vi: { type: 'string', description: 'Очень краткий вьетнамский эквивалент — только для сверки, 1–5 слов' },
        relevance_ru: { type: 'string', description: 'Зачем эта единица нужна ИМЕННО в этом сочинении, со ссылкой на пункт плана' },
        collocations: { type: 'array', items: { type: 'string' }, description: '2–4 типичных сочетания на русском' },
        section_ref: { type: 'string', description: 'Название части плана, где единица пригодится' }
    }
};

const OUTLINE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['topic_restated_ru', 'outline', 'speech_patterns', 'vocabulary', 'grammar', 'writing_tips_ru', 'target_length_ru'],
    properties: {
        topic_restated_ru: { type: 'string', description: 'Формулировка темы своими словами — что именно требуется написать' },
        outline: {
            type: 'object',
            additionalProperties: false,
            required: ['introduction', 'body', 'conclusion'],
            properties: {
                introduction: { type: 'array', items: { type: 'string' }, description: 'Пункты введения на русском языке' },
                body: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['heading_ru', 'points', 'grammar_focus_ru'],
                        properties: {
                            heading_ru: { type: 'string', description: 'Заголовок смысловой части, БЕЗ номера впереди (интерфейс сам нумерует части) — например "Причины загрязнения", а не "1. Причины загрязнения"' },
                            points: { type: 'array', items: { type: 'string' }, description: 'Подпункты — содержательные тезисы, а не отдельные слова' },
                            grammar_focus_ru: { type: 'string', description: 'Какую грамматическую конструкцию здесь удобно использовать' }
                        }
                    }
                },
                conclusion: { type: 'array', items: { type: 'string' } }
            }
        },
        speech_patterns: {
            type: 'array',
            description: 'Короткие речевые образцы (клише) на русском. НЕ готовые абзацы.',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['pattern_ru', 'purpose_ru'],
                properties: {
                    pattern_ru: { type: 'string' },
                    purpose_ru: { type: 'string' }
                }
            }
        },
        vocabulary: { type: 'array', items: VOCAB_ITEM_SCHEMA },
        grammar: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['name_ru', 'why_ru', 'example_ru', 'level'],
                properties: {
                    name_ru: { type: 'string' },
                    why_ru: { type: 'string', description: 'Зачем эта конструкция нужна в этом сочинении' },
                    example_ru: { type: 'string', description: 'Один короткий пример по теме сочинения' },
                    level: { type: 'string' }
                }
            }
        },
        writing_tips_ru: { type: 'array', items: { type: 'string' } },
        target_length_ru: { type: 'string' }
    }
};

function validateOutline(level) {
    const p = getProfile(level);
    return (d) => {
        const errs = [];
        const o = d.outline || {};
        if (!Array.isArray(o.introduction) || o.introduction.length < 2) errs.push('outline.introduction phải có ít nhất 2 ý.');
        if (!Array.isArray(o.body) || o.body.length < Math.max(2, p.outline.bodySections - 1)) {
            errs.push(`outline.body phải có ít nhất ${Math.max(2, p.outline.bodySections - 1)} phần cho trình độ ${p.code}.`);
        }
        if (!Array.isArray(o.conclusion) || o.conclusion.length < 2) errs.push('outline.conclusion phải có ít nhất 2 ý.');

        // Số từ tối thiểu mỗi ý, đúng phong cách từng bậc (levelProfiles.js: A1/A2
        // cho phép cụm 2–5 từ, B1 trở lên cần ý trọn vẹn hơn). Không có bước này,
        // những ý kiểu "Я" (1 từ) vẫn lọt qua — đúng loại "từ khoá rời rạc" mà
        // toàn bộ refactor này muốn loại bỏ, chỉ là núp dưới dạng đại từ thay vì danh từ.
        const minWords = ['A1', 'A2'].includes(p.code) ? 2 : 3;
        const tooShort = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length < minWords;

        (o.body || []).forEach((s, i) => {
            if (!nonEmpty(s.heading_ru) || !isRussian(s.heading_ru)) errs.push(`body[${i}].heading_ru phải viết bằng tiếng Nga.`);
            if (!Array.isArray(s.points) || s.points.length < 2) errs.push(`body[${i}].points phải có ít nhất 2 ý.`);
            (s.points || []).forEach((pt, j) => {
                if (!isRussian(pt)) errs.push(`body[${i}].points[${j}] phải viết bằng tiếng Nga.`);
                if (tooShort(pt)) errs.push(`body[${i}].points[${j}] ("${pt}") chỉ có ${String(pt).trim().split(/\s+/).length} từ — quá cụt, phải diễn đạt thành ý ít nhất ${minWords} từ, không phải từ/đại từ đơn lẻ.`);
            });
        });
        [...(o.introduction || []), ...(o.conclusion || [])].forEach((x, i) => {
            if (!isRussian(x)) errs.push(`Ý dàn bài #${i + 1} (mở/kết) phải viết bằng tiếng Nga.`);
            if (tooShort(x)) errs.push(`Ý dàn bài #${i + 1} (mở/kết) ("${x}") quá cụt — phải ít nhất ${minWords} từ.`);
        });

        const vocab = Array.isArray(d.vocabulary) ? d.vocabulary : [];
        const minVocab = Math.max(6, p.vocabulary.count - 3);
        if (vocab.length < minVocab) errs.push(`vocabulary phải có ít nhất ${minVocab} đơn vị (đang có ${vocab.length}).`);
        vocab.forEach((v, i) => {
            if (!nonEmpty(v.term) || !CYRILLIC.test(v.term)) errs.push(`vocabulary[${i}].term phải là từ/cụm từ tiếng Nga.`);
            if (!nonEmpty(v.relevance_ru, 15) || !isRussian(v.relevance_ru)) errs.push(`vocabulary[${i}].relevance_ru phải giải thích bằng tiếng Nga, đủ ý.`);
            if (!isRussian(v.short_meaning_ru)) errs.push(`vocabulary[${i}].short_meaning_ru phải bằng tiếng Nga.`);
            if (!p.vocabulary.allowedDifficulty.includes(String(v.difficulty || '').trim())) {
                errs.push(`vocabulary[${i}].difficulty = "${v.difficulty}" không hợp lệ cho ${p.code}; chỉ chấp nhận: ${p.vocabulary.allowedDifficulty.join(', ')}.`);
            }
            if (!Array.isArray(v.collocations) || v.collocations.length < 1) errs.push(`vocabulary[${i}].collocations phải có ít nhất 1 sự kết hợp.`);
        });

        if (!Array.isArray(d.grammar) || d.grammar.length < 2) errs.push('grammar phải có ít nhất 2 mục.');
        (d.grammar || []).forEach((g, i) => {
            if (!isRussian(g.example_ru)) errs.push(`grammar[${i}].example_ru phải là ví dụ tiếng Nga.`);
        });
        if (!isRussian(d.topic_restated_ru)) errs.push('topic_restated_ru phải viết bằng tiếng Nga.');
        return errs;
    };
}

// ==========================================================================
// SCHEMA 2 — /api/correct
// ==========================================================================
const ERROR_CLASSES = ['КЗО', 'КНЗО'];
const UPGRADE_TYPES = ['более естественно', 'более формально', 'более точно', 'слишком разговорно', 'более книжно'];

const CORRECT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: [
        'corrected_text', 'errors', 'upgrades', 'overall_feedback_ru', 'main_problem_ru',
        'strengths_ru', 'weaknesses_ru', 'next_steps_ru', 'vocabulary_to_improve_ru',
        'grammar_to_improve_ru', 'recommended_vocabulary', 'outline_coverage',
        'vocabulary_usage', 'level_position_ru', 'parameter_scores', 'bonus_awarded',
        'bonus_reason_ru', 'essay_requirements_check'
    ],
    properties: {
        corrected_text: { type: 'string', description: 'Полный исправленный текст. Исправлены ТОЛЬКО реальные ошибки; корректные предложения сохранены дословно.' },
        errors: {
            type: 'array',
            description: 'Только НАСТОЯЩИЕ ошибки — нарушения нормы русского языка. Стилистические улучшения сюда НЕ входят.',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['original', 'correction', 'error_type_ru', 'error_class', 'explanation_ru', 'rule_tip_ru', 'better_alternative_ru', 'related_vocabulary', 'vi_gloss'],
                properties: {
                    original: { type: 'string', description: 'Фрагмент из текста студента ДОСЛОВНО' },
                    correction: { type: 'string' },
                    error_type_ru: { type: 'string', description: 'Тип ошибки по-русски: падежное управление, вид глагола, согласование, порядок слов, орфография…' },
                    error_class: { type: 'string', enum: ERROR_CLASSES },
                    explanation_ru: { type: 'string', description: 'Развёрнутое объяснение ПО-РУССКИ: какое правило, почему здесь так, короткий пример' },
                    rule_tip_ru: { type: 'string', description: 'Короткое правило-памятка по-русски' },
                    better_alternative_ru: { type: 'string', description: 'Более удачный вариант той же мысли, или пустая строка' },
                    related_vocabulary: { type: 'array', items: { type: 'string' }, description: 'Слова/сочетания, которые помогли бы выразить эту мысль' },
                    vi_gloss: { type: 'string', description: 'Одна короткая строка по-вьетнамски — только для уровней A1/A2, иначе пустая строка' }
                }
            }
        },
        upgrades: {
            type: 'array',
            description: 'Корректные, но улучшаемые формулировки. НИКОГДА не влияют на оценку.',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['original', 'suggestion', 'upgrade_type', 'explanation_ru'],
                properties: {
                    original: { type: 'string' },
                    suggestion: { type: 'string' },
                    upgrade_type: { type: 'string', enum: UPGRADE_TYPES },
                    explanation_ru: { type: 'string', description: 'В чём именно выигрыш: оттенок, регистр, сочетаемость' }
                }
            }
        },
        overall_feedback_ru: { type: 'string', description: 'Общее впечатление, 3–5 предложений, по-русски, со ссылками на конкретные места текста' },
        main_problem_ru: { type: 'string', description: 'Главная проблема текста — одна, самая важная' },
        strengths_ru: { type: 'array', items: { type: 'string' } },
        weaknesses_ru: { type: 'array', items: { type: 'string' } },
        next_steps_ru: { type: 'array', items: { type: 'string' }, description: 'Конкретные действия по порядку важности' },
        vocabulary_to_improve_ru: { type: 'array', items: { type: 'string' } },
        grammar_to_improve_ru: { type: 'array', items: { type: 'string' } },
        recommended_vocabulary: { type: 'array', items: VOCAB_ITEM_SCHEMA, description: 'Единицы, которых студенту не хватило, чтобы выразить свои мысли' },
        outline_coverage: {
            type: 'array',
            description: 'Заполняется ТОЛЬКО если студенту выдавался план. Иначе пустой массив.',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['point_ru', 'status', 'comment_ru'],
                properties: {
                    point_ru: { type: 'string' },
                    status: { type: 'string', enum: ['раскрыто', 'частично', 'не раскрыто'] },
                    comment_ru: { type: 'string' }
                }
            }
        },
        vocabulary_usage: {
            type: 'array',
            description: 'Заполняется ТОЛЬКО если у студента был словарный запас из плана. Иначе пустой массив.',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['term', 'used', 'comment_ru'],
                properties: {
                    term: { type: 'string' },
                    used: { type: 'boolean' },
                    comment_ru: { type: 'string' }
                }
            }
        },
        level_position_ru: { type: 'string', description: 'Где текст находится относительно заявленного уровня и что нужно, чтобы двигаться дальше' },
        parameter_scores: {
            type: 'array',
            description: 'Только для уровней с параметрической оценкой (B2/C1/C2). Иначе пустой массив.',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'score', 'comment_ru'],
                properties: {
                    name: { type: 'string' },
                    score: { type: 'number' },
                    comment_ru: { type: 'string' }
                }
            }
        },
        bonus_awarded: { type: 'number', description: 'Только там, где рубрика предусматривает бонус. Иначе 0.' },
        bonus_reason_ru: { type: 'string' },
        essay_requirements_check: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['requirement', 'addressed', 'note_ru'],
                properties: {
                    requirement: { type: 'string' },
                    addressed: { type: 'boolean' },
                    note_ru: { type: 'string' }
                }
            }
        }
    }
};

/**
 * @param {string} level
 * @param {object} rubric  document Rubric (có thể null)
 * @param {object} ctx     { essayText, hasOutline, outlinePoints, vocabTerms }
 */
function validateCorrection(level, rubric, ctx = {}) {
    const p = getProfile(level);
    return (d) => {
        const errs = [];

        if (!nonEmpty(d.corrected_text, 5)) errs.push('Thiếu corrected_text.');
        if (!Array.isArray(d.errors)) errs.push('errors phải là mảng.');
        if (!nonEmpty(d.overall_feedback_ru, 60) || !isRussian(d.overall_feedback_ru)) {
            errs.push('overall_feedback_ru phải viết BẰNG TIẾNG NGA và đủ dài (tối thiểu 3 câu).');
        }
        if (!isRussian(d.main_problem_ru)) errs.push('main_problem_ru phải viết bằng tiếng Nga.');
        if (!isRussian(d.level_position_ru) || !new RegExp(level, 'i').test(String(d.level_position_ru))) {
            errs.push(`level_position_ru phải viết bằng tiếng Nga và nêu rõ trình độ ${level}.`);
        }
        ['strengths_ru', 'weaknesses_ru', 'next_steps_ru'].forEach(k => {
            const arr = Array.isArray(d[k]) ? d[k] : [];
            if (!arr.length) errs.push(`${k} không được rỗng.`);
            arr.forEach((x, i) => { if (!isRussian(x)) errs.push(`${k}[${i}] phải viết bằng tiếng Nga.`); });
        });

        (d.errors || []).forEach((e, i) => {
            if (!nonEmpty(e.original)) errs.push(`errors[${i}].original rỗng.`);
            if (!nonEmpty(e.correction)) errs.push(`errors[${i}].correction rỗng.`);
            if (!ERROR_CLASSES.includes(e.error_class)) errs.push(`errors[${i}].error_class phải là КЗО hoặc КНЗО.`);
            // Chống giải thích hời hợt kiểu "Правильно: ..." (đúng lỗi của bản cũ).
            // A1/A2 được phép ngắn hơn vì chính profile yêu cầu giải thích cực đơn giản.
            const minExplain = p.needViGloss ? 45 : 70;
            const expl = String(e.explanation_ru || '');
            const isBareCorrection = /^\s*(правильно|верно|надо|нужно)\b/i.test(expl) && (expl.match(/[.!?]/g) || []).length <= 1;
            if (!nonEmpty(expl, minExplain) || !isRussian(expl) || isBareCorrection) {
                errs.push(`errors[${i}].explanation_ru quá hời hợt hoặc không phải tiếng Nga — bắt buộc nêu (1) quy tắc bị vi phạm, (2) vì sao ở ngữ cảnh này lại như vậy, (3) một ví dụ đúng.`);
            }
            if (!nonEmpty(e.rule_tip_ru, 8) || !isRussian(e.rule_tip_ru)) errs.push(`errors[${i}].rule_tip_ru phải là quy tắc ngắn bằng tiếng Nga.`);
            if (e.original === e.correction) errs.push(`errors[${i}]: original và correction giống hệt nhau — đây không phải lỗi.`);
            // Không được bịa: fragment phải thực sự có trong bài (mục 21)
            if (ctx.essayText && nonEmpty(e.original)) {
                const frag = String(e.original).trim().replace(/\s+/g, ' ');
                const hay = String(ctx.essayText).replace(/\s+/g, ' ');
                if (frag.length > 3 && !hay.includes(frag)) {
                    errs.push(`errors[${i}].original ("${frag}") không có trong bài viết của học viên — không được bịa trích dẫn.`);
                }
            }
        });

        (d.upgrades || []).forEach((u, i) => {
            if (!UPGRADE_TYPES.includes(u.upgrade_type)) errs.push(`upgrades[${i}].upgrade_type không hợp lệ.`);
            if (!isRussian(u.explanation_ru)) errs.push(`upgrades[${i}].explanation_ru phải bằng tiếng Nga.`);
            if (u.original === u.suggestion) errs.push(`upgrades[${i}]: không có thay đổi thực sự.`);
        });

        (d.recommended_vocabulary || []).forEach((v, i) => {
            if (!CYRILLIC.test(String(v.term || ''))) errs.push(`recommended_vocabulary[${i}].term phải bằng tiếng Nga.`);
            if (!isRussian(v.relevance_ru)) errs.push(`recommended_vocabulary[${i}].relevance_ru phải bằng tiếng Nga.`);
            if (!p.vocabulary.allowedDifficulty.includes(String(v.difficulty || '').trim())) {
                errs.push(`recommended_vocabulary[${i}].difficulty không hợp lệ cho ${p.code} (cho phép: ${p.vocabulary.allowedDifficulty.join(', ')}).`);
            }
        });

        // Bám đúng ngữ cảnh học tập: có dàn ý thì phải đối chiếu, không có thì phải để trống
        if (ctx.hasOutline) {
            if (!Array.isArray(d.outline_coverage) || d.outline_coverage.length < 2) {
                errs.push('Học viên đã có dàn ý → outline_coverage phải đối chiếu ít nhất 2 luận điểm của dàn ý đó.');
            }
        } else if (Array.isArray(d.outline_coverage) && d.outline_coverage.length) {
            errs.push('Học viên KHÔNG có dàn ý → outline_coverage phải là mảng rỗng (không được bịa dàn ý).');
        }
        if (Array.isArray(ctx.vocabTerms) && ctx.vocabTerms.length) {
            if (!Array.isArray(d.vocabulary_usage) || !d.vocabulary_usage.length) {
                errs.push('Có túi từ vựng → vocabulary_usage phải đánh giá việc dùng các từ đó.');
            }
        }

        // Điểm số: chỉ kiểm tra phần AI được phép chấm (thô), phần tính toán do backend làm
        if (rubric && rubric.scoringMethod === 'parameter') {
            const names = rubric.parameters.map(x => x.name);
            const normNames = names.map(normalizeParamName);
            const got = (d.parameter_scores || []);
            if (got.length !== names.length) errs.push(`parameter_scores phải có đúng ${names.length} tham số: ${names.join(' / ')}.`);
            got.forEach((s, i) => {
                const norm = normalizeParamName(s.name);
                const idx = normNames.indexOf(norm);
                if (idx === -1) errs.push(`parameter_scores[${i}].name "${s.name}" không khớp với bất kỳ tham số nào của rubric (${names.join(' / ')}).`);
                const max = idx !== -1 ? rubric.parameters[idx].maxScore : 5;
                if (typeof s.score !== 'number' || s.score < 0 || s.score > max) errs.push(`parameter_scores[${i}].score phải nằm trong 0–${max}.`);
                if (!isRussian(s.comment_ru)) errs.push(`parameter_scores[${i}].comment_ru phải bằng tiếng Nga.`);
            });
        }
        if (rubric && rubric.scoringMethod === 'deduction') {
            const maxBonus = rubric.deductionRules?.bonusRules?.maxBonus || 0;
            if (typeof d.bonus_awarded !== 'number' || d.bonus_awarded < 0 || d.bonus_awarded > maxBonus) {
                errs.push(`bonus_awarded phải nằm trong 0–${maxBonus} ở trình độ này.`);
            }
        }
        if (rubric && Array.isArray(rubric.essayRequirements) && rubric.essayRequirements.length) {
            if (!Array.isArray(d.essay_requirements_check) || d.essay_requirements_check.length !== rubric.essayRequirements.length) {
                errs.push(`essay_requirements_check phải kiểm tra đủ ${rubric.essayRequirements.length} yêu cầu bắt buộc của bài эссе.`);
            }
        }
        return errs;
    };
}

// ==========================================================================
// SCHEMA 3 — /api/vocabulary/detail
// ==========================================================================
const VOCAB_DETAIL_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['term', 'headword', 'pronunciation', 'stress_note_ru', 'part_of_speech_ru', 'gender_ru',
        'forms', 'meaning_ru', 'meaning_vi', 'usage_ru', 'collocations', 'grammar_note_ru',
        'examples', 'why_relevant_ru', 'cefr', 'register_ru'],
    properties: {
        term: { type: 'string' },
        headword: { type: 'string', description: 'Начальная форма' },
        pronunciation: { type: 'string', description: 'Слово с обозначенным ударением, например: защища́ть' },
        stress_note_ru: { type: 'string', description: 'Замечание об ударении (подвижное, на окончании и т. п.), либо пустая строка' },
        part_of_speech_ru: { type: 'string' },
        gender_ru: { type: 'string', description: 'Род — только для существительных, иначе пустая строка' },
        forms: {
            type: 'array',
            description: 'Полезные формы: вид глагола, множественное число, краткая форма…',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['label_ru', 'form'],
                properties: { label_ru: { type: 'string' }, form: { type: 'string' } }
            }
        },
        meaning_ru: { type: 'string', description: 'Толкование простыми русскими словами, по силам данному уровню' },
        meaning_vi: { type: 'string', description: 'Короткий вьетнамский эквивалент для сверки' },
        usage_ru: { type: 'string', description: 'Как именно употребляется: с каким падежом, в каком контексте, с чем сочетается' },
        collocations: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['phrase_ru', 'gloss_vi'],
                properties: { phrase_ru: { type: 'string' }, gloss_vi: { type: 'string' } }
            }
        },
        grammar_note_ru: { type: 'string', description: 'Связанная грамматическая конструкция и её схема' },
        examples: {
            type: 'array',
            description: '2–3 примера ПО ТЕМЕ сочинения',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['ru', 'vi'],
                properties: { ru: { type: 'string' }, vi: { type: 'string' } }
            }
        },
        why_relevant_ru: { type: 'string', description: 'Почему эта единица полезна именно в этом сочинении и на этом уровне' },
        cefr: { type: 'string' },
        register_ru: { type: 'string', description: 'нейтральное / книжное / разговорное / официально-деловое' }
    }
};

function validateVocabDetail(level) {
    return (d) => {
        const errs = [];
        if (!CYRILLIC.test(String(d.term || ''))) errs.push('term phải bằng tiếng Nga.');
        if (!/[\u0301\u0300]|ё/.test(String(d.pronunciation || '')) && String(d.pronunciation || '').trim().length < 2) {
            errs.push('pronunciation phải ghi rõ trọng âm (dùng dấu ́ sau nguyên âm nhấn).');
        }
        if (!isRussian(d.meaning_ru)) errs.push('meaning_ru phải bằng tiếng Nga.');
        if (!nonEmpty(d.usage_ru, 30) || !isRussian(d.usage_ru)) errs.push('usage_ru phải bằng tiếng Nga và đủ chi tiết.');
        if (!nonEmpty(d.why_relevant_ru, 25) || !isRussian(d.why_relevant_ru)) errs.push('why_relevant_ru phải bằng tiếng Nga, gắn với chính bài đang viết.');
        if (!Array.isArray(d.collocations) || d.collocations.length < 2) errs.push('collocations phải có ít nhất 2 mục.');
        if (!Array.isArray(d.examples) || d.examples.length < 2) errs.push('examples phải có ít nhất 2 câu.');
        (d.examples || []).forEach((ex, i) => {
            if (!isRussian(ex.ru)) errs.push(`examples[${i}].ru phải là câu tiếng Nga.`);
        });
        if (!nonEmpty(d.cefr)) errs.push('Thiếu cefr.');
        return errs;
    };
}

module.exports = {
    OUTLINE_SCHEMA, validateOutline,
    CORRECT_SCHEMA, validateCorrection,
    VOCAB_DETAIL_SCHEMA, validateVocabDetail,
    ERROR_CLASSES, UPGRADE_TYPES,
    isRussian, normalizeParamName
};
