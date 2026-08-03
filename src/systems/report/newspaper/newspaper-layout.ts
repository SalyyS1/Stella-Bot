// Hằng số layout cho tờ báo nhật báo — tách khỏi renderer để giữ file ngắn và để
// renderer chỉ lo "vẽ", còn mọi con số bố cục tập trung một chỗ dễ chỉnh.
//
// Phong cách: báo giấy cổ — nền giấy ố, măng-sét serif đậm, kẻ đen dày, chữ đen,
// nhấn đỏ cho label chuyên mục và số đặc biệt tuần.

export const NEWSPAPER_WIDTH = 1200;
export const NEWSPAPER_HEIGHT = 900;
export const MARGIN = 45;

export const PALETTE = {
    paper: '#f5f0e6',   // nền giấy ố
    ink: '#1a1a1a',     // chữ chính
    grey: '#4a4a4a',    // sapo
    red: '#b8232c',     // nhấn: label chuyên mục, số đặc biệt
    rule: '#111111',    // đường kẻ
    boxBg: '#ece5d3',   // nền ô chuyên mục
    illustFallback: '#ded7c4' // nền ô minh hoạ khi không có ảnh AI
};

// Vùng đứng của từng khối (toạ độ tính từ đầu canvas). Phần động (headline cao
// bao nhiêu tuỳ số dòng) do renderer cộng thêm.
export const LAYOUT = {
    masthead: { y: 58, size: 96 },       // "BÁO STELLA" — Noto Serif Bold
    dateLine: { y: 162, size: 30 },      // ngày — Noto Sans
    weeklyTag: { y: 196, size: 28 },     // "SỐ ĐẶC BIỆT — TUẦN VỪA QUA" (chỉ weekly)
    ruleTop: { y: 45, h: 6 },
    ruleBottom: { y: 232, h: 6 },        // +34px khi weekly (đẩy xuống cho tag)
    ruleBottomWeeklyOffset: 34,
    headline: {
        maxWidth: NEWSPAPER_WIDTH - MARGIN * 2,
        maxLines: 2,
        startSize: 88,
        minSize: 44,
        lineHeight: 1.12
    },
    bodyGap: 26,                         // khoảng cách giữa headline và khối ảnh+sapo
    illustration: { w: 470, h: 260 },    // ảnh minh hoạ (cover crop), sapo nằm bên phải
    sapo: {
        x: 545,
        maxWidth: NEWSPAPER_WIDTH - MARGIN - 545,
        maxLines: 4,
        size: 30
    },
    sections: {
        // Chiều cao BAND cố định neo vào đáy canvas — headline phải thu font cho
        // vừa phần còn lại, band không bao giờ tràn hay biến mất theo độ dài bài.
        bandHeight: 130,
        gap: 20,                         // khoảng cách giữa các ô
        padding: 14,
        borderW: 2,
        label: { size: 30, lineHeight: 1.15, minSize: 16 },
        text: { size: 24, maxLines: 2, lineHeight: 1.25 },
        maxLabelChars: 14,
        maxTextChars: 100
    },
    bottomMargin: 45,
    // Trang nội dung (trang 2+): cột báo giấy thật, 2 cột text chảy liên tục.
    // MAX_PAGES = tổng số ảnh tối đa (trang 1 trang nhất + trang nội dung).
    maxPages: 6,
    article: {
        masthead: { y: 40, size: 64 },
        dateLine: { y: 112, size: 22 },
        pageTag: { y: 138, size: 18 },
        ruleTop: { y: 30, h: 5 },
        ruleBottom: { y: 162, h: 5 },
        columns: { count: 2, gutter: 40 },
        text: { size: 24, lineHeight: 30 },
        startY: 182
    }
};

// Palette "Minecraft vibe" cho ô minh hoạ thay thế (không có ảnh AI) — khối đất,
// cỏ, cát, đá. Màu lấy từng khối theo seed ngày để ổn định trong ngày.
export const MC_BLOCKS = ['#7c6f5e', '#8b7f6b', '#5d9b4c', '#9db14e', '#e8d9a0', '#b3b3b3', '#3e3a33', '#a06a3c'];
