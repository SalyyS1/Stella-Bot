import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildMember,
    InteractionReplyOptions,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import {
    dismissMemberReport,
    listMemberReports,
    listPendingEscalations,
    resetMemberReportState
} from '../systems/user-report/report-store';
import { REPORT_CATEGORIES } from '../systems/user-report/report-policy';
import type { ReportStatus } from '../systems/user-report/report-policy';
import { submitMemberReport } from '../systems/user-report/report-service';
import { renderPendingRows, renderReportRows } from '../systems/user-report/report-view';
import { sendAdminLog } from '../utils/adminLog';

const ADMIN_STATUS_CHOICES = [
    { name: 'Đang chờ', value: 'OPEN' },
    { name: 'Đã xử lý', value: 'ACTIONED' },
    { name: 'Đã bỏ qua', value: 'DISMISSED' }
];

function privatePayload(content: string): InteractionReplyOptions {
    return { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function safeContent(content: string) {
    return { content, allowedMentions: { parse: [] as never[] } };
}

function isModerator(interaction: ChatInputCommandInteraction): boolean {
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers));
}

export default {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Báo cáo hành vi của một thành viên để mod xem xét')
        .addSubcommand(sub => sub
            .setName('user')
            .setDescription('Gửi report riêng tư cho ban quản trị')
            .addUserOption(option => option
                .setName('member')
                .setDescription('Thành viên cần báo cáo')
                .setRequired(true))
            .addStringOption(option => option
                .setName('category')
                .setDescription('Loại vấn đề')
                .setRequired(true)
                .addChoices(...REPORT_CATEGORIES.map(category => ({ name: category.label, value: category.value }))))
            .addStringOption(option => option
                .setName('reason')
                .setDescription('Mô tả ngắn, cụ thể; đừng gửi thông tin nhạy cảm')
                .setRequired(true)
                .setMaxLength(config.userReports.reasonMaxLength))
            .addStringOption(option => option
                .setName('evidence')
                .setDescription('Link tin nhắn/bằng chứng (không bắt buộc)')
                .setRequired(false)
                .setMaxLength(config.userReports.evidenceMaxLength)))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('Mod xem danh sách report (riêng tư)')
            .addStringOption(option => option
                .setName('status')
                .setDescription('Lọc trạng thái')
                .setRequired(false)
                .addChoices(...ADMIN_STATUS_CHOICES))
            .addUserOption(option => option
                .setName('member')
                .setDescription('Lọc theo mục tiêu')
                .setRequired(false))
            .addIntegerOption(option => option
                .setName('page')
                .setDescription('Trang, tối đa 20 report/trang')
                .setMinValue(1)
                .setMaxValue(1000)))
        .addSubcommand(sub => sub
            .setName('pending')
            .setDescription('Administrator xem proposal kick đang chờ duyệt'))
        .addSubcommand(sub => sub
            .setName('dismiss')
            .setDescription('Mod bỏ qua một report sau khi xem xét')
            .addIntegerOption(option => option
                .setName('id')
                .setDescription('ID report')
                .setRequired(true)
                .setMinValue(1))
            .addStringOption(option => option
                .setName('reason')
                .setDescription('Lý do bỏ qua')
                .setRequired(false)
                .setMaxLength(500)))
        .addSubcommand(sub => sub
            .setName('reset')
            .setDescription('Administrator xoá cấp leo thang sai nhưng giữ audit trail')
            .addUserOption(option => option
                .setName('member')
                .setDescription('Thành viên cần đặt lại trạng thái report')
                .setRequired(true))
            .addStringOption(option => option
                .setName('reason')
                .setDescription('Lý do đặt lại')
                .setRequired(false)
                .setMaxLength(500))),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.guild) return interaction.reply(privatePayload(`${emojis.error} Lệnh này chỉ dùng trong server.`));
        const sub = interaction.options.getSubcommand();

        if (sub === 'user') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const reporter = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            const targetUser = interaction.options.getUser('member', true);
            const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!reporter || !target) {
                return interaction.editReply(safeContent(`${emojis.error} Chỉ report thành viên đang ở trong server.`));
            }
            try {
                await submitMemberReport({
                    guild: interaction.guild,
                    reporter: reporter as GuildMember,
                    target: target as GuildMember,
                    category: interaction.options.getString('category', true),
                    reason: interaction.options.getString('reason', true),
                    evidenceUrl: interaction.options.getString('evidence')
                });
                // Không nói số report/ngưỡng/hành động tự động: lộ ngưỡng biến lệnh này
                // thành trò phối hợp đủ đúng số người để ép mute một mục tiêu.
                return interaction.editReply(safeContent(
                    `${emojis.success} Đã tiếp nhận report riêng tư. Ban quản trị sẽ xem xét nếu cần.`
                ));
            } catch (error: any) {
                return interaction.editReply(safeContent(`${emojis.error} ${error?.message || 'Không gửi được report.'}`));
            }
        }

        if (
            (sub === 'pending' || sub === 'reset') &&
            !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.reply(privatePayload(`${emojis.error} Chỉ Administrator được quản lý cấp leo thang.`));
        }
        if ((sub === 'list' || sub === 'dismiss') && !isModerator(interaction)) {
            return interaction.reply(privatePayload(`${emojis.error} Bạn cần quyền Moderate Members.`));
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            if (sub === 'pending') {
                const rows = await listPendingEscalations(interaction.guild.id);
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#e74c3c')
                        .setTitle('Proposal kick đang chờ duyệt')
                        .setDescription(renderPendingRows(rows))
                        .setFooter({ text: 'Nút duyệt/từ chối nằm trong kênh log nội bộ.' })]
                });
            }
            if (sub === 'reset') {
                const target = interaction.options.getUser('member', true);
                const reason = interaction.options.getString('reason') || 'Administrator xác định report không còn hợp lệ';
                const result = await resetMemberReportState({
                    guildId: interaction.guild.id,
                    targetId: target.id,
                    reviewerId: interaction.user.id,
                    reason
                });
                await sendAdminLog(interaction.client, {
                    title: 'Member report escalation reset',
                    color: '#3498db',
                    fields: [
                        { name: 'Target ID', value: `\`${target.id}\``, inline: true },
                        { name: 'Administrator', value: `\`${interaction.user.id}\``, inline: true },
                        { name: 'Report bỏ qua', value: String(result.dismissed), inline: true },
                        { name: 'Lý do', value: reason.slice(0, 500), inline: false }
                    ]
                }).catch(() => {});
                return interaction.editReply(safeContent(
                    `${emojis.success} Đã đặt cấp report của ${target} về 0 và bỏ qua ${result.dismissed} report đang mở.`
                ));
            }
            if (sub === 'dismiss') {
                const id = interaction.options.getInteger('id', true);
                const reason = interaction.options.getString('reason') || 'Mod xem xét và bỏ qua';
                const changed = await dismissMemberReport(interaction.guild.id, id, interaction.user.id, reason);
                return interaction.editReply(changed
                    ? `${emojis.success} Đã bỏ qua report #${id}, giữ nguyên dấu vết để tra cứu.`
                    : `${emojis.note} Report #${id} đã được xử lý trước đó.`);
            }

            const page = interaction.options.getInteger('page') || 1;
            const rawStatus = interaction.options.getString('status');
            const status = ['OPEN', 'ACTIONED', 'DISMISSED'].includes(rawStatus || '')
                ? rawStatus as ReportStatus
                : undefined;
            const rows = await listMemberReports({
                guildId: interaction.guild.id,
                status,
                targetId: interaction.options.getUser('member')?.id,
                skip: (page - 1) * 20,
                take: 20
            });
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#e67e22')
                    .setTitle(`Member reports · trang ${page}`)
                    .setDescription(renderReportRows(rows))
                    .setFooter({ text: 'Chỉ mod thấy nội dung report; dữ liệu được giữ để chống lạm dụng.' })]
            });
        } catch (error: any) {
            console.error('[report] lỗi:', error);
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không xử lý được report.'}`);
        }
    }
};
