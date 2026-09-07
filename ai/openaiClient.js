// ==========================================================================
// ai/openaiClient.js
// LỚP DUY NHẤT trong toàn bộ project được phép gọi OpenAI.
//
// Vì sao gom về một chỗ:
//   - Tên model chỉ xuất hiện ĐÚNG MỘT LẦN, đọc từ process.env.OPENAI_MODEL.
//   - Mọi endpoint đều được hưởng chung: structured output, validate, retry,
//     đo thời gian, log chi phí token.
//   - Đổi model sau này = sửa file .env, không đụng vào code.
// ==========================================================================

const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Model mặc định nếu quên khai báo .env — vẫn là model đã thống nhất cho dự án.
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
// Mức "suy nghĩ" của dòng GPT-5.x. medium là điểm cân bằng tốt cho việc chấm bài.
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || 'medium';
// Trần token đầu ra. Dòng GPT-5.x dùng max_completion_tokens (KHÔNG phải max_tokens),
// và ĐIỀU QUAN TRỌNG: token "suy nghĩ" (reasoning) cũng trừ vào chính trần này.
// Schema của /api/correct khá lớn (lỗi + gợi ý nâng cấp + đối chiếu dàn ý + đối chiếu
// từ vựng...), nên đặt thấp sẽ khiến output bị CẮT CỤT GIỮA CHỪNG → JSON hỏng.
// 16000 là mức an toàn đã kiểm chứng với schema hiện tại của dự án.
const MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 16000);

// Một số tham số bị dòng reasoning model từ chối (temperature, top_p, max_tokens...).
// Thay vì đoán, ta gọi thử rồi tự gỡ đúng tham số mà API báo lỗi. Nhờ vậy code
// chạy được với cả gpt-4o-mini cũ lẫn gpt-5.4-mini mới mà không cần sửa gì.
const unsupportedParams = new Set();

function buildRequest(params) {
    const req = {
        model: MODEL,
        messages: params.messages,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        reasoning_effort: REASONING_EFFORT,
        response_format: params.response_format
    };
    for (const key of unsupportedParams) delete req[key];
    return req;
}

// Lấy tên tham số bị từ chối từ thông báo lỗi 400 của OpenAI
function extractBadParam(error) {
    const param = error?.error?.param || error?.param;
    const code = error?.error?.code || error?.code;
    const msg = error?.error?.message || error?.message || '';
    if (code === 'unsupported_parameter' || code === 'unknown_parameter' || /Unsupported parameter|Unknown parameter|Unsupported value/i.test(msg)) {
        if (param) return param;
        const m = /'([a-z_]+)'/.exec(msg);
        if (m) return m[1];
    }
    return null;
}

async function rawCall(params) {
    try {
        return await openai.chat.completions.create(buildRequest(params));
    } catch (err) {
        const bad = extractBadParam(err);
        if (bad && !unsupportedParams.has(bad)) {
            console.warn(`⚠️  Model ${MODEL} không nhận tham số "${bad}" — bỏ tham số này và gọi lại.`);
            unsupportedParams.add(bad);
            return await openai.chat.completions.create(buildRequest(params));
        }
        throw err;
    }
}

/**
 * Gọi model và BẮT BUỘC nhận về JSON đúng schema.
 *
 * @param {object}   o
 * @param {string}   o.system        - system prompt đã dựng sẵn
 * @param {string}   o.user          - nội dung người dùng (đề bài / bài luận / từ)
 * @param {object}   o.jsonSchema    - JSON Schema (strict) mô tả output
 * @param {string}   o.schemaName    - tên schema, hiện trong log
 * @param {function} o.validate      - (data) => string[]  danh sách lỗi ngữ nghĩa
 * @param {number}   o.maxAttempts   - số lần thử (mặc định 2)
 * @returns {Promise<{data:object, usage:object, attempts:number, ms:number}>}
 */
async function callJSON({ system, user, jsonSchema, schemaName, validate, maxAttempts = 2 }) {
    const started = Date.now();
    const messages = [
        { role: 'system', content: system },
        { role: 'user', content: user }
    ];

    let lastProblems = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Structured Outputs: model bị RÀNG BUỘC sinh đúng schema. Nếu SDK/model
        // không hỗ trợ, tự lùi về json_object (vẫn còn lớp validate của ta phía sau).
        let response;
        const responseFormat = jsonSchema
            ? { type: 'json_schema', json_schema: { name: schemaName || 'result', strict: true, schema: jsonSchema } }
            : { type: 'json_object' };

        try {
            response = await rawCall({ messages, response_format: responseFormat });
        } catch (err) {
            const msg = err?.error?.message || err.message || '';
            if (jsonSchema && /json_schema|response_format/i.test(msg)) {
                console.warn('⚠️  Model không hỗ trợ json_schema, lùi về json_object.');
                response = await rawCall({ messages, response_format: { type: 'json_object' } });
            } else {
                throw err;
            }
        }

        const content = response.choices?.[0]?.message?.content || '';
        const finishReason = response.choices?.[0]?.finish_reason;
        const usage = response.usage || {};

        // Nguyên nhân phổ biến nhất của "JSON hỏng" là bị CẮT CỤT vì hết token
        // (finish_reason === 'length'), không phải model viết sai cú pháp JSON.
        // Log rõ ràng ra đây để không còn phải đoán mò như lần trước.
        if (finishReason === 'length') {
            console.warn(`⚠️  ${schemaName}: output bị CẮT CỤT vì hết token (finish_reason=length, ` +
                `reasoning=${usage.completion_tokens_details?.reasoning_tokens ?? '?'}, ` +
                `completion=${usage.completion_tokens ?? '?'}/${MAX_OUTPUT_TOKENS}). ` +
                `Cân nhắc tăng OPENAI_MAX_OUTPUT_TOKENS trong .env.`);
        }

        let data;
        try {
            data = JSON.parse(content);
        } catch (e) {
            lastProblems = finishReason === 'length'
                ? [`Output bị cắt cụt vì hết token (finish_reason=length) — cần tăng OPENAI_MAX_OUTPUT_TOKENS.`]
                : ['Output không phải JSON hợp lệ.'];
            console.warn(`⚠️  ${schemaName}: lần thử ${attempt} thất bại — ${lastProblems[0]} (độ dài content: ${content.length} ký tự)`);
            messages.push({ role: 'assistant', content: content.slice(0, 2000) });
            messages.push({ role: 'user', content: 'Ответ не является корректным JSON или был обрезан. Верни ТОЛЬКО валидный, ПОЛНЫЙ JSON по схеме, без пояснений, короче по содержанию если нужно.' });
            continue;
        }

        const problems = validate ? validate(data) : [];
        if (!problems.length) {
            const usage = response.usage || {};
            console.log(`🤖 ${MODEL} · ${schemaName} · lần thử ${attempt} · ${Date.now() - started}ms · in ${usage.prompt_tokens || '?'} / out ${usage.completion_tokens || '?'} token`);
            return { data, usage, attempts: attempt, ms: Date.now() - started };
        }

        lastProblems = problems;
        console.warn(`⚠️  ${schemaName}: output chưa đạt (lần ${attempt}) → ${problems.join(' | ')}`);
        // Vòng sửa lỗi: đưa lại chính output sai + danh sách vấn đề cụ thể.
        messages.push({ role: 'assistant', content: JSON.stringify(data).slice(0, 4000) });
        messages.push({
            role: 'user',
            content: 'В предыдущем ответе есть нарушения требований:\n'
                + problems.map(p => `- ${p}`).join('\n')
                + '\nИсправь ИМЕННО эти пункты и верни полный JSON заново, полностью по схеме. Ничего не сокращай.'
        });
    }

    const err = new Error('AI_OUTPUT_INVALID');
    err.problems = lastProblems || ['Không rõ nguyên nhân'];
    throw err;
}

module.exports = { callJSON, MODEL, REASONING_EFFORT };
