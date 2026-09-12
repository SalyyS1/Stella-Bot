import type { PendingEscalation } from './report-store';

const CATEGORY_LABELS: Record<string, string> = {
    spam: 'Spam / flood',
    harassment: 'Quấy rối / xúc phạm',
    scam: 'Lừa đảo / giả mạo',
    nsfw: 'Nội dung không phù hợp',
    other: 'Khác'
};

const STATUS_LABELS: Record<string, string> = {
    OPEN: 'Đang chờ',
    ACTIONED: 'Đã xử lý',
    DISMISSED: 'Đã bỏ qua'
};

export function reportCategoryLabel(value: string): string {
    return CATEGORY_LABELS[value] || value;
}

export function reportStatusLabel(value: string): string {
    return STATUS_LABELS[value] || value;
}

function oneLine(value: string | null | undefined, max: number): string {
    return (value || '').replace(/\s+/g, ' ').replace(/`/g, 'ˋ').trim().slice(0, max) || '*trống*';
}

export interface ReportListRow {
    id: number;
    reporterId: string;
    targetId: string;
    category: string;
    reason: string;
    evidenceUrl: string | null;
    countsTowardEscalation: boolean;
    status: string;
    resolution: string | null;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
}

export function renderReportRows(rows: ReportListRow[]): string {
    const lines: string[] = [];
    let length = 0;
    for (const row of rows) {
        const line =
            `**#${row.id}** · ${reportStatusLabel(row.status)} · ${reportCategoryLabel(row.category)} · ` +
            `target \`${row.targetId}\` · reporter \`${row.reporterId}\` · ` +
            `tính ngưỡng: ${row.countsTowardEscalation ? 'có' : 'không'}\n` +
            `> ${oneLine(row.reason, 260)} · <t:${Math.floor(row.createdAt.getTime() / 1000)}:R>` +
            (row.evidenceUrl ? `\n> bằng chứng: ${oneLine(row.evidenceUrl, 300)}` : '') +
            (row.resolution ? `\n> xử lý: ${oneLine(row.resolution, 220)}` : '');
        if (length + line.length + 2 > 3900) break;
        lines.push(line);
        length += line.length + 2;
    }
    return lines.join('\n\n') || '*Không có report phù hợp.*';
}

export function renderPendingRows(rows: PendingEscalation[]): string {
    return rows.length
        ? rows.map(row =>
            `• target \`${row.targetId}\` · cấp ${row.level} → ${row.pendingLevel ?? '?'} · ` +
            `proposal tạo <t:${Math.floor(row.updatedAt.getTime() / 1000)}:R>` +
            (row.pendingExpiresAt ? ` · hết hạn <t:${Math.floor(row.pendingExpiresAt.getTime() / 1000)}:R>` : '')
        ).join('\n')
        : '*Không có proposal kick đang chờ.*';
}
