import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { config } from '../config';
import prisma from '../lib/prisma';
import { adjustScoin } from './scoinManager';
import { sendAdminLog } from '../utils/adminLog';

// Month-day validation table (Feb supports 29 — celebrated Mar 1 in non-leap years).
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isValidDate(day: number, month: number): boolean {
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    return day <= MONTH_DAYS[month - 1];
}

function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

// Returns {year, month, day, hour} in the configured timezone using Intl parts.
function getTimePartsInTZ(tz: string, now = new Date()): { year: number; month: number; day: number; hour: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false
    }).formatToParts(now);

    const year = parseInt(parts.find(p => p.type === 'year')!.value);
    const month = parseInt(parts.find(p => p.type === 'month')!.value);
    const day = parseInt(parts.find(p => p.type === 'day')!.value);
    const hour = parseInt(parts.find(p => p.type === 'hour')!.value);

    return { year, month, day, hour };
}

export async function setBirthday(userId: string, day: number, month: number): Promise<void> {
    if (!isValidDate(day, month)) {
        throw new Error('Ngày sinh không hợp lệ.');
    }
    await prisma.birthday.upsert({
        where: { userId },
        update: { day, month },
        create: { userId, day, month }
    });
}

export async function getBirthday(userId: string) {
    return prisma.birthday.findUnique({ where: { userId } });
}

export async function clearBirthday(userId: string): Promise<void> {
    await prisma.birthday.delete({ where: { userId } }).catch(() => {
        // Ignore not-found errors (idempotent delete).
    });
}

// 15-min birthday scheduler: celebrates birthdays once per year at announceHour.
const TICK_MS = 15 * 60_000;
let interval: NodeJS.Timeout | null = null;
let busy = false;

export function startBirthdayScheduler(client: Client): void {
    if (interval) clearInterval(interval);
    interval = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
            await celebrateBirthdays(client);
        } catch (error) {
            console.error('Birthday scheduler tick failed:', error);
        } finally {
            busy = false;
        }
    }, TICK_MS);
}

async function celebrateBirthdays(client: Client): Promise<void> {
    if (!config.birthday.enabled) return;

    const today = getTimePartsInTZ(config.maintenance.timezone);
    if (today.hour !== config.birthday.announceHour) return;

    // Find today's celebrants. On Mar 1 of a non-leap year, also celebrate 29/2 folks.
    const celebrantWhere = today.month === 3 && today.day === 1 && !isLeapYear(today.year)
        ? { OR: [{ day: today.day, month: today.month }, { day: 29, month: 2 }] }
        : { day: today.day, month: today.month };

    const celebrants = await prisma.birthday.findMany({ where: celebrantWhere });
    if (!celebrants.length) return;

    const giftedUsers: string[] = [];

    for (const celebrant of celebrants) {
        // Atomic once-per-year claim: only update if lastCelebratedYear is null or < current year.
        const claimed = await prisma.birthday.updateMany({
            where: {
                userId: celebrant.userId,
                OR: [
                    { lastCelebratedYear: null },
                    { lastCelebratedYear: { lt: today.year } }
                ]
            },
            data: { lastCelebratedYear: today.year }
        });

        if (claimed.count === 1) {
            await adjustScoin(
                celebrant.userId,
                config.birthday.gift,
                'Quà sinh nhật 🎂',
                'birthday:gift',
                String(today.year)
            );
            giftedUsers.push(celebrant.userId);
        }
    }

    if (!giftedUsers.length) return;

    // Post one congratulations embed with all celebrants.
    const channel = await client.channels.fetch(config.birthday.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
        // Gifts already paid — log send failure but don't retry (claim prevents re-gift).
        await sendAdminLog(client, {
            title: '⚠️ Birthday Announce Failed',
            description: `Không thể gửi lời chúc sinh nhật cho ${giftedUsers.length} người (quà đã trao).`,
            color: '#e67e22'
        });
        return;
    }

    const mentions = giftedUsers.map(id => `<@${id}>`).join(' ');
    const embed = new EmbedBuilder()
        .setColor('#ff6b9d')
        .setTitle('🎂 Chúc mừng sinh nhật! 🎉')
        .setDescription(
            `Hôm nay là sinh nhật của ${mentions}!\n\n` +
            `Chúc các bạn luôn vui vẻ, hạnh phúc và thành công! ` +
            `Stella tặng mỗi người **${config.birthday.gift} Scoin** 🎁`
        )
        .setFooter({ text: 'Dùng /birthday dat để đăng ký sinh nhật của bạn!' });

    await (channel as TextChannel).send({ embeds: [embed] }).catch(async error => {
        await sendAdminLog(client, {
            title: '⚠️ Birthday Announce Failed',
            description: `Lỗi khi gửi embed: ${error?.message ?? error}`,
            color: '#e74c3c'
        });
    });
}
