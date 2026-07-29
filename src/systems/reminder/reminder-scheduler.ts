import { Client, TextChannel } from 'discord.js';
import { config } from '../../config';
import { loadDue, markFired, deactivate, type DueReminder } from './reminder-store';

// Đồng hồ của hệ nhắc nhở. Quét mỗi phút, ping những lời đã tới hạn.
//
// Nhịp 1 phút là mức thô nhất còn dùng được: người ta nói "3h chiều" chứ không
// nói "15:00:00", nên trễ vài chục giây không ai thấy — nhưng nhịp 5 phút thì
// "3h chiều" có thể thành 15:04, và đó là loại sai người dùng nhận ra ngay.

const CHECK_INTERVAL_MS = config.ai.reminder.checkIntervalMs;

function logReminder(message: string): void {
    console.log(`[reminder] ${message}`);
}

// Ping một người. Trả về 'ok', hoặc lý do vĩnh viễn để tắt lời nhắc.
async function fire(client: Client, reminder: DueReminder): Promise<'ok' | 'dead-channel' | 'gone-member' | 'retry'> {
    const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
    // Kênh không tồn tại / bot mất quyền đọc: không có đường sửa từ phía bot, và
    // giữ lại nghĩa là mỗi phút lại thử lại rồi lại ghi một dòng lỗi, mãi mãi.
    if (!channel) return 'dead-channel';
    if (!channel.isTextBased() || !('send' in channel)) return 'dead-channel';

    // Người đã rời server thì ping chỉ ra một cái tên xám không ai bấm được. Kiểm
    // trước khi gửi để không rác kênh bằng lời nhắc vô nghĩa mỗi ngày.
    const guild = 'guild' in channel ? channel.guild : null;
    if (guild) {
        const member = await guild.members.fetch(reminder.targetId).catch(() => null);
        if (!member) return 'gone-member';
    }

    const body = reminder.message.trim();
    const byOther = reminder.requesterId !== reminder.targetId;
    const text =
        `⏰ <@${reminder.targetId}>` +
        (body ? ` — ${body}` : ' — tới giờ rồi nè!') +
        (byOther ? `\n-# <@${reminder.requesterId}> nhờ Stella nhắc bạn đó.` : '');

    const sent = await (channel as TextChannel).send({
        content: text,
        // Đây là chốt quan trọng nhất của cả file. allowedMentions liệt kê ĐÚNG
        // những id được phép ping — không có nó thì một lời nhắc chứa "@everyone"
        // trong phần nội dung (do người đặt gõ vào) sẽ ping cả server. Nội dung
        // lời nhắc là chữ người dùng viết, nên phải coi như dữ liệu không tin được.
        // roles: [] và parse bỏ everyone là cố ý, không phải mặc định dư thừa.
        allowedMentions: {
            parse: [],
            users: byOther
                ? [reminder.targetId, reminder.requesterId]
                : [reminder.targetId],
            roles: []
        }
    }).catch(error => {
        console.error(`[reminder] gửi lời nhắc ${reminder.id} thất bại:`, error);
        return null;
    });

    // Gửi lỗi mà kênh vẫn còn: có thể là rate limit hoặc mạng chớp. Để nguyên cho
    // tick sau thử lại, vì lời nhắc trễ vài phút vẫn còn giá trị.
    return sent ? 'ok' : 'retry';
}

export function startReminderScheduler(client: Client): void {
    let running = false;
    let tickCount = 0;

    const tick = async () => {
        // Lượt trước chưa xong thì bỏ qua. Một lượt có thể phải gửi nhiều tin và
        // fetch nhiều member, nên nó có thể dài hơn 1 phút khi dồn việc.
        if (running) return;
        running = true;
        tickCount++;
        try {
            const due = await loadDue();
            if (!due.length) return;

            logReminder(`tick #${tickCount}: ${due.length} lời nhắc tới hạn`);

            for (const reminder of due) {
                // Quá hạn quá xa thì KHÔNG ping. Bot chết 3 tiếng rồi sống lại mà
                // dội ra "nhắc bạn việc lúc 3h" vào 6h là vô nghĩa với người nhận,
                // và nếu có nhiều lời nhắc dồn thì nó thành một tràng ping cùng lúc.
                //
                // Vẫn phải markFired chứ không bỏ qua im lặng: bỏ qua thì lời nhắc
                // vẫn tới hạn ở tick sau, và mỗi phút lại bị xét lại mãi mãi. Lời
                // lặp được dời sang ngày mai, lời một lần thì đóng — đúng việc
                // markFired vẫn làm.
                const lateMs = Date.now() - reminder.nextFireAt.getTime();
                if (lateMs > config.ai.reminder.lateToleranceMs) {
                    logReminder(
                        `bỏ qua lời nhắc ${reminder.id}: quá hạn ${Math.round(lateMs / 60_000)} phút ` +
                        `(trần ${Math.round(config.ai.reminder.lateToleranceMs / 60_000)} phút)`
                    );
                    await markFired(reminder);
                    continue;
                }

                const outcome = await fire(client, reminder);
                if (outcome === 'ok') {
                    await markFired(reminder);
                    logReminder(
                        `đã ping ${reminder.targetId}${reminder.repeatDaily ? ' (lặp hằng ngày)' : ''}`
                    );
                } else if (outcome === 'dead-channel') {
                    await deactivate(reminder.id, `kênh ${reminder.channelId} không gửi được`);
                } else if (outcome === 'gone-member') {
                    await deactivate(reminder.id, `người ${reminder.targetId} không còn trong server`);
                }
                // 'retry': không đổi gì, tick sau lo.
            }
        } catch (error) {
            console.error('[reminder] tick failed:', error);
        } finally {
            running = false;
        }
    };

    logReminder(
        `scheduler bật: nhịp ${CHECK_INTERVAL_MS / 1000}s, ` +
        `kênh ping <#${config.ai.reminder.channel}>, ` +
        `trần ${config.ai.reminder.maxPerUser} lời/người`
    );

    void tick();
    setInterval(() => void tick(), CHECK_INTERVAL_MS);
}
