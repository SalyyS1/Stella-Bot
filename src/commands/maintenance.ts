import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { clearMaintenanceTarget, MaintenanceTarget } from '../systems/maintenanceManager';
import { config } from '../config';
import { backfillVotesAndScores } from '../systems/voteBackfillManager';
import { t } from '../i18n';
import { antiRaidStatus } from '../systems/antiRaidManager';
import { getManagedChannelIds } from '../utils/managedChannels';
import { runReport, reportChunkStatus } from '../systems/reportManager';
import { listTerms, deleteTerm } from '../systems/knowledge/glossary-store';
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
                .setName('report')
                .setDescription('Đăng ngay bản tin AI (bỏ qua lịch, để test)')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('glossary-list')
                .setDescription('Xem các thuật ngữ Stella đã học (kiểm tra định nghĩa sai)')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('glossary-forget')
                .setDescription('Xoá một thuật ngữ Stella đã học sai')
                .addStringOption(option =>
                    option
                        .setName('term')
                        .setDescription('Thuật ngữ cần xoá')
                        .setRequired(true)
                )
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

        if (interaction.options.getSubcommand() === 'report') {
            // Read the chunk state BEFORE composing: a posted report prunes old
            // chunks, so asking afterwards would under-report what the bulletin
            // was actually built from.
            const chunkInfo = await reportChunkStatus().catch(() => null);
            const result = await runReport(interaction.client, true);
            const msg = result === 'posted'
                ? 'Đã đăng bản tin AI.'
                : result === 'empty'
                    ? 'Không có gì để đăng (không có hoạt động / request mở) hoặc kênh báo cáo không hợp lệ.'
                    : result === 'disabled'
                        ? 'Tính năng AI đang tắt (thiếu AI_API_KEY).'
                        : 'Bản tin cho hôm nay đã đăng rồi.';
            // Surface how many 3h windows the bulletin drew on. A thin report is
            // almost always missing chunks (bot offline, or AI failing on a slot),
            // and that is invisible from the bulletin text alone.
            const detail = chunkInfo
                ? ` (ghi chép 3h: ${chunkInfo.stored}/${chunkInfo.expected} khung, đang ở khung ${chunkInfo.currentSlot})`
                : '';
            return interaction.editReply(`${config.ui.emojis.success} ${msg}${detail}`);
        }

        // Audit what the community has taught Stella. A wrong definition gets reused
        // in every later bulletin, so being able to read the list back matters as
        // much as being able to delete from it.
        if (interaction.options.getSubcommand() === 'glossary-list') {
            const terms = await listTerms();
            if (!terms.length) {
                return interaction.editReply('Chưa có thuật ngữ nào trong từ điển.');
            }
            const lines = terms.map(row => row.meaning
                ? `• **${row.term}** — ${row.meaning.slice(0, 120)}${row.answeredBy ? ` (bởi <@${row.answeredBy}>)` : ''}`
                : `• **${row.term}** — _chưa ai trả lời_`);
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#9b59b6')
                    .setTitle('Từ điển Stella')
                    .setDescription(lines.join('\n').slice(0, 4096))
                    .setFooter({ text: `${terms.length} thuật ngữ · dùng /maintenance glossary-forget để xoá` })]
            });
        }

        if (interaction.options.getSubcommand() === 'glossary-forget') {
            const term = interaction.options.getString('term', true);
            const removed = await deleteTerm(term);
            return interaction.editReply(removed
                ? `${config.ui.emojis.success} Đã xoá thuật ngữ \`${term}\`.`
                : `${config.ui.emojis.error} Không tìm thấy thuật ngữ \`${term}\`.`);
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
