import { Client, TextChannel } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { sendAdminLog } from '../../utils/adminLog';
import { closeOrderChannel } from './order-channel';

// Vòng đời đơn hàng khi KHÔNG ai bấm nút.
//
// Mọi nút hiện có đều giả định hai bên còn ở đây và còn quan tâm. Thực tế thì: người nhận
// rời server, khách quên mất đơn, đơn quá hạn mà không ai nói gì. Không có gì dọn thì bảng
// đơn đầy dần đơn chết, và đơn CLAIMED của một người đã rời server thì kẹt VĨNH VIỄN —
// không ai bấm huỷ được vì người phải bấm đã đi rồi.
//
// Hai nguyên tắc, Saly chốt 7/9/2026:
//   - Bot chỉ đóng đơn OPEN sau khi ĐÃ NHẮC và không ai trả lời.
//   - Đơn DONE KHÔNG BAO GIỜ tự chốt. Đánh giá là việc của khách, bot chỉ nhắc.

export interface StaleThresholds {
    /** Đơn OPEN quá bấy nhiêu ngày chưa ai nhận thì nhắc chủ đơn. */
    openRemindDays: number;
    /** Đã nhắc mà vẫn im lặng tới mốc này thì tự đóng. */
    openCloseDays: number;
    /** Đơn DONE quá bấy nhiêu ngày chưa đánh giá thì nhắc khách. */
    rateRemindDays: number;
}

export function thresholds(): StaleThresholds {
    return {
        openRemindDays: config.request.staleOpenRemindDays,
        openCloseDays: config.request.staleOpenCloseDays,
        rateRemindDays: config.request.rateRemindDays
    };
}

export type StaleAction = 'none' | 'remind' | 'close';

/**
 * Đơn OPEN này nên làm gì. Hàm thuần để test được các mốc mà không cần DB.
 *
 * `remindedAt` là mốc đã nhắc gần nhất; null = chưa nhắc bao giờ. Đơn chỉ bị đóng SAU khi
 * đã nhắc — đóng thẳng là xoá đơn của người ta mà không báo trước. Kể cả đơn đã quá mốc
 * đóng từ lâu (bot vừa bật tính năng này, hoặc scheduler chết mấy ngày) vẫn được nhắc một
 * lượt rồi mới đóng ở lượt sau.
 */
export function decideStaleOpen(
    createdAt: Date,
    remindedAt: Date | null,
    limits: StaleThresholds,
    now = new Date()
): StaleAction {
    const ageDays = (now.getTime() - createdAt.getTime()) / 86_400_000;
    if (ageDays >= limits.openCloseDays) return remindedAt ? 'close' : 'remind';
    if (ageDays >= limits.openRemindDays && !remindedAt) return 'remind';
    return 'none';
}

/**
 * Đơn CLAIMED đã quá hạn mong muốn chưa. Chỉ nhắc MỘT lần, và nhắc trong kênh đơn để đúng
 * hai người liên quan đọc được — hạn trễ là chuyện giữa họ, không phải chuyện của cả server.
 */
export function isOverdue(dueDate: Date | null, remindedAt: Date | null, now = new Date()): boolean {
    if (!dueDate || remindedAt) return false;
    return dueDate.getTime() < now.getTime();
}

/** Đơn DONE đã tới lúc nhắc đánh giá chưa. Chỉ nhắc MỘT lần — nhắc mãi là làm phiền. */
export function shouldRemindRating(
    completedAt: Date | null,
    remindedAt: Date | null,
    limits: StaleThresholds,
    now = new Date()
): boolean {
    if (!completedAt || remindedAt) return false;
    return (now.getTime() - completedAt.getTime()) / 86_400_000 >= limits.rateRemindDays;
}

interface ChannelCloseInput {
    channelId: string;
    requestId: number;
    requesterId: string;
    claimerId: string | null;
    reason: string;
}

/**
 * Đóng kênh đơn khi việc dọn là do bot chủ động, không phải do ai bấm nút.
 *
 * Vẫn đi qua `closeOrderChannel` để transcript được lưu như mọi lần đóng khác: kênh đơn bị
 * xoá mà mất nội dung là mất đúng thứ cần đến khi hai bên tranh chấp sau này.
 */
async function closeChannelFor(client: Client, input: ChannelCloseInput): Promise<void> {
    const channel = await client.channels.fetch(input.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    await closeOrderChannel({
        channel: channel as TextChannel,
        requestId: input.requestId,
        requesterId: input.requesterId,
        claimerId: input.claimerId,
        reason: input.reason,
        farewell: input.reason
    }).catch(error => console.error(`[request] đóng kênh đơn #${input.requestId} lỗi:`, error));
}

/**
 * Thành viên rời server (tự rời hoặc bị ban) → dọn đơn của họ.
 *
 * Đây là bản không-ai-bấm-nút của `releaseRequest`. Không gọi lại hàm đó vì hàm kia cần một
 * người thực hiện còn tồn tại; ở đây người liên quan đã đi rồi.
 *
 * - Đơn họ ĐANG NHẬN → trả về OPEN cho người khác nhận.
 * - Đơn họ TẠO RA và chưa xong → đóng, vì không còn ai để nhận hàng.
 */
export async function handleMemberGone(
    client: Client,
    userId: string,
    reason: string
): Promise<{ released: number[]; closed: number[] }> {
    const claimed = await prisma.requestPost.findMany({
        where: { claimedById: userId, status: 'CLAIMED' },
        select: { id: true, requesterId: true, ticketChannelId: true }
    }).catch(() => []);

    const released: number[] = [];
    for (const request of claimed) {
        const updated = await prisma.requestPost.updateMany({
            where: { id: request.id, status: 'CLAIMED', claimedById: userId },
            data: { status: 'OPEN', claimedById: null, ticketChannelId: null }
        }).catch(() => ({ count: 0 }));
        if (updated.count === 0) continue;
        released.push(request.id);

        await prisma.requestClaim.updateMany({
            where: { requestId: request.id, claimerId: userId },
            data: { status: 'RELEASED' }
        }).catch(() => {});

        if (request.ticketChannelId) {
            await closeChannelFor(client, {
                channelId: request.ticketChannelId,
                requestId: request.id,
                requesterId: request.requesterId,
                claimerId: userId,
                reason: `Người nhận ${reason}. Đơn đã mở lại cho người khác.`
            });
        }
    }

    const own = await prisma.requestPost.findMany({
        where: { requesterId: userId, status: { in: ['OPEN', 'CLAIMED'] } },
        select: { id: true, claimedById: true, ticketChannelId: true }
    }).catch(() => []);

    const closed: number[] = [];
    for (const request of own) {
        const updated = await prisma.requestPost.updateMany({
            where: { id: request.id, status: { in: ['OPEN', 'CLAIMED'] } },
            data: { status: 'CLOSED', closedAt: new Date(), ticketChannelId: null }
        }).catch(() => ({ count: 0 }));
        if (updated.count === 0) continue;
        closed.push(request.id);

        if (request.ticketChannelId) {
            await closeChannelFor(client, {
                channelId: request.ticketChannelId,
                requestId: request.id,
                requesterId: userId,
                claimerId: request.claimedById,
                reason: `Chủ đơn ${reason}. Đơn đã đóng.`
            });
        }
    }

    if (released.length || closed.length) {
        await sendAdminLog(client, {
            title: 'Dọn đơn vì thành viên rời server',
            color: '#e67e22',
            fields: [
                { name: 'Thành viên', value: `<@${userId}> (${reason})`, inline: false },
                { name: 'Đơn mở lại', value: released.length ? released.map(id => `#${id}`).join(', ') : '*không có*', inline: true },
                { name: 'Đơn đã đóng', value: closed.length ? closed.map(id => `#${id}`).join(', ') : '*không có*', inline: true }
            ]
        }).catch(() => {});
    }

    return { released, closed };
}
