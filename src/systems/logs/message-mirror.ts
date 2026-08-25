import { Message, PartialMessage } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';

export interface MirroredAttachment {
    name: string;
    url: string;
    size: number;
    contentType: string | null;
}

// Giới hạn cột nội dung. Embed Discord chỉ hiện tối đa 4096 ký tự nên lưu dài hơn
// cũng không đọc được — cắt ở đây là để log dùng được, không phải để tiết kiệm chỗ.
const MAX_CONTENT = 4000;

function shouldMirror(message: Message | PartialMessage): boolean {
    if (!config.logs.enabled) return false;
    if (!message.guildId) return false; // DM không mirror
    if (message.author?.bot) return false;
    if (config.logs.ignoreChannelIds.includes(message.channelId)) return false;
    return true;
}

function serializeAttachments(message: Message): string | null {
    if (!message.attachments.size) return null;
    const list: MirroredAttachment[] = message.attachments.map(attachment => ({
        name: attachment.name,
        url: attachment.url,
        size: attachment.size,
        contentType: attachment.contentType ?? null
    }));
    return JSON.stringify(list);
}

export function parseAttachments(raw: string | null): MirroredAttachment[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// Ghi bản sao một tin nhắn mới. Dùng upsert vì tin có thể được sửa trước khi lượt
// mirror này chạy xong (bot đang bận), và khi đó dòng đã tồn tại.
export async function mirrorMessage(message: Message): Promise<void> {
    if (!shouldMirror(message)) return;
    if (!message.content && !message.attachments.size && !message.stickers.size) return;

    const data = {
        channelId: message.channelId,
        authorId: message.author.id,
        content: message.content.slice(0, MAX_CONTENT),
        attachments: serializeAttachments(message),
        stickerNames: message.stickers.size ? message.stickers.map(sticker => sticker.name).join(', ') : null,
        replyToId: message.reference?.messageId ?? null,
        createdAt: message.createdAt
    };

    await prisma.messageMirror.upsert({
        where: { messageId: message.id },
        update: data,
        create: { messageId: message.id, ...data }
    }).catch(error => console.error('[logs] mirror tin nhắn lỗi:', error));
}

export async function getMirror(messageId: string) {
    return prisma.messageMirror.findUnique({ where: { messageId } }).catch(() => null);
}

export interface AppliedEdit {
    before: string | null;
    after: string;
    editCount: number;
    hadMirror: boolean;
}

// Cập nhật bản sao khi tin bị sửa và lưu phiên bản cũ vào lịch sử.
//
// Phiên bản 1 được chèn LÚC SỬA LẦN ĐẦU chứ không phải lúc tin được gửi: trước khi
// có lần sửa nào thì không có gì để so, thêm một dòng cho mọi tin nhắn chỉ để chờ
// một lần sửa có thể không bao giờ đến là nhân đôi dung lượng vô ích.
export async function applyEdit(message: Message, fallbackBefore: string | null): Promise<AppliedEdit> {
    const existing = await getMirror(message.id);
    const before = existing?.content ?? fallbackBefore;
    const after = message.content.slice(0, MAX_CONTENT);
    const nextCount = (existing?.editCount ?? 0) + 1;

    if (!shouldMirror(message)) {
        return { before, after, editCount: nextCount, hadMirror: !!existing };
    }

    if (existing) {
        if (nextCount === 1 && before !== null) {
            await prisma.messageVersion.createMany({
                data: [{ messageId: message.id, version: 1, content: before, changedAt: existing.createdAt }],
                skipDuplicates: true
            }).catch(() => {});
        }
        await prisma.messageVersion.createMany({
            data: [{ messageId: message.id, version: nextCount + 1, content: after }],
            skipDuplicates: true
        }).catch(() => {});

        await prisma.messageMirror.update({
            where: { messageId: message.id },
            data: { content: after, editedAt: new Date(), editCount: nextCount, attachments: serializeAttachments(message) }
        }).catch(error => console.error('[logs] cập nhật bản sửa lỗi:', error));
    } else {
        // Không có bản sao (tin gửi trước khi bật log, hoặc mirror trượt): vẫn tạo
        // dòng để lần sửa sau còn so được, nhưng nội dung TRƯỚC thì đã mất.
        await prisma.messageMirror.create({
            data: {
                messageId: message.id,
                channelId: message.channelId,
                authorId: message.author?.id ?? 'unknown',
                content: after,
                attachments: serializeAttachments(message),
                stickerNames: null,
                replyToId: message.reference?.messageId ?? null,
                createdAt: message.createdAt,
                editedAt: new Date(),
                editCount: nextCount
            }
        }).catch(() => {});
    }

    return { before, after, editCount: nextCount, hadMirror: !!existing };
}

export async function getEditVersions(messageId: string) {
    return prisma.messageVersion.findMany({
        where: { messageId },
        orderBy: { version: 'asc' }
    }).catch(() => []);
}

export async function markDeleted(messageId: string, deletedBy: string | null): Promise<void> {
    await prisma.messageMirror.updateMany({
        where: { messageId },
        data: { deletedAt: new Date(), deletedBy }
    }).catch(error => console.error('[logs] đánh dấu tin đã xoá lỗi:', error));
}

// Tin gần nhất bị xoá / bị sửa trong một kênh, cho /snipe và /editsnipe.
export async function getLatestDeleted(channelId: string) {
    return prisma.messageMirror.findFirst({
        where: { channelId, deletedAt: { gte: new Date(Date.now() - config.logs.snipeWindowMs) } },
        orderBy: { deletedAt: 'desc' }
    }).catch(() => null);
}

export async function getLatestEdited(channelId: string) {
    return prisma.messageMirror.findFirst({
        where: {
            channelId,
            editCount: { gt: 0 },
            editedAt: { gte: new Date(Date.now() - config.logs.snipeWindowMs) },
            deletedAt: null
        },
        orderBy: { editedAt: 'desc' }
    }).catch(() => null);
}

export async function getBulkDeletedMirrors(messageIds: string[]) {
    if (!messageIds.length) return [];
    return prisma.messageMirror.findMany({
        where: { messageId: { in: messageIds } },
        orderBy: { createdAt: 'asc' }
    }).catch(() => []);
}

// Thống kê cho /inspect: người này bị xoá bao nhiêu tin, sửa bao nhiêu tin.
export async function getAuthorActivity(authorId: string) {
    const since24h = new Date(Date.now() - 86_400_000);
    const since7d = new Date(Date.now() - 7 * 86_400_000);
    const [last24h, last7d, deleted7d, edited7d] = await Promise.all([
        prisma.messageMirror.count({ where: { authorId, createdAt: { gte: since24h } } }).catch(() => 0),
        prisma.messageMirror.count({ where: { authorId, createdAt: { gte: since7d } } }).catch(() => 0),
        prisma.messageMirror.count({ where: { authorId, deletedAt: { gte: since7d } } }).catch(() => 0),
        prisma.messageMirror.count({ where: { authorId, editCount: { gt: 0 }, editedAt: { gte: since7d } } }).catch(() => 0)
    ]);
    return { last24h, last7d, deleted7d, edited7d };
}

export async function getRecentByAuthor(authorId: string, take = 10) {
    return prisma.messageMirror.findMany({
        where: { authorId },
        orderBy: { createdAt: 'desc' },
        take
    }).catch(() => []);
}

// Dọn hai tầng: dòng thường theo retainDays, dòng đã bị xoá/sửa giữ tới
// retainFlaggedDays — đó đúng là loại dòng admin quay lại soi, nên nó sống lâu hơn.
export async function pruneMirror(): Promise<number> {
    const normalCutoff = new Date(Date.now() - config.logs.retainDays * 86_400_000);
    const flaggedCutoff = new Date(Date.now() - config.logs.retainFlaggedDays * 86_400_000);

    const [normal, flagged] = await Promise.all([
        prisma.messageMirror.deleteMany({
            where: { mirroredAt: { lt: normalCutoff }, deletedAt: null, editCount: 0 }
        }).catch(() => ({ count: 0 })),
        prisma.messageMirror.deleteMany({
            where: { mirroredAt: { lt: flaggedCutoff } }
        }).catch(() => ({ count: 0 }))
    ]);

    return normal.count + flagged.count;
}

let pruneTimer: NodeJS.Timeout | null = null;

export function startMessageMirrorPruneScheduler(): void {
    if (!config.logs.enabled) return;
    if (pruneTimer) clearInterval(pruneTimer);
    const tick = () => {
        void pruneMirror()
            .then(count => { if (count) console.log(`[logs] đã dọn ${count} bản sao tin nhắn quá hạn`); })
            .catch(error => console.error('[logs] prune lỗi:', error));
    };
    pruneTimer = setInterval(tick, config.logs.prunePeriodMs);
    tick();
}
