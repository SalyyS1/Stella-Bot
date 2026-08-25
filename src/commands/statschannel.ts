import {
    ChannelType,
    ChatInputCommandInteraction,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import {
    createStatsChannel,
    hasPresenceIntent,
    listStatsChannels,
    refreshStatsChannels,
    removeStatsChannel,
    STATS_KINDS,
    type StatsKind
} from '../systems/stats/stats-channel-manager';

// Tên lệnh là `statschannel`, không phải `stats`: `/stats` đã có từ trước và trả về bảng
// thống kê tổng quan của server. Hai việc khác nhau, không gộp.
export default {
    data: new SlashCommandBuilder()
        .setName('statschannel')
        .setDescription('Kênh voice hiển thị số liệu server, tự cập nhật (thay counter Statbot/ProBot)')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Tạo một kênh thống kê')
                .addStringOption(option =>
                    option.setName('kind').setDescription('Loại số liệu').setRequired(true)
                        .addChoices(...STATS_KINDS.map(entry => ({ name: entry.label, value: entry.value }))))
                .addStringOption(option => option.setName('label').setDescription('Nhãn hiển thị').setMaxLength(60))
                .addChannelOption(option =>
                    option.setName('category').setDescription('Category chứa kênh').addChannelTypes(ChannelType.GuildCategory)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Gỡ một kênh thống kê')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Kênh').setRequired(true).addChannelTypes(ChannelType.GuildVoice))
                .addBooleanOption(option => option.setName('delete').setDescription('Xoá luôn kênh (mặc định: có)')))
        .addSubcommand(sub => sub.setName('list').setDescription('Danh sách kênh thống kê'))
        .addSubcommand(sub => sub.setName('refresh').setDescription('Cập nhật ngay, không chờ nhịp'))
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
        const intervalMinutes = Math.round(Math.max(config.stats.updateIntervalMs, config.stats.minIntervalMs) / 60_000);

        if (sub === 'list') {
            const rows = await listStatsChannels();
            return interaction.editReply(
                rows.length
                    ? `${emojis.note} **${rows.length}** kênh thống kê (cập nhật mỗi ${intervalMinutes} phút):\n` +
                      rows.map(row => `• <#${row.channelId}> — \`${row.kind}\``).join('\n')
                    : `${emojis.note} Chưa có kênh thống kê nào.`
            );
        }

        if (sub === 'refresh') {
            const renamed = await refreshStatsChannels(interaction.guild);
            return interaction.editReply(`${emojis.success} Đã cập nhật **${renamed}** kênh (kênh nào số không đổi thì bỏ qua).`);
        }

        if (sub === 'remove') {
            const channel = interaction.options.getChannel('channel', true);
            const removed = await removeStatsChannel(
                channel.id,
                interaction.guild,
                interaction.options.getBoolean('delete') ?? true
            );
            return interaction.editReply(
                removed ? `${emojis.success} Đã gỡ kênh thống kê.` : `${emojis.close} Kênh đó không phải kênh thống kê.`
            );
        }

        const kind = interaction.options.getString('kind', true) as StatsKind;
        const meta = STATS_KINDS.find(entry => entry.value === kind)!;

        // Thiếu intent thì kênh sẽ luôn hiện 0 — thà từ chối và nói rõ hơn là tạo một cái
        // nhãn sai mà không ai hiểu vì sao.
        if (meta.needsPresence && !hasPresenceIntent(interaction.client)) {
            return interaction.editReply(
                `${emojis.error} Loại **${meta.label}** cần intent \`GuildPresences\` mà bot chưa bật, ` +
                'nên kênh sẽ luôn hiện 0.\n' +
                'Bật trong Discord Developer Portal → Bot → Privileged Gateway Intents, ' +
                'rồi thêm `GatewayIntentBits.GuildPresences` vào `src/index.ts`.'
            );
        }

        try {
            const channelId = await createStatsChannel({
                guild: interaction.guild,
                kind,
                label: interaction.options.getString('label') || meta.label,
                createdBy: interaction.user.id,
                categoryId: interaction.options.getChannel('category')?.id
            });
            return interaction.editReply(
                `${emojis.success} Đã tạo <#${channelId}>. Tự cập nhật mỗi **${intervalMinutes} phút**.\n` +
                '-# Nhịp này là sàn an toàn: Discord chỉ cho đổi tên một kênh 2 lần mỗi 10 phút.'
            );
        } catch (error: any) {
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không tạo được kênh.'}`);
        }
    }
};
