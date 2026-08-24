import { trackInfo } from './music-format';

// ============================================================
//  MUSIC AUTOPLAY — queue het thi tu nap bai lien quan
// ============================================================
// lavalink-client goi `onEmptyQueue.autoPlayFunction` khi bai cuoi ket thuc va
// queue trong. Neu ham nay them bai vao queue thi player phat tiep, khong thi
// event queueEnd chay (bot roi voice sau 30s).
//
// Bat/tat theo TUNG PLAYER (khong phai theo guild): moi loa co player rieng,
// nguoi bat autoplay o loa 2 khong nen lam loa 1 tu phat.

const AUTOPLAY_KEY = 'stella:autoplay';
/** Nap it moi lan de bai tu dong khong day queue that cua nguoi dung. */
const MAX_AUTOPLAY_TRACKS = 2;

export function isAutoplayOn(player: any): boolean {
    return Boolean(player?.getData?.(AUTOPLAY_KEY));
}

export function setAutoplay(player: any, enabled: boolean): boolean {
    player?.setData?.(AUTOPLAY_KEY, enabled);
    return enabled;
}

export function toggleAutoplay(player: any): boolean {
    return setAutoplay(player, !isAutoplayOn(player));
}

function trackKey(track: any) {
    const info = trackInfo(track);
    return info.identifier || info.uri || '';
}

/** Bai da phat/dang cho: tranh autoplay tra lai dung bai vua nghe. */
function playedKeys(player: any, last: any) {
    const keys = new Set<string>();
    const add = (track: any) => {
        const key = trackKey(track);
        if (key) keys.add(key);
    };
    add(last);
    for (const track of player?.queue?.previous || []) add(track);
    for (const track of player?.queue?.tracks || []) add(track);
    return keys;
}

async function search(player: any, query: any, requester: any) {
    try {
        const result = await player.search(query, requester, false);
        return result?.tracks || [];
    } catch {
        return [];
    }
}

/**
 * Nap bai lien quan cho bai vua phat xong. Khong bao gio throw: autoplay loi
 * chi lam queue het nhu binh thuong.
 */
export async function autoplayRelatedTracks(player: any, last: any): Promise<number> {
    if (!isAutoplayOn(player) || !last) return 0;

    const info = trackInfo(last);
    const requester = last?.requester;
    const queries: any[] = [];
    // Mix cua YouTube (list=RD<id>) la danh sach "bai lien quan" san co, sat y
    // nhat. Khong co thi lui ve tim theo nghe si, roi ten bai + nghe si.
    if (info.identifier && /youtube|ytmusic/i.test(info.sourceName)) {
        queries.push(`https://www.youtube.com/watch?v=${info.identifier}&list=RD${info.identifier}`);
    }
    if (info.author) queries.push({ query: info.author, source: 'ytmsearch' });
    if (info.title) queries.push({ query: `${info.title} ${info.author}`.trim(), source: 'ytmsearch' });

    const played = playedKeys(player, last);
    for (const query of queries) {
        const candidates = await search(player, query, requester);
        const picked = candidates.filter((track: any) => {
            const key = trackKey(track);
            return key && !played.has(key) && !trackInfo(track).isStream;
        }).slice(0, MAX_AUTOPLAY_TRACKS);

        if (!picked.length) continue;
        await player.queue.add(picked);
        return picked.length;
    }
    return 0;
}
