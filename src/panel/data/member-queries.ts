import prisma from '../../lib/prisma';
import { countActiveWarns } from '../../systems/moderation/mod-case-manager';
import { getInviteStats } from '../../systems/invite/invite-stats';
import { getVoiceStats } from '../../systems/stats/voice-activity-manager';
import { Page, Paging, resolvePaging, toPage } from './pagination';
import { limitedAll, withQueryLimit } from './query-limit';

// Tra cứu thành viên. CHỈ ĐỌC.
//
// Ba con số (warn, voice, invite) lấy bằng cách gọi lại đúng ba hàm mà `/profile` đang
// dùng, không viết lại truy vấn. Panel và slash command phải không bao giờ nói hai con số
// khác nhau về cùng một người.

export interface MemberSummary {
    id: string;
    level: number;
    xp: number;
    totalMessages: number;
    scoinBalance: number;
    contributionScore: number;
    verified: boolean;
    hasPortfolio: boolean;
    joinedAt: string | null;
}

export interface MemberDetail extends MemberSummary {
    expertScore: number;
    scoinEarnedTotal: number;
    dailyStreak: number;
    voiceSeconds: number;
    inviteTotal: number;
    invitePending: number;
    /** Warn còn hiệu lực và tổng hồ sơ kiểm duyệt. Panel chỉ admin vào nên hiện được. */
    activeWarns: number;
    modCaseTotal: number;
    ordersRequested: number;
    ordersClaimed: number;
    blacklisted: boolean;
}

const MEMBER_SELECT = {
    id: true,
    level: true,
    xp: true,
    totalMessages: true,
    scoinBalance: true,
    contributionScore: true,
    verifiedAt: true,
    hasPortfolio: true,
    joinedAt: true
} as const;

function toSummary(row: {
    id: string; level: number; xp: number; totalMessages: number; scoinBalance: number;
    contributionScore: number; verifiedAt: Date | null; hasPortfolio: boolean; joinedAt: Date | null;
}): MemberSummary {
    return {
        id: row.id,
        level: row.level,
        xp: row.xp,
        totalMessages: row.totalMessages,
        scoinBalance: row.scoinBalance,
        contributionScore: row.contributionScore,
        verified: Boolean(row.verifiedAt),
        hasPortfolio: row.hasPortfolio,
        joinedAt: row.joinedAt?.toISOString() ?? null
    };
}

export interface MemberSearchFilter {
    /** Tìm theo Discord ID. Tên hiển thị nằm ở Discord, không nằm trong DB. */
    q?: string | null;
    page?: unknown;
    pageSize?: unknown;
}

export async function searchMembers(filter: MemberSearchFilter = {}): Promise<Page<MemberSummary>> {
    const paging: Paging = resolvePaging(filter.page, filter.pageSize);
    // Chỉ giữ chữ số: Discord ID là số. Bỏ mọi ký tự khác cũng là bỏ luôn ký tự đặc biệt
    // của LIKE, nên không cần thoát chuỗi riêng.
    const digits = (filter.q ?? '').replace(/\D/g, '').slice(0, 25);
    const where = digits ? { id: { contains: digits } } : {};

    const [rows, total] = await limitedAll([
        () => prisma.user.findMany({
            where,
            orderBy: [{ level: 'desc' }, { xp: 'desc' }],
            skip: paging.skip,
            take: paging.take,
            select: MEMBER_SELECT
        }),
        () => prisma.user.count({ where })
    ] as const);

    return toPage(rows.map(toSummary), total, paging);
}

export async function getMemberDetail(userId: string): Promise<MemberDetail | null> {
    // ID phải là chuỗi số: đây là khoá chính, không phải ô tìm kiếm.
    if (!/^\d{5,25}$/.test(userId)) return null;

    const row = await withQueryLimit(() => prisma.user.findUnique({
        where: { id: userId },
        select: {
            ...MEMBER_SELECT,
            expertScore: true,
            scoinEarnedTotal: true,
            dailyStreak: true
        }
    }));
    if (!row) return null;

    const [ordersRequested, ordersClaimed, blacklist] = await limitedAll([
        () => prisma.requestPost.count({ where: { requesterId: userId } }),
        () => prisma.requestPost.count({ where: { claimedById: userId } }),
        () => prisma.blacklist.findUnique({ where: { id: userId }, select: { id: true } }).catch(() => null)
    ] as const);

    // Ba hàm dưới đây thuộc systems/ và tự fan-out truy vấn bên trong (getInviteStats mở
    // 4 truy vấn song song). Chúng KHÔNG đi qua trần của panel, nên chạy tuần tự — song
    // song hoá chúng là cách nhanh nhất để làm cạn pool 15 client của pooler.
    const voice = await getVoiceStats(userId);
    const invites = await getInviteStats(userId);
    const warns = await countActiveWarns(userId);

    return {
        ...toSummary(row),
        expertScore: row.expertScore,
        scoinEarnedTotal: row.scoinEarnedTotal,
        dailyStreak: row.dailyStreak,
        voiceSeconds: voice.totalSeconds,
        inviteTotal: invites.total,
        invitePending: invites.pending,
        activeWarns: warns.warns,
        modCaseTotal: warns.total,
        ordersRequested,
        ordersClaimed,
        blacklisted: Boolean(blacklist)
    };
}
