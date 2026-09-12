import { Guild, GuildMember, PermissionFlagsBits } from 'discord.js';
import { config } from '../../config';
import { sendAdminLog } from '../../utils/adminLog';
import { kickMember, timeoutMember } from '../moderation/mod-actions';
import { sendKickApproval } from './report-alert';
import {
    timeoutMatchesRequest,
    validateReportInput,
    type ReportAction
} from './report-policy';
import {
    claimPendingKick,
    clearPendingEscalation,
    resolvePendingEscalation,
    restorePendingKick,
    submitReportRecord
} from './report-store';

export interface SubmitMemberReportOptions {
    guild: Guild;
    reporter: GuildMember;
    target: GuildMember;
    category: string;
    reason: string;
    evidenceUrl?: string | null;
}

export interface SubmitMemberReportResult {
    reportId: number;
    action: ReportAction | null;
}

function moderationReason(reportId: number, category: string): string {
    return `Nhiều report độc lập · report #${reportId} · ${category}`;
}

function canCountTowardEscalation(options: SubmitMemberReportOptions): boolean {
    const now = Date.now();
    const accountAge = now - options.reporter.user.createdTimestamp;
    const guildAge = options.reporter.joinedTimestamp === null
        ? 0
        : now - options.reporter.joinedTimestamp;
    const reporterOldEnough =
        accountAge >= config.userReports.minReporterAccountAgeDays * 86_400_000 &&
        guildAge >= config.userReports.minReporterGuildHours * 3_600_000;
    // Report về staff vẫn được lưu để owner xem, nhưng tuyệt đối không biến thành
    // auto-timeout. Nếu không, một nhóm thành viên cũ có thể phối hợp hạ moderator.
    const hasModerationPower = [
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.BanMembers
    ].some(permission => options.target.permissions.has(permission));
    const targetProtected =
        options.target.id === options.guild.ownerId ||
        hasModerationPower ||
        !options.target.moderatable;
    return reporterOldEnough && !targetProtected;
}

/**
 * Ghi report và chạy đúng hành động vừa chạm ngưỡng. Timeout là tự động; kick luôn dừng
 * ở proposal. Hành động Discord đi qua mod-actions để dùng chung hierarchy/owner checks.
 */
export async function submitMemberReport(options: SubmitMemberReportOptions): Promise<SubmitMemberReportResult> {
    if (!config.userReports.enabled) throw new Error('Hệ thống report hiện đang tạm tắt.');
    if (options.reporter.guild.id !== options.guild.id || options.target.guild.id !== options.guild.id) {
        throw new Error('Thành viên không thuộc server này.');
    }
    if (options.reporter.id === options.target.id) throw new Error('Không thể tự report chính mình.');
    if (options.reporter.user.bot || options.target.user.bot) throw new Error('Không nhận report đối với bot.');

    const input = validateReportInput(options.category, options.reason, options.evidenceUrl);
    const countsTowardEscalation = canCountTowardEscalation(options);
    const stored = await submitReportRecord({
        guildId: options.guild.id,
        reporterId: options.reporter.id,
        targetId: options.target.id,
        category: input.category,
        reason: input.reason,
        evidenceUrl: input.evidenceUrl,
        countsTowardEscalation
    });
    await sendAdminLog(options.guild.client, {
        title: 'Member report received',
        color: '#e67e22',
        fields: [
            { name: 'Report', value: `#${stored.reportId}`, inline: true },
            { name: 'Target ID', value: `\`${options.target.id}\``, inline: true },
            { name: 'Reporter ID', value: `\`${options.reporter.id}\``, inline: true },
            { name: 'Loại', value: input.category, inline: true },
            { name: 'Tính vào ngưỡng', value: countsTowardEscalation ? 'Có' : 'Không (tài khoản mới hoặc mục tiêu được bảo vệ)', inline: true },
            { name: 'Lý do', value: input.reason.slice(0, 1000), inline: false },
            { name: 'Bằng chứng', value: input.evidenceUrl || '*không có*', inline: false }
        ]
    }).catch(() => {});
    const escalation = stored.escalation;
    if (!escalation) return { reportId: stored.reportId, action: null };

    if (escalation.action === 'KICK') {
        const sent = await sendKickApproval({
            client: options.guild.client,
            guildId: options.guild.id,
            targetId: options.target.id,
            token: escalation.token,
            level: escalation.nextLevel - 1,
            reportCount: escalation.reportCount,
            reason: input.reason,
            evidenceUrl: input.evidenceUrl,
            expiresAt: escalation.expiresAt
        });
        if (!sent) {
            await clearPendingEscalation(options.guild.id, options.target.id, escalation.token).catch(() => {});
            await sendAdminLog(options.guild.client, {
                title: 'User report proposal unavailable',
                color: '#e67e22',
                fields: [
                    { name: 'Report', value: `#${stored.reportId}`, inline: true },
                    { name: 'Target ID', value: `\`${options.target.id}\``, inline: true },
                    { name: 'Hệ quả', value: 'Không gửi được nút duyệt; proposal đã được giải phóng để thử lại ở report sau.' }
                ]
            }).catch(() => {});
        }
        return { reportId: stored.reportId, action: 'KICK' };
    }

    const bot = options.guild.members.me;
    if (!bot) {
        await clearPendingEscalation(options.guild.id, options.target.id, escalation.token).catch(() => {});
        await sendAdminLog(options.guild.client, {
            title: 'User report timeout skipped',
            color: '#e67e22',
            fields: [{ name: 'Target ID', value: `\`${options.target.id}\`` }, { name: 'Lý do', value: 'Không đọc được member của bot.' }]
        }).catch(() => {});
        return { reportId: stored.reportId, action: escalation.action };
    }

    const durationMs = escalation.action === 'TIMEOUT_SHORT'
        ? config.userReports.firstTimeoutMs
        : config.userReports.secondTimeoutMs;
    const reason = moderationReason(stored.reportId, input.category);
    const timeoutStartedAt = Date.now();
    const expectedTimeoutUntil = timeoutStartedAt + durationMs;
    const previousTimeoutUntil = options.target.communicationDisabledUntilTimestamp ?? 0;
    let actionSucceeded = false;
    try {
        try {
            await timeoutMember({ guild: options.guild, actor: bot }, options.target, durationMs, reason);
            actionSucceeded = true;
        } catch (error) {
            // Discord có thể đã nhận PATCH nhưng DB ghi case lỗi. Đọc lại member để không
            // giải phóng reservation rồi timeout lặp vô hạn ở report kế tiếp. Không chỉ
            // kiểm "đang timeout": mục tiêu có thể đã bị timeout từ trước. Phải buộc lấy
            // dữ liệu mới từ Discord và thấy mốc kết thúc vừa đổi gần đúng mốc ta yêu cầu.
            const refreshed = await options.guild.members.fetch({
                user: options.target.id,
                force: true
            }).catch(() => null);
            const refreshedUntil = refreshed?.communicationDisabledUntilTimestamp ?? 0;
            const matchesRequestedTimeout = timeoutMatchesRequest(
                previousTimeoutUntil,
                refreshedUntil,
                expectedTimeoutUntil
            );
            if (!matchesRequestedTimeout) throw error;
            actionSucceeded = true;
        }
        if (actionSucceeded) {
            await resolvePendingEscalation({
                guildId: options.guild.id,
                targetId: options.target.id,
                token: escalation.token,
                actorId: bot.id,
                outcome: 'ACTIONED',
                advanceLevel: true,
                resolution: `${escalation.action} tự động`,
                expectedAction: escalation.action
            });
            await sendAdminLog(options.guild.client, {
                title: 'User report timeout applied',
                color: '#e67e22',
                fields: [
                    { name: 'Report', value: `#${stored.reportId}`, inline: true },
                    { name: 'Target ID', value: `\`${options.target.id}\``, inline: true },
                    { name: 'Mức', value: escalation.action, inline: true }
                ]
            }).catch(() => {});
        }
    } catch (error) {
        await clearPendingEscalation(options.guild.id, options.target.id, escalation.token).catch(() => {});
        await sendAdminLog(options.guild.client, {
            title: 'User report timeout skipped',
            color: '#e67e22',
            fields: [
                { name: 'Report', value: `#${stored.reportId}`, inline: true },
                { name: 'Target ID', value: `\`${options.target.id}\``, inline: true },
                { name: 'Lỗi', value: String(error instanceof Error ? error.message : error).slice(0, 500) }
            ]
        }).catch(() => {});
    }
    return { reportId: stored.reportId, action: escalation.action };
}

export type KickApprovalResult =
    | { status: 'approved'; caseId: number }
    | { status: 'target-left' }
    | { status: 'stale' }
    | { status: 'failed'; message: string }
    | { status: 'forbidden' };

export async function approvePendingKick(
    guild: Guild,
    targetId: string,
    token: string,
    admin: GuildMember
): Promise<KickApprovalResult> {
    if (!admin.permissions.has(PermissionFlagsBits.Administrator)) return { status: 'forbidden' };
    const pending = await claimPendingKick(guild.id, targetId, token, 'KICK_PROCESSING');
    if (!pending) return { status: 'stale' };

    const target = await guild.members.fetch(targetId).catch(() => null);
    if (!target) {
        await resolvePendingEscalation({
            guildId: guild.id, targetId, token, actorId: admin.id,
            outcome: 'ACTIONED', advanceLevel: true,
            resolution: 'Mục tiêu đã rời server trước khi duyệt',
            expectedAction: 'KICK_PROCESSING'
        }).catch(() => {});
        return { status: 'target-left' };
    }

    try {
        const result = await kickMember(
            { guild, actor: admin },
            target,
            `Duyệt proposal từ hệ thống report (mục tiêu ${targetId})`
        );
        await resolvePendingEscalation({
            guildId: guild.id, targetId, token, actorId: admin.id,
            outcome: 'ACTIONED', advanceLevel: true,
            resolution: 'Kick được Administrator duyệt',
            expectedAction: 'KICK_PROCESSING'
        });
        return { status: 'approved', caseId: result.caseId };
    } catch (error) {
        // Giữ proposal và nút để admin có hierarchy cao hơn thử lại; không tự xoá bằng
        // chứng cứ chỉ vì một lần Discord/API tạm lỗi.
        await restorePendingKick(guild.id, targetId, token, 'KICK_PROCESSING').catch(() => {});
        return {
            status: 'failed',
            message: String(error instanceof Error ? error.message : error).slice(0, 500)
        };
    }
}

export async function rejectPendingKick(
    guild: Guild,
    targetId: string,
    token: string,
    admin: GuildMember
): Promise<'rejected' | 'stale' | 'forbidden'> {
    if (!admin.permissions.has(PermissionFlagsBits.Administrator)) return 'forbidden';
    const pending = await claimPendingKick(guild.id, targetId, token, 'KICK_REJECTING');
    if (!pending) return 'stale';
    const resolved = await resolvePendingEscalation({
        guildId: guild.id,
        targetId,
        token,
        actorId: admin.id,
        outcome: 'DISMISSED',
        advanceLevel: false,
        resolution: 'Administrator từ chối proposal kick',
        expectedAction: 'KICK_REJECTING'
    });
    return resolved.ok ? 'rejected' : 'stale';
}
