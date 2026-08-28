import prisma from '../../lib/prisma';
import { getOrderOverview, OrderOverview } from './order-queries';
import { countOpenTickets } from './ticket-queries';
import { limitedAll } from './query-limit';

// Số liệu tổng quan cho dashboard. CHỈ ĐỌC.
//
// Chọn theo tiêu chí "con số này làm Saly làm gì khác đi", không phải "con số này có sẵn".
// Mỗi trường ở đây phải trả lời được một câu hỏi hành động.

export interface CommunityOverview {
    orders: OrderOverview;
    openTickets: number;
    /** Thành viên có joinedAt trong 7 ngày qua. */
    newMembers7d: number;
    /** Tổng scoin đang nằm trong ví thành viên — phát hiện lạm phát trước khi nó thành vấn đề. */
    scoinInCirculation: number;
    /** Điểm trung bình 30 ngày gần nhất và 30 ngày trước đó — chất lượng đang lên hay xuống. */
    rating30d: { avg: number | null; count: number };
    ratingPrev30d: { avg: number | null; count: number };
    generatedAt: string;
}

export async function getCommunityOverview(): Promise<CommunityOverview> {
    const now = Date.now();
    const since7d = new Date(now - 7 * 86_400_000);
    const since30d = new Date(now - 30 * 86_400_000);
    const since60d = new Date(now - 60 * 86_400_000);

    // KHÔNG gộp getOrderOverview/countOpenTickets vào cùng một limitedAll với các truy
    // vấn lẻ bên dưới: hai hàm đó tự dùng trần bên trong, và giữ một slot rồi chờ slot
    // khác là công thức của deadlock khi có nhiều request cùng lúc. Chạy theo nhóm tuần
    // tự, chậm hơn vài trăm ms và không bao giờ treo.
    const orders = await getOrderOverview();
    const openTickets = await countOpenTickets();

    const [newMembers7d, scoinSum, rating30d, ratingPrev30d] = await limitedAll([
        () => prisma.user.count({ where: { joinedAt: { gte: since7d } } }),
        () => prisma.user.aggregate({ _sum: { scoinBalance: true } }),
        () => prisma.requestReview.aggregate({
            where: { createdAt: { gte: since30d } },
            _avg: { rating: true },
            _count: { rating: true }
        }),
        () => prisma.requestReview.aggregate({
            where: { createdAt: { gte: since60d, lt: since30d } },
            _avg: { rating: true },
            _count: { rating: true }
        })
    ] as const);

    return {
        orders,
        openTickets,
        newMembers7d,
        scoinInCirculation: scoinSum._sum.scoinBalance ?? 0,
        rating30d: {
            // `_avg` trả null khi không có dòng nào. Đổi thành 0 là nói sai: "chưa có đánh
            // giá" khác "đánh giá trung bình 0 điểm".
            avg: rating30d._count.rating > 0 ? rating30d._avg.rating : null,
            count: rating30d._count.rating
        },
        ratingPrev30d: {
            avg: ratingPrev30d._count.rating > 0 ? ratingPrev30d._avg.rating : null,
            count: ratingPrev30d._count.rating
        },
        generatedAt: new Date(now).toISOString()
    };
}
