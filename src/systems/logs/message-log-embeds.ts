import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { config } from '../../config';
import { messageLink } from '../../utils/adminLog';
import { renderDiffCodeBlock, renderInlineDiff } from '../../utils/text-diff';
import { getEditVersions, getMirror, MirroredAttachment } from './message-mirror';

const NO_CONTENT = '*(không có nội dung văn bản)*';

function clip(text: string, limit = 1000): string {
    if (!text) return NO_CONTENT;
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function attachmentSummary(attachments: MirroredAttachment[], rescuedCount: number): string | null {
    if (!attachments.length) return null;
    const lines = attachments.map(file => `\`${file.name}\` · ${(file.size / 1024).toFixed(0)} KB`);
    const note = rescuedCount > 0
        ? `\n${config.ui.emojis.success} Đã cứu **${rescuedCount}** ảnh, xem bên dưới.`
        : `\n${config.ui.emojis.error} Không cứu được: ảnh quá hạn giữ hoặc bot đã restart sau khi ảnh được đăng.`;
    return lines.join('\n') + note;
}

function historyButtons(messageId: string, editCount: number, jumpUrl: string | null) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    if (editCount > 0) {
        row.addComponents(
            new ButtonBuilder().setCustomId(`msglog_diff_${messageId}`).setLabel('Xem đoạn đã sửa').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`msglog_history_${messageId}`).setLabel('Toàn bộ lịch sử sửa').setStyle(ButtonStyle.Secondary)
        );
    }
    if (jumpUrl) {
        row.addComponents(new ButtonBuilder().setLabel('Xem ngữ cảnh').setStyle(ButtonStyle.Link).setURL(jumpUrl));
    }
    return row.components.length ? [row] : undefined;
}

export interface DeleteLogContext {
    messageId: string;
    channelId: string;
    guildId: string | null;
    authorId: string | null;
    content: string | null;
    attachments: MirroredAttachment[];
    stickerNames: string | null;
    createdAt: Date | null;
    editCount: number;
    deletedBy: string | null;
    files: AttachmentBuilder[];
}

export function buildDeleteLogPayload(context: DeleteLogContext) {
    const emojis = config.ui.emojis;
    const embed = new EmbedBuilder()
        .setColor('#e74c3c')
        .setTitle(`${emojis.delete} Tin nhắn bị xoá`)
        .addFields(
            { name: 'Tác giả', value: context.authorId ? `<@${context.authorId}>` : '*không rõ*', inline: true },
            { name: 'Kênh', value: `<#${context.channelId}>`, inline: true },
            {
                name: 'Người xoá',
                value: context.deletedBy ? `<@${context.deletedBy}> (mod)` : 'Tác giả tự xoá',
                inline: true
            },
            { name: 'Nội dung', value: clip(context.content || ''), inline: false }
        )
        .setFooter({ text: `ID ${context.messageId}` })
        .setTimestamp();

    if (context.createdAt) {
        embed.addFields({
            name: 'Đã gửi lúc',
            value: `<t:${Math.floor(context.createdAt.getTime() / 1000)}:f> (<t:${Math.floor(context.createdAt.getTime() / 1000)}:R>)`,
            inline: false
        });
    }
    if (context.editCount > 0) {
        embed.addFields({ name: 'Đã sửa', value: `**${context.editCount}** lần trước khi bị xoá`, inline: true });
    }
    if (context.stickerNames) {
        embed.addFields({ name: 'Sticker', value: context.stickerNames, inline: true });
    }

    const files = attachmentSummary(context.attachments, context.files.length);
    if (files) embed.addFields({ name: 'Tệp đính kèm', value: clip(files), inline: false });

    return {
        embeds: [embed],
        files: context.files,
        components: historyButtons(context.messageId, context.editCount, null)
    };
}

export interface EditLogContext {
    messageId: string;
    channelId: string;
    guildId: string | null;
    authorId: string;
    before: string | null;
    after: string;
    editCount: number;
    files: AttachmentBuilder[];
}

export function buildEditLogPayload(context: EditLogContext) {
    const emojis = config.ui.emojis;
    const jumpUrl = messageLink(context.guildId, context.channelId, context.messageId);

    const embed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setTitle(`${emojis.note} Tin nhắn bị sửa`)
        .addFields(
            { name: 'Tác giả', value: `<@${context.authorId}>`, inline: true },
            { name: 'Kênh', value: `<#${context.channelId}>`, inline: true },
            { name: 'Lần sửa', value: `**${context.editCount}**`, inline: true },
            {
                name: 'Trước',
                value: context.before === null ? '*không có bản sao — tin gửi trước khi bật log*' : clip(context.before),
                inline: false
            },
            { name: 'Sau', value: clip(context.after), inline: false }
        )
        .setFooter({ text: `ID ${context.messageId}` })
        .setTimestamp();

    if (context.before !== null) {
        embed.addFields({ name: 'Chỗ đã sửa', value: clip(renderInlineDiff(context.before, context.after), 1000), inline: false });
    }

    return {
        embeds: [embed],
        files: context.files,
        components: historyButtons(context.messageId, context.editCount, jumpUrl)
    };
}

export function buildBulkDeleteLogPayload(options: {
    channelId: string;
    count: number;
    executorId: string | null;
    topAuthors: { authorId: string; count: number }[];
    transcript: AttachmentBuilder | null;
}) {
    const embed = new EmbedBuilder()
        .setColor('#c0392b')
        .setTitle(`${config.ui.emojis.delete} Xoá hàng loạt`)
        .addFields(
            { name: 'Kênh', value: `<#${options.channelId}>`, inline: true },
            { name: 'Số tin', value: `**${options.count}**`, inline: true },
            { name: 'Người thực hiện', value: options.executorId ? `<@${options.executorId}>` : '*không rõ*', inline: true },
            {
                name: 'Bị xoá nhiều nhất',
                value: options.topAuthors.map(row => `<@${row.authorId}> — ${row.count} tin`).join('\n') || '*không có bản sao nội dung*',
                inline: false
            }
        )
        .setFooter({ text: options.transcript ? 'Toàn bộ nội dung nằm trong file kèm theo' : 'Không dựng được transcript (không có bản sao)' })
        .setTimestamp();

    return { embeds: [embed], files: options.transcript ? [options.transcript] : [] };
}

// Nút "Xem đoạn đã sửa": so hai phiên bản mới nhất.
export async function buildEditDiffReply(messageId: string) {
    const versions = await getEditVersions(messageId);
    if (versions.length < 2) {
        const mirror = await getMirror(messageId);
        if (!mirror) return { content: `${config.ui.emojis.error} Không còn bản sao của tin này (đã quá hạn giữ).` };
        return { content: `${config.ui.emojis.note} Tin này chưa có đủ hai phiên bản để so.` };
    }

    const before = versions[versions.length - 2];
    const after = versions[versions.length - 1];
    const embed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setTitle(`Đoạn đã sửa · v${before.version} → v${after.version}`)
        .setDescription(renderDiffCodeBlock(before.content, after.content))
        .addFields({ name: 'Bản gộp', value: clip(renderInlineDiff(before.content, after.content), 1000) })
        .setFooter({ text: `ID ${messageId}` });

    return { embeds: [embed] };
}

// Nút "Toàn bộ lịch sử sửa". Quá 5 phiên bản thì gửi file để không tràn embed.
export async function buildEditHistoryReply(messageId: string) {
    const versions = await getEditVersions(messageId);
    if (!versions.length) {
        return { content: `${config.ui.emojis.error} Không có lịch sử sửa cho tin này.` };
    }

    if (versions.length > 5) {
        const body = versions
            .map(row => `--- v${row.version} · ${row.changedAt.toISOString()} ---\n${row.content}`)
            .join('\n\n');
        return {
            content: `${config.ui.emojis.note} Tin này có **${versions.length}** phiên bản — xem file kèm.`,
            files: [new AttachmentBuilder(Buffer.from(body, 'utf8'), { name: `edit-history-${messageId}.txt` })]
        };
    }

    const embed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setTitle('Lịch sử sửa')
        .setDescription(versions
            .map(row => `**v${row.version}** · <t:${Math.floor(row.changedAt.getTime() / 1000)}:T>\n${clip(row.content, 600)}`)
            .join('\n\n'))
        .setFooter({ text: `ID ${messageId}` });

    return { embeds: [embed] };
}
