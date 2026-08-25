import prisma from '../../lib/prisma';

// Tag = câu trả lời soạn sẵn (thay tag của Carl-bot / custom command của Dyno).
// `autoTrigger` biến một tag thành autoresponder.

export async function upsertTag(input: { name: string; content: string; createdBy: string }) {
    const name = input.name.trim().toLowerCase();
    return prisma.tag.upsert({
        where: { name },
        update: { content: input.content },
        create: { name, content: input.content, createdBy: input.createdBy }
    });
}

export async function getTag(name: string) {
    return prisma.tag.findUnique({ where: { name: name.trim().toLowerCase() } }).catch(() => null);
}

export async function deleteTag(name: string) {
    return prisma.tag.delete({ where: { name: name.trim().toLowerCase() } });
}

export async function listTags() {
    return prisma.tag.findMany({ orderBy: { uses: 'desc' } }).catch(() => []);
}

export async function setTrigger(name: string, trigger: string | null) {
    return prisma.tag.update({
        where: { name: name.trim().toLowerCase() },
        data: { autoTrigger: trigger?.trim().toLowerCase() || null }
    });
}

export async function bumpUses(name: string) {
    await prisma.tag.update({ where: { name }, data: { uses: { increment: 1 } } }).catch(() => {});
}

// Cache danh sách trigger: hàm dò chạy trên MỌI tin nhắn của server, còn danh sách tag
// gần như không đổi. Một truy vấn DB cho mỗi tin là cái giá không đáng.
let triggerCache: { name: string; trigger: string }[] = [];
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

export function invalidateTagCache(): void {
    cacheLoadedAt = 0;
}

async function loadTriggers() {
    if (Date.now() - cacheLoadedAt < CACHE_TTL_MS) return triggerCache;
    const rows = await prisma.tag
        .findMany({ where: { NOT: { autoTrigger: null } }, select: { name: true, autoTrigger: true } })
        .catch(() => []);
    triggerCache = rows
        .filter(row => row.autoTrigger)
        .map(row => ({ name: row.name, trigger: row.autoTrigger! }));
    cacheLoadedAt = Date.now();
    return triggerCache;
}

/**
 * Tìm tag có trigger khớp trong nội dung tin nhắn.
 *
 * Khớp theo TỪ, không khớp giữa từ: trigger "ip" mà khớp cả trong "script", "vip",
 * "clip" thì autoresponder sẽ nhảy vào gần như mọi cuộc trò chuyện — và người ta sẽ
 * bảo bot bị hỏng chứ không bảo trigger đặt sai.
 */
export async function findAutoTag(content: string): Promise<string | null> {
    const haystack = content.toLowerCase();
    for (const entry of await loadTriggers()) {
        const escaped = entry.trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
        if (pattern.test(haystack)) return entry.name;
    }
    return null;
}
