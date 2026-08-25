import { EmbedBuilder, VoiceState } from 'discord.js';
import { config } from '../../config';
import { sendMessageLog } from './message-log-sender';
import { formatDuration } from '../../utils/parse-duration';

// Log hoạt động voice.
//
// Gộp theo PHIÊN, không log từng nửa: log cả lúc vào lẫn lúc ra thì mỗi lần ai đó đổi
// kênh sinh hai dòng, và kênh log thành nhật ký di chuyển không ai đọc. Một dòng khi
// rời/chuyển, kèm thời lượng — đó là thông tin mod thật sự cần ("người này ở trong đó
// bao lâu").

interface Session {
    channelId: string;
    joinedAt: number;
}

const sessions = new Map<string, Session>();

function takeSession(userId: string): Session | null {
    const session = sessions.get(userId);
    if (session) sessions.delete(userId);
    return session ?? null;
}

async function log(
    state: VoiceState,
    title: string,
    color: string,
    lines: string[]
): Promise<void> {
    const member = state.member;
    await sendMessageLog(state.client, {
        embeds: [new EmbedBuilder()
            .setColor(color as any)
            .setTitle(title)
            .setDescription(
                `${member ? `<@${member.id}> (${member.user.tag})` : 'Không rõ ai'}\n` + lines.join('\n')
            )
            .setTimestamp()]
    });
}

export async function logVoiceActivity(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (!config.logs.enabled || !config.logs.voice.enabled) return;
    // Bot nhạc vào/ra voice liên tục theo từng bài — log chúng là tự làm ngập kênh log.
    if (newState.member?.user.bot || oldState.member?.user.bot) return;

    const userId = newState.member?.id || oldState.member?.id;
    if (!userId) return;

    const from = oldState.channelId;
    const to = newState.channelId;
    if (from === to) return; // mute/unmute/deaf: không phải chuyện di chuyển

    const previous = from ? takeSession(userId) : null;
    const spent = previous ? formatDuration(Date.now() - previous.joinedAt) : null;

    if (to) sessions.set(userId, { channelId: to, joinedAt: Date.now() });

    if (from && to) {
        await log(newState, 'Voice · chuyển kênh', '#3498db', [
            `<#${from}> → <#${to}>`,
            spent ? `Ở kênh cũ: **${spent}**` : ''
        ].filter(Boolean));
        return;
    }
    if (to) {
        await log(newState, 'Voice · vào kênh', '#2ecc71', [`Kênh: <#${to}>`]);
        return;
    }
    await log(oldState, 'Voice · rời kênh', '#95a5a6', [
        `Kênh: <#${from}>`,
        spent ? `Thời lượng: **${spent}**` : 'Thời lượng: *không rõ (bot vừa khởi động)*'
    ]);
}
