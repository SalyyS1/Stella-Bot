// Trần số truy vấn DB chạy song song từ panel.
//
// Vì sao cần: pooler Supabase ở session mode chỉ cho `pool_size: 15` client. Bản đầu của
// tầng dữ liệu này dùng Promise.all lồng nhau (overview gọi 6 việc song song, mỗi việc lại
// fan-out thêm 4) và làm vỡ pool ngay lần chạy thử đầu tiên:
//
//   FATAL: (EMAXCONNSESSION) max clients reached in session mode
//
// Đây không phải chuyện hiệu năng mà là chuyện đúng/sai: panel chạy TRONG process bot và
// dùng CHUNG pool với bot. Một request dashboard làm cạn pool là bot mất khả năng đọc DB —
// mất lệnh, mất log, mất ghi XP. Trần 4 để chừa 11 client cho việc của bot.
//
// Đây là trần ở tầng truy vấn, khác với rate limit theo IP (phase 6). Cả hai đều cần:
// rate limit chặn số REQUEST, cái này chặn số CONNECTION mà một request được chiếm.

const MAX_CONCURRENT_QUERIES = 4;

let active = 0;
const waiting: (() => void)[] = [];

function release(): void {
    active--;
    const next = waiting.shift();
    if (next) next();
}

export async function withQueryLimit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= MAX_CONCURRENT_QUERIES) {
        await new Promise<void>(resolve => waiting.push(resolve));
    }
    active++;
    try {
        return await task();
    } finally {
        release();
    }
}

/**
 * Thay cho `Promise.all` ở tầng dữ liệu của panel: cùng kết quả, cùng kiểu tuple, nhưng
 * không bao giờ mở quá `MAX_CONCURRENT_QUERIES` truy vấn cùng lúc. Một task lỗi thì
 * reject như Promise.all, và các task còn lại vẫn được release đúng.
 *
 * Nhận HÀM chứ không nhận Promise: một Promise đã được tạo là một truy vấn đã bay đi,
 * hàng đợi không còn ý nghĩa gì nữa.
 */
export function limitedAll<T extends readonly (() => Promise<unknown>)[]>(
    tasks: readonly [...T]
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
    return Promise.all(tasks.map(task => withQueryLimit(task))) as Promise<{
        [K in keyof T]: Awaited<ReturnType<T[K]>>;
    }>;
}

/** Cho test và cho log: số truy vấn đang chạy và số đang xếp hàng. */
export function queryLimitState(): { active: number; waiting: number; max: number } {
    return { active, waiting: waiting.length, max: MAX_CONCURRENT_QUERIES };
}
