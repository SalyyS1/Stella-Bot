import prisma from '../../lib/prisma';

export type InviteRange = 'all' | 'month' | 'week';

export interface InviteStats {
    /** Lượt mời quá khứ suy ra từ tổng `uses`, đã đóng băng. Không truy được từng người. */
    legacy: number;
    verified: number;
    pending: number;
    rejectedYoung: number;
    left: number;
    revoked: number;
    /** Lượt vào qua vanity/không rõ nguồn đang được ghi cho người này. */
    vanityOrUnknown: number;
    /** legacy + verified — con số dùng để xếp hạng. */
    total: number;
    scoinEarned: number;
}

const RANGE_LABEL: Record<InviteRange, string> = {
    all: 'từ trước tới giờ',
    month: '30 ngày qua',
    week: '7 ngày qua'
};

export function rangeLabel(range: InviteRange): string {
    return RANGE_LABEL[range];
}

function rangeStart(range: InviteRange): Date | null {
    if (range === 'all') return null;
    const days = range === 'month' ? 30 : 7;
    return new Date(Date.now() - days * 86_400_000);
}

export async function getInviteStats(userId: string): Promise<InviteStats> {
    const [grouped, backfill, scoin, vanityCount] = await Promise.all([
        prisma.inviteJoin.groupBy({
            by: ['status'],
            where: { inviterId: userId },
            _count: { _all: true }
        }).catch(() => [] as { status: string; _count: { _all: number } }[]),
        prisma.inviteBackfill.findUnique({ where: { inviterId: userId } }).catch(() => null),
        prisma.scoinTransaction.aggregate({
            where: { userId, source: 'invite:verified' },
            _sum: { amount: true }
        }).catch(() => ({ _sum: { amount: 0 } })),
        prisma.inviteJoin.count({
            where: { inviterId: userId, source: { in: ['VANITY', 'UNKNOWN'] } }
        }).catch(() => 0)
    ]);

    const byStatus = new Map(grouped.map(row => [row.status, row._count._all]));
    const legacy = backfill?.legacyUses ?? 0;
    const verified = byStatus.get('VERIFIED') ?? 0;

    return {
        legacy,
        verified,
        pending: byStatus.get('PENDING') ?? 0,
        rejectedYoung: byStatus.get('REJECTED_YOUNG') ?? 0,
        left: byStatus.get('LEFT') ?? 0,
        revoked: byStatus.get('REVOKED') ?? 0,
        vanityOrUnknown: vanityCount,
        total: legacy + verified,
        scoinEarned: scoin._sum.amount ?? 0
    };
}

export interface LeaderboardRow {
    inviterId: string;
    legacy: number;
    verified: number;
    total: number;
}

// Bảng xếp hạng. `legacy` chỉ được cộng vào ở phạm vi "tất cả": số đó là ảnh chụp
// một lần của quá khứ, không chia được theo tuần/tháng nên nhét vào phạm vi ngắn
// sẽ biến một người từng mời nhiều thành người "mời nhiều tuần này".
export async function getInviteLeaderboard(range: InviteRange, limit = 10): Promise<LeaderboardRow[]> {
    const since = rangeStart(range);
    const [verifiedGroups, backfills] = await Promise.all([
        prisma.inviteJoin.groupBy({
            by: ['inviterId'],
            where: {
                status: 'VERIFIED',
                ...(since ? { verifiedAt: { gte: since } } : {})
            },
            _count: { _all: true }
        }).catch(() => [] as { inviterId: string; _count: { _all: number } }[]),
        range === 'all'
            ? prisma.inviteBackfill.findMany().catch(() => [])
            : Promise.resolve([] as { inviterId: string; legacyUses: number }[])
    ]);

    const totals = new Map<string, LeaderboardRow>();
    for (const row of verifiedGroups) {
        totals.set(row.inviterId, {
            inviterId: row.inviterId,
            legacy: 0,
            verified: row._count._all,
            total: row._count._all
        });
    }
    for (const row of backfills) {
        const current = totals.get(row.inviterId) || { inviterId: row.inviterId, legacy: 0, verified: 0, total: 0 };
        current.legacy = row.legacyUses;
        current.total = current.verified + row.legacyUses;
        totals.set(row.inviterId, current);
    }

    return [...totals.values()]
        .filter(row => row.total > 0)
        .sort((a, b) => b.total - a.total || b.verified - a.verified)
        .slice(0, limit);
}

// Vị trí của một người trong bảng xếp hạng tổng. Server cỡ này thì xếp trong bộ
// nhớ rẻ hơn là dựng một câu SQL xếp hạng riêng.
export async function getInviteRank(userId: string): Promise<number | null> {
    const board = await getInviteLeaderboard('all', 1000);
    const index = board.findIndex(row => row.inviterId === userId);
    return index === -1 ? null : index + 1;
}

export async function getInvitedList(userId: string, take: number, skip = 0) {
    return prisma.inviteJoin.findMany({
        where: { inviterId: userId },
        orderBy: { joinedAt: 'desc' },
        take,
        skip
    }).catch(() => []);
}

export async function countInvitedList(userId: string): Promise<number> {
    return prisma.inviteJoin.count({ where: { inviterId: userId } }).catch(() => 0);
}

export async function getInviterOf(userId: string) {
    return prisma.inviteJoin.findUnique({ where: { invitedId: userId } }).catch(() => null);
}

// Số lượt mời đã verified, dùng cho welcome ("X đã mời N người") và trọng số
// giveaway. Tách khỏi getInviteStats để không phải chạy 4 truy vấn khi chỉ cần một số.
export async function countVerifiedInvites(userId: string, since?: Date | null): Promise<number> {
    return prisma.inviteJoin.count({
        where: {
            inviterId: userId,
            status: 'VERIFIED',
            ...(since ? { verifiedAt: { gte: since } } : {})
        }
    }).catch(() => 0);
}

export async function getLegacyUses(userId: string): Promise<number> {
    const row = await prisma.inviteBackfill.findUnique({ where: { inviterId: userId } }).catch(() => null);
    return row?.legacyUses ?? 0;
}
