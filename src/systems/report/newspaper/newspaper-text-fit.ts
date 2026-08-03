// Cắt chữ vừa khung trên canvas. Canvas KHÔNG tự xuống dòng và không tự thu font —
// AI trả headline dài bao nhiêu tuỳ hứng, nên mọi giới hạn phải do CODE ép, không
// tin prompt. Ba helper thuần (chỉ phụ thuộc một ctx giả lập { font, measureText })
// để dễ test mà không cần canvas thật.

export interface TextFitResult {
    text: string;   // chuỗi đã wrap, ngăn dòng bằng \n
    size: number;   // cỡ font cuối (bằng startSize khi không phải thu)
    lines: number;  // số dòng thực tế (≤ maxLines)
}

// Cắt chuỗi còn tối đa maxChars KÝ TỰ (không phải byte — tiếng Việt nhiều byte).
// Ưu tiên cắt tại dấu cách gần nhất để không cụt giữa chữ.
export function truncate(text: string, maxChars: number): string {
    const t = (text ?? '').trim();
    if (t.length <= maxChars) return t;
    const cut = t.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

// Xuống dòng theo chiều rộng khả dụng. maxLines <= 0 = không giới hạn (dùng để ĐO
// số dòng thật trước khi quyết định thu font). Từ đơn tràn khung được BẺ CỨNG và
// phần còn lại tiếp tục sang dòng sau — không mất ký tự.
export function wrapText(
    ctx: { measureText(text: string): { width: number } },
    text: string,
    maxWidth: number,
    maxLines: number
): string[] {
    const words = (text ?? '').trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    const fits = (s: string) => ctx.measureText(s).width <= maxWidth;

    for (const word of words) {
        let remaining = word;
        while (remaining) {
            if (current && !fits(`${current} ${remaining}`)) {
                lines.push(current);
                current = '';
                if (maxLines > 0 && lines.length >= maxLines) return lines;
            }
            if (current) {
                // Đã kiểm vừa ở trên: ghép cả phần còn lại.
                current = `${current} ${remaining}`;
                remaining = '';
            } else {
                // Đầu dòng: lấy phần vừa khung (từ quá dài bị bẻ cứng), phần dư
                // còn lại trong `remaining` để vòng while đưa sang dòng sau.
                let take = remaining;
                while (take.length > 1 && !fits(take)) take = take.slice(0, -1);
                current = take;
                remaining = remaining.slice(take.length);
            }
        }
    }
    if (current && (maxLines <= 0 || lines.length < maxLines)) lines.push(current);
    return lines;
}

// Wrap nhưng chỉ giữ maxLines dòng, dòng cuối thêm '…' khi bị cắt — để người đọc
// biết text còn tiếp thay vì tưởng renderer hỏng. Dùng cho sapo và ô chuyên mục.
export function wrapTextCapped(
    ctx: { measureText(text: string): { width: number } },
    text: string,
    maxWidth: number,
    maxLines: number
): string[] {
    const lines = wrapText(ctx, text, maxWidth, 0);
    if (lines.length <= maxLines) return lines;
    const capped = lines.slice(0, maxLines);
    capped[maxLines - 1] = capped[maxLines - 1].replace(/\s+$/, '') + '…';
    return capped;
}

// Chia text thành các "hộp" (cột/trang), mỗi hộp vừa maxWidth × maxHeight. Toàn
// bộ text được wrap thành dòng rồi cắt theo số dòng tối đa mỗi hộp — đổ tuần tự
// cột trái → cột phải → trang sau (báo giấy ngắt giữa câu là chuyện thường).
export function flowTextToBoxes(
    ctx: { measureText(text: string): { width: number } },
    text: string,
    maxWidth: number,
    maxHeight: number,
    lineHeight: number
): string[] {
    const lines = wrapText(ctx, text, maxWidth, 0);
    const maxLinesPerBox = Math.max(1, Math.floor(maxHeight / lineHeight));
    const boxes: string[] = [];
    for (let i = 0; i < lines.length; i += maxLinesPerBox) {
        boxes.push(lines.slice(i, i + maxLinesPerBox).join('\n'));
    }
    return boxes;
}

// Thu nhỏ cỡ font tới khi chuỗi wrap ra ≤ maxLines dòng VÀ tổng chiều cao
// (dòng × lineHeight × size) ≤ maxHeight. Đo bằng wrapText không giới hạn rồi so,
// vì wrapText có giới hạn sẽ luôn "vừa". Không còn cách nào vừa ở minSize thì cắt
// cứng ở minSize.
export function shrinkToFit(
    ctx: { font: string; measureText(text: string): { width: number } },
    weight: 'bold' | 'normal',
    family: string,
    text: string,
    maxWidth: number,
    maxLines: number,
    startSize: number,
    minSize: number,
    maxHeight = Infinity,
    lineHeightRatio = 1.12
): TextFitResult {
    const prefix = weight === 'bold' ? 'bold ' : '';
    let size = startSize;
    while (size >= minSize) {
        ctx.font = `${prefix}${size}px ${family}`;
        const measured = wrapText(ctx, text, maxWidth, 0);
        const height = measured.length * Math.round(size * lineHeightRatio);
        if (measured.length <= maxLines && height <= maxHeight) {
            const final = wrapText(ctx, text, maxWidth, maxLines);
            return { text: final.join('\n'), size, lines: final.length };
        }
        size -= 2;
    }
    ctx.font = `${prefix}${minSize}px ${family}`;
    // Fallback xuống đáy minSize vẫn tràn: cắt qua wrapTextCapped để dòng cuối
    // mang '…' — không lặp lại lỗi cắt câm của phiên bản cũ.
    const final = wrapTextCapped(ctx, text, maxWidth, maxLines);
    return { text: final.join('\n'), size: minSize, lines: final.length };
}
