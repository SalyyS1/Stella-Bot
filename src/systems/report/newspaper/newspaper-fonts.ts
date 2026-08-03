import { GlobalFonts } from '@napi-rs/canvas';
import path from 'path';
import fs from 'fs';

// Font tiếng Việt cho tờ báo nhật báo. Host shared Linux thường KHÔNG có font hệ
// thống có dấu tiếng Việt — dựa vào "Noto Sans"/"Arial" theo tên như cardRenderer
// là ra ô vuông trên host. Nên font được NHÚNG vào repo và đăng ký bằng đường dẫn.
//
// Ưu tiên bộ static (đúng weight Bold/Regular); variable là dự phòng khi static
// thiếu — weight chỉ ra mặc định nhưng chữ vẫn đúng dấu, đủ dùng cho đường cứu hộ.

// Đăng ký static TRƯỚC, variable SAU cùng tên family: Skia giữ cả hai và chọn
// đúng weight khi renderer set 'bold'/'normal'.
const FONT_FILES = [
    { file: 'NotoSerif-Bold.ttf', family: 'Noto Serif' },
    { file: 'NotoSerif-Regular.ttf', family: 'Noto Serif' },
    { file: 'NotoSans-Bold.ttf', family: 'Noto Sans' },
    { file: 'NotoSans-Regular.ttf', family: 'Noto Sans' },
    { file: 'NotoSerif-variable.ttf', family: 'Noto Serif' },
    { file: 'NotoSans-variable.ttf', family: 'Noto Sans' }
];

// Resolve thư mục fonts theo nhiều gốc (repo dev / dist sau build) — đúng mẫu
// star.ts xử lý assets (chạy từ process.cwd()).
function fontsDir(): string | null {
    const candidates = [
        path.join(process.cwd(), 'src', 'assets', 'fonts'),
        path.join(process.cwd(), 'dist', 'assets', 'fonts'),
        path.join(process.cwd(), 'assets', 'fonts')
    ];
    for (const dir of candidates) {
        if (fs.existsSync(dir)) return dir;
    }
    return null;
}

// Đăng ký font. Trả true khi có đủ cả 2 family — renderer chỉ vẽ khi hàm này
// trả true. Fail mềm: log rõ file nào thiếu, không throw.
export function registerFonts(): boolean {
    const dir = fontsDir();
    if (!dir) {
        console.error('[report] newspaper: thư mục fonts không tìm thấy (src/assets/fonts)');
        return false;
    }
    const registered = new Set<string>();
    for (const { file, family } of FONT_FILES) {
        const p = path.join(dir, file);
        if (!fs.existsSync(p)) continue;
        try {
            const key = GlobalFonts.registerFromPath(p, family);
            if (key) registered.add(family);
            else console.error(`[report] newspaper: đăng ký font thất bại: ${file}`);
        } catch (error) {
            console.error(`[report] newspaper: đăng ký font ném lỗi (${file}):`, error);
        }
    }
    const ok = registered.has('Noto Serif') && registered.has('Noto Sans');
    if (!ok) {
        console.error('[report] newspaper: font không đầy đủ — bỏ ảnh tờ báo, đăng bản tin chữ');
    } else {
        console.log('[report] newspaper: font Noto Serif + Noto Sans đã sẵn sàng');
    }
    return ok;
}
