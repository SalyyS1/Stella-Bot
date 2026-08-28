import prisma from '../../lib/prisma';
import { Page, Paging, resolvePaging, toPage } from './pagination';
import { limitedAll } from './query-limit';

// Bài showcase cho panel. CHỈ ĐỌC.

export interface ShowcaseRow {
    messageId: string;
    channelId: string;
    authorId: string;
    title: string;
    tagName: string;
    status: string;
    forumThreadId: string | null;
    createdAt: string;
    publishedAt: string | null;
}

// Trạng thái được phép xem. `OPTED_OUT` KHÔNG có trong danh sách này, kể cả cho admin:
// đó là bài tác giả đã chủ động xin không đăng. Panel liệt kê lại chúng là đi ngược lựa
// chọn của họ, và "chỉ admin xem" không đổi được điều đó — ảnh chụp màn hình panel vẫn
// đi ra ngoài.
const VIEWABLE_STATUS = new Set(['VOTING', 'PUBLISHING', 'PUBLISHED']);

export interface ShowcaseFilter {
    status?: string | null;
    authorId?: string | null;
    page?: unknown;
    pageSize?: unknown;
}

export async function listShowcases(filter: ShowcaseFilter = {}): Promise<Page<ShowcaseRow>> {
    const paging: Paging = resolvePaging(filter.page, filter.pageSize);

    const status = filter.status && VIEWABLE_STATUS.has(filter.status) ? filter.status : 'PUBLISHED';
    const where: Record<string, unknown> = { status };
    if (filter.authorId && /^\d{5,25}$/.test(filter.authorId)) where.authorId = filter.authorId;

    const [rows, total] = await limitedAll([
        () => prisma.showcasePost.findMany({
            where,
            // Bài đã publish thì sắp theo ngày publish; bài chưa thì theo ngày tạo.
            orderBy: status === 'PUBLISHED' ? { publishedAt: 'desc' } : { createdAt: 'desc' },
            skip: paging.skip,
            take: paging.take,
            select: {
                messageId: true, channelId: true, authorId: true, title: true,
                tagName: true, status: true, forumThreadId: true,
                createdAt: true, publishedAt: true
            }
        }),
        () => prisma.showcasePost.count({ where })
    ] as const);

    return toPage(
        rows.map(row => ({
            messageId: row.messageId,
            channelId: row.channelId,
            authorId: row.authorId,
            // `title` do người dùng gõ. Trả nguyên văn; phía client tuyệt đối không được
            // render bằng dangerouslySetInnerHTML.
            title: row.title,
            tagName: row.tagName,
            status: row.status,
            forumThreadId: row.forumThreadId,
            createdAt: row.createdAt.toISOString(),
            publishedAt: row.publishedAt?.toISOString() ?? null
        })),
        total,
        paging
    );
}
