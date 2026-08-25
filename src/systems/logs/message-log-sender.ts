import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, Client, EmbedBuilder, Message, TextChannel } from 'discord.js';
import { config } from '../../config';

export interface LogPayload {
    embeds: EmbedBuilder[];
    files?: AttachmentBuilder[];
    components?: ActionRowBuilder<ButtonBuilder>[];
}

// Gửi log tin nhắn.
//
// Tách khỏi sendAdminLog vì hàm đó chỉ nhận embed dạng đơn giản (title/description/
// fields) — còn log tin nhắn cần đính ẢNH đã cứu và NÚT xem diff. Nhồi hai nhu cầu
// vào một hàm sẽ làm chữ ký của nó phình ra cho mọi chỗ gọi khác đang dùng tốt.
//
// Trả về tin đã gửi để chỗ gọi SỬA lại được nó (automod gộp nhiều lượt vi phạm liên
// tiếp vào một embed thay vì đăng thêm embed mới). Chỗ nào không cần thì bỏ qua giá trị
// trả về như trước.
export async function sendMessageLog(client: Client, payload: LogPayload): Promise<Message | null> {
    if (!config.logs.enabled) return null;
    try {
        const channel = await client.channels.fetch(config.logs.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            console.error(`[logs] kênh log ${config.logs.channelId} không dùng được, bỏ log`);
            return null;
        }
        return await (channel as TextChannel).send({
            embeds: payload.embeds,
            files: payload.files,
            components: payload.components,
            // Log chứa lại nội dung tin nhắn cũ, trong đó có thể có @mention. Gửi
            // nguyên văn mà không chặn thì mỗi lần một tin ping bị xoá, người bị
            // ping lại nhận thêm một ping nữa từ kênh log.
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error('[logs] gửi log tin nhắn lỗi:', error);
        return null;
    }
}
