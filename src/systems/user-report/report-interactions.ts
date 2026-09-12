import { ButtonInteraction, GuildMember, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { config } from '../../config';
import { safeDeferUpdate, safeInteractionReply } from '../../utils/interaction-safe-reply';
import { approvePendingKick, rejectPendingKick } from './report-service';
import { parseReportActionId } from './report-alert';

/** Nút proposal kick: permission check trước defer, rồi kiểm token + state trong DB. */
export async function handleUserReportButton(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await safeInteractionReply(interaction, {
            content: `${config.ui.emojis.error} Chỉ Administrator mới duyệt hoặc từ chối proposal kick.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const parsed = parseReportActionId(interaction.customId);
    if (!parsed || !interaction.guild) {
        await safeInteractionReply(interaction, {
            content: `${config.ui.emojis.error} Proposal không hợp lệ hoặc đã hết hạn.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const acknowledged = await safeDeferUpdate(interaction);
    if (!acknowledged) return;
    const admin = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!admin) {
        await interaction.editReply(`${config.ui.emojis.error} Không đọc được tài khoản admin trong server.`).catch(() => {});
        return;
    }

    if (parsed.decision === 'reject') {
        const result = await rejectPendingKick(interaction.guild, parsed.targetId, parsed.token, admin as GuildMember);
        if (result === 'rejected') {
            await interaction.editReply({
                content: `${config.ui.emojis.close} Đã từ chối proposal kick (bởi <@${interaction.user.id}>).`,
                components: []
            }).catch(() => {});
        } else if (result === 'forbidden') {
            await interaction.editReply(`${config.ui.emojis.error} Chỉ Administrator mới được xử lý proposal.`).catch(() => {});
        } else {
            await interaction.editReply({
                content: `${config.ui.emojis.note} Proposal đã được xử lý hoặc hết hạn.`,
                components: []
            }).catch(() => {});
        }
        return;
    }

    const result = await approvePendingKick(interaction.guild, parsed.targetId, parsed.token, admin as GuildMember);
    if (result.status === 'approved') {
        await interaction.editReply({
            content: `${config.ui.emojis.success} Đã kick mục tiêu theo proposal — hồ sơ **#${result.caseId}**.`,
            components: []
        }).catch(() => {});
    } else if (result.status === 'target-left') {
        await interaction.editReply({
            content: `${config.ui.emojis.note} Mục tiêu đã rời server; proposal đã được đóng.`,
            components: []
        }).catch(() => {});
    } else if (result.status === 'forbidden') {
        await interaction.editReply(`${config.ui.emojis.error} Chỉ Administrator mới được xử lý proposal.`).catch(() => {});
    } else if (result.status === 'stale') {
        await interaction.editReply({
            content: `${config.ui.emojis.note} Proposal đã được xử lý hoặc hết hạn.`,
            components: []
        }).catch(() => {});
    } else {
        // Không xoá nút khi lỗi hierarchy/API: admin khác có quyền cao hơn vẫn cần thử lại.
        await interaction.editReply(`${config.ui.emojis.error} Chưa kick được: ${result.message}`).catch(() => {});
    }
}
