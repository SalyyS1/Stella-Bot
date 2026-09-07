import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { messageLink } from '../../utils/adminLog';
import { closeRequest } from '../requestManager';
import { decideStaleOpen, isOverdue, shouldRemindRating, thresholds } from './request-lifecycle';

// Quét đơn bị bỏ quên. Ba việc, mỗi việc một lần chạm:
//   - Đơn OPEN quá 7 ngày  -> nhắc chủ đơn (một lần)
//   - Đã nhắc, quá 14 ngày -> tự đóng
//   - Đơn DONE quá 3 ngày  -> nhắc khách đánh giá (một lần, KHÔNG tự chốt)
//
// Vì sao nhắc trong kênh đăng đơn chứ không DM: khách tắt DM là mất đường, và chính chỗ
// đơn đang nằm mới là chỗ họ bấm được nút.

async function remindStaleOpen(client: Client, request: {
    id: number;
    requesterId: string;
    channelId: string;
    messageId: string | null;
    service: string;
}): Promise<void> {
    const limits = thresholds();
    const channel = await client.channels.fetch(request.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const link = request.messageId ? messageLink(null, request.channelId, request.messageId) : null;
    await (channel as TextChannel).send({
        content: `<@${request.requesterId}>`,
        embeds: [new EmbedBuilder()
            .setColor('#e67e22')
            .setTitle(`${config.ui.emojis.note} Đơn #${request.id} vẫn chưa có ai nhận`)
            .setDescription(
                `**${request.service.slice(0, 200)}**\n\n` +
                `Đơn đã đăng ${limits.openRemindDays} ngày mà chưa có người nhận. Còn cần thì thử ` +
                'sửa lại giá hoặc mô tả cho rõ hơn; không cần nữa thì bấm **Đóng** trên bài đăng.\n' +
                `-# Không có phản hồi thì Stella sẽ tự đóng đơn sau ${limits.openCloseDays} ngày kể từ lúc đăng.` +
                (link ? `\n${link}` : '')
            )
            .setTimestamp()],
        allowedMentions: { users: [request.requesterId] }
    }).catch(() => {});

    await prisma.requestPost.update({
        where: { id: request.id },
        data: { staleRemindedAt: new Date() }
    }).catch(error => console.error(`[request] ghi mốc nhắc đơn #${request.id} lỗi:`, error));
}

async function remindRating(client: Client, request: {
    id: number;
    requesterId: string;
    claimedById: string | null;
    service: string;
}): Promise<void> {
    const channel = await client.channels.fetch(config.channels.rate).catch(() => null);
    if (channel?.isTextBased()) {
        await (channel as TextChannel).send({
            content: `<@${request.requesterId}>`,
            embeds: [new EmbedBuilder()
                .setColor('#ff66cc')
                .setTitle(`${config.ui.emojis.starJump} Đơn #${request.id} chờ bạn đánh giá`)
                .setDescription(
                    `Đơn **${request.service.slice(0, 200)}** đã hoàn thành mà chưa có đánh giá.\n` +
                    (request.claimedById ? `Người nhận: <@${request.claimedById}>\n` : '') +
                    'Điểm này là uy tín của họ với khách sau, nên một lượt bấm cũng có ích.\n' +
                    '-# Nút đánh giá nằm ở bài đăng đơn và trong DM Stella đã gửi lúc đơn xong.'
                )
                .setTimestamp()],
            allowedMentions: { users: [request.requesterId] }
        }).catch(() => {});
    }

    await prisma.requestPost.update({
        where: { id: request.id },
        data: { rateRemindedAt: new Date() }
    }).catch(error => console.error(`[request] ghi mốc nhắc đánh giá #${request.id} lỗi:`, error));
}

async function remindOverdue(client: Client, request: {
    id: number;
    requesterId: string;
    claimedById: string | null;
    ticketChannelId: string | null;
    dueDate: Date | null;
}): Promise<void> {
    // Nhắc trong KÊNH ĐƠN, không phải kênh chung: hạn trễ là chuyện giữa khách và người
    // nhận. Không có kênh đơn thì bỏ qua — bêu một người trễ hạn giữa kênh công khai là
    // hình phạt, mà bot không được tự phạt ai.
    if (request.ticketChannelId) {
        const channel = await client.channels.fetch(request.ticketChannelId).catch(() => null);
        if (channel?.isTextBased()) {
            const dueTs = request.dueDate ? Math.floor(request.dueDate.getTime() / 1000) : null;
            await (channel as TextChannel).send({
                content: `<@${request.requesterId}>${request.claimedById ? ` · <@${request.claimedById}>` : ''}`,
                embeds: [new EmbedBuilder()
                    .setColor('#e67e22')
                    .setTitle(`${config.ui.emojis.note} Đơn #${request.id} đã quá hạn mong muốn`)
                    .setDescription(
                        (dueTs ? `Hạn đã đặt: <t:${dueTs}:D> (<t:${dueTs}:R>)\n\n` : '') +
                        'Hai bên thống nhất lại hạn mới ở đây nhé. Xong rồi thì bấm **Hoàn thành** ' +
                        'trên bài đăng; không tiếp tục được thì bấm **Huỷ nhận việc** để đơn mở lại.\n' +
                        '-# Stella chỉ nhắc một lần, không tự đóng đơn đang có người làm.'
                    )
                    .setTimestamp()],
                allowedMentions: {
                    users: request.claimedById ? [request.requesterId, request.claimedById] : [request.requesterId]
                }
            }).catch(() => {});
        }
    }

    await prisma.requestPost.update({
        where: { id: request.id },
        data: { staleRemindedAt: new Date() }
    }).catch(error => console.error(`[request] ghi mốc nhắc quá hạn #${request.id} lỗi:`, error));
}

/** Một lượt quét. Trả về số việc đã làm, để lệnh gọi tay báo lại được. */
export async function sweepStaleRequests(client: Client): Promise<{ reminded: number; closed: number; overdue: number; rateReminders: number }> {
    const limits = thresholds();
    const now = new Date();
    let reminded = 0;
    let closed = 0;
    let rateReminders = 0;

    const openOnes = await prisma.requestPost.findMany({
        where: {
            status: 'OPEN',
            createdAt: { lte: new Date(now.getTime() - limits.openRemindDays * 86_400_000) }
        },
        select: {
            id: true, requesterId: true, channelId: true, messageId: true,
            service: true, createdAt: true, staleRemindedAt: true
        }
    }).catch(() => []);

    for (const request of openOnes) {
        const action = decideStaleOpen(request.createdAt, request.staleRemindedAt, limits, now);
        if (action === 'remind') {
            await remindStaleOpen(client, request);
            reminded++;
        } else if (action === 'close') {
            // Đi qua closeRequest (isAdmin = true) thay vì tự update: nó lo cả đóng kênh
            // đơn, lưu transcript và làm mới bài đăng. Viết lại ở đây là hai đường đóng đơn
            // khác nhau, và đường thứ hai sẽ quên một bước.
            await closeRequest(client, null, request.id, client.user?.id ?? 'stella', true)
                .then(() => { closed++; })
                .catch(error => console.error(`[request] tự đóng đơn #${request.id} lỗi:`, error));
        }
    }

    // Đơn đang làm mà đã quá hạn mong muốn. `staleRemindedAt` dùng chung với nhắc đơn OPEN:
    // một đơn không thể vừa OPEN vừa CLAIMED nên không đụng nhau, và đơn được trả lại rồi
    // nhận lại thì cũng chỉ nên nhắc một lần cho tới khi có người sửa hạn.
    const overdueOnes = await prisma.requestPost.findMany({
        where: {
            status: 'CLAIMED',
            staleRemindedAt: null,
            dueDate: { not: null, lt: now }
        },
        select: { id: true, requesterId: true, claimedById: true, ticketChannelId: true, dueDate: true, staleRemindedAt: true }
    }).catch(() => []);

    let overdue = 0;
    for (const request of overdueOnes) {
        if (!isOverdue(request.dueDate, request.staleRemindedAt, now)) continue;
        await remindOverdue(client, request);
        overdue++;
    }

    const doneOnes = await prisma.requestPost.findMany({
        where: {
            status: 'DONE',
            rateRemindedAt: null,
            completedAt: { lte: new Date(now.getTime() - limits.rateRemindDays * 86_400_000) }
        },
        select: { id: true, requesterId: true, claimedById: true, service: true, completedAt: true, rateRemindedAt: true }
    }).catch(() => []);

    for (const request of doneOnes) {
        if (!shouldRemindRating(request.completedAt, request.rateRemindedAt, limits, now)) continue;
        await remindRating(client, request);
        rateReminders++;
    }

    return { reminded, closed, overdue, rateReminders };
}

let busy = false;

export function startRequestStaleScheduler(client: Client): void {
    const run = async () => {
        if (busy) return;
        busy = true;
        try {
            const result = await sweepStaleRequests(client);
            if (result.reminded || result.closed || result.overdue || result.rateReminders) {
                console.log(
                    `[request] dọn đơn: nhắc ${result.reminded}, đóng ${result.closed}, ` +
                    `quá hạn ${result.overdue}, nhắc đánh giá ${result.rateReminders}.`
                );
            }
        } catch (error) {
            console.error('[request] lượt dọn đơn lỗi:', error);
        } finally {
            busy = false;
        }
    };
    // Lượt đầu sau 5 phút: bot vừa lên còn đang nạp cache kênh, và việc này tính bằng ngày
    // nên chậm vài phút không đổi gì.
    setTimeout(() => void run(), 5 * 60_000);
    setInterval(() => void run(), config.request.sweepIntervalMs);
}
