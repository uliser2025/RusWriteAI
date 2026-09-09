// ==========================================================================
// emails/verification.js — EMAIL XÁC NHẬN TÀI KHOẢN (tiếng Việt)
//
// Vì sao tách riêng khỏi server.js: HTML email phải viết theo lối bảng + inline
// style của năm 2005 (Outlook, Gmail cắt hết <style> và flex/grid), nên nó dài
// và không nên trộn vào file route. Tách ra thì server.js vẫn đọc được, và sau
// này thêm email quên mật khẩu chỉ cần thêm file cạnh đây.
//
// Ngôn ngữ: email gửi cho người Việt → TIẾNG VIỆT.
// Giao diện website vẫn giữ nguyên tiếng Nga, không liên quan tới file này.
// ==========================================================================

const BRAND = {
    name: 'RusWrite AI',
    blue: '#0039A6',      // xanh quốc kỳ Nga, trùng tông với web
    red: '#B3122B',
    ink: '#1D2433',
    inkSoft: '#5A6478',
    line: '#E4E8F0',
    paper: '#FFFFFF',
    canvas: '#F4F6FA'
};

// Người dùng đăng ký chỉ bằng email nên hệ thống chưa có trường tên riêng.
// Lấy phần trước @ làm lời chào cá nhân hoá — nhưng chỉ khi nó còn ra dáng một
// cái tên; "abc123xyz" hay "no.reply" thì chào trung tính cho lịch sự.
function friendlyName(email) {
    const local = String(email || '').split('@')[0] || '';

    // Có chữ số trong địa chỉ → gần như chắc chắn không phải tên thật
    // ("x7f92k", "linh2003"), chào trung tính cho lịch sự.
    if (/\d/.test(local)) return '';

    const cleaned = local.replace(/[._\-+]+/g, ' ').trim();
    if (cleaned.length < 3 || cleaned.length > 24) return '';
    // Hộp thư chức năng, không phải tên người
    if (/^(no reply|noreply|info|admin|contact|support|hello|mail|team|test|me)$/i.test(cleaned)) return '';
    // Không có nguyên âm thì là chuỗi ký tự ngẫu nhiên, không phải tên
    if (!/[aeiouyаеёиоуыэюя]/i.test(cleaned)) return '';
    // Mỗi phần phải là chữ cái thuần
    if (!cleaned.split(/\s+/).every(w => /^[\p{L}]{2,}$/u.test(w))) return '';

    return cleaned
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function escapeHTML(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * @param {object} opts
 * @param {string} opts.email        địa chỉ người nhận
 * @param {string} opts.verifyLink   link xác nhận đầy đủ
 * @param {string} [opts.expiresIn]  mô tả thời hạn, mặc định '1 giờ'
 * @returns {{subject:string, html:string, text:string}}
 */
function buildVerificationEmail({ email, verifyLink, expiresIn = '1 giờ' }) {
    const name = friendlyName(email);
    const greeting = name ? `Chào ${escapeHTML(name)},` : 'Chào bạn,';
    const link = escapeHTML(verifyLink);
    const year = new Date().getFullYear();

    const subject = `${BRAND.name} — Xác nhận địa chỉ email của bạn`;

    // ----------------------------------------------------------------------
    // Bản HTML. Quy tắc đã tuân thủ để không vỡ trên Outlook/Gmail:
    //   - bố cục bằng <table>, không dùng flex/grid;
    //   - toàn bộ style viết inline;
    //   - chiều rộng tối đa 600px, tự co trên điện thoại nhờ width="100%";
    //   - nút CTA là <a> có padding, không dùng <button>.
    // ----------------------------------------------------------------------
    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.canvas};">
  <!-- Dòng xem trước hiện trong hộp thư, ẩn khỏi nội dung email -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Xác nhận email để kích hoạt tài khoản ${BRAND.name}. Liên kết có hiệu lực trong ${escapeHTML(expiresIn)}.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${BRAND.canvas};padding:32px 16px;">
    <tr><td align="center">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:100%;max-width:600px;background:${BRAND.paper};border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">

        <!-- Dải màu thương hiệu -->
        <tr><td style="height:4px;background:${BRAND.blue};font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Đầu thư -->
        <tr>
          <td style="padding:30px 36px 6px;">
            <span style="font-size:19px;font-weight:700;color:${BRAND.ink};letter-spacing:-.2px;">
              RusWrite <span style="color:${BRAND.blue};">AI</span>
            </span>
            <div style="margin-top:4px;font-size:13px;color:${BRAND.inkSoft};">
              Luyện viết tiếng Nga theo chuẩn ТРКИ
            </div>
          </td>
        </tr>

        <!-- Nội dung -->
        <tr>
          <td style="padding:22px 36px 0;">
            <h1 style="margin:0 0 16px;font-size:21px;line-height:1.35;color:${BRAND.ink};font-weight:700;">
              Xác nhận địa chỉ email của bạn
            </h1>

            <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${BRAND.ink};">
              ${greeting}
            </p>

            <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${BRAND.ink};">
              Cảm ơn bạn đã đăng ký ${BRAND.name} — nền tảng giúp người học Việt Nam
              rèn kỹ năng viết tiếng Nga: phân tích bài viết, chỉ ra lỗi kèm giải thích,
              chấm điểm theo tiêu chí ТРКИ và mở rộng vốn từ theo từng trình độ.
            </p>

            <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:${BRAND.ink};">
              Để hoàn tất đăng ký và bảo vệ tài khoản, bạn vui lòng xác nhận đây đúng là
              địa chỉ email của mình.
            </p>

            <!-- CTA -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
              <tr>
                <td style="border-radius:9px;background:${BRAND.blue};">
                  <a href="${link}"
                     style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:600;
                            color:#FFFFFF;text-decoration:none;border-radius:9px;">
                    Xác nhận địa chỉ email
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 22px;font-size:13.5px;line-height:1.6;color:${BRAND.inkSoft};">
              Liên kết có hiệu lực trong <strong style="color:${BRAND.ink};">${escapeHTML(expiresIn)}</strong>
              kể từ khi email này được gửi. Sau thời gian đó, bạn chỉ cần đăng ký lại để nhận liên kết mới.
            </p>

            <!-- Fallback link -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="background:${BRAND.canvas};border:1px solid ${BRAND.line};border-radius:10px;margin:0 0 22px;">
              <tr>
                <td style="padding:14px 16px;">
                  <div style="font-size:12.5px;color:${BRAND.inkSoft};margin-bottom:6px;">
                    Nút phía trên không bấm được? Sao chép liên kết sau vào trình duyệt:
                  </div>
                  <a href="${link}" style="font-size:12.5px;line-height:1.5;color:${BRAND.blue};
                     text-decoration:none;word-break:break-all;">${link}</a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 26px;font-size:13.5px;line-height:1.65;color:${BRAND.inkSoft};">
              Nếu bạn không đăng ký tài khoản ${BRAND.name}, bạn không cần làm gì thêm —
              tài khoản sẽ không được kích hoạt và email của bạn sẽ được gỡ khỏi hệ thống.
            </p>
          </td>
        </tr>

        <!-- Chân thư -->
        <tr>
          <td style="padding:0 36px 30px;">
            <div style="border-top:1px solid ${BRAND.line};padding-top:18px;">
              <div style="font-size:12.5px;line-height:1.65;color:${BRAND.inkSoft};">
                Email này được gửi tới <span style="color:${BRAND.ink};">${escapeHTML(email)}</span>
                vì địa chỉ này vừa được dùng để đăng ký ${BRAND.name}.
              </div>
              <div style="margin-top:10px;font-size:12px;color:#8B93A5;">
                © ${year} ${BRAND.name}. Đây là email tự động, vui lòng không trả lời.
              </div>
            </div>
          </td>
        </tr>

      </table>

    </td></tr>
  </table>
</body>
</html>`;

    // ----------------------------------------------------------------------
    // Bản văn bản thuần — bắt buộc phải có. Thiếu nó, một số bộ lọc thư rác
    // hạ điểm email và người dùng đọc mail ở chế độ text sẽ thấy trang trắng.
    // ----------------------------------------------------------------------
    const text = [
        `${BRAND.name} — Xác nhận địa chỉ email`,
        '',
        name ? `Chào ${name},` : 'Chào bạn,',
        '',
        `Cảm ơn bạn đã đăng ký ${BRAND.name} — nền tảng giúp người học Việt Nam rèn kỹ năng`,
        'viết tiếng Nga: phân tích bài viết, chỉ ra lỗi kèm giải thích, chấm điểm theo tiêu chí',
        'ТРКИ và mở rộng vốn từ theo từng trình độ.',
        '',
        'Để hoàn tất đăng ký và bảo vệ tài khoản, vui lòng mở liên kết sau để xác nhận email:',
        '',
        verifyLink,
        '',
        `Liên kết có hiệu lực trong ${expiresIn}. Sau thời gian đó, bạn chỉ cần đăng ký lại`,
        'để nhận liên kết mới.',
        '',
        `Nếu bạn không đăng ký tài khoản ${BRAND.name}, bạn không cần làm gì thêm.`,
        '',
        '—',
        `Email này được gửi tới ${email} vì địa chỉ này vừa được dùng để đăng ký ${BRAND.name}.`,
        `© ${year} ${BRAND.name}. Email tự động, vui lòng không trả lời.`
    ].join('\n');

    return { subject, html, text };
}

module.exports = { buildVerificationEmail, friendlyName };
