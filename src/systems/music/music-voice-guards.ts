import { GuildMember, PermissionFlagsBits, VoiceBasedChannel } from 'discord.js';

// ============================================================
//  MUSIC VOICE GUARDS — kiem tra voice/quyen truoc khi phat
// ============================================================

export type ResolvedVoice = {
    member: GuildMember;
    channel: VoiceBasedChannel;
    voiceChannelId: string;
};

/** Bot co the vao va noi trong channel nay khong. */
export function canBotUseVoiceChannel(botMember: GuildMember | null, channel: VoiceBasedChannel) {
    if (!botMember) return false;
    const permissions = channel.permissionsFor(botMember);
    return Boolean(permissions?.has(PermissionFlagsBits.Connect) && permissions.has(PermissionFlagsBits.Speak));
}

/**
 * Bat buoc user dang o voice channel va bot co quyen Connect/Speak o do.
 * Tra ve member + channel da resolve de khoi phai dung `member!` o cho goi.
 */
export function ensureVoice(member: GuildMember | null): ResolvedVoice {
    const channel = member?.voice?.channel;
    if (!member || !channel) throw new Error('Bạn cần vào voice channel trước.');
    if (!canBotUseVoiceChannel(member.guild.members.me, channel)) {
        throw new Error('Stella không có quyền Connect/Speak trong voice channel này.');
    }
    return { member, channel, voiceChannelId: channel.id };
}
