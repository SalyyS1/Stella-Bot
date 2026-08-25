import {
    ChannelType,
    ChatInputCommandInteraction,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import { disableAutoThread, enableAutoThread, listAutoThreads } from '../systems/utility/autothread-manager';

const ARCHIVE_CHOICES = [
    { name: '1 giờ', value: 60 },
    { name: '1 ngày', value: 1440 },
    { name: '3 ngày', value: 4320 },
    { name: '1 tuần', value: 10080 }
];

export default {
    data: new SlashCommandBuilder()
        .setName('autothread')
        .setDescription('Tự mở thread cho mỗi tin trong kênh (thay auto-thread Carl-bot)')
        .addSubcommand(sub =>
            sub.setName('on')
                .setDescription('Bật cho một kênh')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Kênh (mặc định: kênh này)').addChannelTypes(ChannelType.GuildText))
                .addStringOption(option =>
                    option.setName('template').setDescription('Mẫu tên thread: {user}, {content}').setMaxLength(80))
                .addIntegerOption(option =>
                    option.setName('archive').setDescription('Tự đóng sau').addChoices(...ARCHIVE_CHOICES)))
        .addSubcommand(sub =>
            sub.setName('off')
                .setDescription('Tắt cho một kênh')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Kênh (mặc định: kênh này)').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('list').setDescription('Kênh nào đang bật'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Threads.`, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (sub === 'list') {
            const rows = await listAutoThreads();
            return interaction.editReply(
                rows.length
                    ? `${emojis.note} Auto-thread đang bật:\n` +
                      rows.map(row => `• <#${row.channelId}> — \`${row.nameTemplate}\`, đóng sau ${row.archiveMinutes} phút`).join('\n')
                    : `${emojis.note} Chưa bật ở kênh nào.`
            );
        }

        const channelId = interaction.options.getChannel('channel')?.id || interaction.channelId;

        if (sub === 'off') {
            const removed = await disableAutoThread(channelId);
            return interaction.editReply(
                removed ? `${emojis.success} Đã tắt auto-thread ở <#${channelId}>.` : `${emojis.close} Kênh đó chưa bật.`
            );
        }

        await enableAutoThread({
            channelId,
            nameTemplate: interaction.options.getString('template') || '{user}',
            archiveMinutes: interaction.options.getInteger('archive') ?? 1440,
            createdBy: interaction.user.id
        });
        return interaction.editReply(
            `${emojis.success} Auto-thread đã bật ở <#${channelId}>.\n` +
            'Tin trống hoàn toàn và tin đã có thread sẽ được bỏ qua.'
        );
    }
};
