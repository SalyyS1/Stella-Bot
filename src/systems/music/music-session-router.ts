import { Events, GuildMember } from 'discord.js';
import { DEFAULT_VOLUME } from './music-audio-config';
import { listMusicEntries, MusicClientEntry } from './music-client-pool';
import { canBotUseVoiceChannel, ensureVoice } from './music-voice-guards';

// ============================================================
//  MUSIC SESSION ROUTER — map (guild, voice channel) -> bot nao dang phat
// ============================================================
// Mot bot chi o duoc mot voice channel trong mot guild, nen "session" = mot
// player thuoc mot bot client cu the. Router chon bot ranh khi co nguoi xin
// nhac o kenh khac, va tim dung session khi nguoi ta bam nut dieu khien.

export type MusicSession = {
    entry: MusicClientEntry;
    player: any;
    guildId: string;
    voiceChannelId: string;
};

function toSession(entry: MusicClientEntry, guildId: string): MusicSession | null {
    const player = entry.lavalink?.getPlayer(guildId);
    if (!player) return null;
    return { entry, player, guildId, voiceChannelId: String(player.voiceChannelId || '') };
}

/** Dung trong event handler cua Lavalink, noi chi co entry + player. */
export function sessionFromPlayer(entry: MusicClientEntry, player: any): MusicSession {
    return {
        entry,
        player,
        guildId: String(player?.guildId || ''),
        voiceChannelId: String(player?.voiceChannelId || '')
    };
}

export function findSessionsInGuild(guildId: string): MusicSession[] {
    return listMusicEntries()
        .map(entry => toSession(entry, guildId))
        .filter(Boolean) as MusicSession[];
}

export function findSessionByVoiceChannel(guildId: string, voiceChannelId: string): MusicSession | null {
    return findSessionsInGuild(guildId).find(session => session.voiceChannelId === voiceChannelId) || null;
}

/** Session dau tien trong guild — dung cho panel/health khi khong co ngu canh member. */
export function findPrimarySession(guildId: string): MusicSession | null {
    return findSessionsInGuild(guildId)[0] || null;
}

/** Session ma member duoc phep dieu khien (phai cung voice channel). */
export function resolveControllableSession(member: GuildMember | null): MusicSession {
    const guildId = member?.guild?.id;
    const sessions = guildId ? findSessionsInGuild(guildId) : [];
    if (!sessions.length) throw new Error('Không có player đang chạy.');

    const { voiceChannelId } = ensureVoice(member);
    const session = sessions.find(item => item.voiceChannelId === voiceChannelId);
    if (!session) throw new Error('Bạn cần ở cùng voice channel với Stella để điều khiển nhạc.');
    return session;
}

/**
 * Session de xem (panel/refresh): uu tien session cung voice voi member,
 * neu member khong o voice thi lay session dau tien trong guild.
 * Khong throw vi chi de hien thi.
 */
export function resolveViewableSession(member: GuildMember | null, guildId: string): MusicSession | null {
    const voiceChannelId = member?.voice?.channelId;
    if (voiceChannelId) {
        const mine = findSessionByVoiceChannel(guildId, voiceChannelId);
        if (mine) return mine;
    }
    return findPrimarySession(guildId);
}

function describeBusyEntries(sessions: MusicSession[]) {
    if (sessions.length === 1) {
        return 'Stella đang phát nhạc ở voice channel khác. Hãy vào cùng channel để thêm bài.';
    }
    const list = sessions.map(session => `${session.entry.label} ở <#${session.voiceChannelId}>`).join(', ');
    return `Tất cả bot nhạc đang bận: ${list}. Vào một trong các kênh đó để thêm bài nhé.`;
}

const ORPHAN_VOICE_LEAVE_TIMEOUT_MS = 5_000;

/**
 * Sau restart Discord co the resume bot vao voice cu trong khi player trong RAM
 * da mat. Neu gui join lai dung channel do, Discord co the khong cap mot
 * VOICE_SERVER_UPDATE moi va Lavalink se khong bao gio co token de phat am thanh.
 * Buoc nay ep roi han, cho gateway xac nhan, roi acquireSession moi join lai.
 */
export async function disconnectOrphanVoice(entry: MusicClientEntry, guildId: string): Promise<boolean> {
    if (entry.lavalink?.getPlayer(guildId)) return false;

    const guild = entry.client.guilds.cache.get(guildId);
    const botMember = guild?.members.me;
    const orphanChannelId = botMember?.voice?.channelId;
    if (!guild || !botMember || !orphanChannelId) return false;

    console.warn(`[music][${entry.label}] Phat hien voice mo coi o ${orphanChannelId}; roi kenh truoc khi tao player moi.`);

    const left = new Promise<void>(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            entry.client.off(Events.VoiceStateUpdate, onVoiceStateUpdate);
            resolve();
        };
        const onVoiceStateUpdate = (_oldState: any, newState: any) => {
            if (newState?.guild?.id === guildId && newState?.id === entry.client.user?.id && !newState.channelId) finish();
        };
        const timer = setTimeout(finish, ORPHAN_VOICE_LEAVE_TIMEOUT_MS);
        entry.client.on(Events.VoiceStateUpdate, onVoiceStateUpdate);
        if (!botMember.voice.channelId) finish();
    });

    await guild.shard.send({
        op: 4,
        d: { guild_id: guildId, channel_id: null, self_mute: false, self_deaf: false }
    });
    await left;
    return true;
}

/**
 * Lay session cho kenh voice cua member, tao moi neu con bot ranh.
 * Throw loi tieng Viet neu het bot ranh hoac bot khong vao duoc kenh.
 */
export async function acquireSession(member: GuildMember | null, textChannelId: string): Promise<MusicSession> {
    const { member: resolved, channel, voiceChannelId } = ensureVoice(member);
    const guildId = resolved.guild.id;

    const existing = findSessionByVoiceChannel(guildId, voiceChannelId);
    if (existing) {
        if (!existing.player.connected) await existing.player.connect();
        return existing;
    }

    const busy = findSessionsInGuild(guildId);
    const free = listMusicEntries().find(entry => {
        if (entry.lavalink?.getPlayer(guildId)) return false;
        const botMember = entry.client.guilds.cache.get(guildId)?.members?.me ?? null;
        return canBotUseVoiceChannel(botMember, channel);
    });

    if (!free) {
        if (busy.length) throw new Error(describeBusyEntries(busy));
        throw new Error('Không có bot nhạc nào vào được voice channel này. Kiểm tra quyền Connect/Speak.');
    }

    await disconnectOrphanVoice(free, guildId);

    const player = free.lavalink.createPlayer({
        guildId,
        voiceChannelId,
        textChannelId,
        selfDeaf: true,
        selfMute: false,
        volume: DEFAULT_VOLUME
    });
    await player.connect();
    return { entry: free, player, guildId, voiceChannelId };
}
