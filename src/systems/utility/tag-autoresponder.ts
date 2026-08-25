import { Message, TextChannel } from 'discord.js';
import { config } from '../../config';
import { bumpUses, findAutoTag, getTag } from './tag-store';

// Autoresponder + prefix `!tag <tên>`.
//
// Nội dung tag do admin nhập nhưng được gửi bởi BOT — nghĩa là nó mang quyền ping của
// bot. Mọi lượt gửi ở đây đều `allowedMentions: { parse: [] }`: thiếu dòng đó thì
// `/tag create` là công cụ ping @everyone cho bất kỳ ai được phép tạo tag.

// Nhịp tối thiểu giữa hai lần autoresponder trả lời trong CÙNG một kênh. Theo kênh chứ
// không theo người: 5 người cùng nhắc một từ khoá trong 10 giây thì bot trả lời 5 lần
// vẫn là spam, dù mỗi người chỉ nói một câu.
const lastAutoReply = new Map<string, number>();

function onAutoCooldown(channelId: string, now: number): boolean {
    const previous = lastAutoReply.get(channelId) ?? 0;
    if (now - previous < config.utility.tags.autoCooldownMs) return true;
    lastAutoReply.set(channelId, now);
    return false;
}

async function sendTag(message: Message, content: string): Promise<void> {
    await (message.channel as TextChannel)
        .send({ content: content.slice(0, 2000), allowedMentions: { parse: [] } })
        .catch(() => {});
}

/**
 * Trả về true nếu tin nhắn đã được xử lý như một lệnh tag (`!tag <tên>`), để
 * messageCreate dừng pipeline.
 */
export async function handleTagCommand(message: Message): Promise<boolean> {
    if (!message.content.startsWith('!tag ')) return false;
    const name = message.content.slice(5).trim().split(/\s+/)[0];
    if (!name) return false;

    const tag = await getTag(name);
    if (!tag) {
        // Im lặng khi không có tag: báo "không tìm thấy" cho mọi lần gõ nhầm sẽ biến
        // kênh chat thành bãi thông báo lỗi của bot.
        return false;
    }
    await sendTag(message, tag.content);
    await bumpUses(tag.name);
    return true;
}

/** Autoresponder: tin nhắn thường chứa từ khoá của một tag. Không dừng pipeline. */
export async function handleTagTrigger(message: Message): Promise<void> {
    if (!message.content.trim()) return;
    const name = await findAutoTag(message.content);
    if (!name) return;
    if (onAutoCooldown(message.channelId, Date.now())) return;

    const tag = await getTag(name);
    if (!tag) return;
    await sendTag(message, tag.content);
    await bumpUses(tag.name);
}
