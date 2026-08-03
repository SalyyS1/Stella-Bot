import prisma from '../../lib/prisma';
import { config } from '../../config';

// Chốt chống trùng cho mọi công việc của nhật báo (chunk 3h, bài ngày, bài tuần).
// Dựa trên unique [channelId, kind, period] của MaintenanceLog — kẻ thua khi
// create ném lỗi là "đã có người làm". Tách riêng khỏi scheduler để report-weekly
// dùng chung mà không tạo import vòng (scheduler ↔ weekly).
export async function claimWork(kind: string, period: string): Promise<boolean> {
    try {
        await prisma.maintenanceLog.create({
            data: { channelId: config.report.forumChannel, kind, period }
        });
        return true;
    } catch {
        return false;
    }
}

export async function releaseWork(kind: string, period: string): Promise<void> {
    await prisma.maintenanceLog
        .deleteMany({ where: { channelId: config.report.forumChannel, kind, period } })
        .catch(() => {});
}
