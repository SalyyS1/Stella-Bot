// ============================================================
//  MUSIC SEARCH ERRORS — doi loi cua lavalink-client thanh tieng Viet
// ============================================================
// lavalink-client chan truoc khi goi node neu link thuoc source ma node chua
// bat (vd Spotify khi thieu LavaSrc). Loi goc la tieng Anh kieu "Lavalink Node
// has not 'spotify' enabled" — nguoi dung doc xong khong biet phai sua o dau,
// nen o day doi thanh cau chi ro viec can lam VA sua o may nao.

type ErrorHint = { match: RegExp; message: string };

/** Sua o noi Lavalink chay, khong phai .env cua bot — nham cho la mat ca buoi. */
const SOURCE_SETUP_HINTS: ErrorHint[] = [
    {
        match: /has not 'spotify' enabled/i,
        message: 'Node Lavalink chưa bật Spotify. Cần plugin LavaSrc + `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` đặt ở **nơi Lavalink chạy** (không phải `.env` của bot), rồi restart Lavalink. Xem `docs/music-setup.md` mục 6. Kiểm tra nhanh bằng `/music health`.'
    },
    {
        match: /has not 'applemusic' enabled/i,
        message: 'Node Lavalink chưa bật Apple Music (plugin LavaSrc). Xem `/music health` để biết node đang bật source nào.'
    },
    {
        match: /has not 'deezer' enabled/i,
        message: 'Node Lavalink chưa bật Deezer (plugin LavaSrc). Xem `/music health`.'
    },
    {
        match: /has not 'youtube' enabled/i,
        message: 'Node Lavalink chưa bật YouTube. Kiểm tra plugin `youtube-plugin` trong log Lavalink, rồi restart node. Xem `/music health`.'
    },
    {
        match: /has not 'soundcloud' enabled/i,
        message: 'Node Lavalink chưa bật SoundCloud.'
    },
    {
        match: /does not have any info cached yet|No Lavalink Node was provided/i,
        message: 'Node Lavalink vừa kết nối, chưa lấy xong thông tin. Chờ vài giây rồi thử lại.'
    },
    {
        match: /Nothing found/i,
        message: 'Không tìm thấy bài nào khớp. Thử tên khác, hoặc dán link trực tiếp.'
    },
    {
        match: /Query string is empty/i,
        message: 'Từ khóa trống.'
    }
];

// Loi Spotify tra ve qua Lavalink chi la mot cau chung chung ("Something went
// wrong while looking up the track"), doc len khong biet la Spotify chan. Chi map
// khi query dung la link Spotify de khong che loi cua source khac.
const SPOTIFY_LOOKUP_FAILURE = /looking up the track|Valid user authentication required|Response code from channel info is (401|403)/i;
const SPOTIFY_LOOKUP_MESSAGE = 'Spotify không cho đọc link này bằng key app (họ bắt phải có OAuth2 của chủ tài khoản). Link **playlist/album** thì bot tự đọc được; link bài lẻ cần node bật Spotify (`docs/music-setup.md` mục 6); còn lại thì dùng link YouTube nhé.';

function isSpotifyLink(query: string) {
    return /open\.spotify\.com|^spotify:/i.test(String(query || '').trim());
}

/**
 * Doi loi search thanh Error tieng Viet. Giu nguyen loi la (khong match) de
 * khong che mat nguyen nhan that.
 */
export function friendlySearchError(error: any, query = ''): Error {
    const raw = String(error?.message || error || '');
    if (isSpotifyLink(query) && SPOTIFY_LOOKUP_FAILURE.test(raw)) return new Error(SPOTIFY_LOOKUP_MESSAGE);

    const hint = SOURCE_SETUP_HINTS.find(item => item.match.test(raw));
    if (hint) return new Error(hint.message);
    return error instanceof Error ? error : new Error(raw || 'Search lỗi không rõ nguyên nhân.');
}
