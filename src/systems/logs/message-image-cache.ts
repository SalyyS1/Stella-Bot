import { AttachmentBuilder, Message } from 'discord.js';
import { config } from '../../config';

interface CachedFile {
    name: string;
    data: Buffer;
}

interface CacheEntry {
    files: CachedFile[];
    bytes: number;
    expiresAt: number;
}

// Bytes ảnh giữ trong RAM, khoá theo message id.
//
// Vì sao phải giữ bytes: URL CDN của Discord chết NGAY khi tin nhắn bị xoá, nên
// không có cách nào tải ảnh về "lúc phát hiện tin bị xoá" — lúc đó đã muộn. Cách
// duy nhất không cần thêm kênh lưu trữ là giữ bytes từ lúc ảnh được đăng.
//
// Đánh đổi đã chốt với Saly: ảnh bị xoá sau khi hết TTL (mặc định 1h) hoặc sau khi
// bot restart thì KHÔNG cứu được, log chỉ còn tên file. Muốn 100% thì phải upload
// ảnh sang một kênh lưu trữ ngay lúc đăng — đã loại vì không muốn thêm kênh.
const cache = new Map<string, CacheEntry>();
let totalBytes = 0;

function evictOldestUntilFits(incoming: number): void {
    const limit = config.logs.image.cacheTotalBytes;
    // Map giữ thứ tự chèn, nên phần tử đầu là cũ nhất.
    for (const [messageId, entry] of cache) {
        if (totalBytes + incoming <= limit) break;
        cache.delete(messageId);
        totalBytes -= entry.bytes;
    }
}

// Tải và giữ bytes ảnh của một tin nhắn mới. Không throw ra ngoài: mất một tấm ảnh
// trong log không được phép làm hỏng luồng chat.
export async function cacheAttachments(message: Message): Promise<void> {
    if (!config.logs.enabled) return;
    if (!message.guildId || message.author?.bot) return;
    if (!config.logs.image.channelIds.includes(message.channelId)) return;
    if (!message.attachments.size) return;

    const files: CachedFile[] = [];
    let bytes = 0;

    for (const attachment of message.attachments.values()) {
        if (!attachment.contentType?.startsWith('image/')) continue;
        if (attachment.size > config.logs.image.maxBytes) continue;
        try {
            const response = await fetch(attachment.url);
            if (!response.ok) continue;
            const data = Buffer.from(await response.arrayBuffer());
            if (data.byteLength > config.logs.image.maxBytes) continue;
            files.push({ name: attachment.name, data });
            bytes += data.byteLength;
        } catch (error) {
            console.error(`[logs] không tải được ảnh ${attachment.name}:`, error);
        }
    }

    if (!files.length) return;

    evictOldestUntilFits(bytes);
    if (bytes > config.logs.image.cacheTotalBytes) return;

    cache.set(message.id, { files, bytes, expiresAt: Date.now() + config.logs.image.ttlMs });
    totalBytes += bytes;
}

function toAttachments(entry: CacheEntry): AttachmentBuilder[] {
    return entry.files.map(file => new AttachmentBuilder(file.data, { name: file.name }));
}

// Lấy ảnh ra để đính vào log và bỏ khỏi cache (tin đã xoá thì không cần giữ nữa).
export function takeCachedFiles(messageId: string): AttachmentBuilder[] {
    const entry = cache.get(messageId);
    if (!entry) return [];
    cache.delete(messageId);
    totalBytes -= entry.bytes;
    return toAttachments(entry);
}

// Xem mà không bỏ khỏi cache: dùng cho lượt SỬA, vì tin vẫn còn sống và có thể bị
// xoá sau đó — lúc ấy vẫn cần ảnh.
export function peekCachedFiles(messageId: string): AttachmentBuilder[] {
    const entry = cache.get(messageId);
    return entry ? toAttachments(entry) : [];
}

export function hasCachedFiles(messageId: string): boolean {
    return cache.has(messageId);
}

let sweeper: NodeJS.Timeout | null = null;

export function startImageCacheSweeper(): void {
    if (!config.logs.enabled) return;
    if (sweeper) clearInterval(sweeper);
    sweeper = setInterval(() => {
        const now = Date.now();
        for (const [messageId, entry] of cache) {
            if (entry.expiresAt > now) continue;
            cache.delete(messageId);
            totalBytes -= entry.bytes;
        }
    }, 5 * 60_000);
}

export function imageCacheStats() {
    return { entries: cache.size, bytes: totalBytes };
}
