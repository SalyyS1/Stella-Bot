import { Events, Message, PartialMessage } from 'discord.js';
import { config } from '../config';
import { applyEdit } from '../systems/logs/message-mirror';
import { peekCachedFiles } from '../systems/logs/message-image-cache';
import { buildEditLogPayload } from '../systems/logs/message-log-embeds';
import { sendMessageLog } from '../systems/logs/message-log-sender';

export default {
    name: Events.MessageUpdate,
    once: false,
    async execute(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
        if (!config.logs.enabled) return;
        if (!newMessage.guildId) return;
        if (config.logs.ignoreChannelIds.includes(newMessage.channelId)) return;

        // Tin ngoài cache tới dạng partial — phải fetch mới có nội dung mới.
        let message: Message;
        try {
            message = newMessage.partial ? await newMessage.fetch() : (newMessage as Message);
        } catch {
            return;
        }
        if (message.author?.bot) return;

        // Discord bắn messageUpdate cả khi chỉ có preview link được nạp xong, ghim/bỏ
        // ghim, hoặc component đổi. Không lọc thì kênh log đầy những "tin bị sửa" mà
        // chữ y nguyên, và log thật bị lấp.
        const oldContent = oldMessage.partial ? null : oldMessage.content ?? null;
        if (oldContent !== null && oldContent === message.content) return;

        const applied = await applyEdit(message, oldContent);
        if (applied.before !== null && applied.before === applied.after) return;

        await sendMessageLog(message.client, buildEditLogPayload({
            messageId: message.id,
            channelId: message.channelId,
            guildId: message.guildId,
            authorId: message.author.id,
            before: applied.before,
            after: applied.after,
            editCount: applied.editCount,
            // Sửa tin có thể là để bỏ ảnh đi — đính lại ảnh đã cứu để log giữ được
            // thứ vừa bị lấy khỏi tin.
            files: message.attachments.size ? [] : peekCachedFiles(message.id)
        }));
    }
};
