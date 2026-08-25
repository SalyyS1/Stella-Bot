import {
    ChannelType,
    ChatInputCommandInteraction,
    GuildTextBasedChannel,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';

// Trần của Discord: 6 tiếng. Gửi số lớn hơn thì API từ chối cả lệnh.
const MAX_SLOWMODE_SECONDS = 21_600;

export default {
    data: new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('Đặt slowmode cho kênh (0 = tắt)')
        .addIntegerOption(option =>
            option.setName('seconds')
                .setDescription('Số giây giữa hai tin của cùng một người (0 = tắt)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(MAX_SLOWMODE_SECONDS))
        .addChannelOption(option =>
            option.setName('channel').setDescription('Kênh (mặc định: kênh này)').addChannelTypes(ChannelType.GuildText))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Channels.`, flags: MessageFlags.Ephemeral });
        }

        const seconds = interaction.options.getInteger('seconds', true);
        const channel = (interaction.options.getChannel('channel') || interaction.channel) as GuildTextBasedChannel | null;
        if (!channel || channel.type !== ChannelType.GuildText) {
            return interaction.reply({ content: `${emojis.error} Chỉ đặt được cho kênh text.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const applied = await channel
            .setRateLimitPerUser(seconds, `Slowmode bởi ${interaction.user.tag}`)
            .then(() => true)
            .catch(() => false);

        if (!applied) return interaction.editReply(`${emojis.error} Không đặt được — Stella thiếu quyền Manage Channels ở kênh này.`);
        return interaction.editReply(
            seconds
                ? `${emojis.success} Slowmode <#${channel.id}>: **${seconds} giây**/tin.`
                : `${emojis.success} Đã tắt slowmode ở <#${channel.id}>.`
        );
    }
};
