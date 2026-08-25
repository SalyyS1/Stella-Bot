import { EmbedBuilder, Message } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { sendMessageLog } from '../logs/message-log-sender';
import { messageLink } from '../../utils/adminLog';

// `/watch`: mọi tin của người bị theo dõi được copy sang kênh log tới khi hết hạn.
//
// Đây là tính năng dễ lạm dụng nhất trong cả bộ quản lý — nó là theo dõi người thật. Ba
// chốt: chỉ Administrator bật được, luôn ghi ModCase để có dấu vết ai bật và vì sao, và
// BẮT BUỘC có hạn (bảng không cho `expiresAt` null).

export async function startWatch(input: {
    userId: string;
    actorId: string;
    reason: string;
    durationMs: number;
}) {
    const expiresAt = new Date(Date.now() + input.durationMs);
    const row = await prisma.watchTarget.upsert({
        where: { userId: input.userId },
        update: { actorId: input.actorId, reason: input.reason, expiresAt },
        create: { userId: input.userId, actorId: input.actorId, reason: input.reason, expiresAt }
    });
    invalidate();
    return row;
}

export async function stopWatch(userId: string): Promise<boolean> {
    const removed = await prisma.watchTarget.deleteMany({ where: { userId } }).catch(() => ({ count: 0 }));
    invalidate();
    return removed.count > 0;
}

export async function listWatches() {
    return prisma.watchTarget.findMany({ orderBy: { expiresAt: 'asc' } }).catch(() => []);
}

// Cache: hàm mirrorWatched chạy trên MỌI tin nhắn của server. Danh sách theo dõi thường
// có 0-2 dòng, nên giữ nó trong RAM là chênh lệch giữa "một truy vấn mỗi tin nhắn" và
// "không truy vấn nào".
let watched = new Map<string, Date>();
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

function invalidate(): void {
    cacheLoadedAt = 0;
}

async function loadWatched(): Promise<Map<string, Date>> {
    if (Date.now() - cacheLoadedAt < CACHE_TTL_MS) return watched;
    const rows = await prisma.watchTarget.findMany().catch(() => []);
    watched = new Map(rows.map(row => [row.userId, row.expiresAt]));
    cacheLoadedAt = Date.now();
    return watched;
}

/**
 * Copy tin của người bị theo dõi sang kênh log.
 *
 * Hết hạn được xử lý ngay ở đây thay vì bằng scheduler riêng: dòng hết hạn chỉ có hại
 * khi nó còn khiến bot copy tin, nên kiểm đúng lúc đọc là đủ và không thêm một nhịp nền.
 */
export async function mirrorWatched(message: Message): Promise<void> {
    const targets = await loadWatched();
    const expiresAt = targets.get(message.author.id);
    if (!expiresAt) return;

    if (expiresAt.getTime() <= Date.now()) {
        await stopWatch(message.author.id);
        await sendMessageLog(message.client, {
            embeds: [new EmbedBuilder()
                .setColor('#95a5a6')
                .setTitle('Hết hạn theo dõi')
                .setDescription(`Đã tự tắt theo dõi <@${message.author.id}>.`)]
        }).catch(() => {});
        return;
    }

    const attachments = [...message.attachments.values()].map(file => file.name).join(', ');
    await sendMessageLog(message.client, {
        embeds: [new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('Theo dõi · tin nhắn mới')
            .setDescription(
                `<@${message.author.id}> ở <#${message.channelId}> · ` +
                `[tới tin](${messageLink(message.guildId, message.channelId, message.id)})\n\n` +
                (message.content ? `>>> ${message.content.slice(0, 1500)}` : '*(không có chữ)*')
            )
            .setFooter({ text: attachments ? `File: ${attachments}`.slice(0, 2000) : 'Hết hạn tự tắt' })
            .setTimestamp()]
    }).catch(() => {});
}
