import { VoiceState } from 'discord.js';
import prisma from '../../lib/prisma';
import { weekKeyFor } from '../weekly-reward-manager';

// Thời gian trong voice, dùng cho `/voicetop` và `/profile`.
//
// ĐO CÁI GÌ MỚI ĐÚNG: một bảng xếp hạng "thời gian trong voice" thô sẽ đo ai để máy chạy
// lâu nhất, không đo ai tham gia nhiều nhất. Hai khoảng bị loại:
//
//   1. Kênh AFK của server (`guild.afkChannelId`) — Discord tự đẩy người idle vào đó.
//      Đếm nó là trả thưởng cho việc bỏ máy đấy.
//   2. Khoảng tự tắt tai nghe (`selfDeaf`) — tắt tai nghe nghĩa là không nghe. Đây là dấu
//      hiệu rõ nhất và là dữ liệu Discord gửi sẵn trong VoiceState.
//
// Không loại "ngồi một mình": ngồi chờ bạn vào vẫn là dùng server, và tính "có ai khác
// trong kênh" cho từng giây đòi đánh giá lại mỗi lượt người khác vào/ra — phức tạp hơn
// nhiều so với giá trị nó thêm.

// Phiên đang tính, trong RAM. Mất khi bot restart — chấp nhận, đổi lại là không phải ghi
// DB mỗi phút cho mỗi người đang trong voice.
const active = new Map<string, number>();

// Phiên ngắn hơn ngưỡng này không ghi: vào/ra liên tục sinh hàng loạt lượt ghi DB cho vài
// giây vô nghĩa.
const MIN_SESSION_SECONDS = 60;

/** Trạng thái này có đáng tính giờ không. */
function countable(state: VoiceState): boolean {
    if (!state.channelId) return false;
    if (state.member?.user.bot) return false;
    if (state.channelId === state.guild.afkChannelId) return false;
    if (state.selfDeaf) return false;
    return true;
}

async function record(userId: string, seconds: number): Promise<void> {
    if (seconds < MIN_SESSION_SECONDS) return;
    const weekKey = weekKeyFor(new Date());

    const existing = await prisma.voiceActivity.findUnique({ where: { userId } }).catch(() => null);
    // Tuần đổi thì weekSeconds bắt đầu lại. Reset lúc GHI nên không cần một scheduler
    // quét cả bảng vào nửa đêm Chủ nhật.
    const weekSeconds = existing && existing.weekKey === weekKey ? existing.weekSeconds + seconds : seconds;

    await prisma.voiceActivity.upsert({
        where: { userId },
        update: { totalSeconds: { increment: seconds }, weekKey, weekSeconds },
        create: { userId, totalSeconds: seconds, weekKey, weekSeconds }
    }).catch(error => console.error('[voice-activity] ghi lỗi:', error));
}

export async function trackVoiceActivity(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const userId = newState.member?.id || oldState.member?.id;
    if (!userId) return;

    const wasCountable = countable(oldState);
    const isCountable = countable(newState);
    // Cùng kênh, cùng trạng thái deaf → không phải mốc bắt đầu/kết thúc phiên nào.
    if (wasCountable === isCountable && oldState.channelId === newState.channelId) return;

    if (wasCountable) {
        const startedAt = active.get(userId);
        active.delete(userId);
        if (startedAt) await record(userId, Math.floor((Date.now() - startedAt) / 1000));
    }
    if (isCountable) active.set(userId, Date.now());
}

export async function getVoiceStats(userId: string) {
    const row = await prisma.voiceActivity.findUnique({ where: { userId } }).catch(() => null);
    if (!row) return { totalSeconds: 0, weekSeconds: 0 };
    const currentWeek = weekKeyFor(new Date());
    return {
        totalSeconds: row.totalSeconds,
        // Dòng của tuần trước không được hiện thành "tuần này".
        weekSeconds: row.weekKey === currentWeek ? row.weekSeconds : 0
    };
}

export async function getVoiceLeaderboard(range: 'week' | 'all', take = 10) {
    if (range === 'all') {
        return prisma.voiceActivity
            .findMany({ where: { totalSeconds: { gt: 0 } }, orderBy: { totalSeconds: 'desc' }, take })
            .catch(() => []);
    }
    return prisma.voiceActivity
        .findMany({
            where: { weekKey: weekKeyFor(new Date()), weekSeconds: { gt: 0 } },
            orderBy: { weekSeconds: 'desc' },
            take
        })
        .catch(() => []);
}

export function formatVoiceTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (!hours && !minutes) return `${seconds} giây`;
    if (!hours) return `${minutes} phút`;
    return `${hours} giờ ${minutes} phút`;
}
