import prisma from '../../lib/prisma';
import { periodDaysAgo } from './report-time-window';

// Lưu trữ BÀI nhật báo đã đăng — nguồn dữ liệu cho bài tổng hợp tuần (report-weekly).
// Chunk 3h bị prune sau 7 ngày và không phải bài hoàn chỉnh, nên bài ngày phải lưu
// riêng. Sao mẫu report-chunk-store.ts: upsert theo period, fail-soft ở mọi lỗi.

export interface StoredDaily {
    period: string; // yyyy-MM-dd (Saigon)
    body: string;
}

// Lưu bài ngày sau khi đăng thành công. upsert theo period: cùng ngày chạy lại
// (admin force) thì ghi đè thay vì lỗi unique.
export async function saveDailyReport(period: string, body: string): Promise<boolean> {
    try {
        await prisma.reportDaily.upsert({
            where: { period },
            create: { period, body },
            update: { body }
        });
        return true;
    } catch (error) {
        console.error(`[report] saveDailyReport ${period} failed:`, error);
        return false;
    }
}

// Load các bài ngày theo danh sách period (thường là 7 ngày của tuần). Bỏ row
// body rỗng (tuần đó ngày nào không có bài), sắp theo thứ tự period asc.
export async function loadDailyReports(periods: string[]): Promise<StoredDaily[]> {
    const wanted = periods.filter(Boolean);
    if (!wanted.length) return [];
    const rows = await prisma.reportDaily.findMany({
        where: { period: { in: wanted } },
        orderBy: { period: 'asc' }
    }).catch(error => {
        console.error('[report] loadDailyReports failed:', error);
        return null;
    });
    if (!rows) return [];
    return rows
        .filter(r => r.body.trim().length > 0)
        .map(r => ({ period: r.period, body: r.body }));
}

// Xoá bài cũ hơn N ngày. period là yyyy-MM-dd nên so sánh lexicographic đúng.
// 35 ngày đủ cho bài tuần đọc lại tuần trước và vẫn giữ bản ghi tuần để debug.
export async function pruneOldDailyReports(days = 35, nowMs = Date.now()): Promise<void> {
    const cutoff = periodDaysAgo(days, nowMs);
    await prisma.reportDaily.deleteMany({ where: { period: { lt: cutoff } } })
        .catch(error => console.error('[report] pruneOldDailyReports failed:', error));
}
