import prisma from '../../lib/prisma';
import { formatBudget } from '../../systems/request/budget-parser';
import { parseReferenceUrls } from '../../systems/request/reference-image-validator';
import { Page, Paging, resolvePaging, toPage } from './pagination';
import { limitedAll, withQueryLimit } from './query-limit';

// Truy vấn đơn hàng cho panel. CHỈ ĐỌC.
//
// Hàm ở đây nhận tham số thường và trả dữ liệu thường — không nhận `req`/`res`. Đó là
// điều kiện để sau này một route HTTP khác, hay chính slash command, gọi lại được cùng
// hàm thay vì viết lại truy vấn lần thứ hai (hai truy vấn cho cùng một câu hỏi là hai
// con số sẽ lệch nhau).

const OPEN_TOO_LONG_HOURS = 48;

export interface OrderOverview {
    byStatus: Record<string, number>;
    byKind: Record<string, number>;
    /** Đơn còn OPEN quá 48 giờ — dấu hiệu cần nhắc nhóm kỹ năng tương ứng. */
    unclaimedTooLong: number;
    /** Đơn đã có người nhận nhưng quá hạn mong muốn. */
    overdue: number;
    activeTotal: number;
}

export async function getOrderOverview(): Promise<OrderOverview> {
    const now = new Date();
    const openCutoff = new Date(now.getTime() - OPEN_TOO_LONG_HOURS * 3_600_000);

    const [statusGroups, kindGroups, unclaimedTooLong, overdue] = await limitedAll([
        () => prisma.requestPost.groupBy({ by: ['status'], _count: { id: true } }),
        () => prisma.requestPost.groupBy({ by: ['kind'], _count: { id: true } }),
        () => prisma.requestPost.count({ where: { status: 'OPEN', createdAt: { lt: openCutoff } } }),
        () => prisma.requestPost.count({ where: { status: 'CLAIMED', dueDate: { lt: now } } })
    ] as const);

    const byStatus: Record<string, number> = {};
    for (const row of statusGroups) byStatus[row.status] = row._count.id;
    const byKind: Record<string, number> = {};
    for (const row of kindGroups) byKind[row.kind] = row._count.id;

    return {
        byStatus,
        byKind,
        unclaimedTooLong,
        overdue,
        activeTotal: (byStatus.OPEN || 0) + (byStatus.CLAIMED || 0)
    };
}

export interface OrderListItem {
    id: number;
    kind: string;
    status: string;
    skill: string | null;
    service: string;
    budgetLabel: string;
    budgetAmount: number | null;
    dueDate: string | null;
    requesterId: string;
    claimedById: string | null;
    hasOrderChannel: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface OrderFilter {
    status?: string | null;
    kind?: string | null;
    skill?: string | null;
    page?: unknown;
    pageSize?: unknown;
}

// Chỉ nhận đúng các giá trị đã biết. Nhận chuỗi tự do rồi đưa thẳng vào `where` là để
// query string quyết định hình dáng truy vấn.
const ALLOWED_STATUS = new Set(['OPEN', 'CLAIMED', 'DONE', 'RATED', 'CLOSED']);
const ALLOWED_KIND = new Set(['PAID', 'FREE']);

function orderWhere(filter: OrderFilter) {
    const where: Record<string, unknown> = {};
    if (filter.status && ALLOWED_STATUS.has(filter.status)) where.status = filter.status;
    if (filter.kind && ALLOWED_KIND.has(filter.kind)) where.kind = filter.kind;
    // `skill` là khoá enum trong config; so sánh bằng nên không cần thoát ký tự, nhưng
    // vẫn giới hạn độ dài để không nhận một chuỗi 10KB vào truy vấn.
    if (filter.skill) where.skill = String(filter.skill).slice(0, 40);
    return where;
}

export async function listOrders(filter: OrderFilter = {}): Promise<Page<OrderListItem>> {
    const paging: Paging = resolvePaging(filter.page, filter.pageSize);
    const where = orderWhere(filter);

    const [rows, total] = await limitedAll([
        () => prisma.requestPost.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            skip: paging.skip,
            take: paging.take,
            // `select` chứ không findMany trần: `description` và `other` có thể rất dài,
            // và danh sách không cần chúng. Select cũng bảo vệ được các cột thêm sau này.
            select: {
                id: true, kind: true, status: true, skill: true, service: true,
                budget: true, budgetAmount: true, budgetCurrency: true, dueDate: true,
                requesterId: true, claimedById: true, ticketChannelId: true,
                createdAt: true, updatedAt: true
            }
        }),
        () => prisma.requestPost.count({ where })
    ] as const);

    return toPage(
        rows.map(row => ({
            id: row.id,
            kind: row.kind,
            status: row.status,
            skill: row.skill,
            service: row.service,
            // Format tiền ở MỘT chỗ duy nhất (`formatBudget`). Client chỉ hiển thị chuỗi
            // nhận được, không tự nhân chia lại — hai chỗ format là hai chỗ sẽ lệch.
            budgetLabel: formatBudget(row.budgetAmount, row.budgetCurrency, row.budget),
            budgetAmount: row.budgetAmount,
            dueDate: row.dueDate?.toISOString() ?? null,
            requesterId: row.requesterId,
            claimedById: row.claimedById,
            // Chỉ trả boolean, KHÔNG trả id kênh đơn: đó là kênh riêng có dữ liệu khách,
            // panel không cần chỉ đường tới nó.
            hasOrderChannel: Boolean(row.ticketChannelId),
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString()
        })),
        total,
        paging
    );
}

export interface OrderDetail extends OrderListItem {
    description: string;
    other: string | null;
    referenceUrls: string[];
    completedAt: string | null;
    closedAt: string | null;
    claims: { claimerId: string; status: string; createdAt: string }[];
    reviews: { reviewerId: string; targetId: string; rating: number; note: string | null; createdAt: string }[];
}

export async function getOrderDetail(id: number): Promise<OrderDetail | null> {
    if (!Number.isInteger(id) || id <= 0) return null;
    const row = await withQueryLimit(() => prisma.requestPost.findUnique({
        where: { id },
        include: {
            claims: {
                orderBy: { createdAt: 'desc' },
                select: { claimerId: true, status: true, createdAt: true }
            },
            reviews: {
                orderBy: { createdAt: 'desc' },
                select: { reviewerId: true, targetId: true, rating: true, note: true, createdAt: true }
            }
        }
    }));
    if (!row) return null;

    return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        skill: row.skill,
        service: row.service,
        budgetLabel: formatBudget(row.budgetAmount, row.budgetCurrency, row.budget),
        budgetAmount: row.budgetAmount,
        dueDate: row.dueDate?.toISOString() ?? null,
        requesterId: row.requesterId,
        claimedById: row.claimedById,
        hasOrderChannel: Boolean(row.ticketChannelId),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        description: row.description,
        other: row.other,
        // URL CDN Discord HẾT HẠN. Panel hiện được thì hiện; hết hạn thì phía client phải
        // ra ảnh lỗi có chú thích, không phải ô trống bí ẩn.
        referenceUrls: parseReferenceUrls(row.referenceUrls),
        completedAt: row.completedAt?.toISOString() ?? null,
        closedAt: row.closedAt?.toISOString() ?? null,
        claims: row.claims.map(claim => ({
            claimerId: claim.claimerId,
            status: claim.status,
            createdAt: claim.createdAt.toISOString()
        })),
        reviews: row.reviews.map(review => ({
            reviewerId: review.reviewerId,
            targetId: review.targetId,
            rating: review.rating,
            note: review.note,
            createdAt: review.createdAt.toISOString()
        }))
    };
}
