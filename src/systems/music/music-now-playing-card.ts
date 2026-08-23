import { createCanvas, loadImage } from '@napi-rs/canvas';
import { AttachmentBuilder } from 'discord.js';
import { ensureNotoSans } from '../../utils/canvas-font-registry';
import { formatDuration } from './music-format';

// ============================================================
//  NOW PLAYING CARD — anh card cho panel nhac
// ============================================================

export const NOW_PLAYING_CARD_FILENAME = 'stella-now-playing.png';

const W = 1000;
const H = 300;
const ART = { x: 28, y: 42, size: 216, radius: 18 };
const TEXT_X = 272;
const RIGHT_X = 972;
const BAR = { x: 272, y: 190, width: 700, height: 12 };
const CARD_CACHE_LIMIT = 20;
/** Cache theo moc 15s de bam Refresh lien tuc khong render lai vo ich. */
const CARD_CACHE_BUCKET_MS = 15_000;

const cardCache = new Map<string, Buffer>();

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

function truncateToWidth(ctx: any, text: string, maxWidth: number) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let value = text;
    while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
        value = value.slice(0, -1);
    }
    return `${value}…`;
}

/** Nen mo: ve anh bia xuong canvas ti hon roi keo gian len — khoi can blur lib. */
function drawBlurredBackground(ctx: any, artwork: any, accentColor: string) {
    if (artwork) {
        const small = createCanvas(40, 12);
        const smallCtx = small.getContext('2d');
        smallCtx.drawImage(artwork, 0, 0, 40, 12);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(small, 0, 0, W, H);
    } else {
        const base = ctx.createLinearGradient(0, 0, W, H);
        base.addColorStop(0, '#1a1b1e');
        base.addColorStop(1, accentColor);
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, W, H);
    }

    const shade = ctx.createLinearGradient(0, 0, W, H);
    shade.addColorStop(0, 'rgba(12,13,15,0.82)');
    shade.addColorStop(1, 'rgba(12,13,15,0.62)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
}

function drawArtwork(ctx: any, artwork: any, accentColor: string) {
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
        ctx.fillStyle = accentColor;
        ctx.fillRect(ART.x, ART.y, ART.size, ART.size);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 96px "Noto Sans", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('♪', ART.x + ART.size / 2, ART.y + ART.size / 2 + 34);
        ctx.textAlign = 'left';
    }
    ctx.restore();

    roundRect(ctx, ART.x, ART.y, ART.size, ART.size, ART.radius);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

async function drawRequester(ctx: any, data: NowPlayingCardData) {
    const label = data.requesterName ? `Yêu cầu bởi ${data.requesterName}` : '';
    if (!label) return;

    const avatarSize = 30;
    const avatarY = 246;
    let textX = TEXT_X;
    if (data.requesterAvatarUrl) {
        try {
            const avatar = await loadImage(data.requesterAvatarUrl);
            ctx.save();
            ctx.beginPath();
            ctx.arc(TEXT_X + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(avatar, TEXT_X, avatarY, avatarSize, avatarSize);
            ctx.restore();
            textX = TEXT_X + avatarSize + 10;
        } catch {
            // Avatar loi thi bo qua, chi hien ten.
        }
    }

    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = '17px "Noto Sans", Arial, sans-serif';
    ctx.fillText(truncateToWidth(ctx, label, 520), textX, avatarY + 21);
}

function drawProgress(ctx: any, data: NowPlayingCardData) {
    const duration = Number(data.duration || 0);
    const ratio = data.isStream || !duration ? 1 : Math.min(1, Math.max(0, data.position / duration));

    roundRect(ctx, BAR.x, BAR.y, BAR.width, BAR.height, BAR.height / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();

    const filled = Math.max(BAR.height, BAR.width * ratio);
    roundRect(ctx, BAR.x, BAR.y, filled, BAR.height, BAR.height / 2);
    ctx.fillStyle = data.accentColor;
    ctx.fill();

    if (!data.isStream && duration) {
        ctx.beginPath();
        ctx.arc(BAR.x + filled, BAR.y + BAR.height / 2, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }

    ctx.font = '18px "Noto Sans", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText(data.isStream ? 'LIVE' : formatDuration(data.position), BAR.x, 232);
    ctx.textAlign = 'right';
    ctx.fillText(formatDuration(data.duration, data.isStream), RIGHT_X, 232);
    ctx.textAlign = 'left';
}

/**
 * Render card. Khong bao gio throw: loi anh/font chi lam card don gian hon,
 * panel nhac van phai chay.
 */
export async function renderNowPlayingCard(data: NowPlayingCardData): Promise<AttachmentBuilder | null> {
    const bucket = Math.floor(data.position / CARD_CACHE_BUCKET_MS);
    const cacheKey = `${data.cacheKey}:${bucket}:${data.paused ? 'p' : 'r'}`;
    const cached = cardCache.get(cacheKey);
    if (cached) return new AttachmentBuilder(cached, { name: NOW_PLAYING_CARD_FILENAME });

    try {
        ensureNotoSans();
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');

        let artwork: any = null;
        if (data.artworkUrl) {
            try {
                artwork = await loadImage(data.artworkUrl);
            } catch {
                artwork = null;
            }
        }

        drawBlurredBackground(ctx, artwork, data.accentColor);
        drawArtwork(ctx, artwork, data.accentColor);

        ctx.fillStyle = data.accentColor;
        ctx.font = 'bold 18px "Noto Sans", Arial, sans-serif';
        ctx.fillText(data.paused ? 'ĐANG TẠM DỪNG' : 'ĐANG PHÁT', TEXT_X, 62);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 38px "Noto Sans", Arial, sans-serif';
        ctx.fillText(truncateToWidth(ctx, data.title, 700), TEXT_X, 114);

        const subtitle = [data.author, data.sourceLabel].filter(Boolean).join(' • ');
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.font = '22px "Noto Sans", Arial, sans-serif';
        ctx.fillText(truncateToWidth(ctx, subtitle, 700), TEXT_X, 152);

        drawProgress(ctx, data);
        await drawRequester(ctx, data);

        const buffer = canvas.toBuffer('image/png');
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
