import { GuildMember } from 'discord.js';
import { config } from '../../config';
import { trackInfo } from './music-format';
import { addTrackToPlaylist, bumpPlaylistPlayCount, PlaylistTrackInput } from './music-playlist-service';
import { assertMusicReady, buildRequester, searchWithSession } from './music-queue-service';
import { acquireSession, resolveViewableSession } from './music-session-router';
import { ensureVoice } from './music-voice-guards';

// ============================================================
//  MUSIC PLAYLIST PLAY — nap playlist vao queue, luu bai dang phat
// ============================================================

const LIMITS = config.music.playlist;
// Resolve song song 5 bai: tuan tu thi 50 bai la 50 luot cho Lavalink noi tiep
// nhau, con ban het cung luc thi node bi dogpile.
const RESOLVE_CONCURRENCY = 5;

type StoredTrack = {
    title: string;
    uri: string;
    identifier: string | null;
    author: string | null;
    duration: number | null;
};

export function trackToPlaylistInput(track: any): PlaylistTrackInput {
    const info = trackInfo(track);
    return {
        title: info.title,
        author: info.author || undefined,
        uri: info.uri,
        identifier: info.identifier || undefined,
        source: info.sourceName || undefined,
        duration: info.duration,
        artworkUrl: info.artworkUrl || undefined
    };
}

async function resolveStoredTracks(session: any, items: StoredTrack[], requester: any) {
    const resolved: any[] = new Array(items.length).fill(null);

    for (let start = 0; start < items.length; start += RESOLVE_CONCURRENCY) {
        const batch = items.slice(start, start + RESOLVE_CONCURRENCY);
        await Promise.all(batch.map(async (item, offset) => {
            // uri chinh xac hon search theo ten: search theo ten de ra ban cover
            // hoac ban remix khong phai bai nguoi ta luu.
            const query = item.uri || `${item.title} ${item.author || ''}`.trim();
            try {
                const { tracks } = await searchWithSession(session, query, requester);
                resolved[start + offset] = tracks[0] || null;
            } catch {
                resolved[start + offset] = null;
            }
        }));
    }
    return resolved;
}

function shuffleInPlace<T>(list: T[]) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

/** Nap playlist (cua minh hoac playlist share) vao queue. */
export async function playStoredPlaylist(
    member: GuildMember | null,
    textChannelId: string,
    userId: string,
    playlist: { id: number; name: string; tracks: StoredTrack[] },
    options: { shuffle?: boolean } = {}
) {
    assertMusicReady();
    ensureVoice(member);
    if (!playlist.tracks.length) throw new Error(`Playlist **${playlist.name}** đang trống.`);

    const session = await acquireSession(member, textChannelId);
    const requester = buildRequester(member, userId);

    const items = playlist.tracks.slice(0, LIMITS.maxEnqueue);
    const overflow = playlist.tracks.length - items.length;
    const resolved = (await resolveStoredTracks(session, items, requester)).filter(Boolean);
    if (!resolved.length) throw new Error(`Không bài nào trong **${playlist.name}** còn phát được.`);

    if (options.shuffle) shuffleInPlace(resolved);
    await session.player.queue.add(resolved);
    if (!session.player.playing && !session.player.paused) await session.player.play();
    await bumpPlaylistPlayCount(playlist.id);

    return {
        session,
        queued: resolved.length,
        skipped: items.length - resolved.length,
        overflow
    };
}

/** Luu bai dang phat vao playlist (nut Luu tren panel + /music playlist save). */
export async function savePlayingTrackToPlaylist(member: GuildMember | null, guildId: string, userId: string, playlistName: string) {
    const session = resolveViewableSession(member, guildId);
    const current = session?.player?.queue?.current;
    if (!current) throw new Error('Không có bài nào đang phát để lưu.');

    const input = trackToPlaylistInput(current);
    if (!input.uri) throw new Error('Bài này không có link để lưu lại.');
    const saved = await addTrackToPlaylist(userId, playlistName, input);
    return { title: input.title, position: saved.position, playlistName };
}
