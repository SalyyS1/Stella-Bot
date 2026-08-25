import { EmbedBuilder, Message, PermissionFlagsBits } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { messageLink } from '../../utils/adminLog';

// Highlight (Carl-bot gọi đúng tên này): ai nhắc từ khoá của bạn thì bạn nhận DM kèm
// ngữ cảnh. Đây là tính năng CÁ NHÂN — mọi member dùng được, không phải công cụ quản lý.
//
// Nhưng nó cũng là một đường đọc lén nếu làm hớ: đặt một từ khoá phổ biến rồi nhận nguyên
// văn tin nhắn từ những kênh mình không được vào. Cổng chặn nằm ở `canRead` bên dưới, và
// nó là phần quan trọng nhất của file này.

export const MAX_KEYWORDS_PER_USER = 10;
const MIN_KEYWORD_LENGTH = 3;
const MAX_KEYWORD_LENGTH = 50;
// Nhịp tối thiểu mỗi (người, kênh): một cuộc trò chuyện dùng từ đó 20 lần không được
// biến thành 20 cái DM.
const DM_COOLDOWN_MS = 5 * 60_000;

export async function addHighlight(userId: string, raw: string): Promise<string> {
    const keyword = raw.trim().toLowerCase();
    // Từ 1-2 ký tự khớp gần như mọi câu — nó không phải highlight, nó là đường ống chat.
    if (keyword.length < MIN_KEYWORD_LENGTH) throw new Error(`Từ khoá phải dài ít nhất ${MIN_KEYWORD_LENGTH} ký tự.`);
    if (keyword.length > MAX_KEYWORD_LENGTH) throw new Error(`Từ khoá tối đa ${MAX_KEYWORD_LENGTH} ký tự.`);

    const count = await prisma.highlight.count({ where: { userId } }).catch(() => 0);
    if (count >= MAX_KEYWORDS_PER_USER) {
        throw new Error(`Bạn đã có ${MAX_KEYWORDS_PER_USER} từ khoá — bỏ một từ trước khi thêm.`);
    }

    await prisma.highlight.upsert({
        where: { userId_keyword: { userId, keyword } },
        update: {},
        create: { userId, keyword }
    });
    invalidate();
    return keyword;
}

export async function removeHighlight(userId: string, raw: string): Promise<boolean> {
    const removed = await prisma.highlight
        .deleteMany({ where: { userId, keyword: raw.trim().toLowerCase() } })
        .catch(() => ({ count: 0 }));
    invalidate();
    return removed.count > 0;
}

export async function clearHighlights(userId: string): Promise<number> {
    const removed = await prisma.highlight.deleteMany({ where: { userId } }).catch(() => ({ count: 0 }));
    invalidate();
    return removed.count;
}

export async function listHighlights(userId: string): Promise<string[]> {
    const rows = await prisma.highlight.findMany({ where: { userId } }).catch(() => []);
    return rows.map(row => row.keyword);
}

// Cache toàn bộ cặp (userId, keyword). Hàm dò chạy trên MỌI tin nhắn; bảng này nhỏ.
let pairs: { userId: string; keyword: string }[] = [];
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;
const lastDm = new Map<string, number>();

function invalidate(): void {
    cacheLoadedAt = 0;
}

async function loadPairs() {
    if (Date.now() - cacheLoadedAt < CACHE_TTL_MS) return pairs;
    pairs = await prisma.highlight
        .findMany({ select: { userId: true, keyword: true } })
        .catch(() => [] as { userId: string; keyword: string }[]);
    cacheLoadedAt = Date.now();
    return pairs;
}

function matches(content: string, keyword: string): boolean {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Cùng luật ranh giới từ với autoresponder: "ip" không được khớp trong "script".
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(content.toLowerCase());
}

/** Người đặt highlight có thật sự đọc được kênh đó không. Đây là cổng chống đọc lén. */
async function canRead(message: Message, userId: string): Promise<boolean> {
    const member = await message.guild?.members.fetch(userId).catch(() => null);
    if (!member) return false;
    const permissions = message.channel.isTextBased() && 'permissionsFor' in message.channel
        ? message.channel.permissionsFor(member)
        : null;
    return permissions?.has(PermissionFlagsBits.ViewChannel) ?? false;
}

export async function notifyHighlights(message: Message): Promise<void> {
    if (!message.content.trim() || !message.guild) return;

    const all = await loadPairs();
    if (!all.length) return;

    // Gom theo người: một tin khớp ba từ khoá của cùng một người vẫn chỉ là một DM.
    const hits = new Map<string, string[]>();
    for (const pair of all) {
        // Không bao giờ DM về tin của chính mình.
        if (pair.userId === message.author.id) continue;
        if (!matches(message.content, pair.keyword)) continue;
        const list = hits.get(pair.userId) ?? [];
        list.push(pair.keyword);
        hits.set(pair.userId, list);
    }
    if (!hits.size) return;

    const now = Date.now();
    for (const [userId, keywords] of hits) {
        const cooldownKey = `${userId}:${message.channelId}`;
        if (now - (lastDm.get(cooldownKey) ?? 0) < DM_COOLDOWN_MS) continue;
        if (!await canRead(message, userId)) continue;
        lastDm.set(cooldownKey, now);

        const user = await message.client.users.fetch(userId).catch(() => null);
        if (!user) continue;
        await user.send({
            embeds: [new EmbedBuilder()
                .setColor('#f1c40f')
                .setTitle(`Có người nhắc "${keywords.join('", "')}"`)
                .setDescription(
                    `**${message.author.tag}** ở <#${message.channelId}>:\n` +
                    `>>> ${message.content.slice(0, 1200)}`
                )
                .addFields({
                    name: 'Tới tin nhắn',
                    value: `[bấm đây](${messageLink(message.guildId, message.channelId, message.id)})`
                })
                .setFooter({ text: `Tắt bằng /highlight remove ${keywords[0]}` })
                .setTimestamp(message.createdAt)],
            // DM chứa nguyên văn tin của người khác — trong đó có thể có mention.
            allowedMentions: { parse: [] }
        }).catch(() => {
            // Người chặn DM thì bỏ qua im lặng: nhắc họ trong kênh công khai rằng họ có
            // highlight là tiết lộ đúng thứ họ đang giữ riêng.
        });
    }

    if (lastDm.size > 1000) {
        for (const [key, at] of lastDm) {
            if (now - at > DM_COOLDOWN_MS * 4) lastDm.delete(key);
        }
    }
}
