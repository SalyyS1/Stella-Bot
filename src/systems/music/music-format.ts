// ============================================================
//  MUSIC FORMAT — helper hien thi track cho panel/queue/playlist
// ============================================================

/** ms -> "3:45" hoac "1:02:03". Track live/khong biet duration -> "LIVE". */
export function formatDuration(ms?: number | null, isStream = false) {
    if (isStream) return 'LIVE';
    if (!ms || ms <= 0 || !Number.isFinite(ms)) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mm = hours ? String(minutes).padStart(2, '0') : String(minutes);
    return `${hours ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}

export function truncate(value: string, max: number) {
    const text = (value || '').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** Doc info cua track ke ca khi lavalink-client tra shape phang. */
export function trackInfo(track: any) {
    const info = track?.info || track || {};
    const requester = track?.requester || {};
    return {
        title: String(info.title || 'Không rõ tên bài'),
        author: info.author ? String(info.author) : '',
        uri: info.uri ? String(info.uri) : '',
        duration: typeof info.duration === 'number' ? info.duration : null,
        isStream: Boolean(info.isStream),
        artworkUrl: info.artworkUrl ? String(info.artworkUrl) : '',
        sourceName: info.sourceName ? String(info.sourceName) : '',
        identifier: info.identifier ? String(info.identifier) : '',
        requesterId: requester.id ? String(requester.id) : '',
        requesterName: requester.username ? String(requester.username) : '',
        requesterAvatarUrl: requester.avatarUrl ? String(requester.avatarUrl) : ''
    };
}

/**
 * Ten bai dang masked link: Discord chi hien ten, khong hien URL tho.
 * Ky tu ] va ) trong ten se pha markdown nen phai escape.
 */
export function trackLink(track: any, maxTitle = 70) {
    const info = trackInfo(track);
    const title = truncate(info.title, maxTitle).replace(/([\[\]()])/g, '\\$1');
    if (!info.uri) return `**${title}**`;
    return `**[${title}](${info.uri})**`;
}

/** Ten nguon de hien cho nguoi dung ("youtube" -> "YouTube"). */
export function prettySourceName(sourceName: string) {
    const map: Record<string, string> = {
        youtube: 'YouTube',
        ytmusic: 'YouTube Music',
        youtubemusic: 'YouTube Music',
        spotify: 'Spotify',
        soundcloud: 'SoundCloud',
        bandcamp: 'Bandcamp',
        twitch: 'Twitch',
        vimeo: 'Vimeo',
        http: 'Link trực tiếp'
    };
    const key = (sourceName || '').toLowerCase();
    return map[key] || (sourceName ? sourceName : 'Không rõ nguồn');
}
