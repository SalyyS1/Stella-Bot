import { createCanvas, loadImage } from '@napi-rs/canvas';
import { AttachmentBuilder } from 'discord.js';
import { ensureNotoSans } from '../../utils/canvas-font-registry';
import { formatDuration } from './music-format';

// ============================================================
//  NOW PLAYING CARD — anh card cho panel nhac
// ============================================================
// Card la thu nguoi dung nhin dau tien nen no phai ganh phan "dep": anh bia,
// ten bai (toi da 2 dong), progress bar, va cac chip trang thai. Embed ben
// canh chi con danh sach bai ke tiep, khong lap lai nhung gi card da noi.

export const NOW_PLAYING_CARD_FILENAME = 'stella-now-playing.jpg';

const W = 1000;
const H = 344;
const ART = { x: 42, y: 42, size: 260, radius: 24 };
const TEXT_X = 332;
const RIGHT_X = 958;
const TEXT_WIDTH = RIGHT_X - TEXT_X;
const BAR = { x: TEXT_X, y: 228, width: TEXT_WIDTH, height: 12 };
const CHIP = { y: 282, height: 34, gap: 10, radius: 17, padding: 14 };
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
function drawBackground(ctx: any, artwork: any, accentColor: string) {
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

    const bottom = ctx.createLinearGradient(0, H - 120, 0, H);
    bottom.addColorStop(0, 'rgba(9,10,12,0)');
    bottom.addColorStop(1, 'rgba(9,10,12,0.55)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, H - 120, W, 120);

    // Vien sang mo o mep tren cho card khong bi "phang".
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
}

function drawArtwork(ctx: any, artwork: any, accentColor: string) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    roundRect(ctx, ART.x, ART.y, ART.size, ART.size, ART.radius);
    ctx.fillStyle = rgba(accentColor, 0.9);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, ART.x, ART.y, ART.size, ART.size, ART.radius);
    ctx.clip();
    if (artwork) {
        // Crop giua theo canh ngan de anh bia khong bi bop meo (thumbnail
        // YouTube la 16:9 hoac 4:3, o card lai la o vuong).
        const side = Math.min(artwork.width, artwork.height);
        const sx = (artwork.width - side) / 2;
        const sy = (artwork.height - side) / 2;
        ctx.drawImage(artwork, sx, sy, side, side, ART.x, ART.y, ART.size, ART.size);
    } else {
        const fallback = ctx.createLinearGradient(ART.x, ART.y, ART.x + ART.size, ART.y + ART.size);
        fallback.addColorStop(0, rgba(accentColor, 0.95));
        fallback.addColorStop(1, 'rgba(20,21,25,0.95)');
        ctx.fillStyle = fallback;
        ctx.fillRect(ART.x, ART.y, ART.size, ART.size);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 92px "Noto Sans", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('♪', ART.x + ART.size / 2, ART.y + ART.size / 2 + 34);
        ctx.textAlign = 'left';
    }
    ctx.restore();

    roundRect(ctx, ART.x, ART.y, ART.size, ART.size, ART.radius);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

type PillStyle = { bg: string; color: string; border?: string; font?: string; extraLeft?: number };

/** Ve mot "vien thuoc" chua chu, tra ve chieu rong da dung de xep chip ke tiep. */
function drawPill(ctx: any, x: number, y: number, height: number, label: string, style: PillStyle) {
    ctx.font = style.font || '16px "Noto Sans", Arial, sans-serif';
    const extraLeft = style.extraLeft || 0;
    const textWidth = ctx.measureText(label).width;
    const width = CHIP.padding * 2 + textWidth + extraLeft;

    roundRect(ctx, x, y, width, height, height / 2);
    ctx.fillStyle = style.bg;
    ctx.fill();
    if (style.border) {
        ctx.strokeStyle = style.border;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    ctx.fillStyle = style.color;
    ctx.fillText(label, x + CHIP.padding + extraLeft, y + height / 2 + 6);
    return width;
}

const GLASS_PILL: PillStyle = {
    bg: 'rgba(255,255,255,0.10)',
    border: 'rgba(255,255,255,0.16)',
    color: 'rgba(255,255,255,0.86)'
};

function drawHeader(ctx: any, data: NowPlayingCardData) {
    const statusLabel = data.paused ? 'TẠM DỪNG' : 'ĐANG PHÁT';
    let x = TEXT_X;
    x += drawPill(ctx, x, 42, 32, statusLabel, {
        bg: rgba(data.accentColor, 0.95),
        color: '#ffffff',
        font: 'bold 16px "Noto Sans", Arial, sans-serif'
    }) + CHIP.gap;

    if (data.sourceLabel) x += drawPill(ctx, x, 42, 32, data.sourceLabel, GLASS_PILL) + CHIP.gap;
    if (data.speakerLabel && x < RIGHT_X - 130) drawPill(ctx, x, 42, 32, data.speakerLabel, GLASS_PILL);
}

function drawTitleBlock(ctx: any, data: NowPlayingCardData) {
    ctx.font = 'bold 36px "Noto Sans", Arial, sans-serif';
    const lines = wrapToLines(ctx, data.title, TEXT_WIDTH, 2);

    ctx.fillStyle = '#ffffff';
    const titleTop = lines.length > 1 ? 124 : 146;
    lines.forEach((line, index) => ctx.fillText(line, TEXT_X, titleTop + index * 44));

    const subtitle = data.author || '';
    if (!subtitle) return;
    ctx.fillStyle = 'rgba(255,255,255,0.70)';
    ctx.font = '22px "Noto Sans", Arial, sans-serif';
    ctx.fillText(truncateToWidth(ctx, subtitle, TEXT_WIDTH), TEXT_X, lines.length > 1 ? 198 : 184);
}

function drawProgress(ctx: any, data: NowPlayingCardData) {
    const duration = Number(data.duration || 0);
    const ratio = data.isStream || !duration ? 1 : Math.min(1, Math.max(0, data.position / duration));

    roundRect(ctx, BAR.x, BAR.y, BAR.width, BAR.height, BAR.height / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fill();

    const filled = Math.max(BAR.height, BAR.width * ratio);
    const fill = ctx.createLinearGradient(BAR.x, BAR.y, BAR.x + filled, BAR.y);
    fill.addColorStop(0, data.accentColor);
    fill.addColorStop(1, lighten(data.accentColor, 0.45));
    roundRect(ctx, BAR.x, BAR.y, filled, BAR.height, BAR.height / 2);
    ctx.fillStyle = fill;
    ctx.fill();

    if (!data.isStream && duration) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(BAR.x + filled, BAR.y + BAR.height / 2, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
    }

    ctx.font = '17px "Noto Sans", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    // Ben trai luon la thoi gian da phat; ben phai la tong thoi luong, hoac
    // LIVE khi la stream (khong lap LIVE o ca hai ben).
    ctx.fillText(formatDuration(data.position), BAR.x, 264);
    ctx.textAlign = 'right';
    ctx.fillText(data.isStream ? 'LIVE' : formatDuration(data.duration), RIGHT_X, 264);
    ctx.textAlign = 'left';
}

/**
 * Hang chip duoi cung: am luong, so bai trong queue, che do lap, nguoi yeu cau.
 * Khong dung emoji vi canvas chi co Noto Sans — emoji se ra o vuong.
 */
async function drawChips(ctx: any, data: NowPlayingCardData) {
    let x = TEXT_X;
    const chips: string[] = [];
    if (typeof data.volume === 'number') chips.push(`Âm lượng ${data.volume}%`);
    if (typeof data.queueCount === 'number') chips.push(data.queueCount ? `Còn ${data.queueCount} bài` : 'Hết queue');
    if (data.loopLabel) chips.push(`Lặp: ${data.loopLabel}`);

    for (const chip of chips) {
        if (x > RIGHT_X - 150) break;
        x += drawPill(ctx, x, CHIP.y, CHIP.height, chip, GLASS_PILL) + CHIP.gap;
    }

    if (!data.requesterName) return;
    const avatarSize = 24;
    const label = truncateToWidth(ctx, data.requesterName, 200);
    const extraLeft = data.requesterAvatarUrl ? avatarSize + 8 : 0;
    drawPill(ctx, x, CHIP.y, CHIP.height, label, { ...GLASS_PILL, extraLeft });

    if (!data.requesterAvatarUrl) return;
    const avatar = await loadCachedImage(data.requesterAvatarUrl);
    if (!avatar) return;

    const avatarX = x + CHIP.padding;
    const avatarY = CHIP.y + (CHIP.height - avatarSize) / 2;
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
    const bucket = Math.floor(data.position / CARD_CACHE_BUCKET_MS);
    const state = [
        data.paused ? 'p' : 'r',
        data.volume ?? '',
        data.queueCount ?? '',
        data.loopLabel || ''
    ].join('|');
    const cacheKey = `${data.cacheKey}:${bucket}:${state}`;
    const cached = cardCache.get(cacheKey);
    if (cached) return new AttachmentBuilder(cached, { name: NOW_PLAYING_CARD_FILENAME });

    try {
        ensureNotoSans();
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');
        const artwork = await loadCachedImage(data.artworkUrl);

        drawBackground(ctx, artwork, data.accentColor);
        drawArtwork(ctx, artwork, data.accentColor);
        drawHeader(ctx, data);
        drawTitleBlock(ctx, data);
        drawProgress(ctx, data);
        await drawChips(ctx, data);

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



