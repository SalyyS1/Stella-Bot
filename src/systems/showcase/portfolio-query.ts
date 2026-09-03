import prisma from '../../lib/prisma';

// Đọc tác phẩm đã được duyệt của một người. CHỈ ĐỌC.
//
// Tách khỏi `showcaseManager.ts` (815 dòng, lo cả vòng vote lẫn luồng publish): đây là
// truy vấn đọc theo tác giả, không dính gì tới việc đăng bài. Logic nằm ở tầng systems/
// để lệnh Discord và một route HTTP sau này gọi lại đúng một hàm.

export const PORTFOLIO_PAGE_SIZE = 5;

export interface PortfolioItem {
    messageId: string;
    title: string;
    tagName: string;
    forumThreadId: string | null;
    publishedAt: Date | null;
}

export interface PortfolioPage {
    items: PortfolioItem[];
    total: number;
    page: number;
    pageCount: number;
}

/**
 * Bài showcase ĐÃ DUYỆT của một tác giả, mới nhất trước.
 *
 * Lọc bằng `status: 'PUBLISHED'` (equals) chứ không bằng `not in [...]`: `VOTING` là bài
 * chưa đủ vote, `PUBLISHING` là bài đang trong transaction publish, và `OPTED_OUT` là bài
 * tác giả đã chủ động xin không đăng. Dùng equals nghĩa là một status thêm sau này mặc
 * định BỊ ẨN — quên cập nhật danh sách loại trừ là lộ bài, quên cập nhật equals thì chỉ
 * là thiếu bài.
 */
export async function getPublishedPortfolio(
    authorId: string,
    options: { page?: number } = {}
): Promise<PortfolioPage> {
    // `Math.max(1, NaN)` trả về NaN, không phải 1 — nên phải kiểm isFinite TRƯỚC khi kẹp.
    // Không kiểm thì `skip: NaN` và Prisma từ chối cả truy vấn ("Argument skip is missing").
    const requested = Number(options.page ?? 1);
    const page = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 1;
    const empty: PortfolioPage = { items: [], total: 0, page: 1, pageCount: 1 };

    // ID phải là chuỗi số. Đây là khoá lọc, không phải ô tìm kiếm.
    if (!/^\d{5,25}$/.test(authorId)) return empty;

    const where = { authorId, status: 'PUBLISHED' };
    const total = await prisma.showcasePost.count({ where }).catch(error => {
        console.error('[portfolio] count failed:', error);
        return -1;
    });
    if (total < 0) return empty;

    const pageCount = Math.max(1, Math.ceil(total / PORTFOLIO_PAGE_SIZE));
    // Trang vượt cuối thì kẹp về trang cuối, không trả rỗng: người bấm "Sau" ở trang cuối
    // đáng được thấy trang cuối chứ không phải một danh sách trống.
    const safePage = Math.min(page, pageCount);

    const items = await prisma.showcasePost.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (safePage - 1) * PORTFOLIO_PAGE_SIZE,
        take: PORTFOLIO_PAGE_SIZE,
        select: {
            messageId: true,
            title: true,
            tagName: true,
            forumThreadId: true,
            publishedAt: true
        }
    }).catch(error => {
        console.error('[portfolio] findMany failed:', error);
        return [];
    });

    return { items, total, page: safePage, pageCount };
}
