import { Message, TextChannel } from 'discord.js';
import prisma from '../../lib/prisma';

// Sticky message: nội quy kênh tự đăng lại xuống cuối sau mỗi N tin, để nó không bị
// đẩy lên mất.
//
// `pending` đếm trong DB chứ không trong RAM: restart giữa chừng mà mất bộ đếm thì
// sticky sẽ đăng lại ở thời điểm ngẫu nhiên — trông như bot bị lỗi.

export async function setSticky(input: {
    channelId: string;
    content: string;
    minGap: number;
    createdBy: string;
}) {
    return prisma.stickyMessage.upsert({
        where: { channelId: input.channelId },
        update: { content: input.content, minGap: input.minGap, pending: 0 },
        create: {
            channelId: input.channelId,
            content: input.content,
            minGap: input.minGap,
            createdBy: input.createdBy
        }
    });
}

export async function removeSticky(channelId: string) {
    const row = await prisma.stickyMessage.findUnique({ where: { channelId } }).catch(() => null);
    if (!row) return null;
    await prisma.stickyMessage.delete({ where: { channelId } }).catch(() => {});
    return row;
}

export async function listSticky() {
    return prisma.stickyMessage.findMany().catch(() => []);
}

// Cache tập kênh có sticky. Hàm bump chạy trên mọi tin nhắn; hầu hết kênh không có
// sticky, nên một truy vấn DB mỗi tin chỉ để biết "không có gì" là lãng phí.
let stickyChannels = new Set<string>();
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

export function invalidateStickyCache(): void {
    cacheLoadedAt = 0;
}

async function hasSticky(channelId: string): Promise<boolean> {
    if (Date.now() - cacheLoadedAt >= CACHE_TTL_MS) {
        const rows = await prisma.stickyMessage.findMany({ select: { channelId: true } }).catch(() => []);
        stickyChannels = new Set(rows.map(row => row.channelId));
        cacheLoadedAt = Date.now();
    }
    return stickyChannels.has(channelId);
}

/** Đếm một tin mới trong kênh; tới ngưỡng thì đăng lại sticky xuống cuối. */
export async function bumpSticky(message: Message): Promise<void> {
    if (!await hasSticky(message.channelId)) return;

    const row = await prisma.stickyMessage
        .update({ where: { channelId: message.channelId }, data: { pending: { increment: 1 } } })
        .catch(() => null);
    if (!row || row.pending < row.minGap) return;

    const channel = message.channel as TextChannel;
    // Xoá bản cũ TRƯỚC khi đăng bản mới: bỏ qua bước này thì mỗi lần đăng lại để lại
    // một bản, và sau một ngày kênh có 50 bản nội quy nằm rải rác.
    if (row.lastMessageId) {
        await channel.messages.fetch(row.lastMessageId).then(old => old.delete()).catch(() => {});
    }

    const sent = await channel
        .send({ content: row.content.slice(0, 2000), allowedMentions: { parse: [] } })
        .catch(() => null);

    await prisma.stickyMessage
        .update({
            where: { channelId: message.channelId },
            data: { pending: 0, lastMessageId: sent?.id || null }
        })
        .catch(() => {});
}
