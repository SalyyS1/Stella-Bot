import { config } from '../../../config';
import { generateImage, isImageEnabled } from '../../imageGenClient';
import { extractFrontPage } from './newspaper-extract';
import { renderNewspaper, FrontPageData } from './newspaper-canvas';

// Phối hợp 3 bước thành 1 ảnh tờ báo: trích trang nhất (AI text) → vẽ ảnh minh
// hoạ (AI image) → render canvas. Fail-soft TỪNG TẦNG, theo thứ tự:
//
//   extract lỗi         → null (bỏ hẳn ảnh, bản tin chữ vẫn đăng)
//   image gen lỗi/tắt   → vẫn render, ô minh hoạ = hoạ tiết canvas
//   render lỗi (font)   → null (bỏ ảnh)
//
// Không nhánh nào được ném lỗi ra caller (runReport) — ảnh là phụ, bản tin là chính.

export interface NewspaperImageOptions {
    weekly?: boolean; // số đặc biệt tuần: măng-sét đỏ + phụ đề
}

// Dựng ảnh tờ báo cho một bản tin. Trả PNG Buffer hoặc null (bỏ ảnh).
export async function buildFrontPageImage(
    body: string,
    date: string,
    opts: NewspaperImageOptions = {}
): Promise<Buffer | null> {
    if (!config.report.newspaper.enabled) return null;

    const data: FrontPageData | null = await extractFrontPage(body, date).catch(error => {
        console.error('[report] newspaper extract failed:', error);
        return null;
    });
    if (!data) {
        console.error('[report] newspaper: trích trang nhất thất bại — đăng bản tin chữ');
        return null;
    }

    // Ảnh minh hoạ: best-effort. Lỗi/tắt thì dùng ô hoạ tiết canvas (vẫn có ảnh
    // tờ báo, chỉ không có ảnh AI) — chính là fail-soft tầng giữa.
    if (config.report.newspaper.illustration.enabled && isImageEnabled() && data.imagePrompt) {
        const illustration = await generateImage(data.imagePrompt).catch(error => {
            console.error('[report] newspaper illustration failed:', error);
            return null;
        });
        data.illustration = illustration ? illustration.data : null;
    }

    return renderNewspaper(data, opts).catch(error => {
        console.error('[report] newspaper render failed:', error);
        return null;
    });
}
