import prisma from '../../lib/prisma';
import { Page, Paging, resolvePaging, toPage } from './pagination';
import { withQueryLimit } from './query-limit';

// Freelancer: uy tín (từ RequestReview) ghép với hồ sơ nhận việc tự khai
// (FreelancerProfile). CHỈ ĐỌC.
//
// Không tính lại uy tín theo công thức riêng ở đây. `/profile`, `/top freelancers` và
// panel phải nói cùng một con số về cùng một người — lệch nhau là mất tin, và người dùng
// sẽ tin con số nào tiện cho họ.

export interface FreelancerRow {
    userId: string;
    avgRating: number | null;
    jobCount: number;
    verified: boolean;
    openForWork: boolean | null;
    headline: string | null;
    priceText: string | null;
    profileUpdatedAt: string | null;
}

export interface FreelancerFilter {
    /** Chỉ hiện người đang nhận việc. */
    openOnly?: boolean;
    page?: unknown;
    pageSize?: unknown;
}

export async function listFreelancers(filter: FreelancerFilter = {}): Promise<Page<FreelancerRow>> {
    const paging: Paging = resolvePaging(filter.page, filter.pageSize);

    // Ba truy vấn tuần tự, mỗi cái qua trần: tổng số connection panel chiếm không bao giờ
    // vượt trần dù có bao nhiêu request cùng lúc.
    const grouped = await withQueryLimit(() => prisma.requestReview.groupBy({
        by: ['targetId'],
        _avg: { rating: true },
        _count: { rating: true }
    }));

    // Người có hồ sơ nhận việc nhưng chưa có job nào vẫn phải xuất hiện — đó đúng là
    // người cần được khách tìm thấy.
    const profiles = await withQueryLimit(() => prisma.freelancerProfile.findMany({
        select: { userId: true, openForWork: true, headline: true, priceText: true, updatedAt: true }
    }));
    const profileById = new Map(profiles.map(profile => [profile.userId, profile]));

    const userIds = new Set<string>([
        ...grouped.map(row => row.targetId),
        ...profiles.map(profile => profile.userId)
    ]);
    const verifiedRows = await withQueryLimit(() => prisma.user.findMany({
        where: { id: { in: [...userIds] }, verifiedAt: { not: null } },
        select: { id: true }
    }));
    const verified = new Set(verifiedRows.map(row => row.id));

    const ratingById = new Map(grouped.map(row => [row.targetId, row]));
    let rows: FreelancerRow[] = [...userIds].map(userId => {
        const rating = ratingById.get(userId);
        const profile = profileById.get(userId);
        const jobCount = rating?._count.rating ?? 0;
        return {
            userId,
            avgRating: jobCount > 0 ? rating?._avg.rating ?? null : null,
            jobCount,
            verified: verified.has(userId),
            openForWork: profile?.openForWork ?? null,
            headline: profile?.headline ?? null,
            priceText: profile?.priceText ?? null,
            profileUpdatedAt: profile?.updatedAt.toISOString() ?? null
        };
    });

    if (filter.openOnly) rows = rows.filter(row => row.openForWork === true);

    // Sắp bằng JS chứ không bằng SQL: dữ liệu đến từ hai bảng ghép trong bộ nhớ. Đây là
    // đánh đổi có ý thức — số freelancer là hàng chục, không phải hàng chục nghìn. Khi
    // nào danh sách này vượt vài nghìn dòng thì phải đổi sang một truy vấn có JOIN.
    rows.sort((a, b) =>
        (b.avgRating ?? -1) - (a.avgRating ?? -1) ||
        b.jobCount - a.jobCount ||
        a.userId.localeCompare(b.userId)
    );

    const total = rows.length;
    return toPage(rows.slice(paging.skip, paging.skip + paging.take), total, paging);
}
