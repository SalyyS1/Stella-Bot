import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { getEditVersions, getLatestDeleted, getLatestEdited, parseAttachments } from '../systems/logs/message-mirror';
import { renderInlineDiff } from '../utils/text-diff';

export default {
    data: new SlashCommandBuilder()
        .setName('snipe')
        .setDescription('[Mod] Xem tin vừa bị xoá hoặc vừa bị sửa trong kênh này')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Loại tin cần soi')
                .setRequired(false)
                .addChoices(
                    { name: 'Tin bị xoá (mặc định)', value: 'deleted' },
                    { name: 'Tin bị sửa', value: 'edited' }
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Moderate Members.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const type = interaction.options.getString('type') || 'deleted';
        const windowMinutes = Math.round(config.logs.snipeWindowMs / 60_000);

        try {
            if (type === 'edited') {
                const row = await getLatestEdited(interaction.channelId);
                if (!row) {
                    return interaction.editReply(`${emojis.note} Không có tin nào bị sửa ở kênh này trong ${windowMinutes} phút qua.`);
                }
                const versions = await getEditVersions(row.messageId);
                const before = versions.length >= 2 ? versions[versions.length - 2].content : null;

                const embed = new EmbedBuilder()
                    .setColor('#f1c40f')
                    .setTitle('Tin vừa bị sửa')
                    .addFields(
                        { name: 'Tác giả', value: `<@${row.authorId}>`, inline: true },
                        { name: 'Số lần sửa', value: `**${row.editCount}**`, inline: true },
                        { name: 'Nội dung hiện tại', value: row.content.slice(0, 1000) || '*trống*', inline: false }
                    )
                    .setFooter({ text: `ID ${row.messageId}` })
                    .setTimestamp(row.editedAt);

                if (before !== null) {
                    embed.addFields({ name: 'Chỗ đã sửa', value: renderInlineDiff(before, row.content, 1000), inline: false });
                }
                return interaction.editReply({ embeds: [embed] });
            }

            const row = await getLatestDeleted(interaction.channelId);
            if (!row) {
                return interaction.editReply(`${emojis.note} Không có tin nào bị xoá ở kênh này trong ${windowMinutes} phút qua.`);
            }

            const attachments = parseAttachments(row.attachments);
            const embed = new EmbedBuilder()
                .setColor('#e74c3c')
                .setTitle('Tin vừa bị xoá')
                .addFields(
                    { name: 'Tác giả', value: `<@${row.authorId}>`, inline: true },
                    { name: 'Người xoá', value: row.deletedBy ? `<@${row.deletedBy}> (mod)` : 'Tác giả tự xoá', inline: true },
                    { name: 'Nội dung', value: row.content.slice(0, 1000) || '*trống*', inline: false }
                )
                .setFooter({ text: `ID ${row.messageId}` })
                .setTimestamp(row.deletedAt);

            if (attachments.length) {
                // URL gốc gần như chắc chắn đã chết; nêu tên file để mod biết có gì
                // từng ở đó thay vì đưa một link bấm vào là lỗi.
                embed.addFields({
                    name: 'Tệp đính kèm (URL đã hết hiệu lực)',
                    value: attachments.map(file => `\`${file.name}\``).join(', ').slice(0, 1000),
                    inline: false
                });
            }

            return interaction.editReply({ embeds: [embed] });
        } catch (error: any) {
            console.error('[snipe] lỗi:', error);
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không soi được tin nhắn.'}`);
        }
    }
};
