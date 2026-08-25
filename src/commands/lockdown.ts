import {
    ChannelType,
    ChatInputCommandInteraction,
    GuildTextBasedChannel,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import { sendMessageLog } from '../systems/logs/message-log-sender';
import { EmbedBuilder } from 'discord.js';
import { liftAllLocks, listLocks, lockChannel, unlockChannel } from '../systems/moderation/channel-lock';

async function logAction(interaction: ChatInputCommandInteraction, title: string, description: string) {
    await sendMessageLog(interaction.client, {
        embeds: [new EmbedBuilder()
            .setColor('#e74c3c')
            .setTitle(title)
            .setDescription(`${description}\nBởi <@${interaction.user.id}>`)
            .setTimestamp()]
    }).catch(() => {});
}

export default {
    data: new SlashCommandBuilder()
        .setName('lockdown')
        .setDescription('Khoá quyền chat của @everyone trên một kênh (thay lockdown của Dyno)')
        .addSubcommand(sub =>
            sub.setName('on')
                .setDescription('Khoá một kênh')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Kênh (mặc định: kênh này)').addChannelTypes(ChannelType.GuildText))
                .addStringOption(option => option.setName('reason').setDescription('Lý do').setMaxLength(300)))
        .addSubcommand(sub =>
            sub.setName('off')
                .setDescription('Mở khoá một kênh')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Kênh (mặc định: kênh này)').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('lift').setDescription('Mở mọi kênh mà bot đã khoá'))
        .addSubcommand(sub => sub.setName('list').setDescription('Kênh nào đang bị khoá'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Channels.`, flags: MessageFlags.Ephemeral });
        }
        if (!interaction.guild) {
            return interaction.reply({ content: `${emojis.error} Lệnh này chỉ dùng trong server.`, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (sub === 'list') {
            const locks = await listLocks();
            return interaction.editReply(
                locks.length
                    ? `${emojis.appeal} Đang khoá **${locks.length}** kênh:\n` +
                      locks.map(lock =>
                          `• <#${lock.channelId}> — bởi <@${lock.actorId}>${lock.reason ? ` (${lock.reason})` : ''}`
                      ).join('\n').slice(0, 1800)
                    : `${emojis.note} Không có kênh nào đang bị khoá.`
            );
        }

        if (sub === 'lift') {
            const results = await liftAllLocks(interaction.guild);
            if (!results.length) return interaction.editReply(`${emojis.note} Không có kênh nào đang bị khoá.`);
            const failed = results.filter(result => !result.ok);
            await logAction(interaction, 'Lockdown · mở toàn bộ', `Đã mở ${results.length - failed.length}/${results.length} kênh.`);
            return interaction.editReply(
                `${emojis.success} Đã mở **${results.length - failed.length}/${results.length}** kênh.` +
                (failed.length ? `\n${emojis.error} Lỗi: ${failed.map(result => `<#${result.channelId}>`).join(', ')}` : '')
            );
        }

        const channel = (interaction.options.getChannel('channel') || interaction.channel) as GuildTextBasedChannel | null;
        if (!channel || !channel.isTextBased()) {
            return interaction.editReply(`${emojis.error} Không đọc được kênh.`);
        }

        if (sub === 'on') {
            const reason = interaction.options.getString('reason') || null;
            const result = await lockChannel(channel, interaction.user.id, reason);
            if (!result.ok) return interaction.editReply(`${emojis.error} ${result.error}`);
            await logAction(interaction, 'Lockdown · khoá kênh', `<#${channel.id}>${reason ? `\nLý do: ${reason}` : ''}`);
            return interaction.editReply(
                `${emojis.success} Đã khoá <#${channel.id}>. \`@everyone\` không gửi được tin.\n` +
                'Mở lại bằng `/lockdown off` — quyền kênh sẽ về **đúng** trạng thái trước khi khoá.'
            );
        }

        const result = await unlockChannel(channel);
        if (!result.ok) return interaction.editReply(`${emojis.error} ${result.error}`);
        await logAction(interaction, 'Lockdown · mở kênh', `<#${channel.id}>`);
        return interaction.editReply(`${emojis.success} Đã mở <#${channel.id}>.`);
    }
};
