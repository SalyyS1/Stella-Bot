import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { NEWSPAPER_WIDTH, NEWSPAPER_HEIGHT, MARGIN, PALETTE, LAYOUT, MC_BLOCKS } from './newspaper-layout';
import { wrapTextCapped, shrinkToFit, truncate, flowTextToBoxes } from './newspaper-text-fit';

// Renderer tờ báo nhật báo. Vẽ thuần canvas: măng-sét, headline, sapo, ảnh minh
// hoạ (AI hoặc hoạ tiết thay thế), lưới chuyên mục. KHÔNG gọi AI — nhận dữ liệu
// sẵn (FrontPageData) và trả PNG.
//
// Fail-soft: font chưa đăng ký → trả null (caller bỏ ảnh, đăng bản tin chữ).
// Mọi text đều qua truncate/wrapText/shrinkToFit — không tin prompt, không tràn.

export interface FrontPageSection {
    label: string;   // tên chuyên mục (≤ 14 ký tự)
    text: string;    // 1-2 dòng tóm tắt (≤ 100 ký tự)
}

export interface FrontPageData {
    date: string;    // yyyy-MM-dd (Saigon)
    headline: string;
    sapo: string;
    sections: FrontPageSection[];
    imagePrompt?: string;              // prompt ảnh minh hoạ (extract sinh ra)
    illustration?: Buffer | null; // ảnh AI đã gen; null = vẽ ô hoạ tiết
}

export interface RenderOptions {
    weekly?: boolean; // số đặc biệt: măng-sét đỏ + dòng "SỐ ĐẶC BIỆT — TUẦN VỪA QUA"
}

type Ctx = ReturnType<ReturnType<typeof createCanvas>['getContext']>;

// RNG nhỏ, seed từ ngày — ô minh hoạ thay thế trông khác mỗi ngày nhưng ổn định
// trong ngày (cùng ngày render lại ra cùng ảnh).
function seededRng(seedStr: string): () => number {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
        h ^= seedStr.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 15), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    };
}

// Vẽ ảnh phủ kín một vùng (cover crop) — ảnh AI tỉ lệ tuỳ ý, không bóp méo.
async function drawCover(ctx: Ctx, img: Buffer, x: number, y: number, w: number, h: number): Promise<void> {
    const image = await loadImage(img);
    const scale = Math.max(w / image.width, h / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
}

// Ô minh hoạ thay thế khi không có ảnh AI: dải khối Minecraft (cỏ/đất trên đá),
// seed theo ngày để không lặp y hệt nhưng ổn định trong ngày.
function drawFallbackIllustration(ctx: Ctx, x: number, y: number, w: number, h: number, seed: string): void {
    ctx.fillStyle = PALETTE.illustFallback;
    ctx.fillRect(x, y, w, h);
    const rng = seededRng(seed);
    const cell = 30;
    // Nền đá tối
    ctx.fillStyle = '#c9c2ae';
    for (let gy = 0; gy * cell < h; gy++) {
        for (let gx = 0; gx * cell < w; gx++) {
            if (rng() < 0.3) {
                ctx.fillStyle = MC_BLOCKS[Math.floor(rng() * MC_BLOCKS.length)];
                ctx.fillRect(x + gx * cell + 2, y + gy * cell + 2, cell - 4, cell - 4);
            }
        }
    }
    // Dải cỏ + đất dưới đáy (như terrain Minecraft)
    const stripY = y + h - cell * 2;
    for (let gx = 0; gx * cell < w; gx++) {
        const top = gx % 3 === 0 ? '#5d9b4c' : '#9db14e';
        ctx.fillStyle = top;
        ctx.fillRect(x + gx * cell, stripY, cell, cell);
        ctx.fillStyle = '#8b7f6b';
        ctx.fillRect(x + gx * cell, stripY + cell, cell, cell);
    }
}

// Vẽ text căn giữa theo chiều ngang (măng-sét, ngày, phụ đề).
function drawCentered(ctx: Ctx, text: string, y: number, font: string, color: string): void {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    const width = ctx.measureText(text).width;
    ctx.fillText(text, (NEWSPAPER_WIDTH - width) / 2, y);
}

// Vẽ khối măng-sét: kẻ trên, tên báo, ngày (+ phụ đề nếu weekly), kẻ dưới.
function drawMasthead(ctx: Ctx, data: FrontPageData, weekly: boolean): number {
    ctx.fillStyle = PALETTE.rule;
    ctx.fillRect(MARGIN, LAYOUT.ruleTop.y, NEWSPAPER_WIDTH - MARGIN * 2, LAYOUT.ruleTop.h);

    const mastColor = weekly ? PALETTE.red : PALETTE.ink;
    drawCentered(ctx, 'BÁO STELLA', LAYOUT.masthead.y, `bold ${LAYOUT.masthead.size}px "Noto Serif"`, mastColor);
    drawCentered(ctx, `NHẬT BÁO · ${data.date}`, LAYOUT.dateLine.y, `${LAYOUT.dateLine.size}px "Noto Sans"`, PALETTE.grey);
    if (weekly) {
        drawCentered(ctx, 'SỐ ĐẶC BIỆT — TUẦN VỪA QUA', LAYOUT.weeklyTag.y, `bold ${LAYOUT.weeklyTag.size}px "Noto Sans"`, PALETTE.red);
    }

    const ruleY = LAYOUT.ruleBottom.y + (weekly ? LAYOUT.ruleBottomWeeklyOffset : 0);
    ctx.fillStyle = PALETTE.rule;
    ctx.fillRect(MARGIN, ruleY, NEWSPAPER_WIDTH - MARGIN * 2, LAYOUT.ruleBottom.h);
    return ruleY + LAYOUT.ruleBottom.h;
}

// Vẽ headline: thu font tới khi vừa maxLines dòng VÀ không vượt maxHeight (band
// chuyên mục neo ở đáy cố định, headline phải nhường chỗ). Trả toạ độ y sau dòng cuối.
function drawHeadline(ctx: Ctx, headline: string, startY: number, maxHeight: number): number {
    const fit = shrinkToFit(
        ctx, 'bold', '"Noto Serif"', headline,
        LAYOUT.headline.maxWidth, LAYOUT.headline.maxLines,
        LAYOUT.headline.startSize, LAYOUT.headline.minSize,
        maxHeight, LAYOUT.headline.lineHeight
    );
    const lineHeight = Math.round(fit.size * LAYOUT.headline.lineHeight);
    ctx.font = `bold ${fit.size}px "Noto Serif"`;
    ctx.fillStyle = PALETTE.ink;
    ctx.textBaseline = 'top';
    let y = startY;
    for (const line of fit.text.split('\n')) {
        const width = ctx.measureText(line).width;
        ctx.fillText(line, (NEWSPAPER_WIDTH - width) / 2, y);
        y += lineHeight;
    }
    return y;
}

// Vẽ một ô chuyên mục: viền, label đỏ (thu font cho vừa ô — tên dài như "SỰ KIỆN
// SERVER" tràn nếu chỉ truncate theo ký tự) + gạch dưới, text 2 dòng kèm '…'.
function drawSectionBox(ctx: Ctx, section: FrontPageSection, x: number, y: number, w: number, h: number): void {
    const label = truncate(section.label, LAYOUT.sections.maxLabelChars).toUpperCase();
    const text = truncate(section.text, LAYOUT.sections.maxTextChars);

    ctx.fillStyle = PALETTE.boxBg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = LAYOUT.sections.borderW;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    const pad = LAYOUT.sections.padding;
    const labelY = y + pad;
    // Label thu font (1 dòng) tới khi vừa bề rộng ô — tên mục dài không được
    // vẽ đè viền sang ô bên cạnh.
    const labelFit = shrinkToFit(
        ctx, 'bold', '"Noto Sans"', label,
        w - pad * 2, 1,
        LAYOUT.sections.label.size, LAYOUT.sections.label.minSize
    );
    ctx.font = `bold ${labelFit.size}px "Noto Sans"`;
    ctx.fillStyle = PALETTE.red;
    ctx.textBaseline = 'top';
    ctx.fillText(labelFit.text, x + pad, labelY);
    // gạch chân label
    const labelW = ctx.measureText(labelFit.text).width;
    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(x + pad, labelY + labelFit.size + 3, labelW, 2);

    const textY = labelY + Math.round(labelFit.size * LAYOUT.sections.label.lineHeight) + 10;
    ctx.font = `${LAYOUT.sections.text.size}px "Noto Sans"`;
    ctx.fillStyle = PALETTE.ink;
    const lines = wrapTextCapped(ctx, text, w - pad * 2, LAYOUT.sections.text.maxLines);
    const lineHeight = Math.round(LAYOUT.sections.text.size * LAYOUT.sections.text.lineHeight);
    lines.forEach((line, i) => ctx.fillText(line, x + pad, textY + i * lineHeight));
}

// Vẽ lưới chuyên mục. Band cao CỐ ĐỊNH (sections.bandHeight) neo vào đáy canvas —
// số ô 1-4 chia đều bề ngang, không phụ thuộc độ dài headline nữa.
function drawSections(ctx: Ctx, sections: FrontPageSection[], y: number): void {
    if (!sections.length) return;
    const count = Math.min(sections.length, 4);
    const gap = LAYOUT.sections.gap;
    const totalW = NEWSPAPER_WIDTH - MARGIN * 2;
    const w = (totalW - gap * (count - 1)) / count;
    const h = LAYOUT.sections.bandHeight;
    sections.slice(0, count).forEach((section, i) => {
        drawSectionBox(ctx, section, MARGIN + i * (w + gap), y, w, h);
    });
}

// Render tờ báo thành PNG. Trả null khi font chưa đăng ký (không thể vẽ chữ
// tiếng Việt đúng) — caller bỏ ảnh, bản tin chữ vẫn đăng.
export async function renderNewspaper(
    data: FrontPageData,
    opts: RenderOptions = {}
): Promise<Buffer | null> {
    if (!GlobalFonts.has('Noto Serif') || !GlobalFonts.has('Noto Sans')) {
        console.error('[report] newspaper: font chưa đăng ký — bỏ ảnh tờ báo');
        return null;
    }
    const weekly = opts.weekly === true;
    const canvas = createCanvas(NEWSPAPER_WIDTH, NEWSPAPER_HEIGHT);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(0, 0, NEWSPAPER_WIDTH, NEWSPAPER_HEIGHT);

    const afterRule = drawMasthead(ctx, data, weekly);

    // Band chuyên mục neo vào đáy CỐ ĐỊNH — headline phải thu font cho vừa phần
    // còn lại giữa kẻ dưới măng-sét và đỉnh band, dù ngày ngắn hay dài.
    const sectionsY = NEWSPAPER_HEIGHT - LAYOUT.bottomMargin - LAYOUT.sections.bandHeight;
    const headlineMaxHeight = sectionsY - LAYOUT.bodyGap - LAYOUT.illustration.h - (afterRule + 20);

    // Headline bắt đầu ngay dưới kẻ — vị trí dịch theo weekly (masthead đẩy xuống).
    const afterHeadline = drawHeadline(ctx, data.headline, afterRule + 20, headlineMaxHeight);

    // Khối ảnh + sapo bắt đầu dưới headline
    const bodyY = afterHeadline + LAYOUT.bodyGap;
    const ix = MARGIN;
    const iy = bodyY;
    const iw = LAYOUT.illustration.w;
    const ih = LAYOUT.illustration.h;
    if (data.illustration) {
        await drawCover(ctx, data.illustration, ix, iy, iw, ih);
    } else {
        drawFallbackIllustration(ctx, ix, iy, iw, ih, data.date);
    }
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(ix + 1, iy + 1, iw - 2, ih - 2);

    // Sapo bên phải ảnh — wrap có '…' khi bị cắt, người đọc biết còn tiếp
    ctx.font = `${LAYOUT.sapo.size}px "Noto Sans"`;
    ctx.fillStyle = PALETTE.grey;
    ctx.textBaseline = 'top';
    const sapoLines = wrapTextCapped(ctx, data.sapo, LAYOUT.sapo.maxWidth, LAYOUT.sapo.maxLines);
    const sapoLineH = Math.round(LAYOUT.sapo.size * 1.3);
    sapoLines.forEach((line, i) => ctx.fillText(line, LAYOUT.sapo.x, iy + i * sapoLineH));

    // Lưới chuyên mục: band cố định ở đáy canvas (không phụ thuộc độ dài bài)
    drawSections(ctx, data.sections, sectionsY);

    return canvas.toBuffer('image/png');
}

// Một trang nội dung (trang 2+): măng-sét nhỏ + 2 cột text báo giấy. Nhận sẵn
// text cột trái/phải (flowTextToBoxes đã chia theo chiều cao) — vẽ thuần, không đo lại.
function drawArticlePage(ctx: Ctx, data: FrontPageData, leftText: string, rightText: string, pageNo: number, weekly: boolean): void {
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(0, 0, NEWSPAPER_WIDTH, NEWSPAPER_HEIGHT);

    const a = LAYOUT.article;
    // kẻ trên + măng-sét nhỏ + ngày + "tiếp theo" + kẻ dưới
    ctx.fillStyle = PALETTE.rule;
    ctx.fillRect(MARGIN, a.ruleTop.y, NEWSPAPER_WIDTH - MARGIN * 2, a.ruleTop.h);
    const mastColor = weekly ? PALETTE.red : PALETTE.ink;
    drawCentered(ctx, 'BÁO STELLA', a.masthead.y, `bold ${a.masthead.size}px "Noto Serif"`, mastColor);
    drawCentered(ctx, `NHẬT BÁO · ${data.date}`, a.dateLine.y, `${a.dateLine.size}px "Noto Sans"`, PALETTE.grey);
    drawCentered(ctx, `TIẾP THEO · TRANG ${pageNo}`, a.pageTag.y, `bold ${a.pageTag.size}px "Noto Sans"`, PALETTE.red);
    ctx.fillStyle = PALETTE.rule;
    ctx.fillRect(MARGIN, a.ruleBottom.y, NEWSPAPER_WIDTH - MARGIN * 2, a.ruleBottom.h);

    // 2 cột text
    const totalW = NEWSPAPER_WIDTH - MARGIN * 2;
    const colW = (totalW - a.columns.gutter) / a.columns.count;
    const colH = NEWSPAPER_HEIGHT - a.startY - LAYOUT.bottomMargin;
    ctx.font = `${a.text.size}px "Noto Sans"`;
    ctx.fillStyle = PALETTE.ink;
    ctx.textBaseline = 'top';
    const lineHeight = a.text.lineHeight;
    const columns = [leftText, rightText];
    columns.forEach((text, i) => {
        const x = MARGIN + i * (colW + a.columns.gutter);
        const lines = text ? text.split('\n') : [];
        lines.slice(0, Math.floor(colH / lineHeight)).forEach((line, j) => {
            ctx.fillText(line, x, a.startY + j * lineHeight);
        });
    });
}

// Render NHIỀU TRANG tờ báo: trang 1 = trang nhất (renderNewspaper), trang 2+ =
// nội dung đầy đủ dạng cột báo 2 cột. Body dài bao nhiêu thì đổ hết vào ảnh cho
// tới khi đủ LAYOUT.maxPages trang — phần dư nằm trong embed text (caller giữ nguyên).
// Trả null khi font chưa đăng ký.
export async function renderNewspaperPages(
    data: FrontPageData,
    body: string,
    opts: RenderOptions = {}
): Promise<Buffer[] | null> {
    const first = await renderNewspaper(data, opts);
    if (!first) return null;

    const pages: Buffer[] = [first];
    const contentBudget = LAYOUT.maxPages - 1;
    const text = (body ?? '').trim();
    if (contentBudget <= 0 || !text) return pages;

    const weekly = opts.weekly === true;
    const a = LAYOUT.article;
    const totalW = NEWSPAPER_WIDTH - MARGIN * 2;
    const colW = (totalW - a.columns.gutter) / a.columns.count;
    const colH = NEWSPAPER_HEIGHT - a.startY - LAYOUT.bottomMargin;

    // Đo trên một ctx canvas ảo (cùng font) để chia text thành các hộp cột.
    const measurer = createCanvas(10, 10).getContext('2d');
    measurer.font = `${a.text.size}px "Noto Sans"`;
    const boxes = flowTextToBoxes(measurer, text, colW, colH, a.text.lineHeight);

    const contentPages = Math.min(Math.ceil(boxes.length / a.columns.count), contentBudget);
    for (let p = 0; p < contentPages; p++) {
        const canvas = createCanvas(NEWSPAPER_WIDTH, NEWSPAPER_HEIGHT);
        const ctx = canvas.getContext('2d');
        drawArticlePage(ctx, data, boxes[p * 2] ?? '', boxes[p * 2 + 1] ?? '', p + 2, weekly);
        pages.push(canvas.toBuffer('image/png'));
    }
    return pages;
}
