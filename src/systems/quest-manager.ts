import prisma from '../lib/prisma';
import { config } from '../config';
import { adjustScoin, adjustScoinTx } from './scoinManager';

// Quest catalog: key → target, reward, label, emoji
const QUEST_CATALOG = {
    chat: { target: 15, reward: 15, label: 'Trò chuyện: gửi 15 tin nhắn', emoji: '💬' },
    daily: { target: 1, reward: 10, label: 'Điểm danh /daily', emoji: '📅' },
    trivia: { target: 1, reward: 25, label: 'Trả lời đúng câu đố của Stella', emoji: '🧠' },
    vote: { target: 2, reward: 15, label: 'Vote 2 bài showcase/request', emoji: '👍' },
    star: { target: 1, reward: 15, label: 'Đi săn sao 1 lần', emoji: '⭐' }
} as const;

type QuestKey = keyof typeof QUEST_CATALOG;

/**
 * Returns today's quest day key (yyyy-MM-dd) in configured timezone.
 */
export function todayQuestDay(): string {
    const dayFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: config.maintenance.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return dayFormatter.format(new Date());
}

/**
 * Deterministic quest picker: same userId + day → same quest keys.
 * Simple string hash to select N quests from catalog.
 */
function pickQuestsForDay(userId: string, day: string, count: number): QuestKey[] {
    const keys = Object.keys(QUEST_CATALOG) as QuestKey[];
    const seed = `${userId}:${day}`;

    // Simple string hash (not crypto, just deterministic distribution)
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash) + seed.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
    }

    // Shuffle using hash as seed (Fisher-Yates with deterministic random)
    const shuffled = [...keys];
    for (let i = shuffled.length - 1; i > 0; i--) {
        hash = (hash * 1103515245 + 12345) & 0x7fffffff; // LCG
        const j = hash % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, count);
}

/**
 * Lazy-assign today's quests for a user. Race-safe via skipDuplicates.
 */
async function ensureQuestsAssigned(userId: string, day: string): Promise<void> {
    const pickedKeys = pickQuestsForDay(userId, day, config.quests.perDay);
    const questData = pickedKeys.map(key => ({
        userId,
        day,
        questKey: key,
        target: QUEST_CATALOG[key].target,
        reward: QUEST_CATALOG[key].reward
    }));

    await prisma.dailyQuest.createMany({
        data: questData,
        skipDuplicates: true
    });
}

/**
 * Record progress for a quest. Never throws (internal error handling).
 * No-op when quests disabled or kind not in catalog.
 */
export async function recordQuestProgress(userId: string, kind: string, n = 1): Promise<void> {
    try {
        // Early returns for disabled or invalid quest
        if (!config.quests.enabled) return;
        if (!(kind in QUEST_CATALOG)) return;

        const questKey = kind as QuestKey;
        const day = todayQuestDay();
        const questDef = QUEST_CATALOG[questKey];

        // 1. Lazy-assign today's quests
        await ensureQuestsAssigned(userId, day);

        // 2. Increment progress (only if not already completed)
        await prisma.dailyQuest.updateMany({
            where: { userId, day, questKey, completed: false },
            data: { progress: { increment: n } }
        });

        // 3. Race-safe completion claim
        const claimed = await prisma.dailyQuest.updateMany({
            where: {
                userId,
                day,
                questKey,
                completed: false,
                progress: { gte: questDef.target }
            },
            data: { completed: true }
        });

        // If we successfully claimed completion (count === 1), award Scoin
        if (claimed.count === 1) {
            await adjustScoin(
                userId,
                questDef.reward,
                `Hoàn thành nhiệm vụ: ${questDef.label}`,
                'quest:complete',
                `${day}:${questKey}`
            );

            // 4. Check for all-done bonus
            await checkAndPayAllDoneBonus(userId, day);
        }
    } catch (error) {
        console.error('[quest-manager] Error recording progress:', error);
    }
}

/**
 * Check if user completed all today's quests; if yes, pay streak bonus once.
 */
async function checkAndPayAllDoneBonus(userId: string, day: string): Promise<void> {
    // Count completed vs assigned quests
    const [completedCount, assignedCount] = await Promise.all([
        prisma.dailyQuest.count({ where: { userId, day, completed: true } }),
        prisma.dailyQuest.count({ where: { userId, day } })
    ]);

    if (completedCount !== assignedCount) return; // Not all done yet

    // All done! Pay bonus inside transaction (race-safe)
    await prisma.$transaction(async tx => {
        // Row-lock user to prevent double-pay
        await tx.user.update({
            where: { id: userId },
            data: { scoinBalance: { increment: 0 } }
        });

        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

        // Already paid bonus for today?
        if (user.lastQuestDay === day) return;

        // Calculate streak
        const yesterday = yesterdayQuestDay(day);
        const streak = (user.lastQuestDay === yesterday) ? user.questStreak + 1 : 1;
        const bonus = bonusForStreak(streak);

        // Update user streak and day
        await tx.user.update({
            where: { id: userId },
            data: {
                questStreak: streak,
                lastQuestDay: day
            }
        });

        // Pay bonus
        await adjustScoinTx(
            tx,
            userId,
            bonus,
            'Hoàn thành đủ nhiệm vụ ngày',
            'quest:allDone',
            day
        );
    });
}

/** All-done bonus for a given streak, capped. Single source for pay + display. */
function bonusForStreak(streak: number): number {
    return Math.min(
        config.quests.allDoneBonusBase + config.quests.allDoneBonusPerStreak * streak,
        config.quests.allDoneBonusCap
    );
}

/**
 * Returns yesterday's quest day key (yyyy-MM-dd).
 * Anchored at UTC noon so the host timezone can never shift the calendar day
 * (UTC noon ±12h stays on the same date in every timezone).
 */
function yesterdayQuestDay(today: string): string {
    const [year, month, day] = today.split('-').map(Number);
    const todayUtcNoon = new Date(Date.UTC(year, month - 1, day, 12));
    const yesterdayDate = new Date(todayUtcNoon.getTime() - 24 * 60 * 60_000);

    const dayFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: config.maintenance.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    return dayFormatter.format(yesterdayDate);
}

/**
 * Get user's quest board for today: assigned quests + current streak.
 */
export async function getQuestBoard(userId: string): Promise<{
    quests: Array<{
        key: string;
        label: string;
        emoji: string;
        progress: number;
        target: number;
        reward: number;
        completed: boolean;
    }>;
    streak: number;
    todayBonus: number;
    bonusPaidToday: boolean;
}> {
    const day = todayQuestDay();

    // Ensure quests are assigned
    await ensureQuestsAssigned(userId, day);

    // Fetch today's quests
    const quests = await prisma.dailyQuest.findMany({
        where: { userId, day },
        orderBy: { questKey: 'asc' }
    });

    // Fetch user streak
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { questStreak: true, lastQuestDay: true }
    });

    // The bonus shown must match what checkAndPayAllDoneBonus actually pays:
    // already paid today → the paid amount; otherwise project the streak the
    // user WILL have when finishing today (continuation vs reset to 1).
    const bonusPaidToday = user?.lastQuestDay === day;
    const effectiveStreak = bonusPaidToday
        ? (user?.questStreak || 1)
        : (user?.lastQuestDay === yesterdayQuestDay(day) ? (user?.questStreak || 0) + 1 : 1);

    return {
        todayBonus: bonusForStreak(effectiveStreak),
        bonusPaidToday,
        quests: quests.map(q => ({
            key: q.questKey,
            label: QUEST_CATALOG[q.questKey as QuestKey].label,
            emoji: QUEST_CATALOG[q.questKey as QuestKey].emoji,
            progress: q.progress,
            target: q.target,
            reward: q.reward,
            completed: q.completed
        })),
        streak: user?.questStreak || 0
    };
}
