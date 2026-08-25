import { EmbedBuilder, Events, Message, PartialMessage } from 'discord.js';
import { config } from '../config';
import { getMirror, markDeleted, parseAttachments } from '../systems/logs/message-mirror';
import { takeCachedFiles } from '../systems/logs/message-image-cache';
import { buildDeleteLogPayload } from '../systems/logs/message-log-embeds';
import { sendMessageLog } from '../systems/logs/message-log-sender';
import { resolveDeleterWithGrace } from '../systems/logs/audit-actor-resolver';
import { createModCase } from '../systems/moderation/mod-case-manager';
import { removeStarboardPost } from '../systems/utility/starboard-manager';

// Ping rồi xoá: kiểu quấy rối không để lại dấu vết nào khác. Người bị ping nhận
// thông báo, mở ra thì tin đã biến mất và họ không chứng minh được gì.
function detectGhostPing(content: string, createdAt: Date | null): boolean {
    if (!createdAt) return false;
    if (Date.now() - createdAt.getTime() > config.logs.ghostPingWindowMs) return false;
    return /<@!?\d+>|<@&\d+>|@everyone|@here/.test(content);
}

export default {
    name: Events.MessageDelete,
    once: false,
    async execute(message: Message | PartialMessage) {
        // Dọn bài trên bảng vàng TRƯỚC mọi cổng lọc của log: một bài starboard trỏ tới
        // tin đã bị xoá là link chết vĩnh viễn, và việc dọn nó không liên quan gì tới
        // chuyện log kiểm duyệt có đang bật hay không.
        void removeStarboardPost(message.client, message.id).catch(() => {});

        if (!config.logs.enabled) return;
        if (!message.guildId) return;
        if (config.logs.ignoreChannelIds.includes(message.channelId)) return;
        if (message.author?.bot) return;

        const mirror = await getMirror(message.id);
        // Bot chưa từng thấy tin này: gửi trước khi bật log, hoặc ở kênh bị loại trừ.
        // Không có gì để log ngoài cái vỏ, mà cái vỏ thì chỉ gây nhiễu kênh log.
        if (!mirror && (message.partial || !message.content)) return;

        const authorId = mirror?.authorId ?? message.author?.id ?? null;
        const content = mirror?.content ?? (message.partial ? '' : message.content ?? '');
        const createdAt = mirror?.createdAt ?? (message.partial ? null : message.createdAt);
        const deletedBy = authorId
            ? await resolveDeleterWithGrace(message.channelId, authorId)
            : null;

        await markDeleted(message.id, deletedBy);

        await sendMessageLog(message.client, buildDeleteLogPayload({
            messageId: message.id,
            channelId: message.channelId,
            guildId: message.guildId,
            authorId,
            content,
            attachments: parseAttachments(mirror?.attachments ?? null),
            stickerNames: mirror?.stickerNames ?? null,
            createdAt,
            editCount: mirror?.editCount ?? 0,
            deletedBy,
            files: takeCachedFiles(message.id)
        }));

        // Ghost-ping chỉ tính khi CHÍNH tác giả xoá: mod xoá một tin có mention là
        // việc dọn dẹp bình thường, không phải hành vi cần ghi hồ sơ.
        if (authorId && !deletedBy && detectGhostPing(content, createdAt)) {
            await createModCase({
                targetId: authorId,
                actorId: message.client.user?.id ?? 'system',
                kind: 'GHOST_PING',
                reason: 'Ping người khác rồi tự xoá tin trong thời gian ngắn',
                evidence: `${message.channelId}/${message.id}`
            }).catch(() => {});

            await sendMessageLog(message.client, {
                embeds: [new EmbedBuilder()
                    .setColor('#8e44ad')
                    .setTitle('👻 Ghost-ping')
                    .setDescription(
                        `<@${authorId}> đã ping người khác rồi tự xoá tin sau ` +
                        `${Math.max(1, Math.round((Date.now() - (createdAt?.getTime() ?? Date.now())) / 1000))} giây.`
                    )
                    .addFields(
                        { name: 'Kênh', value: `<#${message.channelId}>`, inline: true },
                        { name: 'Nội dung', value: content.slice(0, 1000) || '*trống*', inline: false }
                    )
                    .setFooter({ text: 'Đã ghi vào hồ sơ kiểm duyệt · /case list để xem' })
                    .setTimestamp()]
            });
        }
    }
};
