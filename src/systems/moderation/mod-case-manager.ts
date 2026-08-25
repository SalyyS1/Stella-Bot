import { Client, EmbedBuilder } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { sendMessageLog } from '../logs/message-log-sender';

export type ModCaseKind = 'WARN' | 'NOTE' | 'TIMEOUT' | 'KICK' | 'BAN' | 'UNBAN' | 'GHOST_PING' | 'WATCH';

const KIND_LABEL: Record<ModCaseKind, string> = {
    WARN: 'Cảnh cáo',
    NOTE: 'Ghi chú nội bộ',
    TIMEOUT: 'Timeout',
    KICK: 'Kick',
    BAN: 'Ban',
    UNBAN: 'Bỏ ban',
    GHOST_PING: 'Ghost-ping',
    WATCH: 'Theo dõi'
};

const KIND_COLOR: Record<ModCaseKind, string> = {
    WARN: '#e67e22',
    NOTE: '#95a5a6',
    TIMEOUT: '#e67e22',
    KICK: '#e74c3c',
    BAN: '#c0392b',
    UNBAN: '#2ecc71',
    GHOST_PING: '#8e44ad',
    WATCH: '#3498db'
};

export function modCaseLabel(kind: string): string {
    return KIND_LABEL[kind as ModCaseKind] || kind;
}

export interface CreateModCaseOptions {
    targetId: string;
    actorId: string;
    kind: ModCaseKind;
    reason?: string | null;
    evidence?: string | null;
    /** Truyền client để bot đăng luôn embed vào kênh log. */
    notifyClient?: Client;
}

export async function createModCase(options: CreateModCaseOptions) {
    const record = await prisma.modCase.create({
        data: {
            targetId: options.targetId,
            actorId: options.actorId,
            kind: options.kind,
            reason: options.reason?.slice(0, 900) || null,
            evidence: options.evidence?.slice(0, 300) || null
        }
    });

    if (options.notifyClient) {
        await sendMessageLog(options.notifyClient, {
            embeds: [new EmbedBuilder()
                .setColor(KIND_COLOR[options.kind] as any)
                .setTitle(`Hồ sơ #${record.id} · ${KIND_LABEL[options.kind]}`)
                .addFields(
                    { name: 'Thành viên', value: `<@${options.targetId}>`, inline: true },
                    { name: 'Người xử lý', value: `<@${options.actorId}>`, inline: true },
                    { name: 'Lý do', value: options.reason?.slice(0, 1000) || '*không ghi*', inline: false }
                )
                .setTimestamp()]
        }).catch(() => {});
    }

    return record;
}

// Đếm hồ sơ cho /profile (chỉ mod xem) và /inspect.
export async function countActiveWarns(targetId: string) {
    const [warns, total] = await Promise.all([
        prisma.modCase.count({ where: { targetId, kind: 'WARN', active: true } }).catch(() => 0),
        prisma.modCase.count({ where: { targetId } }).catch(() => 0)
    ]);
    return { warns, total };
}

export async function listModCases(targetId: string, take = 15) {
    return prisma.modCase.findMany({
        where: { targetId },
        orderBy: { createdAt: 'desc' },
        take
    }).catch(() => []);
}

export async function deactivateModCase(caseId: number) {
    const record = await prisma.modCase.findUnique({ where: { id: caseId } });
    if (!record) throw new Error('Không tìm thấy hồ sơ này.');
    if (!record.active) throw new Error('Hồ sơ này đã được huỷ hiệu lực trước đó.');
    return prisma.modCase.update({ where: { id: caseId }, data: { active: false } });
}

// DM người bị cảnh cáo. Cố ý KHÔNG chặn việc ghi hồ sơ nếu DM thất bại: người chặn
// DM không được phép nhờ đó mà thoát hồ sơ.
export async function notifyWarnTarget(client: Client, targetId: string, reason: string, caseId: number): Promise<boolean> {
    try {
        const user = await client.users.fetch(targetId);
        await user.send(
            `${config.ui.emojis.appeal} Bạn nhận một **cảnh cáo** ở Stella (hồ sơ #${caseId}).\n` +
            `Lý do: ${reason}\n\n` +
            'Nếu bạn thấy cảnh cáo này không đúng, hãy nhắn cho mod để xem lại.'
        );
        return true;
    } catch {
        return false;
    }
}
