import { Client, EmbedBuilder, GuildMember, TextChannel } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { sendAdminLog } from '../../utils/adminLog';
import { refreshRequestMessage } from '../requestManager';
import { formatDuration, parseDurationMs } from '../../utils/parse-duration';

export const CLEAR_DEADLINE_VALUES = new Set(['none', 'clear', 'x', 'bo']);

/** Parse deadline tương đối để không phụ thuộc timezone của host. */
export function parseRequestDeadline(raw: string, now = new Date()): Date | null {
    const value = raw.trim().toLowerCase();
    if (CLEAR_DEADLINE_VALUES.has(value)) return null;
    const durationMs = parseDurationMs(value, {
        minMs: config.request.deadlineMinMs,
        maxMs: config.request.deadlineMaxDays * 86_400_000,
        maxLabel: `${config.request.deadlineMaxDays} ngày`
    });
    return new Date(now.getTime() + durationMs);
}

export function deadlineLabel(deadline: Date | null, now = new Date()): string {
    if (!deadline) return 'Không đặt hạn';
    const seconds = Math.floor(deadline.getTime() / 1000);
    const remaining = Math.max(0, deadline.getTime() - now.getTime());
    return `<t:${seconds}:f> (<t:${seconds}:R>) · còn khoảng ${formatDuration(remaining)}`;
}

function canManage(request: { requesterId: string; claimedById: string | null }, actorId: string, isAdmin: boolean): boolean {
    return isAdmin || request.requesterId === actorId || request.claimedById === actorId;
}

/**
 * Đặt/xoá hạn cho đơn. Tách khỏi command để sau này panel HTTP gọi lại cùng logic.
 * Hạn chỉ là lời nhắc mềm: scheduler không tự phạt và không tự đóng đơn CLAIMED.
 */
export async function setRequestDeadline(
    client: Client,
    id: number,
    actor: GuildMember,
    raw: string,
    isAdmin: boolean,
    now = new Date()
): Promise<string> {
    if (!Number.isInteger(id) || id <= 0) throw new Error('ID đơn không hợp lệ.');
    const request = await prisma.requestPost.findUnique({ where: { id } });
    if (!request) throw new Error('Không tìm thấy đơn.');
    if (!canManage(request, actor.id, isAdmin)) {
        throw new Error('Chỉ chủ đơn, người nhận hoặc ban quản trị mới đặt hạn được.');
    }
    if (!['OPEN', 'CLAIMED'].includes(request.status)) {
        throw new Error('Đơn đã hoàn thành/đóng thì không đổi hạn được.');
    }

    const deadline = parseRequestDeadline(raw, now);
    const changed = await prisma.requestPost.updateMany({
        where: { id, status: request.status },
        data: { dueDate: deadline, staleRemindedAt: null }
    });
    if (!changed.count) throw new Error('Đơn vừa đổi trạng thái, hãy thử lại.');

    await refreshRequestMessage(client, id).catch(error =>
        console.error(`[request] refresh sau khi đặt hạn #${id} lỗi:`, error)
    );

    const recipients = [request.requesterId, request.claimedById].filter(
        (value): value is string => Boolean(value)
    );
    if (request.ticketChannelId) {
        const channel = await client.channels.fetch(request.ticketChannelId).catch(() => null);
        if (channel?.isTextBased() && 'send' in channel) {
            await (channel as TextChannel).send({
                embeds: [new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`${config.ui.emojis.note} Cập nhật hạn đơn #${id}`)
                    .setDescription(deadline
                        ? `Hạn mới: ${deadlineLabel(deadline, now)}\nHai bên nhớ thống nhất lại phạm vi trong kênh này.`
                        : 'Đã xoá hạn mong muốn của đơn.')
                    .setTimestamp()],
                allowedMentions: { users: recipients }
            }).catch(() => {});
        }
    }

    await sendAdminLog(client, {
        title: 'Request deadline updated',
        color: '#3498db',
        fields: [
            { name: 'Request', value: `#${id}`, inline: true },
            { name: 'Actor ID', value: `\`${actor.id}\``, inline: true },
            { name: 'Deadline', value: deadline ? deadline.toISOString() : 'cleared', inline: false }
        ]
    }).catch(() => {});

    return deadline
        ? `Đã đặt hạn đơn #${id}: ${deadlineLabel(deadline, now)}.`
        : `Đã xoá hạn đơn #${id}.`;
}
