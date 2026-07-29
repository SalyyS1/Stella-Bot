import prisma from '../../lib/prisma';
import { config } from '../../config';
import { nextSaigonTime } from '../report/report-time-window';

// Lưu và đọc lời nhắc. Mốc giờ được tính sẵn thành thời điểm tuyệt đối trước khi
// lưu, nên scheduler chỉ việc so sánh `nextFireAt <= now` mỗi phút — không phải
// parse lại tiếng Việt, và một lần restart không làm mất lời nhắc nào.

export interface NewReminder {
    requesterId: string;
    targetId: string;
    channelId: string;
    message: string;
    hourVn: number;
    minuteVn: number;
    repeatDaily: boolean;
}

// Trần số lời nhắc đang sống của MỘT người. Không có trần thì một người có thể
// đặt hàng trăm lời nhắc lặp và biến kênh chat thành máy ping — mà lời nhắc lặp
// không tự hết hạn, nên thiệt hại là vĩnh viễn cho tới khi có người đi dọn.
export async function countActive(requesterId: string): Promise<number> {
    return prisma.reminder
        .count({ where: { requesterId, active: true } })
        .catch(error => {
            console.error('[reminder] countActive failed:', error);
            // Fail-closed: coi như đã đầy. Chặn oan một lời nhắc nhẹ hơn nhiều so
            // với mở cửa cho spam vì DB chớp một nhịp.
            return config.ai.reminder.maxPerUser;
        });
}

// Trần RIÊNG cho lịch lặp hằng ngày, chặt hơn trần chung. Lý do tách: lịch một
// lần tự chết sau khi ping, còn lịch lặp sống mãi tới khi có người xoá — nên ba
// lịch lặp rác gây phiền lâu hơn hẳn ba lịch một lần, dù cùng đếm là "ba".
export async function countRecurring(requesterId: string): Promise<number> {
    return prisma.reminder
        .count({ where: { requesterId, active: true, repeatDaily: true } })
        .catch(error => {
            console.error('[reminder] countRecurring failed:', error);
            return config.ai.reminder.maxRecurringPerUser; // fail-closed như countActive
        });
}

export async function createReminder(input: NewReminder): Promise<{ id: number; fireAt: Date } | null> {
    const fireAt = new Date(nextSaigonTime(input.hourVn, input.minuteVn));
    const row = await prisma.reminder.create({
        data: {
            requesterId: input.requesterId,
            targetId: input.targetId,
            channelId: input.channelId,
            message: input.message.slice(0, config.ai.reminder.maxNoteChars),
            nextFireAt: fireAt,
            repeatDaily: input.repeatDaily,
            hourVn: input.hourVn,
            minuteVn: input.minuteVn
        }
    }).catch(error => {
        console.error('[reminder] createReminder failed:', error);
        return null;
    });
    return row ? { id: row.id, fireAt } : null;
}

export interface DueReminder {
    id: number;
    requesterId: string;
    targetId: string;
    channelId: string;
    message: string;
    repeatDaily: boolean;
    hourVn: number;
    minuteVn: number;
    nextFireAt: Date;
}

// Lời nhắc đã tới hạn. Trần `take` để một lần bỏ bot lâu ngày không biến thành
// một cơn bão ping trong đúng một phút.
export async function loadDue(nowMs = Date.now()): Promise<DueReminder[]> {
    return prisma.reminder.findMany({
        where: { active: true, nextFireAt: { lte: new Date(nowMs) } },
        orderBy: { nextFireAt: 'asc' },
        take: config.ai.reminder.maxFiresPerTick,
        select: {
            id: true, requesterId: true, targetId: true, channelId: true,
            message: true, repeatDaily: true, hourVn: true, minuteVn: true,
            // Cần cho chốt "quá hạn xa thì bỏ qua" ở scheduler: không đọc ra thì
            // scheduler không có cách nào biết một lời nhắc trễ 3 tiếng hay 30 giây.
            nextFireAt: true
        }
    }).catch(error => {
        console.error('[reminder] loadDue failed:', error);
        return [];
    });
}

// Đánh dấu đã ping. Lời lặp được dời sang lần kế tiếp, lời một lần thì tắt.
//
// nextFireAt của lời lặp được DỰNG LẠI từ hourVn/minuteVn chứ không phải cộng 24h
// vào mốc cũ: cộng 24h sẽ trôi dần nếu một lần ping bị trễ (bot chết, tick dồn),
// và mỗi lần trễ lại đẩy giờ ping của mọi ngày sau lệch thêm.
export async function markFired(reminder: DueReminder): Promise<void> {
    const data = reminder.repeatDaily
        ? {
            lastFiredAt: new Date(),
            nextFireAt: new Date(nextSaigonTime(reminder.hourVn, reminder.minuteVn))
        }
        : { lastFiredAt: new Date(), active: false };

    await prisma.reminder
        .update({ where: { id: reminder.id }, data })
        .catch(error => console.error(`[reminder] markFired ${reminder.id} failed:`, error));
}

// Tắt một lời nhắc không ping được vì lý do vĩnh viễn (kênh đã xoá, người đã rời
// server). Khác với lỗi tạm: giữ lại một lời nhắc không bao giờ ping được nghĩa là
// mỗi phút lại thử lại và mỗi phút lại ghi một dòng lỗi, mãi mãi.
export async function deactivate(id: number, why: string): Promise<void> {
    console.error(`[reminder] tắt lời nhắc ${id}: ${why}`);
    await prisma.reminder
        .update({ where: { id }, data: { active: false } })
        .catch(error => console.error(`[reminder] deactivate ${id} failed:`, error));
}

// Lời nhắc còn sống của một người, để họ xem và huỷ.
export async function listActive(requesterId: string) {
    return prisma.reminder.findMany({
        where: { requesterId, active: true },
        orderBy: { nextFireAt: 'asc' },
        take: 25,
        select: {
            id: true, targetId: true, message: true,
            nextFireAt: true, repeatDaily: true
        }
    }).catch(error => {
        console.error('[reminder] listActive failed:', error);
        return [];
    });
}

// Huỷ theo id, nhưng CHỈ lời nhắc do chính người đó đặt. Không kiểm chủ sở hữu ở
// đây thì bất kỳ ai cũng huỷ được lời nhắc của người khác chỉ bằng cách đoán id —
// và id là số tự tăng, nên "đoán" là đếm từ 1.
export async function cancelOwn(requesterId: string, id: number): Promise<boolean> {
    const result = await prisma.reminder
        .updateMany({ where: { id, requesterId, active: true }, data: { active: false } })
        .catch(error => {
            console.error(`[reminder] cancelOwn ${id} failed:`, error);
            return { count: 0 };
        });
    return result.count > 0;
}
