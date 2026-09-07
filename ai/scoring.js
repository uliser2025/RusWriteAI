// ==========================================================================
// ai/scoring.js
// TÍNH ĐIỂM THEO RUBRIC ТРКИ/TORFL — thuần JS, KHÔNG gọi AI.
//
// Logic GIỮ NGUYÊN như bản trước refactor: AI chỉ phân loại lỗi КЗО/КНЗО và
// chấm thô từng tham số 0-5; mọi phép cộng/trừ/áp trần đều do file này làm.
//
// Khác biệt duy nhất so với bản cũ: chỉ mảng `errors` mới ảnh hưởng điểm.
// Mảng `upgrades` (gợi ý nâng cấp cách diễn đạt) KHÔNG BAO GIỜ trừ điểm.
// ==========================================================================

const { normalizeParamName } = require('./schemas');

function computeFinalScoring(rubric, aiRaw) {
    const errors = Array.isArray(aiRaw.errors) ? aiRaw.errors : [];
    if (!rubric) {
        return { method: 'none', note: 'Không có rubric cho trình độ này, chỉ hiển thị nhận xét định tính.' };
    }

    if (rubric.scoringMethod === 'deduction') {
        const kzoCount = errors.filter(e => e.error_class === 'КЗО').length;
        const knzoCount = errors.filter(e => e.error_class === 'КНЗО').length;
        const totalDeducted = kzoCount * rubric.deductionRules.kzoPenalty + knzoCount * rubric.deductionRules.knzoPenalty;

        let bonus = 0, bonusReason = '';
        if (rubric.deductionRules.bonusRules && typeof aiRaw.bonus_awarded === 'number') {
            bonus = Math.max(0, Math.min(aiRaw.bonus_awarded, rubric.deductionRules.bonusRules.maxBonus));
            bonusReason = aiRaw.bonus_reason_ru || aiRaw.bonus_reason || '';
        }

        const finalScore = Math.max(0, Math.min(rubric.totalScore, rubric.totalScore - totalDeducted + bonus));
        const isValid = rubric.deductionRules.invalidationThreshold
            ? totalDeducted <= rubric.deductionRules.invalidationThreshold
            : true;

        return {
            method: 'deduction',
            trki_name: rubric.trkiName,
            total_score: rubric.totalScore,
            kzo_count: kzoCount,
            kzo_penalty_each: rubric.deductionRules.kzoPenalty,
            knzo_count: knzoCount,
            knzo_penalty_each: rubric.deductionRules.knzoPenalty,
            total_deducted: totalDeducted,
            bonus_awarded: bonus,
            bonus_reason: bonusReason,
            final_score: finalScore,
            is_valid: isValid,
            validity_note: isValid ? null : `Tổng điểm trừ (${totalDeducted}) vượt ngưỡng ${rubric.deductionRules.invalidationThreshold} điểm — theo quy định ${rubric.trkiName}, bài viết ở mức này KHÔNG được công nhận, bất kể điểm số.`
        };
    }

    // scoringMethod === 'parameter'
    const hasKzo = errors.some(e => e.error_class === 'КЗО');
    const rawScores = Array.isArray(aiRaw.parameter_scores) ? aiRaw.parameter_scores : [];
    // So khớp KHÔNG phụ thuộc việc model có lặp lại phần chú thích tiếng Việt trong
    // ngoặc hay không (vd rubric ghi "Интенция (Ý đồ giao tiếp)", model trả "Интенция").
    // So khớp tuyệt đối ở đây từng khiến điểm bị tính thành 0 một cách ÂM THẦM.
    const parameters = rubric.parameters.map(p => {
        const target = normalizeParamName(p.name);
        const raw = rawScores.find(r => normalizeParamName(r.name) === target) || {};
        let score = typeof raw.score === 'number' ? Math.max(0, Math.min(p.maxScore, raw.score)) : 0;
        let capped = false;
        // Quy tắc: có lỗi КЗО thì tham số "Языковые средства" (ngôn ngữ) bị giới hạn điểm tối đa
        if (hasKzo && p.kzoCapsAt !== null && p.kzoCapsAt !== undefined && score > p.kzoCapsAt) {
            score = p.kzoCapsAt;
            capped = true;
        }
        return { name: p.name, max_score: p.maxScore, score, capped, comment: raw.comment_ru || raw.comment || '' };
    });
    const totalEarned = parameters.reduce((sum, p) => sum + p.score, 0);
    const totalMax = rubric.parameters.reduce((sum, p) => sum + p.maxScore, 0);

    return {
        method: 'parameter',
        trki_name: rubric.trkiName,
        parameters,
        total_score_earned: totalEarned,
        total_score_max: totalMax,
        kzo_cap_applied: hasKzo
    };
}

module.exports = { computeFinalScoring };
