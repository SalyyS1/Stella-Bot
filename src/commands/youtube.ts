import {
    ChannelType,
    ChatInputCommandInteraction,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import {
    addSubscription,
    listSubscriptions,
    pollYoutube,
    removeSubscription
} from '../systems/youtube/youtube-alert-manager';

// /youtube — theo dõi kênh YouTube, báo video mới vào một kênh Discord.
// Không key, không quota: đọc feed RSS công khai của YouTube.
export default {
    data: new SlashCommandBuilder()
        .setName('youtube')
        .setDescription('Báo video mới của kênh YouTube vào Discord (thay Social Alerts của MEE6)')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Theo dõi một kênh YouTube')
                .addStringOption(option =>
                    option.setName('channel')
                        .setDescription('@handle, link kênh, hoặc ID UC...')
                        .setRequired(true)
                        .setMaxLength(200))
                .addChannelOption(option =>
                    option.setName('post_in')
                        .setDescription('Kênh Discord để báo (mặc định: kênh này)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
                .addRoleOption(option =>
                    option.setName('ping').setDescription('Role được ping khi có video mới')))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Ngừng theo dõi một kênh')
                .addStringOption(option =>
                    option.setName('channel')
                        .setDescription('@handle, link kênh, hoặc ID UC...')
                        .setRequired(true)
                        .setMaxLength(200)))
        .addSubcommand(sub => sub.setName('list').setDescription('Kênh nào đang được theo dõi'))
        .addSubcommand(sub => sub.setName('check').setDescription('Quét ngay, không chờ nhịp 10 phút'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Server.`, flags: MessageFlags.Ephemeral });
        }
        if (!interaction.guild) {
            return interaction.reply({ content: `${emojis.error} Lệnh này chỉ dùng trong server.`, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const intervalMinutes = Math.round(config.youtube.pollIntervalMs / 60_000);

        if (sub === 'list') {
            const rows = await listSubscriptions();
            if (!rows.length) {
                return interaction.editReply(`${emojis.note} Chưa theo dõi kênh nào. Dùng \`/youtube add\`.`);
            }
            return interaction.editReply(
                `${emojis.note} **${rows.length}/${config.youtube.maxSubscriptions}** kênh, quét mỗi ${intervalMinutes} phút:\n` +
                rows.map(row =>
                    `• **${row.ytTitle}** → <#${row.discordChannelId}>` +
                    (row.pingRoleId ? ` (ping <@&${row.pingRoleId}>)` : '') +
                    (row.failCount > 0 ? ` — ⚠️ feed lỗi ${row.failCount} lần liền` : '')
                ).join('\n'),
            );
        }

        if (sub === 'check') {
            const count = await pollYoutube(interaction.client);
            return interaction.editReply(
                count
                    ? `${emojis.success} Đã báo **${count}** video mới.`
                    : `${emojis.success} Đã quét, không có video mới.`
            );
        }

        const channelInput = interaction.options.getString('channel', true);

        if (sub === 'remove') {
            try {
                const title = await removeSubscription(channelInput);
                return interaction.editReply(
                    title
                        ? `${emojis.success} Đã ngừng theo dõi **${title}**.`
                        : `${emojis.close} Kênh này chưa được theo dõi.`
                );
            } catch (error) {
                return interaction.editReply(`${emojis.error} ${error instanceof Error ? error.message : 'Không gỡ được.'}`);
            }
        }

        const target = interaction.options.getChannel('post_in') ?? interaction.channel;
        if (!target || !('id' in target)) {
            return interaction.editReply(`${emojis.error} Không xác định được kênh để báo.`);
        }

        try {
            const result = await addSubscription({
                channelInput,
                discordChannelId: target.id,
                pingRoleId: interaction.options.getRole('ping')?.id ?? null,
                addedBy: interaction.user.id
            });
            return interaction.editReply(
                `${emojis.success} ${result.replaced ? 'Đã cập nhật' : 'Đang theo dõi'} **${result.ytTitle}** → <#${target.id}>.\n` +
                (result.latest
                    ? `Video mới nhất hiện tại: [${result.latest.title}](${result.latest.url}) — từ giờ chỉ báo video đăng SAU cái này.`
                    : 'Kênh chưa có video nào; sẽ báo từ video đầu tiên.') +
                `\n-# Quét mỗi ${intervalMinutes} phút.`,
            );
        } catch (error) {
            return interaction.editReply(`${emojis.error} ${error instanceof Error ? error.message : 'Không thêm được kênh.'}`);
        }
    }
};
