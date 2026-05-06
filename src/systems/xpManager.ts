import { GuildMember, Guild, TextChannel } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';

// ═══════════════════════════════════════════════
// 🌟 STELLA SPIRAL — Công thức XP độc quyền
// ═══════════════════════════════════════════════
// XP mỗi từ = min(độ dài từ + 1, 10)
//   → "bò" (2 ký tự) = 3 XP
//   → "nghiêng" (7 ký tự) = 8 XP
//   → "xin chào mọi người" = 4+5+3+7 = 19 XP
//
// XP để lên level tiếp = 80 × level^1.35 + 20 × level
//   → Lv1→2: ~100 XP    Lv10→11: ~1990 XP
//   → Lv50→51: ~22670 XP  Lv69→70: ~36580 XP
// ═══════════════════════════════════════════════

const xpCooldowns = new Map<string, number>();

/**
 * Tính XP cần thiết để đạt level tiếp theo
 */
export function xpToNextLevel(level: number): number {
    return Math.floor(80 * Math.pow(level, 1.35) + 20 * level);
}

/**
 * Tính tổng XP tích luỹ cần để đạt tới 1 level nhất định (từ level 1)
 */
export function totalXpForLevel(targetLevel: number): number {
    let total = 0;
    for (let i = 1; i < targetLevel; i++) {
        total += xpToNextLevel(i);
    }
    return total;
}

/**
 * Tính XP từ nội dung tin nhắn (dựa trên độ dài từ)
 */
export function calculateMessageXp(content: string): number {
    // Lọc ra các từ thật sự (chữ cái + số, bỏ emoji/ký tự đặc biệt)
    const words = content.split(/\s+/).filter(w => w.replace(/[^a-zA-Z0-9\u00C0-\u1EF9]/g, '').length > 0);

    if (words.length < config.xp.minWords) return 0;

    // Lọc từ trùng lặp (chống spam "bò bò bò bò bò")
    const uniqueWords = [...new Set(words.map(w => w.toLowerCase()))];
    // Nếu trùng > 70% → spam
    if (uniqueWords.length < words.length * 0.3) return 0;

    let totalXp = 0;
    for (const word of words) {
        const cleanWord = word.replace(/[^a-zA-Z0-9\u00C0-\u1EF9]/g, '');
        if (cleanWord.length === 0) continue;
        // Công thức: min(length + 1, 10)
        totalXp += Math.min(cleanWord.length + 1, 10);
    }

    return Math.min(totalXp, config.xp.maxXpPerMsg);
}

/**
 * Tính Daily XP dựa trên streak
 * Streak càng dài → XP càng nhiều (cap ở 200)
 */
export function calculateDailyXp(streak: number): number {
    return Math.min(30 + streak * 12, 200);
}

/**
 * Xử lý XP khi người dùng gửi tin nhắn
 * Trả về { leveledUp, newLevel, xpGained } hoặc null nếu cooldown
 */
export async function processMessageXp(userId: string, content: string, guild: Guild, member: GuildMember | null): Promise<{ leveledUp: boolean; newLevel: number; xpGained: number; oldLevel: number } | null> {
    // Kiểm tra cooldown
    const now = Date.now();
    const lastXp = xpCooldowns.get(userId) || 0;
    if (now - lastXp < config.xp.cooldownMs) return null;

    const xpGained = calculateMessageXp(content);
    if (xpGained === 0) return null;

    // Cập nhật cooldown
    xpCooldowns.set(userId, now);

    // Upsert user + cộng XP
    const user = await prisma.user.upsert({
        where: { id: userId },
        update: {
            xp: { increment: xpGained },
            totalMessages: { increment: 1 }
        },
        create: {
            id: userId,
            xp: xpGained,
            level: 1,
            totalMessages: 1
        }
    });

    const currentXp = user.xp; // XP sau khi cộng
    const currentLevel = user.level;
    const xpNeeded = xpToNextLevel(currentLevel);

    // Check level up
    if (currentXp >= xpNeeded) {
        const newLevel = currentLevel + 1;
        await prisma.user.update({
            where: { id: userId },
            data: {
                level: newLevel,
                xp: currentXp - xpNeeded // Dư XP chuyển sang level mới
            }
        });

        // Auto-role
        if (member) {
            await updateLevelRole(guild, member, newLevel);
        }

        return { leveledUp: true, newLevel, xpGained, oldLevel: currentLevel };
    }

    return { leveledUp: false, newLevel: currentLevel, xpGained, oldLevel: currentLevel };
}

/**
 * Cập nhật Role theo Level (gỡ role cũ, gắn role mới nếu đổi tier)
 */
export async function updateLevelRole(guild: Guild, member: GuildMember, level: number): Promise<void> {
    const tiers = config.xp.levelTiers;
    const currentTier = tiers.find(t => level >= t.minLevel && level <= t.maxLevel);
    if (!currentTier) return;

    // Tìm hoặc tạo role
    let role = guild.roles.cache.find(r => r.name === currentTier.roleName);
    if (!role) {
        try {
            role = await guild.roles.create({
                name: currentTier.roleName,
                color: currentTier.color,
                reason: 'Stella Bot — Auto Level Role'
            });
        } catch (e) {
            console.error('Failed to create level role:', e);
            return;
        }
    }

    // Gỡ tất cả role tier khác
    for (const tier of tiers) {
        if (tier.configKey === currentTier.configKey) continue;
        const oldRole = guild.roles.cache.find(r => r.name === tier.roleName);
        if (oldRole && member.roles.cache.has(oldRole.id)) {
            await member.roles.remove(oldRole).catch(() => {});
        }
    }

    // Gắn role mới nếu chưa có
    if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role).catch(() => {});
    }
}
