import { GuildMember, Message, TextChannel } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';

// AFK (thay AFK của Dyno/ProBot).
//
// Lý do có cache: hai hàm dưới chạy trên MỌI tin nhắn. Bảng AfkStatus thường chỉ có vài
// dòng, nên giữ nguyên tập id trong RAM rẻ hơn nhiều so với một truy vấn mỗi tin.

const AFK_PREFIX = '[AFK] ';

let afkIds = new Set<string>();
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadAfkIds(): Promise<Set<string>> {
    if (Date.now() - cacheLoadedAt < CACHE_TTL_MS) return afkIds;
    const rows = await prisma.afkStatus.findMany({ select: { userId: true } }).catch(() => []);
    afkIds = new Set(rows.map(row => row.userId));
    cacheLoadedAt = Date.now();
    return afkIds;
}

function invalidate(): void {
    cacheLoadedAt = 0;
}

/** Lý do AFK hiện ra cho người khác đọc → cắt độ dài và gỡ mọi dạng ping. */
export function sanitizeReason(raw: string): string {
    return raw
        .replace(/@(everyone|here)/gi, '@​$1')
        .replace(/<@[!&]?\d+>/g, '[mention]')
        .slice(0, config.utility.afk.maxReasonLength)
        .trim() || 'Không nói lý do';
}

export async function setAfk(member: GuildMember, reason: string): Promise<void> {
    await prisma.afkStatus.upsert({
        where: { userId: member.id },
        update: { reason, since: new Date() },
        create: { userId: member.id, reason }
    });
    invalidate();

    // Đổi nickname là phần "nice to have": bot không đổi được nick của chủ server và của
    // người có role cao hơn nó. Fail mềm, chỉ mất dấu hiệu hiển thị.
    if (!member.nickname?.startsWith(AFK_PREFIX)) {
        const next = `${AFK_PREFIX}${member.displayName}`.slice(0, 32);
        await member.setNickname(next, 'Đặt AFK').catch(() => {});
    }
}

/** Người đang AFK chat lại → tự tắt AFK. Trả về true nếu vừa tắt. */
export async function clearAfkOnMessage(message: Message): Promise<boolean> {
    if (!(await loadAfkIds()).has(message.author.id)) return false;

    const row = await prisma.afkStatus.findUnique({ where: { userId: message.author.id } }).catch(() => null);
    if (!row) return false;
    await prisma.afkStatus.delete({ where: { userId: message.author.id } }).catch(() => {});
    invalidate();

    const member = message.member;
    if (member?.nickname?.startsWith(AFK_PREFIX)) {
        await member.setNickname(member.nickname.slice(AFK_PREFIX.length) || null, 'Tắt AFK').catch(() => {});
    }

    const notice = await (message.channel as TextChannel)
        .send({
            content: `<@${message.author.id}> ${config.ui.emojis.success} Chào mừng quay lại, đã tắt AFK.`,
            allowedMentions: { users: [message.author.id] }
        })
        .catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 8_000);
    return true;
}

// Gộp theo kênh: 5 người cùng ping một người đang AFK trong 30 giây thì bot nhắc 5 lần
// vẫn là spam.
const lastNotice = new Map<string, number>();
const NOTICE_COOLDOWN_MS = 30_000;

/** Ai ping người đang AFK thì được bot nhắc. */
export async function notifyAfkMentions(message: Message): Promise<void> {
    if (!message.mentions.users.size) return;
    const ids = await loadAfkIds();
    const mentioned = [...message.mentions.users.values()].filter(user => ids.has(user.id) && user.id !== message.author.id);
    if (!mentioned.length) return;

    const now = Date.now();
    if (now - (lastNotice.get(message.channelId) ?? 0) < NOTICE_COOLDOWN_MS) return;
    lastNotice.set(message.channelId, now);

    const rows = await prisma.afkStatus
        .findMany({ where: { userId: { in: mentioned.map(user => user.id) } } })
        .catch(() => []);
    if (!rows.length) return;

    const lines = rows.map(row =>
        `${config.ui.emojis.note} <@${row.userId}> đang AFK từ <t:${Math.floor(row.since.getTime() / 1000)}:R> — ${row.reason}`
    );
    const notice = await (message.channel as TextChannel)
        .send({ content: lines.join('\n').slice(0, 1800), allowedMentions: { parse: [] } })
        .catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 20_000);
}
