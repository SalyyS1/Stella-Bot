import { GuildMember } from 'discord.js';
import { config } from '../../config';
import { MAX_VOLUME, MIN_VOLUME, SEEK_STEP_MS } from './music-audio-config';
import { toggleAutoplay } from './music-autoplay';
import { getMainMusicEntry } from './music-client-pool';
import { lavalinkConfigured } from './music-node-config';
import { rememberSearch, takeSearchTrack } from './music-search-cache';
import { friendlySearchError } from './music-search-errors';
import { acquireSession, MusicSession, resolveControllableSession } from './music-session-router';
import { fetchSpotifyCollection, parseSpotifyCollection, SpotifyCollectionRef } from './music-spotify-collection-resolver';
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
    const collection = parseSpotifyCollection(query);
    if (collection) return searchSpotifyCollection(session, collection, requester);

    const searchQuery = isUrl(query) ? query : { query, source: 'ytmsearch' as const };
    try {
        const result = await session.player.search(searchQuery, requester, true);
        return collectUsableTracks(session.entry.lavalink, result);
    } catch (error) {
        throw friendlySearchError(error, query);
    }
}

/**
 * Link playlist/album Spotify: bot tu doc danh sach bai (Lavalink khong doc noi,
 * ly do o music-spotify-collection-resolver) roi moi nho Lavalink tim audio cho
 * tung bai. Cat theo maxEnqueue vi moi bai la mot luot resolve.
 */
async function searchSpotifyCollection(
    session: MusicSession,
    ref: SpotifyCollectionRef,
    requester: MusicRequester
): Promise<MusicSearchOutcome> {
    const collection = await fetchSpotifyCollection(ref);
    const items = collection.tracks.slice(0, config.music.playlist.maxEnqueue);
    const tracks = (await resolveTracksForItems(session, items, requester)).filter(Boolean);
    if (!tracks.length) throw new Error(`Không tìm được bài nào trong **${collection.name}** trên YouTube.`);

    return { result: null, tracks, isPlaylist: true, playlistName: collection.name };
}

/** Bai chi co metadata (bai da luu trong playlist, bai lay tu link Spotify). */
export type ResolvableTrackItem = {
    title: string;
    uri: string;
    author?: string | null;
};

// Resolve song song 5 bai: tuan tu thi 50 bai la 50 luot cho Lavalink noi tiep
// nhau, con ban het cung luc thi node bi dogpile.
const RESOLVE_CONCURRENCY = 5;

/**
 * Resolve mot bai chi co metadata thanh track phat duoc. Thu uri truoc (chinh xac
 * hon: search theo ten de ra ban cover/remix khong phai bai nguoi ta luu), roi moi
 * lui ve ten + nghe si. Buoc lui rat can: link chet hoac node chua bat source cua
 * link (vd uri Spotify tren node khong co LavaSrc) thi bai van phat duoc tu YouTube.
 */
export async function resolveTrackForItem(session: MusicSession, item: ResolvableTrackItem, requester: MusicRequester) {
    const byName = `${item.title} ${item.author || ''}`.trim();
    const attempts = [item.uri, byName].filter((query, index, list) => query && list.indexOf(query) === index);

    for (const query of attempts) {
        try {
            const { tracks } = await searchWithSession(session, query, requester);
            if (tracks[0]) return tracks[0];
        } catch {
            // Thu cach ke tiep; het cach moi tinh la bai nay bo qua.
        }
    }
    return null;
}

/** Resolve nhieu bai, moi lot RESOLVE_CONCURRENCY bai. Bai fail tra ve null. */
export async function resolveTracksForItems(session: MusicSession, items: ResolvableTrackItem[], requester: MusicRequester) {
    const resolved: any[] = new Array(items.length).fill(null);

    for (let start = 0; start < items.length; start += RESOLVE_CONCURRENCY) {
        const batch = items.slice(start, start + RESOLVE_CONCURRENCY);
        await Promise.all(batch.map(async (item, offset) => {
            resolved[start + offset] = await resolveTrackForItem(session, item, requester);
        }));
    }
    return resolved;
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
        throw friendlySearchError(error, query);
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

/**
 * Quay lai bai truoc. queue.previous do lavalink-client tu luu (25 bai gan
 * nhat); bai dang phat duoc day tro lai dau queue de khong bi mat.
 */
async function playPreviousTrack(session: MusicSession) {
    const previous = await session.player.queue.shiftPrevious().catch(() => null);
    if (!previous) throw new Error('Chưa có bài nào trước đó để quay lại.');

    const current = session.player.queue?.current;
    if (current) await session.player.queue.add(current, 0);
    await session.player.play({ clientTrack: previous });
}

export async function controlMusic(member: GuildMember | null, action: string): Promise<MusicSession> {
    const session = resolveControllableSession(member);
    const player = session.player;

    if (action === 'pause') {
        if (player.paused) await player.resume();
        else await player.pause();
    }
    if (action === 'skip') await player.skip(0, false);
    if (action === 'prev') await playPreviousTrack(session);
    if (action === 'autoplay') toggleAutoplay(player);
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
