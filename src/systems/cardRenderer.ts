import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { AttachmentBuilder } from 'discord.js';
import path from 'path';

// ============================================================
//  STELLA CARD RENDERER — Profile & Daily image cards
// ============================================================

/** Vẽ hình chữ nhật bo tròn */
function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

/** Vẽ avatar bo tròn */
async function drawAvatar(ctx: any, avatarUrl: string, x: number, y: number, size: number) {
    try {
        const avatar = await loadImage(avatarUrl);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, x, y, size, size);
        ctx.restore();

        // Border trắng quanh avatar
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2 + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.stroke();
    } catch {
        // Fallback: vẽ circle trống nếu load ảnh lỗi
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#5865F2';
        ctx.fill();
    }
}

/** Vẽ vòng tròn progress */
function drawProgressRing(ctx: any, cx: number, cy: number, radius: number, percent: number, color: string) {
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (Math.PI * 2 * percent);

    // Background ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Progress ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();
}

// ============================================================
//  PROFILE CARD
// ============================================================
interface ProfileData {
    username: string;
    avatarUrl: string;
    level: number;
    xp: number;
    xpNeeded: number;
    rank: number;
    totalMessages: number;
    dailyStreak: number;
    tierName: string;
    tierColor: string;
}

export async function renderProfileCard(data: ProfileData): Promise<AttachmentBuilder> {
    const W = 934;
    const H = 282;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // === BACKGROUND ===
    // Dark base
    roundRect(ctx, 0, 0, W, H, 20);
    ctx.fillStyle = '#1a1b1e';
    ctx.fill();

    // Accent gradient dải sáng bên phải
    const grad = ctx.createLinearGradient(W * 0.55, 0, W, H);
    grad.addColorStop(0, 'rgba(46, 204, 113, 0.0)');
    grad.addColorStop(0.5, 'rgba(46, 204, 113, 0.15)');
    grad.addColorStop(1, 'rgba(46, 204, 113, 0.3)');
    roundRect(ctx, 0, 0, W, H, 20);
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle border
    roundRect(ctx, 0, 0, W, H, 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // === AVATAR (trái) ===
    const avatarSize = 140;
    const avatarX = 40;
    const avatarY = (H - avatarSize) / 2;
    await drawAvatar(ctx, data.avatarUrl, avatarX, avatarY, avatarSize);

    // === INFO TEXT ===
    const textX = avatarX + avatarSize + 35;

    // Username
    ctx.fillStyle = data.tierColor;
    ctx.font = 'bold 22px "Noto Sans", Arial, sans-serif';
    ctx.fillText(data.username, textX, 55);

    // Tier badge
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '14px "Noto Sans", Arial, sans-serif';
    ctx.fillText(data.tierName, textX, 78);

    // "Level:" label
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '16px "Noto Sans", Arial, sans-serif';
    ctx.fillText('Level:', textX, 115);

    // Level number (lớn)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`${data.level}`, textX, 165);

    // "Experience:" label
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '16px "Noto Sans", Arial, sans-serif';
    ctx.fillText('Experience:', textX + 140, 115);

    // XP number
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`${data.xp.toLocaleString()}`, textX + 140, 158);

    // Stats row phía dưới
    const statsY = 200;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '13px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`💬 ${data.totalMessages.toLocaleString()} tin nhắn`, textX, statsY);
    ctx.fillText(`🔥 ${data.dailyStreak} ngày streak`, textX + 170, statsY);

    // === XP PROGRESS BAR (dưới cùng) ===
    const barX = textX;
    const barY = 228;
    const barW = 370;
    const barH = 14;
    const barRadius = barH / 2;
    const progress = Math.min(data.xp / data.xpNeeded, 1);

    // Bar background
    roundRect(ctx, barX, barY, barW, barH, barRadius);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fill();

    // Bar fill
    if (progress > 0) {
        const fillW = Math.max(barW * progress, barH);
        roundRect(ctx, barX, barY, fillW, barH, barRadius);
        const barGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
        barGrad.addColorStop(0, '#2ecc71');
        barGrad.addColorStop(1, '#27ae60');
        ctx.fillStyle = barGrad;
        ctx.fill();
    }

    // XP text trên bar
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '11px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`${data.xp.toLocaleString()} / ${data.xpNeeded.toLocaleString()} XP`, barX + barW + 10, barY + 11);

    // === RANK BOX (giữa-phải) ===
    const rankBoxX = W - 290;
    const rankBoxY = H / 2 - 30;

    // Rank label
    roundRect(ctx, rankBoxX, rankBoxY, 100, 60, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px "Noto Sans", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Rank:', rankBoxX + 50, rankBoxY + 22);

    ctx.fillStyle = data.tierColor;
    ctx.font = 'bold 24px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`#${data.rank}`, rankBoxX + 50, rankBoxY + 48);
    ctx.textAlign = 'left';

    // === PROGRESS RING (phải) ===
    const ringCx = W - 100;
    const ringCy = H / 2;
    const ringRadius = 55;
    const percent = Math.floor(progress * 100);

    // Ring background box
    roundRect(ctx, ringCx - 75, ringCy - 75, 150, 150, 15);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();

    drawProgressRing(ctx, ringCx, ringCy, ringRadius, progress, data.tierColor);

    // Percent text inside ring
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`${percent}%`, ringCx, ringCy + 2);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '11px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`${(data.xpNeeded - data.xp).toLocaleString()} xp`, ringCx, ringCy + 22);
    ctx.fillText('To go', ringCx, ringCy + 36);

    // "Next Lvl" label rotated
    ctx.save();
    ctx.translate(ringCx - ringRadius - 18, ringCy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '11px "Noto Sans", Arial, sans-serif';
    ctx.fillText('Next Lvl', 0, 0);
    ctx.restore();

    ctx.textAlign = 'left';

    // === OUTPUT ===
    const buffer = canvas.toBuffer('image/png');
    return new AttachmentBuilder(buffer, { name: 'profile-card.png' });
}

// ============================================================
//  DAILY CARD
// ============================================================
interface DailyData {
    username: string;
    avatarUrl: string;
    day: number;
    xpReward: number;
    tomorrowXp: number;
    streak: number;
    level: number;
    xp: number;
    xpNeeded: number;
    leveledUp: boolean;
}

export async function renderDailyCard(data: DailyData): Promise<AttachmentBuilder> {
    const W = 700;
    const H = 250;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    roundRect(ctx, 0, 0, W, H, 20);
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#151821');
    bg.addColorStop(0.48, '#242033');
    bg.addColorStop(1, '#17362f');
    ctx.fillStyle = bg;
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, W - 2, H - 2, 20);
    ctx.stroke();

    const starPoints = [
        [560, 34, 5], [604, 54, 3], [646, 30, 4], [520, 197, 3],
        [82, 38, 3], [126, 208, 4], [672, 168, 3]
    ];
    for (const [x, y, r] of starPoints) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fill();
    }

    await drawAvatar(ctx, data.avatarUrl, 34, 42, 92);

    ctx.fillStyle = '#f4f0ff';
    ctx.font = 'bold 25px "Noto Sans", Arial, sans-serif';
    ctx.fillText(data.username, 145, 58);
    ctx.fillStyle = 'rgba(244,240,255,0.62)';
    ctx.font = '14px "Noto Sans", Arial, sans-serif';
    ctx.fillText('Stella daily check-in', 146, 82);

    roundRect(ctx, 146, 102, 188, 64, 14);
    const rewardGrad = ctx.createLinearGradient(146, 102, 334, 166);
    rewardGrad.addColorStop(0, '#b76cff');
    rewardGrad.addColorStop(1, '#22d18f');
    ctx.fillStyle = rewardGrad;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '13px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`Day ${data.day}`, 164, 126);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`+${data.xpReward} XP`, 164, 156);

    roundRect(ctx, 354, 102, 138, 64, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.font = '13px "Noto Sans", Arial, sans-serif';
    ctx.fillText('Tomorrow', 372, 126);
    ctx.fillStyle = '#88f0c0';
    ctx.font = 'bold 22px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`+${data.tomorrowXp} XP`, 372, 155);

    roundRect(ctx, 514, 88, 136, 92, 18);
    ctx.fillStyle = 'rgba(16,19,28,0.52)';
    ctx.fill();
    ctx.strokeStyle = data.leveledUp ? '#ffd166' : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = data.leveledUp ? '#ffd166' : '#ffffff';
    ctx.font = 'bold 36px "Noto Sans", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Lv.${data.level}`, 582, 132);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '12px "Noto Sans", Arial, sans-serif';
    ctx.fillText(data.leveledUp ? 'LEVEL UP' : `${data.streak} day streak`, 582, 157);
    ctx.textAlign = 'left';

    const progress = Math.min(data.xp / data.xpNeeded, 1);
    roundRect(ctx, 34, 198, 632, 16, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fill();
    if (progress > 0) {
        roundRect(ctx, 34, 198, Math.max(16, 632 * progress), 16, 8);
        const xpGrad = ctx.createLinearGradient(34, 0, 666, 0);
        xpGrad.addColorStop(0, '#b76cff');
        xpGrad.addColorStop(0.55, '#5f8cff');
        xpGrad.addColorStop(1, '#22d18f');
        ctx.fillStyle = xpGrad;
        ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.font = '12px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`Streak ${data.streak} ngày`, 34, 232);
    ctx.textAlign = 'right';
    ctx.fillText(`${data.xp.toLocaleString()} / ${data.xpNeeded.toLocaleString()} XP`, 666, 232);
    ctx.textAlign = 'left';

    const buffer = canvas.toBuffer('image/png');
    return new AttachmentBuilder(buffer, { name: 'daily-card.png' });
}
