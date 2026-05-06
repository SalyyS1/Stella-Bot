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

    // === BACKGROUND ===
    roundRect(ctx, 0, 0, W, H, 20);
    ctx.fillStyle = '#1a1b1e';
    ctx.fill();

    // === 3 CARDS ===
    const cardW = 180;
    const cardH = 180;
    const cardY = 20;
    const gap = 30;
    const startX = (W - (cardW * 3 + gap * 2)) / 2;

    // --- Card 1: Yesterday/Motivation ---
    const c1x = startX;
    roundRect(ctx, c1x, cardY, cardW, cardH, 15);
    const purpleGrad = ctx.createLinearGradient(c1x, cardY, c1x + cardW, cardY + cardH);
    purpleGrad.addColorStop(0, '#9b59b6');
    purpleGrad.addColorStop(1, '#8e44ad');
    ctx.fillStyle = purpleGrad;
    ctx.fill();

    // Decorative shapes on card 1
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(c1x + 15, cardY + 15, 25, 25);
    ctx.fillRect(c1x + cardW - 40, cardY + 15, 25, 25);
    ctx.fillRect(c1x + 10, cardY + cardH - 50, 15, 15);
    ctx.beginPath();
    ctx.arc(c1x + cardW - 25, cardY + cardH - 35, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px "Noto Sans", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Come back', c1x + cardW / 2, cardY + 80);
    ctx.font = 'bold 22px "Noto Sans", Arial, sans-serif';
    ctx.fillText('tomorrow', c1x + cardW / 2, cardY + 108);
    ctx.font = '14px "Noto Sans", Arial, sans-serif';
    ctx.fillText('for more XP!', c1x + cardW / 2, cardY + 132);

    // --- Card 2: Today (Active) ---
    const c2x = startX + cardW + gap;
    roundRect(ctx, c2x, cardY, cardW, cardH, 15);
    const greenGrad = ctx.createLinearGradient(c2x, cardY, c2x + cardW, cardY + cardH);
    greenGrad.addColorStop(0, '#2ecc71');
    greenGrad.addColorStop(1, '#27ae60');
    ctx.fillStyle = greenGrad;
    ctx.fill();

    // Glow effect
    ctx.shadowColor = '#2ecc71';
    ctx.shadowBlur = 20;
    roundRect(ctx, c2x, cardY, cardW, cardH, 15);
    ctx.strokeStyle = 'rgba(46,204,113,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Decorative dots
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    for (let i = 0; i < 8; i++) {
        const dx = c2x + 20 + Math.random() * (cardW - 40);
        const dy = cardY + 15 + Math.random() * 30;
        ctx.beginPath();
        ctx.arc(dx, dy, 2 + Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
    }

    // Chevrons ">>>>>"
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '16px "Noto Sans", Arial, sans-serif';
    ctx.fillText('》》》》', c2x + cardW / 2, cardY + 30);

    // Day label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`Day ${data.day}`, c2x + cardW / 2, cardY + 75);

    // Decorative lines
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c2x + 40, cardY + 95);
    ctx.lineTo(c2x + cardW - 40, cardY + 105);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c2x + 50, cardY + 110);
    ctx.lineTo(c2x + cardW - 30, cardY + 115);
    ctx.stroke();

    // XP reward (lớn)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`+${data.xpReward} XP`, c2x + cardW / 2, cardY + 160);

    // --- Card 3: Tomorrow (Locked) ---
    const c3x = startX + (cardW + gap) * 2;
    roundRect(ctx, c3x, cardY, cardW, cardH, 15);
    const darkGrad = ctx.createLinearGradient(c3x, cardY, c3x + cardW, cardY + cardH);
    darkGrad.addColorStop(0, '#1e8449');
    darkGrad.addColorStop(1, '#145a32');
    ctx.fillStyle = darkGrad;
    ctx.fill();

    // Chevrons
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '16px "Noto Sans", Arial, sans-serif';
    ctx.fillText('》》》》', c3x + cardW / 2, cardY + 30);

    // Tomorrow label
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = 'bold 22px "Noto Sans", Arial, sans-serif';
    ctx.fillText('Tomorrow', c3x + cardW / 2, cardY + 75);

    // Lock icon (vẽ bằng shapes)
    const lockCx = c3x + cardW / 2;
    const lockCy = cardY + 125;
    // Lock body
    roundRect(ctx, lockCx - 18, lockCy, 36, 30, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fill();
    // Lock arch
    ctx.beginPath();
    ctx.arc(lockCx, lockCy, 14, Math.PI, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // +XP tomorrow
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '14px "Noto Sans", Arial, sans-serif';
    ctx.fillText(`+${data.tomorrowXp} XP`, c3x + cardW / 2, cardY + 170);

    // === CONNECTION LINES giữa cards ===
    const lineY = cardY + cardH / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 3;

    // Line 1→2
    ctx.beginPath();
    ctx.moveTo(c1x + cardW + 2, lineY);
    ctx.lineTo(c2x - 2, lineY);
    ctx.stroke();
    // Dot
    ctx.beginPath();
    ctx.arc((c1x + cardW + c2x) / 2, lineY, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();

    // Line 2→3
    ctx.beginPath();
    ctx.moveTo(c2x + cardW + 2, lineY);
    ctx.lineTo(c3x - 2, lineY);
    ctx.stroke();
    // Arrow dot
    ctx.beginPath();
    ctx.arc((c2x + cardW + c3x) / 2, lineY, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fill();

    // === BOTTOM BAR: Streak + Level info ===
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px "Noto Sans", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`🔥 Streak: ${data.streak} ngày  |  📊 Lv.${data.level}  |  XP: ${data.xp.toLocaleString()}/${data.xpNeeded.toLocaleString()}`, startX, H - 15);

    if (data.leveledUp) {
        ctx.textAlign = 'right';
        ctx.fillStyle = '#f1c40f';
        ctx.font = 'bold 14px "Noto Sans", Arial, sans-serif';
        ctx.fillText(`🎉 LEVEL UP → Lv.${data.level}!`, W - startX, H - 15);
    }

    ctx.textAlign = 'left';

    // === OUTPUT ===
    const buffer = canvas.toBuffer('image/png');
    return new AttachmentBuilder(buffer, { name: 'daily-card.png' });
}
