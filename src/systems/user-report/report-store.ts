import { randomUUID } from 'crypto';
import { Prisma, type ReportEscalation as ReportEscalationRow } from '@prisma/client';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import {
    decideEscalation,
    effectiveEscalationLevel,
    isDiscordId,
    reportDayFor,
    reportWindowStart,
    ReportPolicyError,
    REPORT_DAILY_LIMIT,
    REPORT_DUPLICATE,
    type ReportAction,
    type ReportStatus
} from './report-policy';

export interface SubmitReportRecordInput {
    guildId: string;
    reporterId: string;
    targetId: string;
    category: string;
    reason: string;
    evidenceUrl: string | null;
    countsTowardEscalation: boolean;
    now?: Date;
}

export interface EscalationReservation {
    action: ReportAction;
    nextLevel: number;
    reportCount: number;
    token: string;
    throughAt: Date;
    expiresAt: Date;
}

export interface SubmitReportRecordResult {
    reportId: number;
    reportDay: string;
    escalation: EscalationReservation | null;
}

type Tx = Prisma.TransactionClient;

// Một process bot vẫn có thể nhận hai interaction cùng lúc. Lock nhẹ theo reporter/ngày
// làm giới hạn report/ngày có hiệu lực ngay trong process; unique index vẫn là lớp cuối
// chống race nếu lỡ chạy hai process hoặc request đi qua route HTTP trong tương lai.
const reporterLocks = new Map<string, Promise<void>>();

function withReporterLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = reporterLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    reporterLocks.set(key, current);
    return previous.then(task).finally(() => {
        release();
        if (reporterLocks.get(key) === current) reporterLocks.delete(key);
    });
}

function duplicateError(): ReportPolicyError {
    return new ReportPolicyError(REPORT_DUPLICATE, 'Bạn đã report thành viên này trong hôm nay rồi.');
}

function dailyLimitError(): ReportPolicyError {
    return new ReportPolicyError(
        REPORT_DAILY_LIMIT,
        `Bạn đã dùng hết ${config.userReports.reporterDailyLimit} report hôm nay. Hãy để mod xử lý các report đã gửi.`
    );
}

function escalationWhere(guildId: string, targetId: string) {
    return { guildId_targetId: { guildId, targetId } };
}

async function clearExpiredPending(
    tx: Tx,
    state: ReportEscalationRow | null,
    now: Date
): Promise<ReportEscalationRow | null> {
    if (!state?.pendingAction || !state.pendingExpiresAt || state.pendingExpiresAt > now) return state;
    await tx.reportEscalation.updateMany({
        where: { guildId: state.guildId, targetId: state.targetId, pendingToken: state.pendingToken },
        data: {
            pendingAction: null,
            pendingLevel: null,
            pendingToken: null,
            pendingThroughAt: null,
            pendingExpiresAt: null
        }
    });
    return tx.reportEscalation.findUnique({ where: escalationWhere(state.guildId, state.targetId) });
}

/** Ghi report và, nếu vừa chạm ngưỡng, đặt một reservation duy nhất cho hành động. */
export async function submitReportRecord(input: SubmitReportRecordInput): Promise<SubmitReportRecordResult> {
    if (!isDiscordId(input.guildId) || !isDiscordId(input.reporterId) || !isDiscordId(input.targetId)) {
        throw new ReportPolicyError('REPORT_INVALID_ID', 'ID thành viên không hợp lệ.');
    }
    const now = input.now && !Number.isNaN(input.now.getTime()) ? input.now : new Date();
    const reportDay = reportDayFor(now);
    const lockKey = `${input.guildId}:${input.reporterId}:${reportDay}`;

    return withReporterLock(lockKey, () => prisma.$transaction(async tx => {
        const existing = await tx.memberReport.findUnique({
            where: {
                guildId_reporterId_targetId_reportDay: {
                    guildId: input.guildId,
                    reporterId: input.reporterId,
                    targetId: input.targetId,
                    reportDay
                }
            },
            select: { id: true }
        });
        if (existing) throw duplicateError();

        const submittedToday = await tx.memberReport.count({
            where: { guildId: input.guildId, reporterId: input.reporterId, reportDay }
        });
        if (submittedToday >= config.userReports.reporterDailyLimit) throw dailyLimitError();

        let report: Awaited<ReturnType<typeof tx.memberReport.create>>;
        try {
            report = await tx.memberReport.create({
                data: {
                    guildId: input.guildId,
                    reporterId: input.reporterId,
                    targetId: input.targetId,
                    reportDay,
                    category: input.category,
                    reason: input.reason,
                    evidenceUrl: input.evidenceUrl,
                    countsTowardEscalation: input.countsTowardEscalation
                }
            });
        } catch (error: unknown) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw duplicateError();
            }
            throw error;
        }

        let state: ReportEscalationRow | null = await tx.reportEscalation.upsert({
            where: escalationWhere(input.guildId, input.targetId),
            update: {},
            create: { guildId: input.guildId, targetId: input.targetId }
        });
        state = await clearExpiredPending(tx, state, now);
        if (!state) throw new Error('Không đọc được trạng thái report.');

        const start = reportWindowStart(now, state.lastActionAt, config.userReports.windowDays);
        const openReports = await tx.memberReport.findMany({
            where: {
                guildId: input.guildId,
                targetId: input.targetId,
                status: 'OPEN',
                countsTowardEscalation: true,
                createdAt: { gte: start, lte: report.createdAt }
            },
            select: { reporterId: true }
        });
        const distinctReporters = new Set(openReports.map(row => row.reporterId)).size;
        const effectiveLevel = effectiveEscalationLevel(
            state.level,
            state.lastActionAt,
            now,
            config.userReports.windowDays
        );
        const decision = decideEscalation(
            effectiveLevel,
            distinctReporters,
            config.userReports.reportsPerEscalation,
            Boolean(state.pendingAction)
        );
        if (!decision) return { reportId: report.id, reportDay, escalation: null };

        const token = randomUUID();
        const ttl = decision.action === 'KICK'
            ? config.userReports.kickApprovalTtlMs
            : config.userReports.timeoutReservationTtlMs;
        const expiresAt = new Date(now.getTime() + ttl);
        const reserved = await tx.reportEscalation.updateMany({
            where: {
                guildId: input.guildId,
                targetId: input.targetId,
                level: state.level,
                pendingAction: null
            },
            data: {
                pendingAction: decision.action,
                pendingLevel: decision.nextLevel,
                pendingToken: token,
                pendingThroughAt: report.createdAt,
                pendingExpiresAt: expiresAt
            }
        });
        if (reserved.count === 0) return { reportId: report.id, reportDay, escalation: null };

        return {
            reportId: report.id,
            reportDay,
            escalation: {
                action: decision.action,
                nextLevel: decision.nextLevel,
                reportCount: distinctReporters,
                token,
                throughAt: report.createdAt,
                expiresAt
            }
        };
    }));
}

export interface PendingEscalation {
    guildId: string;
    targetId: string;
    level: number;
    pendingAction: string;
    pendingLevel: number | null;
    pendingToken: string;
    pendingThroughAt: Date | null;
    pendingExpiresAt: Date | null;
    updatedAt: Date;
}

function asPending(row: ReportEscalationRow | null): PendingEscalation | null {
    if (!row?.pendingToken || !row.pendingAction) return null;
    return {
        guildId: row.guildId,
        targetId: row.targetId,
        level: row.level,
        pendingAction: row.pendingAction,
        pendingLevel: row.pendingLevel,
        pendingToken: row.pendingToken,
        pendingThroughAt: row.pendingThroughAt,
        pendingExpiresAt: row.pendingExpiresAt,
        updatedAt: row.updatedAt
    };
}

type KickClaimAction = 'KICK_PROCESSING' | 'KICK_REJECTING';

/**
 * Chuyển proposal KICK sang trạng thái đang xử lý bằng update có điều kiện. Đây là CAS ở
 * DB: hai admin bấm cùng lúc thì chỉ một người lấy được proposal, người còn lại thấy stale.
 */
export async function claimPendingKick(
    guildId: string,
    targetId: string,
    token: string,
    action: KickClaimAction,
    now = new Date()
): Promise<PendingEscalation | null> {
    return prisma.$transaction(async tx => {
        let state = await tx.reportEscalation.findUnique({ where: escalationWhere(guildId, targetId) });
        if (!state || state.pendingToken !== token) return null;

        // Process cũ có thể chết sau khi claim nhưng trước khi gọi Discord. Sau 5 phút,
        // cho phép nút cũ lấy lại proposal; còn proposal KICK chưa ai bấm quá 7 ngày thì
        // hết hạn thật và được dọn.
        if (
            ['KICK_PROCESSING', 'KICK_REJECTING'].includes(state.pendingAction || '') &&
            state.pendingExpiresAt && state.pendingExpiresAt <= now
        ) {
            await tx.reportEscalation.updateMany({
                where: { guildId, targetId, pendingToken: token, pendingAction: state.pendingAction },
                data: {
                    pendingAction: 'KICK',
                    pendingExpiresAt: new Date(now.getTime() + config.userReports.kickApprovalTtlMs)
                }
            });
            state = await tx.reportEscalation.findUnique({ where: escalationWhere(guildId, targetId) });
        }
        if (!state || state.pendingAction !== 'KICK' || (state.pendingExpiresAt && state.pendingExpiresAt <= now)) {
            return null;
        }

        const claimed = await tx.reportEscalation.updateMany({
            where: { guildId, targetId, pendingToken: token, pendingAction: 'KICK' },
            data: {
                pendingAction: action,
                pendingExpiresAt: new Date(now.getTime() + 5 * 60_000)
            }
        });
        if (!claimed.count) return null;
        return asPending(await tx.reportEscalation.findUnique({ where: escalationWhere(guildId, targetId) }));
    });
}

/** Khi Discord lỗi, trả proposal về trạng thái chờ để admin khác thử lại. */
export async function restorePendingKick(
    guildId: string,
    targetId: string,
    token: string,
    expectedAction: KickClaimAction
): Promise<boolean> {
    const restored = await prisma.reportEscalation.updateMany({
        where: { guildId, targetId, pendingToken: token, pendingAction: expectedAction },
        data: {
            pendingAction: 'KICK',
            pendingExpiresAt: new Date(Date.now() + config.userReports.kickApprovalTtlMs)
        }
    });
    return restored.count > 0;
}

export async function getPendingEscalation(guildId: string, targetId: string): Promise<PendingEscalation | null> {
    const row = await prisma.reportEscalation.findUnique({ where: escalationWhere(guildId, targetId) });
    if (!row) return null;
    if (row.pendingToken && row.pendingExpiresAt && row.pendingExpiresAt <= new Date()) {
        await clearPendingEscalation(guildId, targetId, row.pendingToken);
        return null;
    }
    return asPending(row);
}

export async function clearPendingEscalation(guildId: string, targetId: string, token: string): Promise<boolean> {
    const result = await prisma.reportEscalation.updateMany({
        where: { guildId, targetId, pendingToken: token },
        data: {
            pendingAction: null,
            pendingLevel: null,
            pendingToken: null,
            pendingThroughAt: null,
            pendingExpiresAt: null
        }
    });
    return result.count > 0;
}

export async function resolvePendingEscalation(input: {
    guildId: string;
    targetId: string;
    token: string;
    actorId: string;
    outcome: 'ACTIONED' | 'DISMISSED';
    advanceLevel: boolean;
    resolution: string;
    expectedAction: string;
}): Promise<{ ok: boolean; affected: number }> {
    return prisma.$transaction(async tx => {
        const state = await tx.reportEscalation.findUnique({ where: escalationWhere(input.guildId, input.targetId) });
        if (
            !state || state.pendingToken !== input.token ||
            state.pendingAction !== input.expectedAction
        ) return { ok: false, affected: 0 };

        const through = state.pendingThroughAt ?? new Date();
        const marked = await tx.memberReport.updateMany({
            where: {
                guildId: input.guildId,
                targetId: input.targetId,
                status: 'OPEN',
                createdAt: { lte: through }
            },
            data: {
                status: input.outcome,
                resolution: input.resolution.slice(0, 500),
                reviewedBy: input.actorId,
                reviewedAt: new Date()
            }
        });
        await tx.reportEscalation.update({
            where: escalationWhere(input.guildId, input.targetId),
            data: {
                level: input.advanceLevel ? (state.pendingLevel ?? state.level + 1) : state.level,
                lastActionAt: new Date(),
                pendingAction: null,
                pendingLevel: null,
                pendingToken: null,
                pendingThroughAt: null,
                pendingExpiresAt: null
            }
        });
        return { ok: true, affected: marked.count };
    });
}

export async function listPendingEscalations(guildId: string): Promise<PendingEscalation[]> {
    const rows = await prisma.reportEscalation.findMany({
        where: { guildId, pendingAction: 'KICK' },
        orderBy: { updatedAt: 'desc' },
        take: 50
    });
    const active: PendingEscalation[] = [];
    for (const row of rows) {
        if (row.pendingExpiresAt && row.pendingExpiresAt <= new Date()) {
            await clearPendingEscalation(row.guildId, row.targetId, row.pendingToken || '');
            continue;
        }
        const pending = asPending(row);
        if (pending) active.push(pending);
    }
    return active;
}

export async function listMemberReports(input: {
    guildId: string;
    status?: ReportStatus;
    targetId?: string;
    skip?: number;
    take?: number;
}) {
    const requestedTake = Number(input.take ?? 20);
    const requestedSkip = Number(input.skip ?? 0);
    const take = Number.isFinite(requestedTake)
        ? Math.min(20, Math.max(1, Math.floor(requestedTake)))
        : 20;
    const skip = Number.isFinite(requestedSkip) ? Math.max(0, Math.floor(requestedSkip)) : 0;
    return prisma.memberReport.findMany({
        where: {
            guildId: input.guildId,
            status: input.status,
            targetId: input.targetId
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
            id: true, reporterId: true, targetId: true, category: true, reason: true,
            evidenceUrl: true, countsTowardEscalation: true, status: true,
            resolution: true, reviewedBy: true,
            reviewedAt: true, createdAt: true
        }
    });
}

export async function dismissMemberReport(
    guildId: string,
    reportId: number,
    reviewerId: string,
    reason: string
): Promise<boolean> {
    const report = await prisma.memberReport.findFirst({ where: { id: reportId, guildId } });
    if (!report) throw new Error('Không tìm thấy report trong server này.');
    if (report.status !== 'OPEN') return false;
    const pending = await getPendingEscalation(guildId, report.targetId);
    if (pending) throw new Error('Mục tiêu đang có proposal chờ admin; hãy dùng nút Từ chối proposal trước.');
    const updated = await prisma.memberReport.updateMany({
        where: { id: reportId, guildId, status: 'OPEN' },
        data: {
            status: 'DISMISSED',
            resolution: reason.slice(0, 500),
            reviewedBy: reviewerId,
            reviewedAt: new Date()
        }
    });
    return updated.count > 0;
}

/**
 * Administrator xoá điểm leo thang sau khi xác định một chuỗi report là sai/lạm dụng.
 * Không xoá row: mọi report vẫn còn làm audit trail. Optimistic lock bằng `updatedAt`
 * khiến reset không thể âm thầm đè lên một proposal vừa được admin khác claim.
 */
export async function resetMemberReportState(input: {
    guildId: string;
    targetId: string;
    reviewerId: string;
    reason: string;
}): Promise<{ dismissed: number; stateReset: boolean }> {
    if (![input.guildId, input.targetId, input.reviewerId].every(isDiscordId)) {
        throw new ReportPolicyError('REPORT_INVALID_ID', 'ID thành viên không hợp lệ.');
    }
    const reason = input.reason.trim().slice(0, 500) || 'Administrator đặt lại lịch sử leo thang';

    return prisma.$transaction(async tx => {
        const state = await tx.reportEscalation.findUnique({
            where: escalationWhere(input.guildId, input.targetId)
        });
        if (state && ['KICK_PROCESSING', 'KICK_REJECTING'].includes(state.pendingAction || '')) {
            throw new Error('Proposal đang được admin khác xử lý; hãy thử lại sau.');
        }

        let stateReset = false;
        if (state) {
            const reset = await tx.reportEscalation.updateMany({
                where: {
                    guildId: input.guildId,
                    targetId: input.targetId,
                    updatedAt: state.updatedAt,
                    pendingAction: state.pendingAction
                },
                data: {
                    level: 0,
                    lastActionAt: null,
                    pendingAction: null,
                    pendingLevel: null,
                    pendingToken: null,
                    pendingThroughAt: null,
                    pendingExpiresAt: null
                }
            });
            if (!reset.count) throw new Error('Trạng thái report vừa thay đổi; hãy tải lại rồi thử lại.');
            stateReset = true;
        }

        const reports = await tx.memberReport.updateMany({
            where: { guildId: input.guildId, targetId: input.targetId, status: 'OPEN' },
            data: {
                status: 'DISMISSED',
                resolution: reason,
                reviewedBy: input.reviewerId,
                reviewedAt: new Date()
            }
        });
        return { dismissed: reports.count, stateReset };
    });
}
