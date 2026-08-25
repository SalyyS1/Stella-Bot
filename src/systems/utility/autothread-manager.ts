import { Message } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';

// Auto-thread: mọi tin trong kênh được chỉ định tự có một thread để bàn riêng.
//
// Kênh `share`/`showcase` đã có logic mở thread riêng trong messageCreate. Nếu ai bật
// autothread cho hai kênh đó thì bỏ qua ở đây — hai thread cho một tin là cách nhanh nhất
// làm người ta tắt tính năng này.
const CHANNELS_WITH_OWN_THREADS = new Set([config.channels.share, config.channels.showcase]);

export async function enableAutoThread(input: {
    channelId: string;
    nameTemplate: string;
    archiveMinutes: number;
    createdBy: string;
}) {
    const row = await prisma.autoThreadChannel.upsert({
        where: { channelId: input.channelId },
        update: { nameTemplate: input.nameTemplate, archiveMinutes: input.archiveMinutes },
        create: input
    });
    invalidate();
    return row;
}

export async function disableAutoThread(channelId: string): Promise<boolean> {
    const removed = await prisma.autoThreadChannel.deleteMany({ where: { channelId } }).catch(() => ({ count: 0 }));
    invalidate();
    return removed.count > 0;
}

export async function listAutoThreads() {
    return prisma.autoThreadChannel.findMany().catch(() => []);
}

// Cache: hàm dưới chạy trên mọi tin nhắn, mà hầu hết kênh không bật autothread.
let channels = new Map<string, { nameTemplate: string; archiveMinutes: number }>();
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

function invalidate(): void {
    cacheLoadedAt = 0;
}

async function loadChannels() {
    if (Date.now() - cacheLoadedAt < CACHE_TTL_MS) return channels;
    const rows = await listAutoThreads();
    channels = new Map(rows.map(row => [
        row.channelId,
        { nameTemplate: row.nameTemplate, archiveMinutes: row.archiveMinutes }
    ]));
    cacheLoadedAt = Date.now();
    return channels;
}

function buildName(template: string, message: Message): string {
    const content = message.content.replace(/\s+/g, ' ').trim();
    const name = template
        .replace('{user}', message.member?.displayName || message.author.username)
        .replace('{content}', content || 'bài mới');
    return name.slice(0, 90) || `Bài của ${message.author.username}`;
}

export async function openAutoThread(message: Message): Promise<void> {
    if (CHANNELS_WITH_OWN_THREADS.has(message.channelId)) return;
    // Tin đã nằm trong thread thì không mở thread của thread.
    if (message.channel.isThread()) return;
    if (message.hasThread) return;
    // Tin trống hoàn toàn (chỉ sticker/embed hệ thống) không đáng có một thread.
    if (!message.content.trim() && message.attachments.size === 0) return;

    const settings = (await loadChannels()).get(message.channelId);
    if (!settings) return;

    await message.startThread({
        name: buildName(settings.nameTemplate, message),
        autoArchiveDuration: settings.archiveMinutes as any
    }).catch(() => {
        // Thiếu quyền Create Public Threads, hoặc kênh đã đạt trần thread đang hoạt động.
        // Fail mềm: mất một thread không đáng chặn cả pipeline tin nhắn.
    });
}
