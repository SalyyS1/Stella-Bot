import { Message } from 'discord.js';
import { config } from '../../config';
import { looksLikeReminder, parseReminder, resolveTarget } from './reminder-parser';
import { countActive, countRecurring, createReminder } from './reminder-store';
import { describeSaigon } from '../report/report-time-window';

// Đường vào của lời nhắc: một tin `!s ...` đã được nhận là có ý nhờ nhắc.
//
// Trả về true nghĩa là tin này đã được xử lý như lời nhắc và KHÔNG nên đi tiếp vào
// Q&A — nếu để đi tiếp thì người dùng vừa được đặt lời nhắc lại vừa nhận một câu
// trả lời AI về chính câu nhờ đó, tốn thêm một lượt gọi và đọc như bot bị lag.

// Ai được nhờ ping NGƯỜI KHÁC. Đây là chốt quan trọng nhất của cả tính năng:
// không có nó thì bất kỳ ai cũng đặt được lời nhắc lặp ping bất kỳ ai mỗi ngày,
// tức là biến bot thành công cụ quấy rối có hẹn giờ. Ping CHÍNH MÌNH thì ai cũng
// được, vì nó không làm phiền ai khác.
//
// Quyền được kiểm bằng role thật trong Discord, KHÔNG bao giờ bằng điều AI đọc ra
// từ câu chữ: để model quyết nghĩa là ai cũng có thể viết "tôi có quyền ping người
// khác" và nó sẽ tin.
function canPingOthers(message: Message): boolean {
    const roles = message.member?.roles.cache;
    if (!roles) return false;
    if (config.roles.reminderPingOthers.some(id => id && roles.has(id))) return true;
    // Admin luôn được: họ đã có quyền mạnh hơn nhiều thứ này, nên chặn lại chỉ gây
    // bối rối chứ không thêm an toàn.
    return message.member?.permissions.has('Administrator') ?? false;
}

export async function handleReminderRequest(message: Message, text: string): Promise<boolean> {
    if (!config.ai.reminder.enabled) return false;
    // Lọc rẻ trước khi tốn một lượt gọi AI. Mọi tin `!s` đều đi qua đây.
    if (!looksLikeReminder(text)) return false;

    const parsed = await parseReminder(text).catch(error => {
        console.error('[reminder] parse failed:', error);
        return null;
    });
    // Không phải lời nhắc (hoặc AI không đọc ra được giờ) → để Q&A trả lời như thường.
    if (!parsed) return false;

    // Trần số lời nhắc còn sống. Kiểm SAU khi biết chắc là lời nhắc, để một câu
    // tán gẫu không bị tính vào hạn mức của ai.
    const active = await countActive(message.author.id);
    if (active >= config.ai.reminder.maxPerUser) {
        await message.reply(
            `${config.ui.emojis.error} Bạn đang có ${active} lời nhắc rồi — nhiều quá Stella nhớ không nổi 😵‍💫 ` +
            'Huỷ bớt đi rồi đặt tiếp nhé.'
        ).catch(() => {});
        return true;
    }

    // Trần RIÊNG, chặt hơn, cho lịch lặp hằng ngày. Lý do phải tách: lịch một lần
    // tự chết sau khi ping, còn lịch lặp sống mãi tới khi có người xoá — nên một
    // lịch lặp đặt sai (sai người, sai giờ) là thiệt hại lặp lại mỗi ngày, không
    // phải một lần. Trần chung sẽ cho phép dùng hết hạn mức bằng toàn lịch lặp.
    if (parsed.repeatDaily) {
        const recurring = await countRecurring(message.author.id);
        if (recurring >= config.ai.reminder.maxRecurringPerUser) {
            await message.reply(
                `${config.ui.emojis.error} Bạn đã có ${recurring} lịch nhắc **lặp mỗi ngày** rồi — ` +
                `trần là ${config.ai.reminder.maxRecurringPerUser} thôi nha bồ 🙈 ` +
                'Lịch lặp không tự hết nên Stella phải siết chặt hơn lịch một lần.'
            ).catch(() => {});
            return true;
        }
    }

    const target = await resolveTarget(message, parsed.targetHint);
    if (!target) {
        await message.reply(
            `${config.ui.emojis.error} Stella không biết bạn muốn nhắc ai 🤔 Ping thẳng người đó ` +
            '(kiểu `!s nhắc @Ri 1h chiều mỗi ngày`) cho chắc nhé.'
        ).catch(() => {});
        return true;
    }
    if (target.ambiguous) {
        await message.reply(
            `${config.ui.emojis.error} Có mấy người tên giống "${parsed.targetHint}" quá, Stella ping sai thì ăn gạch 😬 ` +
            'Ping thẳng người đó giúp Stella nhé.'
        ).catch(() => {});
        return true;
    }

    // Cổng quyền. Nhắc chính mình thì luôn được; nhắc người khác cần role.
    const isSelf = target.id === message.author.id;
    if (!isSelf && !canPingOthers(message)) {
        await message.reply(
            `${config.ui.emojis.error} Nhờ Stella ping người khác thì cần role riêng nha bồ 🙈 ` +
            'Còn nhắc chính bạn thì thoải mái — nói lại kiểu "nhắc tôi 3h chiều..." là được.'
        ).catch(() => {});
        return true;
    }

    const created = await createReminder({
        requesterId: message.author.id,
        targetId: target.id,
        // Ping ở kênh chat theo Saly chốt, KHÔNG ở kênh người ta gõ lệnh: lời nhắc
        // là để người bị nhắc thấy, mà họ không nhất thiết theo dõi kênh Q&A.
        channelId: config.ai.reminder.channel,
        message: parsed.message,
        hourVn: parsed.hour,
        minuteVn: parsed.minute,
        repeatDaily: parsed.repeatDaily
    });

    if (!created) {
        await message.reply(
            `${config.ui.emojis.error} Stella lưu lời nhắc không được, thử lại giúp nhé 😥`
        ).catch(() => {});
        return true;
    }

    const when = describeSaigon(created.fireAt.getTime());
    const who = isSelf ? 'bạn' : `<@${target.id}>`;
    await message.reply({
        content:
            `${config.ui.emojis.success} Chốt! Stella sẽ ping ${who} ` +
            (parsed.repeatDaily
                ? `**mỗi ngày lúc ${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}**`
                : `vào **${when}**`) +
            (parsed.message ? `\n> ${parsed.message}` : '') +
            `\nPing ở <#${config.ai.reminder.channel}> nhé. Quên là lỗi của Stella 🫡`,
        // Không ping người bị nhắc NGAY LÚC NÀY. Cả điểm của lời nhắc là ping đúng
        // giờ đã hẹn; ping thêm lúc đặt là làm phiền đúng thứ mà tính năng này định
        // sắp xếp cho gọn.
        allowedMentions: { users: [message.author.id] }
    }).catch(() => {});
    return true;
}
