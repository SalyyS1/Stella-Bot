import { AuditLogEvent, GuildAuditLogsEntry } from 'discord.js';

interface DeletionRecord {
    channelId: string | null;
    targetId: string | null;
    executorId: string | null;
    at: number;
}

// Bộ nhớ ngắn hạn cho các lượt xoá tin do mod thực hiện.
//
// Vì sao không gọi fetchAuditLogs lúc cần: entry audit log xuất hiện SAU event
// messageDelete vài trăm ms, và fetch danh sách rồi đoán "entry mới nhất có phải của
// tin này" là một cuộc đua — chạy hai lượt xoá gần nhau là gán sai người. Event
// GuildAuditLogEntryCreate bắn đúng một entry ngay khi nó được tạo, nên chỉ cần ghi
// lại và tra ngược.
//
// Discord gộp nhiều lượt xoá của cùng một mod trong cùng một kênh vào MỘT entry
// (count tăng dần) nên bản ghi được khớp theo (kênh, tác giả) trong cửa sổ ngắn thay
// vì theo message id — message id không có trong entry.
const records: DeletionRecord[] = [];
const WINDOW_MS = 10_000;
const MAX_RECORDS = 50;

function prune(now = Date.now()): void {
    while (records.length && now - records[0].at > WINDOW_MS) records.shift();
    while (records.length > MAX_RECORDS) records.shift();
}

export function rememberDeletionEntry(entry: GuildAuditLogsEntry): void {
    if (entry.action !== AuditLogEvent.MessageDelete && entry.action !== AuditLogEvent.MessageBulkDelete) return;
    const extra: any = entry.extra;
    records.push({
        channelId: extra?.channel?.id ?? extra?.channelId ?? null,
        targetId: entry.targetId ?? null,
        executorId: entry.executorId ?? null,
        at: Date.now()
    });
    prune();
}

// Ai đã xoá tin này. null = không tìm thấy dấu vết mod nào ⇒ tác giả tự xoá.
export function resolveDeleter(channelId: string, authorId: string): string | null {
    prune();
    for (let index = records.length - 1; index >= 0; index--) {
        const record = records[index];
        if (record.channelId && record.channelId !== channelId) continue;
        if (record.targetId && record.targetId !== authorId) continue;
        return record.executorId;
    }
    return null;
}

// Đợi audit log tới. Event messageDelete gần như luôn tới trước, nên chờ một nhịp
// ngắn rồi tra lại là đủ; chờ lâu hơn chỉ làm log tới muộn mà không chính xác hơn.
export async function resolveDeleterWithGrace(channelId: string, authorId: string, graceMs = 1500): Promise<string | null> {
    const immediate = resolveDeleter(channelId, authorId);
    if (immediate) return immediate;
    await new Promise(resolve => setTimeout(resolve, graceMs));
    return resolveDeleter(channelId, authorId);
}
