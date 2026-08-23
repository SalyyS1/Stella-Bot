import { randomBytes } from 'crypto';

// ============================================================
//  MUSIC SEARCH CACHE — nho ket qua search cho select menu
// ============================================================
// Track encoded cua Lavalink dai hang tram ky tu, khong nhet vao value cua
// select menu (gioi han 100) duoc. Nen luu ket qua trong RAM va chi dua
// searchId + index vao component.

const SEARCH_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 200;

type SearchEntry = {
    tracks: any[];
    userId: string;
    guildId: string;
    expiresAt: number;
};

const searches = new Map<string, SearchEntry>();

function sweep() {
    const now = Date.now();
    for (const [id, entry] of searches) {
        if (entry.expiresAt <= now) searches.delete(id);
    }
    // Chan truong hop nguoi ta spam search: bo cai cu nhat.
    while (searches.size > MAX_ENTRIES) {
        const oldest = searches.keys().next().value;
        if (!oldest) break;
        searches.delete(oldest);
    }
}

export function rememberSearch(userId: string, guildId: string, tracks: any[]): string {
    sweep();
    const id = randomBytes(4).toString('hex');
    searches.set(id, { tracks, userId, guildId, expiresAt: Date.now() + SEARCH_TTL_MS });
    return id;
}

/** Lay track user chon. Throw loi tieng Viet neu het han hoac khong phai chu. */
export function takeSearchTrack(searchId: string, index: number, userId: string): any {
    const entry = searches.get(searchId);
    if (!entry || entry.expiresAt <= Date.now()) {
        searches.delete(searchId);
        throw new Error('Kết quả tìm kiếm đã hết hạn, search lại nhé.');
    }
    if (entry.userId !== userId) throw new Error('Đây là kết quả tìm kiếm của người khác.');
    const track = entry.tracks[index];
    if (!track) throw new Error('Không tìm thấy bài đã chọn.');
    return track;
}
