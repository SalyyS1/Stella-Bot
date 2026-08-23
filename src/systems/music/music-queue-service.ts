import { GuildMember } from 'discord.js';
import { MAX_VOLUME, MIN_VOLUME, SEEK_STEP_MS } from './music-audio-config';
import { getMainMusicEntry } from './music-client-pool';
import { lavalinkConfigured } from './music-node-config';
import { rememberSearch, takeSearchTrack } from './music-search-cache';
import { friendlySearchError } from './music-search-errors';
import { acquireSession, MusicSession, resolveControllableSession } from './music-session-router';
import { ensureVoice } from './music-voice-guards';

// ============================================================
//  MUSIC QUEUE SERVICE — search, queue, dieu khien player
// ============================================================

const PLAY_COOLDOWN_MS = 5_000;
const playCooldown = new Map<string, number>();

export function assertMusicReady() {
    if (!lavalinkConfigured() || !getMainMusicEntry()) {
        throw new Error('Music chưa được cấu hình Lavalink. Hãy chạy Lavalink và điền LAVALINK_* trong .env.');
    }
}

function isUrl(input: string) {
    return /^https?:\/\//i.test(input);
}

function checkPlayCooldown(userId: string) {
    const now = Date.now();
    for (const [id, expiresAt] of playCooldown) {
        if (expiresAt <= now) playCooldown.delete(id);
    }
    const until = playCooldown.get(userId) || 0;
    if (until > now) throw new Error(`Chờ thêm ${Math.ceil((until - now) / 1000)}s rồi play tiếp nhé.`);
    playCooldown.set(userId, now + PLAY_COOLDOWN_MS);
}

export type MusicRequester = {
    id: string;
    username?: string;
    avatarUrl?: string;
};

/**
 * Requester duoc luu vao track de panel/card hien ten + avatar nguoi yeu cau
 * ma khong phai fetch member lai.
 */
export function buildRequester(member: GuildMember | null, userId: string): MusicRequester {
    if (!member) return { id: userId };
    return {
        id: member.id,
        username: member.displayName,
        avatarUrl: member.displayAvatarURL({ extension: 'png', size: 128 })
    };
}

/**
 * Nguong loai track rac. lavalink-client mac dinh 29s — nguong do cat luon bai
 * that su ngan (intro, skit) nen o day ha xuong 5s: chi con bo cac entry duration
 * = 0 / khong phai number, tuc track hong that.
 */
const MIN_TRACK_DURATION_MS = 5_000;

export type MusicSearchOutcome = {
    result: any;
    tracks: any[];
    /** Query la link cua CA MOT playlist/album, khong phai mot bai le. */
    isPlaylist: boolean;
    playlistName: string;
};

function collectUsableTracks(lavalink: any, result: any): MusicSearchOutcome {
    const tracks = (result?.tracks || []).filter((track: any) => lavalink.utils.isNotBrokenTrack(track, MIN_TRACK_DURATION_MS));
    return {
        result,
        tracks,
        isPlaylist: result?.loadType === 'playlist',
        playlistName: String(result?.playlist?.name || '')
    };
}

/** Search bang session dang co, loc bo track loi. */
export async function searchWithSession(session: MusicSession, query: string, requester: MusicRequester): Promise<MusicSearchOutcome> {
    const searchQuery = isUrl(query) ? query : { query, source: 'ytmsearch' as const };
    try {
        const result = await session.player.search(searchQuery, requester, true);
        return collectUsableTracks(session.entry.lavalink, result);
    } catch (error) {
        throw friendlySearchError(error);
    }
}

/**
 * Search KHONG can player: dung cho playlist add, noi nguoi dung chi muon luu
 * bai chu khong bat bot vao voice. Search truc tiep qua node.
 */
export async function searchWithoutSession(query: string, requester: MusicRequester): Promise<MusicSearchOutcome> {
    assertMusicReady();
    const entry = getMainMusicEntry()!;
    const node = entry.lavalink?.nodeManager?.leastUsedNodes()?.[0];
    if (!node) throw new Error('Chưa có Lavalink node nào kết nối được. Kiểm tra `/music health`.');

    const searchQuery = isUrl(query) ? query : { query, source: 'ytmsearch' as const };
    let outcome: MusicSearchOutcome;
    try {
        outcome = collectUsableTracks(entry.lavalink, await node.search(searchQuery, requester, true));
    } catch (error) {
        throw friendlySearchError(error);
    }
    if (!outcome.tracks.length) throw new Error('Không tìm thấy bài nào khớp từ khóa.');
    return outcome;
}

export type QueuedTrackSummary = {
    session: MusicSession;
    title: string;
    uri: string;
    count: number;
    playlist: boolean;
};

export async function queueTrack(
    member: GuildMember | null,
    textChannelId: string,
    userId: string,
    query: string
): Promise<QueuedTrackSummary> {
    assertMusicReady();
    ensureVoice(member);
    checkPlayCooldown(userId);

    const session = await acquireSession(member, textChannelId);
    const { tracks, isPlaylist, playlistName } = await searchWithSession(session, query, buildRequester(member, userId));
    if (!tracks.length) throw new Error('Không tìm thấy bài hợp lệ.');

    if (isPlaylist) await session.player.queue.add(tracks);
    else await session.player.queue.add(tracks[0]);

    if (!session.player.playing && !session.player.paused) await session.player.play();

    return {
        session,
        title: isPlaylist ? `${tracks.length} bài từ ${playlistName || 'playlist'}` : tracks[0].info.title,
        uri: isPlaylist ? query : tracks[0].info.uri,
        count: tracks.length,
        playlist: isPlaylist
    };
}

const REPEAT_CYCLE = ['off', 'track', 'queue'] as const;

export async function controlMusic(member: GuildMember | null, action: string): Promise<MusicSession> {
    const session = resolveControllableSession(member);
    const player = session.player;

    if (action === 'pause') {
        if (player.paused) await player.resume();
        else await player.pause();
    }
    if (action === 'skip') await player.skip(0, false);
    if (action === 'stop') {
        await player.stopPlaying(true, false);
        await player.destroy('Stopped by user').catch(() => {});
    }
    if (action === 'loop') {
        const index = REPEAT_CYCLE.indexOf(player.repeatMode);
        await player.setRepeatMode(REPEAT_CYCLE[(index + 1) % REPEAT_CYCLE.length]);
    }
    if (action === 'shuffle') await player.queue.shuffle();
    if (action === 'volume_up') await player.setVolume(Math.min(MAX_VOLUME, (player.volume || 75) + 10));
    if (action === 'volume_down') await player.setVolume(Math.max(MIN_VOLUME, (player.volume || 75) - 10));
    if (action === 'seek_back' || action === 'seek_forward') await seekBy(session, action === 'seek_back' ? -SEEK_STEP_MS : SEEK_STEP_MS);

    return session;
}

/** Seek tuong doi. Stream truc tiep khong seek duoc nen bao loi ro rang. */
async function seekBy(session: MusicSession, deltaMs: number) {
    const current = session.player.queue?.current;
    const duration = Number(current?.info?.duration || 0);
    if (!current) throw new Error('Không có bài nào đang phát.');
    if (current.info?.isStream || !duration) throw new Error('Bài này là stream trực tiếp, không seek được.');

    const position = Number(session.player.position || 0);
    const target = Math.min(Math.max(0, position + deltaMs), Math.max(0, duration - 1_000));
    await session.player.seek(target);
}

export async function setMusicVolume(member: GuildMember | null, value: number) {
    if (!Number.isFinite(value) || value < MIN_VOLUME || value > MAX_VOLUME) {
        throw new Error(`Volume từ ${MIN_VOLUME} đến ${MAX_VOLUME}.`);
    }
    const session = resolveControllableSession(member);
    await session.player.setVolume(value);
    return session;
}

/** Search de nguoi dung chon bang select menu. Chua them bai nao vao queue. */
export async function searchForSelection(member: GuildMember | null, textChannelId: string, userId: string, query: string) {
    assertMusicReady();
    ensureVoice(member);
    checkPlayCooldown(userId);

    const session = await acquireSession(member, textChannelId);
    const { tracks } = await searchWithSession(session, query, buildRequester(member, userId));
    if (!tracks.length) throw new Error('Không tìm thấy bài nào khớp từ khóa.');

    const searchId = rememberSearch(userId, session.guildId, tracks);
    return { session, tracks, searchId };
}

/** Phat bai user chon tu select menu search. Khong tinh cooldown lan 2. */
export async function playSearchPick(member: GuildMember | null, textChannelId: string, userId: string, searchId: string, index: number) {
    assertMusicReady();
    ensureVoice(member);

    const track = takeSearchTrack(searchId, index, userId);
    const session = await acquireSession(member, textChannelId);
    await session.player.queue.add(track);
    if (!session.player.playing && !session.player.paused) await session.player.play();
    return { session, track };
}

/**
 * Nhay tới bài thứ `index` (0-based) trong queue.tracks.
 * player.skip(n) bo n-1 bai dau roi skip, nen phai truyen index + 1.
 */
export async function jumpToQueueIndex(member: GuildMember | null, index: number) {
    const session = resolveControllableSession(member);
    const tracks: any[] = session.player.queue?.tracks || [];
    if (!Number.isInteger(index) || index < 0 || index >= tracks.length) {
        throw new Error('Bài này không còn trong queue nữa.');
    }
    await session.player.skip(index + 1, false);
    return session;
}
