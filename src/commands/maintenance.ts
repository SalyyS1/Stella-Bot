import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { clearMaintenanceTarget, MaintenanceTarget } from '../systems/maintenanceManager';
import { config } from '../config';
import { backfillVotesAndScores } from '../systems/voteBackfillManager';
import { t } from '../i18n';
import { antiRaidStatus } from '../systems/antiRaidManager';
import { getManagedChannelIds } from '../utils/managedChannels';
import { runDigest } from '../systems/digestManager';
import prisma from '../lib/prisma';

export default {
    data: new SlashCommandBuilder()
        .setName('maintenance')
        .setDescription('Quản lý dọn kênh Stella (Admin)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear kênh request/server ads và đăng lại hướng dẫn')
                .addStringOption(option =>
                    option
                        .setName('target')
                        .setDescription('Kênh cần clear')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Request Paid', value: 'requestPaid' },
                            { name: 'Request Free', value: 'requestFree' },
                            { name: 'Server Ads', value: 'serverAds' },
                            { name: 'All', value: 'all' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('backfill-votes')
                .setDescription('Quét showcase/share để gán reaction thiếu và tính lại điểm vote')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Xem trạng thái vận hành và anti-raid của Stella')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('digest')
                .setDescription('Đăng ngay bảng tin dịch vụ (bỏ qua lịch, để test)')
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.memberPermissions?.has('Administrator')) {
            return interaction.reply({ content: `${config.ui.emojis.error} Bạn không có quyền dùng lệnh này.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (interaction.options.getSubcommand() === 'status') {
            const antiRaid = antiRaidStatus();
            const [managed, users, activeGiveaways, openRequests] = await Promise.all([
                getManagedChannelIds(),
                prisma.user.count(),
                prisma.giveaway.count({ where: { status: 'ACTIVE' } }),
                prisma.requestPost.count({ where: { status: { in: ['OPEN', 'CLAIMED'] } } })
            ]);
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(antiRaid.enabled ? '#2ecc71' : '#e67e22')
                    .setTitle('Stella Operations Status')
                    .addFields(
                        { name: 'Anti-raid', value: antiRaid.enabled ? 'Enabled' : 'Disabled', inline: true },
                        { name: 'Strike groups', value: `${antiRaid.activeStrikeGroups}`, inline: true },
                        { name: 'Internal actions', value: `${antiRaid.pendingInternalActions}`, inline: true },
                        { name: 'Users', value: `${users}`, inline: true },
                        { name: 'Giveaway active', value: `${activeGiveaways}`, inline: true },
                        { name: 'Request open', value: `${openRequests}`, inline: true },
                        { name: 'Managed channels', value: Object.entries(managed).map(([key, id]) => `**${key}:** <#${id}>`).join('\n') }
                    )
                    .setFooter({ text: `Anti-raid window: ${Math.round(antiRaid.windowMs / 1000)}s` })
                    .setTimestamp()]
            });
        }

        if (interaction.options.getSubcommand() === 'digest') {
            const result = await runDigest(interaction.client, true);
            const msg = result === 'posted'
                ? 'Đã đăng bảng tin dịch vụ.'
                : result === 'empty'
                    ? 'Không có gì để đăng (không có request mở / showcase mới) hoặc kênh digest không hợp lệ.'
                    : 'Bảng tin cho kỳ này đã đăng rồi.';
            return interaction.editReply(`${config.ui.emojis.success} ${msg}`);
        }

        if (interaction.options.getSubcommand() === 'backfill-votes') {
            const result = await backfillVotesAndScores(interaction.client);
            const text = await t(interaction.guildId, 'showcase.reconcileDone', {
                scanned: result.scanned,
                created: result.created,
                reacted: result.reacted,
                votes: result.votes,
                published: result.published
            });
            return interaction.editReply(`${config.ui.emojis.success} ${text}`);
        }

        const target = interaction.options.getString('target', true);
        const targets: MaintenanceTarget[] = target === 'all'
            ? ['requestPaid', 'requestFree', 'serverAds']
            : [target as MaintenanceTarget];

        const results: string[] = [];
        for (const item of targets) {
            try {
                const deleted = await clearMaintenanceTarget(interaction.client, item, interaction.user.id);
                results.push(`${item}: OK (${deleted} tin nhắn)`);
            } catch (error) {
                results.push(`${item}: Lỗi - ${String(error).slice(0, 300)}`);
            }
        }

        await interaction.editReply(`${config.ui.emojis.success} Đã clear xong:\n${results.join('\n')}`);
    }
};
