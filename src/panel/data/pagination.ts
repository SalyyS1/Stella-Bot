// Phân trang dùng chung cho mọi truy vấn của panel.
//
// Trần đặt ở SERVER. Trần ở client là trần trang trí: client gửi `pageSize=10000` thì
// vẫn phải nhận về 50. Panel chạy trong cùng process với bot, nên một truy vấn quét cả
// bảng không chỉ làm trang chậm — nó làm bot chậm.

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

export interface Paging {
    page: number;
    pageSize: number;
    skip: number;
    take: number;
}

export interface Page<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
}

/**
 * Số nguyên trong khoảng, hoặc `fallback`. Nhận `unknown` vì nguồn là query string —
 * `Number('abc')` ra NaN, và NaN đi vào `skip` của Prisma là một lỗi lúc chạy.
 */
export function parseIntParam(
    value: unknown,
    options: { min: number; max: number; fallback: number }
): number {
    const raw = Array.isArray(value) ? value[0] : value;
    const parsed = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
    if (!Number.isFinite(parsed)) return options.fallback;
    const rounded = Math.trunc(parsed);
    if (rounded < options.min) return options.min;
    if (rounded > options.max) return options.max;
    return rounded;
}

export function resolvePaging(page?: unknown, pageSize?: unknown): Paging {
    const resolvedPage = parseIntParam(page, { min: 1, max: 100_000, fallback: 1 });
    const resolvedSize = parseIntParam(pageSize, {
        min: 1,
        max: MAX_PAGE_SIZE,
        fallback: DEFAULT_PAGE_SIZE
    });
    return {
        page: resolvedPage,
        pageSize: resolvedSize,
        skip: (resolvedPage - 1) * resolvedSize,
        take: resolvedSize
    };
}

export function toPage<T>(items: T[], total: number, paging: Paging): Page<T> {
    return {
        items,
        total,
        page: paging.page,
        pageSize: paging.pageSize,
        pageCount: Math.max(1, Math.ceil(total / paging.pageSize))
    };
}
