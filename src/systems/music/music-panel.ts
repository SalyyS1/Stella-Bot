import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, Client, EmbedBuilder } from 'discord.js';
import { config } from '../../config';
import { listMusicEntries } from './music-client-pool';
import { formatDuration, prettySourceName, trackInfo, trackLink, truncate } from './music-format';
import { getLavalinkNodes, getMusicPrefix, lavalinkConfigured } from './music-node-config';
import { NOW_PLAYING_CARD_FILENAME, renderNowPlayingCard } from './music-now-playing-card';
import { MusicComponentRow, musicControlRows, searchResultRow } from './music-panel-components';
import { findPrimarySession, MusicSession } from './music-session-router';

// ============================================================
//  MUSIC PANEL — embed now-playing + queue
// ============================================================
// Panel kieu hybrid: doi bai (hoac bam Refresh) thi render lai card anh,
// cac update nhe (pause/volume/loop) chi sua embed va giu nguyen card cu —
// edit message ma khong truyen files/attachments thi Discord giu attachment.

export type MusicPanelPayload = {
    embeds: EmbedBuilder[];
    components: MusicComponentRow[];
    files?: AttachmentBuilder[];
    attachments?: any[];
};

/**
 * Progress bar bang ky tu. player.position chi duoc Lavalink cap nhat theo
 * playerUpdateInterval (5s) nen bar co the lech toi 5s — du dung de nhin.
 */
function renderProgressBar(position: number, duration: number, slots = config.music.progressBarSlots) {
    if (!duration || duration <= 0) return '';
    const ratio = Math.min(1, Math.max(0, position / duration));
    const knob = Math.round(ratio * (slots - 1));
    return `${'▬'.repeat(knob)}🔘${'▬'.repeat(Math.max(0, slots - 1 - knob))}`;
}

function accentColor(sourceName: string) {
    const key = (sourceName || '').toLowerCase();
    return (config.music.accentColors[key] || config.music.accentColors.default) as any;
}

function queueDurationText(tracks: any[]) {
    const total = tracks.reduce((sum, track) => sum + Number(track?.info?.duration || 0), 0);
    if (!total) return '';
    return ` • còn ${formatDuration(total)}`;
}

export function musicPanelForSession(session: MusicSession | null, options: { cardAttached?: boolean } = {}): MusicPanelPayload {
    const player = session?.player;
    const current = player?.queue?.current;
    const tracks: any[] = player?.queue?.tracks || [];
    const embed = new EmbedBuilder().setThumbnail(config.music.panelGif);

    if (!current) {
        embed
            .setColor(accentColor('default'))
            .setTitle('Music')
            .setDescription('Chưa có bài nào đang phát. Dùng `/music play` hoặc `' + getMusicPrefix() + 'play <tên bài>` để bắt đầu.')
            .setFooter({ text: lavalinkConfigured() ? 'Lavalink playback' : 'Cần cấu hình Lavalink để phát audio' });
        // Khong con bai nao thi bo luon card cu cho sach message.
        return { embeds: [embed], components: musicControlRows(session), files: [], attachments: [] };
    }

    const info = trackInfo(current);
    const position = Number(player?.position || 0);
    const lines = [
        trackLink(current),
        info.author ? `${info.author} • ${prettySourceName(info.sourceName)}` : prettySourceName(info.sourceName)
    ];
    const bar = renderProgressBar(position, info.duration || 0);
    if (bar) lines.push(`${bar} \`${formatDuration(position)} / ${formatDuration(info.duration, info.isStream)}\``);
    else lines.push(`\`${formatDuration(info.duration, info.isStream)}\``);

    embed
        .setColor(accentColor(info.sourceName))
        .setTitle(player?.paused ? 'Đang tạm dừng' : 'Đang phát')
        .setDescription(lines.join('\n'))
        .addFields(
            { name: 'Queue', value: `${tracks.length} bài${queueDurationText(tracks)}`, inline: true },
            { name: 'Lặp', value: player?.repeatMode === 'track' ? '1 bài' : player?.repeatMode === 'queue' ? 'Cả queue' : 'Tắt', inline: true },
            { name: 'Âm lượng', value: `${player?.volume ?? 100}%`, inline: true }
        );

    if (info.requesterId) embed.addFields({ name: 'Người yêu cầu', value: `<@${info.requesterId}>`, inline: true });
    if (session?.voiceChannelId) embed.addFields({ name: 'Kênh', value: `<#${session.voiceChannelId}>`, inline: true });
    if (session && listMusicEntries().length > 1) embed.addFields({ name: 'Loa', value: session.entry.label, inline: true });

    if (tracks.length) {
        const preview = tracks.slice(0, 3).map((track, index) => {
            const next = trackInfo(track);
            return `\`${index + 1}.\` ${next.title.slice(0, 60)} \`${formatDuration(next.duration, next.isStream)}\``;
        });
        if (tracks.length > 3) preview.push(`… và ${tracks.length - 3} bài nữa`);
        embed.addFields({ name: 'Bài kế tiếp', value: preview.join('\n').slice(0, 1000) });
    }

    embed.setFooter({ text: lavalinkConfigured() ? 'Lavalink playback' : 'Cần cấu hình Lavalink để phát audio' });
    if (options.cardAttached) embed.setImage(`attachment://${NOW_PLAYING_CARD_FILENAME}`);
    return { embeds: [embed], components: musicControlRows(session) };
}

/**
 * Panel day du: render card anh moi. Dung khi doi bai, khi tra ket qua play,
 * hoac khi nguoi dung bam Refresh. Card loi thi tu dong tra panel khong anh.
 */
export async function buildMusicPanel(session: MusicSession | null): Promise<MusicPanelPayload> {
    const current = session?.player?.queue?.current;
    if (!session || !current) return musicPanelForSession(session);

    const info = trackInfo(current);
    const card = await renderNowPlayingCard({
        title: info.title,
        author: info.author,
        sourceLabel: prettySourceName(info.sourceName),
        artworkUrl: info.artworkUrl,
        position: Number(session.player.position || 0),
        duration: info.duration,
        isStream: info.isStream,
        paused: Boolean(session.player.paused),
        accentColor: String(accentColor(info.sourceName)),
        requesterName: info.requesterName,
        requesterAvatarUrl: info.requesterAvatarUrl,
        cacheKey: info.identifier || info.uri || info.title
    });

    if (!card) return musicPanelForSession(session);
    return { ...musicPanelForSession(session, { cardAttached: true }), files: [card], attachments: [] };
}

/**
 * Panel theo guild — dung khi khong co ngu canh member (vd: sau khi stop).
 */
export function musicPanel(guildId: string): MusicPanelPayload {
    return musicPanelForSession(findPrimarySession(guildId));
}

/**
 * Bo field `attachments` khi GUI TIN NHAN MOI. `attachments: []` chi co nghia
 * khi edit (de xoa file cu); dua vao payload tao moi la vo nghia.
 */
export function asNewMessagePayload(payload: MusicPanelPayload) {
    const { attachments, ...rest } = payload;
    return rest;
}

/** Danh sach ket qua search + select menu de chon bai. Khong hien URL. */
export function musicSearchPanel(query: string, searchId: string, tracks: any[]): MusicPanelPayload {
    const lines = tracks.slice(0, 24).map((track, index) => {
        const info = trackInfo(track);
        const meta = [info.author, prettySourceName(info.sourceName)].filter(Boolean).join(' • ');
        return `\`${index + 1}.\` **${truncate(info.title, 70)}** \`${formatDuration(info.duration, info.isStream)}\`\n${meta}`;
    });

    const embed = new EmbedBuilder()
        .setColor(accentColor('default'))
        .setTitle('Kết quả tìm kiếm')
        .setDescription(`Từ khóa: **${truncate(query, 80)}**\n\n${lines.join('\n')}`.slice(0, 4000))
        .setThumbnail(config.music.panelGif)
        .setFooter({ text: 'Chọn một bài ở menu bên dưới • kết quả hết hạn sau 5 phút' });

    return { embeds: [embed], components: [searchResultRow(searchId, tracks)] };
}

export function musicHealthPanel(client: Client, revealNodeAddresses = false) {
    const nodes = getLavalinkNodes();
    const entries = listMusicEntries();
    const nodeLines = nodes.length
        ? nodes.map(node => revealNodeAddresses ? `**${node.id}** - ${node.host}:${node.port}${node.secure ? ' TLS' : ''}` : `**${node.id}** - configured`).join('\n')
        : 'Chưa cấu hình node Lavalink.';
    const botLines = entries.length
        ? entries.map(entry => {
            const players: any[] = [...(entry.lavalink?.players?.values?.() ?? [])];
            // Loa nao dang o kenh nao la thong tin can nhat khi phat song song:
            // no quyet dinh lenh play tiep theo roi vao loa nao.
            const where = players
                .map(player => player.voiceChannelId ? `<#${player.voiceChannelId}>` : 'chờ kết nối')
                .join(', ');
            return `**${entry.label}** (${entry.role}) - ${players.length} player${where ? ` → ${where}` : ''}`;
        }).join('\n')
        : 'Chưa có bot nhạc nào được khởi tạo.';
    const playerCount = entries.reduce((sum, entry) => sum + (entry.lavalink?.players?.size ?? 0), 0);

    return {
        embeds: [new EmbedBuilder()
            .setColor(nodes.length && entries.length ? '#2ecc71' : '#e67e22')
            .setTitle('Music Health')
            .setDescription(entries.length ? 'Music manager đã khởi tạo.' : 'Music manager chưa khởi tạo hoặc thiếu Lavalink env.')
            .addFields(
                { name: 'Node configured', value: String(nodes.length), inline: true },
                { name: 'Players', value: String(playerCount), inline: true },
                { name: 'Prefix', value: getMusicPrefix(), inline: true },
                { name: 'Nodes', value: nodeLines.slice(0, 1000) },
                { name: 'Bot nhạc', value: botLines.slice(0, 1000) }
            )
            .setFooter({ text: 'Không hiển thị password/token trong health check.' })]
    };
}
