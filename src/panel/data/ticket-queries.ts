import prisma from '../../lib/prisma';
import { Page, Paging, resolvePaging, toPage } from './pagination';
import { limitedAll, withQueryLimit } from './query-limit';

// Ticket cho panel. CHỈ ĐỌC.
//
// KHÔNG trả nội dung ticket. `topic` là một dòng người mở tự gõ nên hiện được, còn nội
// dung trao đổi nằm trong transcript ở kênh log — panel không proxy nó. Ticket là chỗ
// người ta kể chuyện họ không muốn kể công khai; biến panel thành máy đọc lại chúng là
// mở một mặt lộ mới, không phải thêm một tính năng.

export interface TicketRow {
    id: number;
    openerId: string;
    topic: string;
    claimedBy: string | null;
    closedBy: string | null;
    createdAt: string;
    closedAt: string | null;
    /** Số giờ ticket đã mở (hoặc đã tồn tại tới lúc đóng). */
    ageHours: number;
}

export interface TicketFilter {
    /** true = chỉ ticket đang mở, false = chỉ đã đóng, undefined = tất cả. */
    open?: boolean;
    page?: unknown;
    pageSize?: unknown;
}

export async function listTickets(filter: TicketFilter = {}): Promise<Page<TicketRow>> {
    const paging: Paging = resolvePaging(filter.page, filter.pageSize);
    const where = filter.open === undefined
        ? {}
        : filter.open
            ? { closedAt: null }
            : { closedAt: { not: null } };

    const [rows, total] = await limitedAll([
        () => prisma.ticket.findMany({
            where,
            // Ticket mở lâu nhất lên đầu khi xem danh sách đang mở: đó là ticket bị bỏ quên.
            orderBy: filter.open ? { createdAt: 'asc' } : { createdAt: 'desc' },
            skip: paging.skip,
            take: paging.take,
            select: {
                id: true, openerId: true, topic: true, claimedBy: true,
                closedBy: true, createdAt: true, closedAt: true
            }
        }),
        () => prisma.ticket.count({ where })
    ] as const);

    const now = Date.now();
    return toPage(
        rows.map(row => ({
            id: row.id,
            openerId: row.openerId,
            topic: row.topic,
            claimedBy: row.claimedBy,
            closedBy: row.closedBy,
            createdAt: row.createdAt.toISOString(),
            closedAt: row.closedAt?.toISOString() ?? null,
            ageHours: Math.round(
                ((row.closedAt?.getTime() ?? now) - row.createdAt.getTime()) / 3_600_000
            )
        })),
        total,
        paging
    );
}

export async function countOpenTickets(): Promise<number> {
    return withQueryLimit(() => prisma.ticket.count({ where: { closedAt: null } }));
}
