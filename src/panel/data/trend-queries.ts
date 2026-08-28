import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { parseIntParam } from './pagination';
import { limitedAll } from './query-limit';

// Số liệu theo ngày cho biểu đồ dashboard. CHỈ ĐỌC.
//
// Vì sao dùng raw SQL: `groupBy` của Prisma group theo GIÁ TRỊ của cột, còn ở đây cần
// group theo NGÀY của một timestamp (`date_trunc`). Không có cách diễn đạt việc đó bằng
// API thường.
//
// Vì sao phải tham số hoá: số ngày đến từ query string. Nối chuỗi vào SQL là SQL
// injection với quyền của chính bot lên toàn bộ 64 bảng — đây là chỗ duy nhất trong panel
// có SQL thô, nên nó là chỗ duy nhất cần nói rõ điều này.

const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;

export interface DailyPoint {
    day: string;
    count: number;
}

export interface OrderTrend {
    days: number;
    created: DailyPoint[];
    completed: DailyPoint[];
    ratings: { day: string; avgRating: number; count: number }[];
}

function resolveDays(days?: unknown): number {
    return parseIntParam(days, { min: 1, max: MAX_DAYS, fallback: DEFAULT_DAYS });
}

function toDayKey(value: unknown): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

export async function getOrderTrend(days?: unknown): Promise<OrderTrend> {
    const window = resolveDays(days);
    // Khoảng thời gian tính bằng JS rồi truyền vào như một tham số, thay vì nhồi
    // `INTERVAL '${n} days'` vào câu SQL.
    const since = new Date(Date.now() - window * 86_400_000);

    const [created, completed, ratings] = await limitedAll([
        () => prisma.$queryRaw<{ day: Date; count: bigint }[]>(Prisma.sql`
            SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
            FROM "RequestPost"
            WHERE "createdAt" >= ${since}
            GROUP BY 1
            ORDER BY 1
        `),
        () => prisma.$queryRaw<{ day: Date; count: bigint }[]>(Prisma.sql`
            SELECT date_trunc('day', "completedAt") AS day, COUNT(*)::bigint AS count
            FROM "RequestPost"
            WHERE "completedAt" IS NOT NULL AND "completedAt" >= ${since}
            GROUP BY 1
            ORDER BY 1
        `),
        () => prisma.$queryRaw<{ day: Date; avg: number; count: bigint }[]>(Prisma.sql`
            SELECT date_trunc('day', "createdAt") AS day,
                   AVG("rating")::float8 AS avg,
                   COUNT(*)::bigint AS count
            FROM "RequestReview"
            WHERE "createdAt" >= ${since}
            GROUP BY 1
            ORDER BY 1
        `)
    ] as const);

    return {
        days: window,
        // COUNT trả về bigint; JSON.stringify không serialize được bigint (ném TypeError),
        // nên phải đổi sang number ngay tại đây.
        created: created.map(row => ({ day: toDayKey(row.day), count: Number(row.count) })),
        completed: completed.map(row => ({ day: toDayKey(row.day), count: Number(row.count) })),
        ratings: ratings.map(row => ({
            day: toDayKey(row.day),
            avgRating: Number(row.avg?.toFixed?.(2) ?? row.avg ?? 0),
            count: Number(row.count)
        }))
    };
}

export interface BudgetBucket {
    label: string;
    /** Trần dưới của khoảng, tính bằng VND. */
    from: number;
    to: number | null;
    count: number;
}

// Khoảng giá cố định, không để client tự truyền: cột `budgetAmount` là INTEGER và mọi
// khoảng phải nằm dưới trần của nó. Chỉ đếm đơn ghi VND — trộn 60 USD vào cùng thang với
// 1.500.000 VND là một biểu đồ nói sai.
const BUDGET_BUCKETS: { label: string; from: number; to: number | null }[] = [
    { label: '< 200k', from: 0, to: 200_000 },
    { label: '200k – 500k', from: 200_000, to: 500_000 },
    { label: '500k – 1tr', from: 500_000, to: 1_000_000 },
    { label: '1tr – 3tr', from: 1_000_000, to: 3_000_000 },
    { label: '3tr – 10tr', from: 3_000_000, to: 10_000_000 },
    { label: '≥ 10tr', from: 10_000_000, to: null }
];

export async function getBudgetDistribution(): Promise<BudgetBucket[]> {
    // Sáu lần count, nhưng đi qua trần nên tối đa 4 chạy cùng lúc.
    const counts = await limitedAll(
        BUDGET_BUCKETS.map(bucket => () =>
            prisma.requestPost.count({
                where: {
                    budgetCurrency: 'VND',
                    budgetAmount: bucket.to === null
                        ? { gte: bucket.from }
                        : { gte: bucket.from, lt: bucket.to }
                }
            })
        )
    );
    return BUDGET_BUCKETS.map((bucket, index) => ({ ...bucket, count: counts[index] }));
}
