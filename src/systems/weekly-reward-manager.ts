import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { adjustScoin } from './scoinManager';
import { sendAdminLog } from '../utils/adminLog';

// 10-minute tick interval for scheduler
const TICK_MS = 10 * 60_000;
let interval: NodeJS.Timeout | null = null;
let busy = false;

/**
 * Computes the week key (MONDAY yyyy-MM-dd) for the given date in the configured timezone.
 * Uses Intl.DateTimeFormat parts to get date components without host-TZ reliance.
 */
export function weekKeyFor(date: Date): string {
    const tz = config.maintenance.timezone;
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short'
    });

    const parts = formatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year')!.value;
    const month = parts.find(p => p.type === 'month')!.value;
    const day = parts.find(p => p.type === 'day')!.value;
    const weekdayStr = parts.find(p => p.type === 'weekday')!.value;

    // Map weekday short names to day offset from Monday (0 = Mon, 6 = Sun)
    const weekdayMap: { [key: string]: number } = {
        Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6
    };
    const offset = weekdayMap[weekdayStr] ?? 0;

    // Compute Monday by subtracting offset days
    const dateInt = parseInt(day, 10);
    const monday = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, dateInt - offset, 0, 0, 0));

    // Format as yyyy-MM-dd
    const monYear = monday.getUTCFullYear();
    const monMonth = String(monday.getUTCMonth() + 1).padStart(2, '0');
    const monDay = String(monday.getUTCDate()).padStart(2, '0');

    return `${monYear}-${monMonth}-${monDay}`;
}

/**
 * Records weekly activity for the user. Never throws (safe for hot message path).
 * No-op when weekly rewards disabled.
 */
export async function recordWeeklyActivity(userId: string, xpGained: number): Promise<void> {
    if (!config.weeklyRewards.enabled) return;

    try {
        const weekKey = weekKeyFor(new Date());
        await prisma.weeklyActivity.upsert({
            where: { userId_weekKey: { userId, weekKey } },
            update: {
                messages: { increment: 1 },
                xp: { increment: xpGained }
            },
            create: {
                userId,
                weekKey,
                messages: 1,
                xp: xpGained
            }
        });
    } catch (error) {
        console.error('[weeklyRewards] recordWeeklyActivity failed:', error);
    }
}

/**
 * Starts the weekly reward scheduler with a 10-min tick.
 * Fires on Monday at announceHour (in configured timezone).
 */
export function startWeeklyRewardScheduler(client: Client): void {
    if (interval) clearInterval(interval);

    interval = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
            await processWeeklyRewards(client);
        } catch (error) {
            console.error('[weeklyRewards] Scheduler tick failed:', error);
        } finally {
            busy = false;
        }
    }, TICK_MS);
}

async function processWeeklyRewards(client: Client): Promise<void> {
    const { enabled, channelId, announceHour, prizes, minXp } = config.weeklyRewards;
    if (!enabled) return;

    const now = new Date();
    const tz = config.maintenance.timezone;

    // Get current weekday and hour in configured timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
        hour: 'numeric',
        hour12: false
    });
    const parts = formatter.formatToParts(now);
    const weekdayStr = parts.find(p => p.type === 'weekday')?.value;
    const hourStr = parts.find(p => p.type === 'hour')?.value;

    // Only run on Monday at the configured hour
    if (weekdayStr !== 'Mon' || parseInt(hourStr ?? '0', 10) !== announceHour) {
        return;
    }

    // Target = last week's Monday (7 days ago)
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const target = weekKeyFor(lastWeek);

    // CLAIM FIRST (restart-safe): record this run before paying anyone
    try {
        await prisma.weeklyRewardRun.create({
            data: { weekKey: target }
        });
    } catch (error: any) {
        // P2002 = unique constraint violation → already ran → silently return
        if (error?.code === 'P2002') {
            return;
        }
        // Unexpected error during claim → log and bail (no payment)
        console.error(`[weeklyRewards] Failed to claim run for ${target}:`, error);
        await sendAdminLog(client, {
            title: '⚠️ Weekly Rewards Claim Failed',
            description: `Không thể claim run cho tuần ${target}. Không trao thưởng.`,
            color: '#e74c3c',
            fields: [{ name: 'Error', value: String(error?.message ?? error).slice(0, 1024) }]
        });
        return;
    }

    // Find top 3 winners (eligible: xp >= minXp)
    const winners = await prisma.weeklyActivity.findMany({
        where: {
            weekKey: target,
            xp: { gte: minXp }
        },
        orderBy: [
            { xp: 'desc' },
            { messages: 'desc' },
            { userId: 'asc' }
        ],
        take: 3
    });

    // No winners → just record the run (already done), post nothing
    if (winners.length === 0) {
        return;
    }

    // Award prizes
    const awardResults: { userId: string; prize: number; username: string; xp: number; messages: number }[] = [];
    for (let i = 0; i < winners.length; i++) {
        const winner = winners[i];
        const prize = prizes[i] ?? 0;
        if (prize <= 0) continue;

        try {
            await adjustScoin(
                winner.userId,
                prize,
                'Thưởng bảng vàng tuần',
                'weekly:reward',
                target
            );

            // Fetch username
            let username = 'Unknown';
            try {
                const user = await client.users.fetch(winner.userId);
                username = user.username;
            } catch {
                // Fallback to ID if fetch fails
                username = `User-${winner.userId.slice(0, 8)}`;
            }

            awardResults.push({
                userId: winner.userId,
                prize,
                username,
                xp: winner.xp,
                messages: winner.messages
            });
        } catch (error) {
            // Log error but continue (accepted trade-off: partial payment > nothing)
            console.error(`[weeklyRewards] Failed to award prize to ${winner.userId}:`, error);
            await sendAdminLog(client, {
                title: '⚠️ Weekly Reward Payment Failed',
                description: `Không thể trao ${prize} Scoin cho <@${winner.userId}> (tuần ${target}).`,
                color: '#e74c3c',
                fields: [
                    { name: 'User', value: `<@${winner.userId}>`, inline: true },
                    { name: 'Prize', value: `${prize} Scoin`, inline: true },
                    { name: 'Error', value: String(error instanceof Error ? error.message : error).slice(0, 1024) }
                ]
            });
        }
    }

    // Announce in channel (only if we have awards)
    if (awardResults.length === 0) {
        return;
    }

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            throw new Error(`Channel ${channelId} không tồn tại hoặc không phải text channel`);
        }

        const medals = ['🥇', '🥈', '🥉'];
        let description = `**Bảng vàng tuần ${target}** đã khép lại!\n\n`;

        for (let i = 0; i < awardResults.length; i++) {
            const { userId, prize, username, xp, messages } = awardResults[i];
            const medal = medals[i];
            description += `${medal} <@${userId}> (**${username}**)\n`;
            description += `> ${config.ui.emojis.star} **${xp.toLocaleString()}** XP · 💬 **${messages.toLocaleString()}** tin nhắn · **+${prize}** Scoin\n\n`;
        }

        description += `Chúc mừng các bạn! Tuần mới đã bắt đầu — hãy tiếp tục cống hiến nhé! 💪`;

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setAuthor({ name: 'Stella Studio', iconURL: client.user?.displayAvatarURL() })
            .setTitle('🏆 Thưởng Bảng Vàng Tuần')
            .setDescription(description)
            .setFooter({ text: 'Xếp hạng theo XP · Được tính từ thứ 2 tuần trước', iconURL: client.user?.displayAvatarURL() })
            .setTimestamp();

        await (channel as TextChannel).send({ embeds: [embed] });
    } catch (error) {
        // Log announcement failure (payment already succeeded)
        console.error(`[weeklyRewards] Failed to announce rewards for ${target}:`, error);
        await sendAdminLog(client, {
            title: '⚠️ Weekly Rewards Announcement Failed',
            description: `Đã trao thưởng thành công nhưng không thể đăng thông báo cho tuần ${target}.`,
            color: '#e67e22',
            fields: [
                { name: 'Winners', value: awardResults.map(r => `<@${r.userId}> (+${r.prize})`).join('\n').slice(0, 1024) },
                { name: 'Error', value: String(error instanceof Error ? error.message : error).slice(0, 1024) }
            ]
        });
    }
}
