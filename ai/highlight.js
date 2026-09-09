// ==========================================================================
// ai/highlight.js — NEO VỊ TRÍ LỖI VÀO BÀI VIẾT GỐC
//
// Vấn đề: AI trả về "original" là một cụm chữ trong bài, nhưng frontend cần
// biết CHÍNH XÁC cụm đó nằm ở ký tự thứ mấy để tô sáng đúng chỗ. Tìm bằng
// indexOf đơn giản sẽ sai khi:
//   - cùng một cụm xuất hiện nhiều lần trong bài;
//   - AI viết lại cụm đó với chữ hoa/thường khác, hoặc ё ↔ е;
//   - trong bài có nhiều khoảng trắng liền nhau, xuống dòng, tab;
//   - AI thêm/bớt dấu câu hai đầu cụm;
//   - AI dùng « » thay vì " ", – thay vì —.
//
// Module này giải quyết bằng cách so khớp trên một BẢN CHUẨN HOÁ của bài viết,
// đồng thời giữ BẢNG ÁNH XẠ ngược về chỉ số ký tự thật. Nhờ vậy chỉ số trả ra
// luôn là chỉ số trong chuỗi GỐC mà frontend đang hiển thị — không lệch.
//
// Nguyên tắc an toàn: THÀ KHÔNG TÔ CÒN HƠN TÔ SAI CHỖ.
// Lỗi nào không neo được chắc chắn sẽ có anchored=false; frontend vẫn liệt kê
// lỗi đó trong danh sách phân tích nhưng không tô lên bài viết.
//
// Không phụ thuộc vào bất kỳ module nào khác trong ./ai — có thể unit-test riêng.
// ==========================================================================

// --------------------------------------------------------------------------
// 1. CHUẨN HOÁ CÓ ÁNH XẠ NGƯỢC
// Trả về chuỗi đã chuẩn hoá + mảng map: map[j] = chỉ số trong chuỗi gốc của
// ký tự chuẩn hoá thứ j. Nhờ map này, mọi vị trí tìm được đều quy được về gốc.
// --------------------------------------------------------------------------
function normalizeWithMap(src) {
    const s = String(src || '');
    const out = [];
    const map = [];
    let prevWasSpace = false;

    for (let i = 0; i < s.length; i++) {
        let ch = s[i];

        // Dấu nhấn tổ hợp (у́, о́ trong sách giáo khoa) — bỏ qua, không tính là ký tự
        if (ch >= '\u0300' && ch <= '\u036f') continue;

        // Mọi loại khoảng trắng (space, tab, xuống dòng, nbsp) gộp thành một dấu cách
        if (/\s|\u00a0/.test(ch)) {
            if (prevWasSpace) continue;
            out.push(' ');
            map.push(i);
            prevWasSpace = true;
            continue;
        }
        prevWasSpace = false;

        ch = ch.toLowerCase();
        if (ch === 'ё') ch = 'е';            // ё và е coi như một
        if (ch === 'й') ch = 'й';            // chuẩn hoá й dựng sẵn / й tổ hợp
        if ('«»""„“”'.includes(ch)) ch = '"';
        if ('‘’'.includes(ch)) ch = "'";
        if ('–—−'.includes(ch)) ch = '-';

        out.push(ch);
        map.push(i);
    }

    return { norm: out.join(''), map, srcLength: s.length };
}

// Đổi khoảng [j, j+len) trên chuỗi chuẩn hoá về khoảng [start, end) trên chuỗi gốc
function toSourceRange(map, srcLength, j, len) {
    if (len <= 0) return null;
    const start = map[j];
    const lastIdx = map[j + len - 1];
    if (start === undefined || lastIdx === undefined) return null;
    return { start, end: Math.min(lastIdx + 1, srcLength) };
}

// Tìm TẤT CẢ vị trí xuất hiện của needle trong haystack (đã chuẩn hoá)
function findAll(haystack, needle) {
    const hits = [];
    if (!needle) return hits;
    let from = 0;
    for (; ;) {
        const j = haystack.indexOf(needle, from);
        if (j === -1) break;
        hits.push(j);
        from = j + 1; // cho phép chồng lấn, không bỏ sót
    }
    return hits;
}

// Gọt dấu câu / khoảng trắng thừa hai đầu cụm mà AI hay thêm vào
function trimEdges(s) {
    return String(s || '').replace(/^[\s"'«»„“”.,;:!?()\[\]…-]+/, '')
        .replace(/[\s"'«»„“”.,;:!?()\[\]…-]+$/, '');
}

// --------------------------------------------------------------------------
// 2. NEO MỘT CỤM
// Thứ tự ưu tiên, dừng ngay khi có kết quả CHẮC CHẮN:
//   (a) AI đã trả sẵn startIndex/endIndex và cắt ra đúng cụm  → tin ngay
//   (b) cụm xuất hiện đúng 1 lần trong bài                     → chắc chắn
//   (c) cụm xuất hiện nhiều lần → dùng câu ngữ cảnh, rồi đến
//       thứ tự đọc (lỗi sau phải nằm sau lỗi trước)
//   (d) không thấy → gọt dấu câu, rồi thử cụm rút gọn
//   (e) vẫn không thấy → trả null, KHÔNG đoán bừa
// --------------------------------------------------------------------------
function anchorOne({ normSrc, map, srcLength, source, fragment, context, startIndex, endIndex, searchFrom, taken }) {
    const raw = String(fragment || '').trim();
    if (!raw) return null;

    const overlapsTaken = (r) => taken.some(t => r.start < t.end && t.start < r.end);

    const candidatesFor = (needleRaw) => {
        const n = normalizeWithMap(needleRaw).norm.trim();
        if (n.length < 2) return [];
        return findAll(normSrc, n)
            .map(j => toSourceRange(map, srcLength, j, n.length))
            .filter(Boolean);
    };

    const pick = (ranges, confidence) => {
        if (!ranges.length) return null;

        // Ưu tiên vị trí nằm sau lỗi đã neo trước đó (AI liệt kê lỗi theo thứ tự đọc)
        const forward = ranges.filter(r => r.start >= searchFrom && !overlapsTaken(r));
        if (forward.length) return { ...forward[0], confidence };

        const free = ranges.filter(r => !overlapsTaken(r));
        if (free.length) return { ...free[0], confidence };

        // Hai lỗi thật sự đè lên nhau (một cụm vừa sai cách vừa sai từ) là chuyện
        // bình thường. buildSpans() cắt đoạn nên không hề vỡ layout — vẫn neo,
        // chỉ hạ mức tin cậy để frontend biết đây là vùng nhiều lỗi chồng nhau.
        const forwardOverlap = ranges.filter(r => r.start >= searchFrom);
        if (forwardOverlap.length) return { ...forwardOverlap[0], confidence: 'overlap' };
        return { ...ranges[0], confidence: 'overlap' };
    };

    // (a) Tin chỉ số AI trả về, nhưng PHẢI kiểm chứng lại bằng nội dung thật
    if (typeof startIndex === 'number' && typeof endIndex === 'number') {
        if (startIndex >= 0 && endIndex <= srcLength && endIndex > startIndex) {
            const cut = normalizeWithMap(source.slice(startIndex, endIndex)).norm.trim();
            const want = normalizeWithMap(raw).norm.trim();
            if (cut === want) return { start: startIndex, end: endIndex, confidence: 'exact' };
        }
        // Không khớp → bỏ qua chỉ số của AI, tự đi tìm. Đây chính là cơ chế
        // xác thực mà mục VIII yêu cầu: chỉ số sai thì không được dùng.
    }

    // (b) + (c)
    let ranges = candidatesFor(raw);
    if (ranges.length === 1 && !overlapsTaken(ranges[0])) {
        return { ...ranges[0], confidence: 'exact' };
    }
    if (ranges.length > 1 && context) {
        // Thu hẹp bằng câu ngữ cảnh: chỉ giữ vị trí nào nằm trong đoạn ngữ cảnh đó
        const ctxRanges = candidatesFor(context);
        if (ctxRanges.length) {
            const inside = ranges.filter(r => ctxRanges.some(c => r.start >= c.start && r.end <= c.end));
            if (inside.length) ranges = inside;
        }
    }
    // Nhiều vị trí giống nhau mà ngữ cảnh không tách được → vẫn neo theo thứ tự đọc
    // nhưng đánh dấu 'ambiguous' để frontend biết đây là suy đoán, không phải chắc chắn.
    const byOrder = pick(ranges, ranges.length > 1 ? 'ambiguous' : 'exact');
    if (byOrder) return byOrder;

    // (d) Gọt dấu câu hai đầu rồi thử lại
    const trimmed = trimEdges(raw);
    if (trimmed && trimmed !== raw) {
        const r = pick(candidatesFor(trimmed), 'trimmed');
        if (r) return r;
    }

    // (d2) Cụm dài mà AI chép hơi lệch: thử phần đầu của cụm (>= 60% số từ, tối thiểu 2 từ)
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length >= 3) {
        for (let take = words.length - 1; take >= Math.max(2, Math.ceil(words.length * 0.6)); take--) {
            const r = pick(candidatesFor(words.slice(0, take).join(' ')), 'partial');
            if (r) return r;
        }
    }

    // (e) Chịu thua — không tô còn hơn tô sai
    return null;
}

// --------------------------------------------------------------------------
// 3. CHIA BÀI VIẾT THÀNH CÁC ĐOẠN KHÔNG CHỒNG NHAU
// Hai lỗi nằm đè lên nhau (vd một cụm vừa sai cách vừa sai từ) sẽ khiến thẻ
// HTML lồng nhau và vỡ layout. Thay vì lồng thẻ, ta cắt bài viết tại mọi điểm
// biên, mỗi đoạn mang DANH SÁCH id lỗi đang phủ lên nó. Frontend chỉ việc
// render tuần tự — không bao giờ có highlight chồng highlight.
// --------------------------------------------------------------------------
function buildSpans(anchored) {
    if (!anchored.length) return [];

    const points = new Set();
    anchored.forEach(a => { points.add(a.start); points.add(a.end); });
    const cuts = [...points].sort((x, y) => x - y);

    const spans = [];
    for (let i = 0; i < cuts.length - 1; i++) {
        const start = cuts[i], end = cuts[i + 1];
        if (end <= start) continue;
        const ids = anchored.filter(a => a.start < end && start < a.end).map(a => a.id);
        if (ids.length) spans.push({ start, end, errorIds: ids });
    }
    return spans;
}

// --------------------------------------------------------------------------
// 4. HÀM CHÍNH — dùng trong server.js
//
//   const { errors, spans, stats } = anchorErrors(text, data.errors);
//
// Mỗi lỗi được bổ sung: id, startIndex, endIndex, anchored, anchorConfidence.
// KHÔNG làm thay đổi các trường sẵn có, nên frontend cũ vẫn chạy bình thường.
// --------------------------------------------------------------------------
function anchorErrors(sourceText, rawErrors, options = {}) {
    const source = String(sourceText || '');
    const { norm: normSrc, map, srcLength } = normalizeWithMap(source);
    const idPrefix = options.idPrefix || 'err';

    const taken = [];
    let searchFrom = 0;
    let anchoredCount = 0;

    const errors = (rawErrors || []).map((e, i) => {
        const id = e.id || `${idPrefix}_${String(i + 1).padStart(3, '0')}`;
        const fragment = e.original || e.original_text || e.originalText || '';

        const hit = anchorOne({
            normSrc, map, srcLength, source,
            fragment,
            context: e.context || e.sentence || e.context_ru || '',
            startIndex: typeof e.startIndex === 'number' ? e.startIndex : e.start_index,
            endIndex: typeof e.endIndex === 'number' ? e.endIndex : e.end_index,
            searchFrom,
            taken
        });

        if (hit) {
            taken.push({ start: hit.start, end: hit.end });
            searchFrom = hit.start; // lỗi kế tiếp thường nằm từ đây trở đi
            anchoredCount++;
            return {
                ...e, id,
                startIndex: hit.start,
                endIndex: hit.end,
                anchored: true,
                anchorConfidence: hit.confidence
            };
        }

        return { ...e, id, startIndex: null, endIndex: null, anchored: false, anchorConfidence: 'none' };
    });

    const spans = buildSpans(
        errors.filter(e => e.anchored).map(e => ({ id: e.id, start: e.startIndex, end: e.endIndex }))
    );

    return {
        errors,
        spans,
        stats: { total: errors.length, anchored: anchoredCount, unanchored: errors.length - anchoredCount }
    };
}

module.exports = { anchorErrors, normalizeWithMap, buildSpans };
