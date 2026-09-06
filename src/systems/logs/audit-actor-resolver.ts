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

function pruneList<T extends { at: number }>(list: T[], now = Date.now()): void {
    while (list.length && now - list[0].at > WINDOW_MS) list.shift();
    while (list.length > MAX_RECORDS) list.shift();
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
    pruneList(records);
}

// Ai đã xoá tin này. null = không tìm thấy dấu vết mod nào ⇒ tác giả tự xoá.
export function resolveDeleter(channelId: string, authorId: string): string | null {
    pruneList(records);
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

// ── Ai đổi role / nickname / timeout của một thành viên ─────────────────────
//
// Cùng cơ chế với xoá tin, nhưng khớp theo (thành viên, loại thay đổi) thay vì kênh.
// Ba loại đi trong hai action khác nhau: role là MemberRoleUpdate riêng, còn nickname
// và timeout cùng nằm trong MemberUpdate và chỉ phân biệt được bằng `changes[].key`.
// Phải tách loại: mod A đổi nick và mod B cấp role cho cùng một người trong cùng giây
// là chuyện thật (lúc onboard), gộp chung là gán nhầm người.

export type MemberChangeKind = 'roles' | 'nick' | 'timeout';

interface MemberUpdateRecord {
    targetId: string;
    executorId: string;
    kind: MemberChangeKind;
    at: number;
}

const memberRecords: MemberUpdateRecord[] = [];

/** Loại thay đổi mà một entry audit log mô tả. Rỗng nếu entry không phải về thành viên. */
export function memberChangeKindsOf(entry: Pick<GuildAuditLogsEntry, 'action' | 'changes'>): MemberChangeKind[] {
    if (entry.action === AuditLogEvent.MemberRoleUpdate) return ['roles'];
    if (entry.action !== AuditLogEvent.MemberUpdate) return [];
    const kinds: MemberChangeKind[] = [];
    for (const change of entry.changes ?? []) {
        if (change.key === 'nick') kinds.push('nick');
        if (change.key === 'communication_disabled_until') kinds.push('timeout');
    }
    return kinds;
}

export function rememberMemberUpdateEntry(entry: GuildAuditLogsEntry): void {
    if (!entry.targetId || !entry.executorId) return;
    const at = Date.now();
    for (const kind of memberChangeKindsOf(entry)) {
        memberRecords.push({ targetId: entry.targetId, executorId: entry.executorId, kind, at });
    }
    pruneList(memberRecords, at);
}

// Ai đã thực hiện thay đổi loại `kind` lên thành viên này. null = chưa thấy entry nào.
// Lưu ý: tự đổi nickname cũng sinh entry với executor là chính người đó — caller so
// executorId với targetId để hiện "tự đổi".
export function resolveMemberActor(targetId: string, kind: MemberChangeKind): string | null {
    pruneList(memberRecords);
    for (let index = memberRecords.length - 1; index >= 0; index--) {
        const record = memberRecords[index];
        if (record.targetId === targetId && record.kind === kind) return record.executorId;
    }
    return null;
}

/**
 * Tra một lượt cho mọi loại thay đổi trong cùng event guildMemberUpdate. Chỉ chờ MỘT
 * nhịp chung khi còn loại nào chưa có người — không chờ riêng từng loại.
 */
export async function resolveMemberActorsWithGrace(
    targetId: string,
    kinds: MemberChangeKind[],
    graceMs = 1500
): Promise<Map<MemberChangeKind, string | null>> {
    const result = new Map<MemberChangeKind, string | null>();
    for (const kind of kinds) result.set(kind, resolveMemberActor(targetId, kind));
    if ([...result.values()].every(Boolean)) return result;
    await new Promise(resolve => setTimeout(resolve, graceMs));
    for (const kind of kinds) {
        if (!result.get(kind)) result.set(kind, resolveMemberActor(targetId, kind));
    }
    return result;
}
