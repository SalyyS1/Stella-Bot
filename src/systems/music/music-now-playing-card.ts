import { createCanvas, loadImage } from '@napi-rs/canvas';
import { AttachmentBuilder } from 'discord.js';
import { ensureNotoSans } from '../../utils/canvas-font-registry';
import { formatDuration } from './music-format';
import { PanelLayout } from './music-panel-layout';

// ============================================================
//  NOW PLAYING CARD — anh card cho panel nhac
// ============================================================
// Card la thu nguoi dung nhin dau tien nen no phai ganh phan "dep": anh bia,
// ten bai (toi da 2 dong), progress bar, va cac chip trang thai. Embed ben
// canh chi con danh sach bai ke tiep, khong lap lai nhung gi card da noi.

export const NOW_PLAYING_CARD_FILENAME = 'stella-now-playing.jpg';

/**
 * Hai khuon card. `compact` khong phai ban thu nho cua `wide`: no cao hon so
 * voi be rong, va co font lon hon so voi khung, vi Discord thu ca anh theo be
 * rong cot chat — cot hep cua kenh voice lam card ngang thanh mot vach chu ti.
 */
type CardSpec = {
    width: number;
    height: number;
    art: { x: number; y: number; size: number; radius: number };
    textX: number;
    rightX: number;
    pill: { y: number; height: number; font: string; padding: number; gap: number };
    title: { font: string; lineHeight: number; topOneLine: number; topTwoLines: number };
    author: { font: string; yOneLine: number; yTwoLines: number };
    bar: { x: number; y: number; width: number; height: number };
    timesY: number;
    timesFont: string;
    chip: { x: number; y: number; height: number; gap: number; padding: number; rowGap: number; rows: number; font: string; right: number };
};

const WIDE_SPEC: CardSpec = {
    width: 1000,
    height: 344,
    art: { x: 42, y: 42, size: 260, radius: 24 },
    textX: 332,
    rightX: 958,
    pill: { y: 42, height: 32, font: '16px "Noto Sans", Arial, sans-serif', padding: 14, gap: 10 },
    title: { font: 'bold 36px "Noto Sans", Arial, sans-serif', lineHeight: 44, topOneLine: 146, topTwoLines: 124 },
    author: { font: '22px "Noto Sans", Arial, sans-serif', yOneLine: 184, yTwoLines: 198 },
    bar: { x: 332, y: 228, width: 626, height: 12 },
    timesY: 264,
    timesFont: '17px "Noto Sans", Arial, sans-serif',
    chip: { x: 332, y: 282, height: 34, gap: 10, padding: 14, rowGap: 8, rows: 1, font: '16px "Noto Sans", Arial, sans-serif', right: 958 }
};

const COMPACT_SPEC: CardSpec = {
    width: 620,
    height: 396,
    art: { x: 28, y: 28, size: 168, radius: 18 },
    textX: 216,
    rightX: 592,
    pill: { y: 28, height: 30, font: '15px "Noto Sans", Arial, sans-serif', padding: 12, gap: 8 },
    title: { font: 'bold 30px "Noto Sans", Arial, sans-serif', lineHeight: 38, topOneLine: 116, topTwoLines: 100 },
    author: { font: '19px "Noto Sans", Arial, sans-serif', yOneLine: 148, yTwoLines: 170 },
    bar: { x: 28, y: 240, width: 564, height: 12 },
    timesY: 276,
    timesFont: '17px "Noto Sans", Arial, sans-serif',
    chip: { x: 28, y: 296, height: 32, gap: 8, padding: 12, rowGap: 8, rows: 2, font: '16px "Noto Sans", Arial, sans-serif', right: 592 }
};

const CARD_CACHE_LIMIT = 20;
/** Cache theo moc 15s de bam Refresh lien tuc khong render lai vo ich. */
const CARD_CACHE_BUCKET_MS = 15_000;

const cardCache = new Map<string, Buffer>();
/**
 * Cache anh (bia + avatar) da decode. Doi bai chi la mot phan; moi lan bam nut
 * dieu khien la card phai ve lai, va tai lai anh bia qua mang moi lan la cho
 * cham nhat trong ca qua trinh render.
 */
const IMAGE_CACHE_LIMIT = 16;
const imageCache = new Map<string, any>();

async function loadCachedImage(url: string) {
    if (!url) return null;
    const cached = imageCache.get(url);
    if (cached) return cached;
    try {
        const image = await loadImage(url);
        if (imageCache.size >= IMAGE_CACHE_LIMIT) {
            const oldest = imageCache.keys().next().value;
            if (oldest) imageCache.delete(oldest);
        }
        imageCache.set(url, image);
        return image;
    } catch {
        return null;
    }
}

export type NowPlayingCardData = {
    title: string;
    author: string;
    sourceLabel: string;
    artworkUrl: string;
    position: number;
    duration: number | null;
    isStream: boolean;
    paused: boolean;
    accentColor: string;
    requesterName: string;
    requesterAvatarUrl: string;
    cacheKey: string;
    volume?: number;
    queueCount?: number;
    loopLabel?: string;
    speakerLabel?: string;
    autoplay?: boolean;
    layout?: PanelLayout;
};

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function parseHex(hex: string) {
    const clean = String(hex || '').replace('#', '').trim();
    const full = clean.length === 3 ? clean.split('').map(char => char + char).join('') : clean;
    const value = Number.parseInt(full, 16);
    if (!Number.isFinite(value) || full.length !== 6) return { r: 88, g: 101, b: 242 };
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgba(hex: string, alpha: number) {
    const { r, g, b } = parseHex(hex);
    return `rgba(${r},${g},${b},${alpha})`;
}

/** Sang hon accent de progress bar co gradient thay vi mot mau phang. */
function lighten(hex: string, ratio: number) {
    const { r, g, b } = parseHex(hex);
    const mix = (channel: number) => Math.round(channel + (255 - channel) * ratio);
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

function truncateToWidth(ctx: any, text: string, maxWidth: number) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let value = text;
    while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
        value = value.slice(0, -1);
    }
    return `${value}…`;
}

/** Cat ten bai thanh toi da `maxLines` dong theo tu, dong cuoi them dau …  */
function wrapToLines(ctx: any, text: string, maxWidth: number, maxLines: number) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';

    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth) {
            line = candidate;
            continue;
        }
        if (line) lines.push(line);
        line = word;
        if (lines.length === maxLines) break;
    }
    if (lines.length < maxLines && line) lines.push(line);
    if (!lines.length) return [truncateToWidth(ctx, text, maxWidth)];

    // Con chu chua ve het -> dong cuoi phai co dau … cho nguoi doc biet.
    const rendered = lines.join(' ');
    if (rendered.length < String(text || '').trim().length) {
        lines[lines.length - 1] = truncateToWidth(ctx, `${lines[lines.length - 1]}…`, maxWidth);
    }
    return lines.map(item => truncateToWidth(ctx, item, maxWidth));
}

/**
 * Nen mo: ve anh bia xuong canvas ti hon roi keo gian len — khoi can blur lib.
 * Hai buoc thu nho (64 roi 18) cho ra vet mo min hon mot buoc.
 */
function drawBackground(ctx: any, spec: CardSpec, artwork: any, accentColor: string) {
    const { width: W, height: H } = spec;
    if (artwork) {
        const pass1 = createCanvas(64, 64);
        pass1.getContext('2d').drawImage(artwork, 0, 0, 64, 64);
        const pass2 = createCanvas(18, 18);
        const pass2Ctx = pass2.getContext('2d');
        pass2Ctx.imageSmoothingEnabled = true;
        pass2Ctx.drawImage(pass1, 0, 0, 18, 18);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(pass2, 0, 0, W, H);
    } else {
        const base = ctx.createLinearGradient(0, 0, W, H);
        base.addColorStop(0, '#15161a');
        base.addColorStop(1, rgba(accentColor, 0.55));
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, W, H);
    }

    // Tint accent cho ca card cung tone voi source dang phat.
    ctx.fillStyle = rgba(accentColor, 0.14);
    ctx.fillRect(0, 0, W, H);

    // Toi ben trai (cho chu) va nhat dan sang phai (cho thay anh bia mo).
    const scrim = ctx.createLinearGradient(0, 0, W, 0);
    scrim.addColorStop(0, 'rgba(9,10,12,0.94)');
    scrim.addColorStop(0.55, 'rgba(9,10,12,0.78)');
    scrim.addColorStop(1, 'rgba(9,10,12,0.52)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, H);

    const fade = Math.min(120, Math.round(H * 0.35));
    const bottom = ctx.createLinearGradient(0, H - fade, 0, H);
    bottom.addColorStop(0, 'rgba(9,10,12,0)');
    bottom.addColorStop(1, 'rgba(9,10,12,0.62)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, H - fade, W, fade);

    // Vien sang mo o mep tren cho card khong bi "phang".
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
}

function drawArtwork(ctx: any, spec: CardSpec, artwork: any, accentColor: string) {
    const art = spec.art;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    roundRect(ctx, art.x, art.y, art.size, art.size, art.radius);
    ctx.fillStyle = rgba(accentColor, 0.9);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, art.x, art.y, art.size, art.size, art.radius);
    ctx.clip();
    if (artwork) {
        // Crop giua theo canh ngan de anh bia khong bi bop meo (thumbnail
        // YouTube la 16:9 hoac 4:3, o card lai la o vuong).
        const side = Math.min(artwork.width, artwork.height);
        const sx = (artwork.width - side) / 2;
        const sy = (artwork.height - side) / 2;
        ctx.drawImage(artwork, sx, sy, side, side, art.x, art.y, art.size, art.size);
    } else {
        const fallback = ctx.createLinearGradient(art.x, art.y, art.x + art.size, art.y + art.size);
        fallback.addColorStop(0, rgba(accentColor, 0.95));
        fallback.addColorStop(1, 'rgba(20,21,25,0.95)');
        ctx.fillStyle = fallback;
        ctx.fillRect(art.x, art.y, art.size, art.size);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = `bold ${Math.round(art.size * 0.35)}px "Noto Sans", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('♪', art.x + art.size / 2, art.y + art.size / 2 + art.size * 0.13);
        ctx.textAlign = 'left';
    }
    ctx.restore();

    roundRect(ctx, art.x, art.y, art.size, art.size, art.radius);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

type PillStyle = { bg: string; color: string; border?: string; font: string; padding: number; extraLeft?: number };

/** Ve mot "vien thuoc" chua chu, tra ve chieu rong da dung de xep chip ke tiep. */
function drawPill(ctx: any, x: number, y: number, height: number, label: string, style: PillStyle) {
    ctx.font = style.font;
    const extraLeft = style.extraLeft || 0;
    const textWidth = ctx.measureText(label).width;
    const width = style.padding * 2 + textWidth + extraLeft;

    roundRect(ctx, x, y, width, height, height / 2);
    ctx.fillStyle = style.bg;
    ctx.fill();
    if (style.border) {
        ctx.strokeStyle = style.border;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    ctx.fillStyle = style.color;
    ctx.fillText(label, x + style.padding + extraLeft, y + height / 2 + 6);
    return width;
}

const GLASS = {
    bg: 'rgba(255,255,255,0.10)',
    border: 'rgba(255,255,255,0.16)',
    color: 'rgba(255,255,255,0.86)'
};

function drawHeader(ctx: any, spec: CardSpec, data: NowPlayingCardData) {
    const pill = spec.pill;
    const glass: PillStyle = { ...GLASS, font: pill.font, padding: pill.padding };
    let x = spec.textX;

    x += drawPill(ctx, x, pill.y, pill.height, data.paused ? 'TẠM DỪNG' : 'ĐANG PHÁT', {
        bg: rgba(data.accentColor, 0.95),
        color: '#ffffff',
        font: `bold ${pill.font}`,
        padding: pill.padding
    }) + pill.gap;

    // Chip nao khong con cho thi bo, khong de tran ra ngoai card.
    const optional = [data.sourceLabel, data.speakerLabel].filter(Boolean) as string[];
    for (const label of optional) {
        ctx.font = pill.font;
        const width = pill.padding * 2 + ctx.measureText(label).width;
        if (x + width > spec.rightX) break;
        x += drawPill(ctx, x, pill.y, pill.height, label, glass) + pill.gap;
    }
}

function drawTitleBlock(ctx: any, spec: CardSpec, data: NowPlayingCardData) {
    const textWidth = spec.rightX - spec.textX;
    ctx.font = spec.title.font;
    const lines = wrapToLines(ctx, data.title, textWidth, 2);

    ctx.fillStyle = '#ffffff';
    const titleTop = lines.length > 1 ? spec.title.topTwoLines : spec.title.topOneLine;
    lines.forEach((line, index) => ctx.fillText(line, spec.textX, titleTop + index * spec.title.lineHeight));

    const subtitle = data.author || '';
    if (!subtitle) return;
    ctx.fillStyle = 'rgba(255,255,255,0.70)';
    ctx.font = spec.author.font;
    ctx.fillText(
        truncateToWidth(ctx, subtitle, textWidth),
        spec.textX,
        lines.length > 1 ? spec.author.yTwoLines : spec.author.yOneLine
    );
}

function drawProgress(ctx: any, spec: CardSpec, data: NowPlayingCardData) {
    const bar = spec.bar;
    const duration = Number(data.duration || 0);
    const ratio = data.isStream || !duration ? 1 : Math.min(1, Math.max(0, data.position / duration));

    roundRect(ctx, bar.x, bar.y, bar.width, bar.height, bar.height / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fill();

    const filled = Math.max(bar.height, bar.width * ratio);
    const fill = ctx.createLinearGradient(bar.x, bar.y, bar.x + filled, bar.y);
    fill.addColorStop(0, data.accentColor);
    fill.addColorStop(1, lighten(data.accentColor, 0.45));
    roundRect(ctx, bar.x, bar.y, filled, bar.height, bar.height / 2);
    ctx.fillStyle = fill;
    ctx.fill();

    if (!data.isStream && duration) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(bar.x + filled, bar.y + bar.height / 2, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
    }

    ctx.font = spec.timesFont;
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    // Ben trai luon la thoi gian da phat; ben phai la tong thoi luong, hoac
    // LIVE khi la stream (khong lap LIVE o ca hai ben).
    ctx.fillText(formatDuration(data.position), bar.x, spec.timesY);
    ctx.textAlign = 'right';
    ctx.fillText(data.isStream ? 'LIVE' : formatDuration(data.duration), bar.x + bar.width, spec.timesY);
    ctx.textAlign = 'left';
}

/**
 * Hang chip: am luong, so bai trong queue, che do lap, autoplay, nguoi yeu cau.
 * Khuon compact cho phep 2 hang vi cot chat hep. Khong dung emoji vi canvas chi
 * co Noto Sans — emoji se ra o vuong.
 */
async function drawChips(ctx: any, spec: CardSpec, data: NowPlayingCardData) {
    const chip = spec.chip;
    const style: PillStyle = { ...GLASS, font: chip.font, padding: chip.padding };
    let x = chip.x;
    let row = 0;

    /** Xep mot chip, tu xuong hang khi het cho. Tra vi tri da ve, null neu bo. */
    const place = (label: string, extraLeft = 0) => {
        ctx.font = chip.font;
        const width = chip.padding * 2 + ctx.measureText(label).width + extraLeft;
        if (x + width > chip.right) {
            if (row + 1 >= chip.rows) return null;
            row++;
            x = chip.x;
        }
        const drawnX = x;
        const drawnY = chip.y + row * (chip.height + chip.rowGap);
        drawPill(ctx, drawnX, drawnY, chip.height, label, { ...style, extraLeft });
        x = drawnX + width + chip.gap;
        return { x: drawnX, y: drawnY };
    };

    if (typeof data.volume === 'number') place(`Âm lượng ${data.volume}%`);
    if (typeof data.queueCount === 'number') place(data.queueCount ? `Còn ${data.queueCount} bài` : 'Hết queue');
    if (data.loopLabel) place(`Lặp: ${data.loopLabel}`);
    if (data.autoplay) place('Autoplay');

    if (!data.requesterName) return;
    const avatarSize = 24;
    ctx.font = chip.font;
    const label = truncateToWidth(ctx, data.requesterName, 180);
    const extraLeft = data.requesterAvatarUrl ? avatarSize + 8 : 0;
    const placed = place(label, extraLeft);
    if (!placed || !data.requesterAvatarUrl) return;

    const avatar = await loadCachedImage(data.requesterAvatarUrl);
    if (!avatar) return;

    const avatarX = placed.x + chip.padding;
    const avatarY = placed.y + (chip.height - avatarSize) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
}

/**
 * Render card. Khong bao gio throw: loi anh/font chi lam card don gian hon,
 * panel nhac van phai chay.
 */
export async function renderNowPlayingCard(data: NowPlayingCardData): Promise<AttachmentBuilder | null> {
    const layout: PanelLayout = data.layout === 'compact' ? 'compact' : 'wide';
    const spec = layout === 'compact' ? COMPACT_SPEC : WIDE_SPEC;
    const bucket = Math.floor(data.position / CARD_CACHE_BUCKET_MS);
    const state = [
        layout,
        data.paused ? 'p' : 'r',
        data.volume ?? '',
        data.queueCount ?? '',
        data.loopLabel || '',
        data.autoplay ? 'a' : ''
    ].join('|');
    const cacheKey = `${data.cacheKey}:${bucket}:${state}`;
    const cached = cardCache.get(cacheKey);
    if (cached) return new AttachmentBuilder(cached, { name: NOW_PLAYING_CARD_FILENAME });

    try {
        ensureNotoSans();
        const canvas = createCanvas(spec.width, spec.height);
        const ctx = canvas.getContext('2d');
        const artwork = await loadCachedImage(data.artworkUrl);

        drawBackground(ctx, spec, artwork, data.accentColor);
        drawArtwork(ctx, spec, artwork, data.accentColor);
        drawHeader(ctx, spec, data);
        drawTitleBlock(ctx, spec, data);
        drawProgress(ctx, spec, data);
        await drawChips(ctx, spec, data);

        // JPEG thay vi PNG: card la anh chup co nen mo, JPEG nho hon ~3 lan nen
        // moi lan bam nut khong phai upload lai 170KB.
        const buffer = canvas.toBuffer('image/jpeg', 92);
        if (cardCache.size >= CARD_CACHE_LIMIT) {
            const oldest = cardCache.keys().next().value;
            if (oldest) cardCache.delete(oldest);
        }
        cardCache.set(cacheKey, buffer);
        return new AttachmentBuilder(buffer, { name: NOW_PLAYING_CARD_FILENAME });
    } catch (error) {
        console.error('[music] Render now-playing card lỗi:', error);
        return null;
    }
}



