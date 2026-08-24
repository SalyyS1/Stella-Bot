// ============================================================
//  MUSIC SPOTIFY COLLECTION RESOLVER — doc playlist/album Spotify khong can key
// ============================================================
// Spotify chi cho doc DANH SACH bai trong playlist bang token OAuth2 cua chinh
// chu playlist: `/v1/playlists/{id}/items` tra 401 "Valid user authentication
// required" voi token client-credentials (key app), con `/v1/playlists/{id}/tracks`
// tra 403. LavaSrc khong lam OAuth2 nen link playlist Spotify KHONG BAO GIO load
// duoc qua Lavalink, du key dung va plugin bat day du.
//
// Trang embed cong khai van tra du ten bai + nghe si + uri ma khong can key, va
// do la tat ca thu bot can: Spotify chi la nguon metadata, audio luon lay tu
// YouTube. Nen buoc "liet ke bai trong playlist" duoc lam o day, con buoc tim
// audio van de Lavalink lo.

const EMBED_BASE = 'https://open.spotify.com/embed';
const REQUEST_TIMEOUT_MS = 10_000;
// Trang embed tra HTML khac nhau theo User-Agent; UA trinh duyet la ban co
// __NEXT_DATA__ day du nhat.
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SHAPE_ERROR = 'Không đọc được nội dung link Spotify (Spotify vừa đổi cấu trúc trang embed). Tạm thời dùng link YouTube.';
const MISSING_ERROR = 'Không mở được link Spotify này: sai link, đã bị xoá, hoặc playlist đang ở chế độ riêng tư (Private). Bật công khai rồi thử lại.';
const EMPTY_ERROR = 'Link Spotify này không có bài nào bot đọc được (playlist riêng tư, hoặc chỉ chứa file nhạc offline).';

/** `playlist` va `album` deu la "mot tap bai", xu ly y het nhau. */
export type SpotifyCollectionRef = { type: 'playlist' | 'album'; id: string };

export type SpotifyCollectionTrack = {
    title: string;
    author: string;
    /** Link track chuan, trung dinh dang voi uri LavaSrc luu -> dedup playlist khop nhau. */
    uri: string;
    identifier: string;
    duration: number | null;
};

export type SpotifyCollection = {
    name: string;
    artworkUrl: string;
    tracks: SpotifyCollectionTrack[];
};

const COLLECTION_PATTERN = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)(playlist|album)[/:]([A-Za-z0-9]+)/i;

/** Nhan ra link/uri playlist hoac album Spotify. Link track tra null (Lavalink lo duoc). */
export function parseSpotifyCollection(input: string): SpotifyCollectionRef | null {
    const match = COLLECTION_PATTERN.exec(String(input || '').trim());
    if (!match) return null;
    return { type: match[1].toLowerCase() as 'playlist' | 'album', id: match[2] };
}

function trackFromEmbedItem(item: any): SpotifyCollectionTrack | null {
    const uri = String(item?.uri || '');
    const id = uri.startsWith('spotify:track:') ? uri.slice('spotify:track:'.length) : '';
    const title = String(item?.title || '').trim();
    // Khong co id track = local file hoac podcast episode -> bo, khong tim duoc audio.
    if (!id || !title) return null;

    const duration = Number(item?.duration);
    return {
        title,
        author: String(item?.subtitle || '').trim(),
        uri: `https://open.spotify.com/track/${id}`,
        identifier: id,
        duration: Number.isFinite(duration) && duration > 0 ? duration : null
    };
}

function largestCoverUrl(entity: any): string {
    const sources = Array.isArray(entity?.coverArt?.sources) ? entity.coverArt.sources : [];
    const biggest = sources.reduce(
        (best: any, item: any) => (Number(item?.width || 0) >= Number(best?.width || 0) ? item : best),
        sources[0]
    );
    return biggest?.url ? String(biggest.url) : '';
}

/** Tach du lieu tu HTML embed. Tach rieng khoi fetch de test duoc khong can mang. */
export function parseSpotifyEmbedHtml(html: string, ref: SpotifyCollectionRef): SpotifyCollection {
    const payload = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''));
    if (!payload) throw new Error(SHAPE_ERROR);

    let entity: any;
    try {
        entity = JSON.parse(payload[1])?.props?.pageProps?.state?.data?.entity;
    } catch {
        throw new Error(SHAPE_ERROR);
    }
    // Spotify tra HTTP 200 kem trang embed rong cho link sai/da xoa/private, nen
    // "khong co entity" phai bao la link khong mo duoc chu khong phai loi cau truc.
    if (!entity) throw new Error(MISSING_ERROR);
    if (entity.type !== ref.type) throw new Error(SHAPE_ERROR);

    const tracks = (Array.isArray(entity.trackList) ? entity.trackList : [])
        .map(trackFromEmbedItem)
        .filter((track: SpotifyCollectionTrack | null): track is SpotifyCollectionTrack => track !== null);
    if (!tracks.length) throw new Error(EMPTY_ERROR);

    return {
        name: String(entity.name || '').trim() || (ref.type === 'album' ? 'Album Spotify' : 'Playlist Spotify'),
        artworkUrl: largestCoverUrl(entity),
        tracks
    };
}

/**
 * Lay danh sach bai cua playlist/album Spotify.
 * Spotify tu cat trackList cua embed o 100 bai — dung bang tran 100 bai/playlist
 * cua bot nen khong can phan trang them.
 */
export async function fetchSpotifyCollection(ref: SpotifyCollectionRef): Promise<SpotifyCollection> {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
        response = await fetch(`${EMBED_BASE}/${ref.type}/${ref.id}`, {
            headers: { 'User-Agent': BROWSER_USER_AGENT, 'Accept-Language': 'en' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch {
        throw new Error('Không gọi được Spotify để đọc link này. Kiểm tra mạng của bot rồi thử lại.');
    }

    if (response.status === 404) throw new Error('Link Spotify này không tồn tại (hoặc đã bị xoá).');
    if (!response.ok) throw new Error(`Spotify trả lỗi ${response.status} khi đọc link này. Thử lại sau.`);
    return parseSpotifyEmbedHtml(await response.text(), ref);
}
