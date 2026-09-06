import { AuditLogEvent, Events, Guild, GuildAuditLogsEntry } from 'discord.js';
import { config } from '../config';
import { rememberDeletionEntry, rememberMemberUpdateEntry } from '../systems/logs/audit-actor-resolver';
import { createModCase, ModCaseKind } from '../systems/moderation/mod-case-manager';

// Loại hành động mod nào được ghi thành hồ sơ, và nhãn tiếng Việt để hiện trong log.
const CASE_KINDS: Partial<Record<AuditLogEvent, ModCaseKind>> = {
    [AuditLogEvent.MemberBanAdd]: 'BAN',
    [AuditLogEvent.MemberBanRemove]: 'UNBAN',
    [AuditLogEvent.MemberKick]: 'KICK'
};

// Timeout nằm trong MemberUpdate, nhận ra qua trường communication_disabled_until.
function isTimeoutEntry(entry: GuildAuditLogsEntry): { timedOut: boolean; until: string | null } | null {
    if (entry.action !== AuditLogEvent.MemberUpdate) return null;
    const change = entry.changes?.find(item => item.key === 'communication_disabled_until');
    if (!change) return null;
    const until = (change.new as string | undefined) ?? null;
    return { timedOut: !!until, until };
}

export default {
    name: Events.GuildAuditLogEntryCreate,
    once: false,
    async execute(entry: GuildAuditLogsEntry, _guild: Guild) {
        if (!config.logs.enabled) return;

        // Ghi lại lượt xoá tin để messageDelete biết là mod xoá hay tác giả tự xoá, và
        // lượt đổi role/nick/timeout để guildMemberUpdate ghi được AI làm. Ghi cả khi
        // executor là bot: "Stella cấp role qua role menu" là câu trả lời hữu ích.
        rememberDeletionEntry(entry);
        rememberMemberUpdateEntry(entry);

        // Bot tự làm (anti-raid, lệnh của bot) không ghi hồ sơ thêm lần nữa: những
        // đường đó đã có log riêng, ghi đôi làm hồ sơ đếm sai.
        if (!entry.executorId || entry.executorId === _guild.client.user?.id) return;
        if (!entry.targetId) return;

        const timeout = isTimeoutEntry(entry);
        if (timeout) {
            if (!timeout.timedOut) return; // gỡ timeout — không phải hình phạt mới
            await createModCase({
                targetId: entry.targetId,
                actorId: entry.executorId,
                kind: 'TIMEOUT',
                reason: entry.reason || `Timeout tới ${timeout.until ?? 'không rõ'}`,
                notifyClient: _guild.client
            }).catch(error => console.error('[moderation] ghi case timeout lỗi:', error));
            return;
        }

        const kind = CASE_KINDS[entry.action as AuditLogEvent];
        if (!kind) return;

        await createModCase({
            targetId: entry.targetId,
            actorId: entry.executorId,
            kind,
            reason: entry.reason || 'Không ghi lý do',
            notifyClient: _guild.client
        }).catch(error => console.error('[moderation] ghi case từ audit log lỗi:', error));
    }
};
