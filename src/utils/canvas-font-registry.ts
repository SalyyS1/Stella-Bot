import { GlobalFonts } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';

// ============================================================
//  CANVAS FONT REGISTRY — dang ky Noto Sans mot lan cho canvas
// ============================================================
// Renderer newspaper co ban dang ky rieng (can ca Noto Serif), day la ban gon
// cho cac card chi dung Noto Sans. Dang ky lai nhieu lan la vo ich nen cache
// ket qua trong process.

const FONT_FAMILY = 'Noto Sans';
const FONT_FILES = ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf', 'NotoSans-variable.ttf'];

let registered: boolean | null = null;

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

/**
 * Tra true khi Noto Sans dung duoc. Fail mem: card van ve duoc bang font
 * fallback cua he thong, chi la dau tieng Viet co the xau hon.
 */
export function ensureNotoSans(): boolean {
    if (registered !== null) return registered;
    const dir = fontsDir();
    if (!dir) {
        console.warn('[canvas] Không tìm thấy thư mục fonts, dùng font hệ thống.');
        registered = false;
        return registered;
    }

    let ok = false;
    for (const file of FONT_FILES) {
        const fontPath = path.join(dir, file);
        if (!fs.existsSync(fontPath)) continue;
        try {
            if (GlobalFonts.registerFromPath(fontPath, FONT_FAMILY)) ok = true;
        } catch (error) {
            console.warn(`[canvas] Đăng ký font lỗi (${file}):`, error);
        }
    }
    registered = ok;
    return registered;
}
