import { Client, EmbedBuilder, User } from 'discord.js';
import { config } from '../../config';
import { formatDuration, prettySourceName, truncate } from './music-format';
import { resolveCoverImageUrl } from './music-playlist-cover';

// ============================================================
//  MUSIC PLAYLIST PANEL — embed danh sach / chi tiet playlist
// ============================================================
// Chi hien TEN BAI, khong hien URL tho: vua la yeu cau, vua giu embed khong bi
// vo layout khi link dai.

const LIMITS = config.music.playlist;
/** So bai in ra trong mot embed. Con lai gop thanh mot dong "…con N bai". */
const MAX_LISTED_TRACKS = 25;

type PlaylistRow = {
    name: string;
    isPublic: boolean;
    shareCode: string;
    playCount: number;
    _count?: { tracks: number };
};

type PlaylistDetail = {
    name: string;
    description: string | null;
    coverUrl: string | null;
    coverMessageId: string | null;
    isPublic: boolean;
    shareCode: string;
    playCount: number;
    tracks: { position: number; title: string; author: string | null; duration: number | null; source: string | null }[];
};

function accent() {
    return config.music.accentColors.default as any;
}

function totalDuration(tracks: { duration: number | null }[]) {
    return tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
}

export function playlistListEmbed(user: User, playlists: PlaylistRow[]) {
    const totalTracks = playlists.reduce((sum, playlist) => sum + (playlist._count?.tracks ?? 0), 0);
    const embed = new EmbedBuilder()
        .setColor(accent())
        .setAuthor({ name: `Playlist của ${user.username}`, iconURL: user.displayAvatarURL() })
        .setThumbnail(config.music.panelGif)
        .setFooter({ text: `${playlists.length}/${LIMITS.maxPerUser} playlist • ${totalTracks} bài • chi tiết: /music playlist view` });

    if (!playlists.length) {
        return embed.setDescription([
            'Bạn chưa có playlist nào.',
            '',
            '`/music playlist create name:<tên>` — tạo playlist rỗng',
            '`/music playlist create name:<tên> from:<link playlist>` — tạo và nạp sẵn từ link Spotify/YouTube'
        ].join('\n'));
    }

    embed.setDescription(playlists.map((playlist, index) => {
        const count = playlist._count?.tracks ?? 0;
        const visibility = playlist.isPublic ? `Công khai • mã \`${playlist.shareCode}\`` : 'Riêng tư';
        return `**${index + 1}. ${truncate(playlist.name, 60)}**\n${count}/${LIMITS.maxTracks} bài • ${visibility} • đã phát ${playlist.playCount} lần`;
    }).join('\n\n'));

    return embed;
}

export async function playlistViewEmbed(client: Client, user: User, playlist: PlaylistDetail) {
    const tracks = playlist.tracks.slice().sort((a, b) => a.position - b.position);
    const shown = tracks.slice(0, MAX_LISTED_TRACKS);

    const lines = shown.map(track => {
        const meta = [track.author, track.source ? prettySourceName(track.source) : ''].filter(Boolean).join(' • ');
        return `\`${String(track.position).padStart(2, ' ')}.\` **${truncate(track.title, 62)}** \`${formatDuration(track.duration)}\`${meta ? `\n${truncate(meta, 70)}` : ''}`;
    });
    if (tracks.length > shown.length) lines.push(`…và **${tracks.length - shown.length}** bài nữa.`);

    const header = [
        playlist.description ? `_${truncate(playlist.description, 200)}_` : '',
        `${tracks.length}/${LIMITS.maxTracks} bài • tổng ${formatDuration(totalDuration(tracks))}`,
        `${playlist.isPublic ? 'Công khai' : 'Riêng tư'} — mã share: \`${playlist.shareCode}\``
    ].filter(Boolean).join('\n');

    const embed = new EmbedBuilder()
        .setColor(accent())
        .setAuthor({ name: `${user.username} • playlist`, iconURL: user.displayAvatarURL() })
        .setTitle(truncate(playlist.name, 100))
        .setDescription(`${header}\n\n${lines.join('\n') || 'Playlist đang trống.'}`.slice(0, 4000))
        .setFooter({ text: 'Phát bằng /music playlist play • người khác nạp bằng /music playlist import' });

    const cover = await resolveCoverImageUrl(client, playlist).catch(() => null);
    embed.setThumbnail(config.music.panelGif);
    if (cover) embed.setImage(cover);

    return embed;
}
