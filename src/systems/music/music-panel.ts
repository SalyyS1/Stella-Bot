import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, Client, EmbedBuilder } from 'discord.js';
import { config } from '../../config';
import { getMainMusicEntry, listMusicEntries } from './music-client-pool';
import { formatDuration, prettySourceName, trackInfo, trackLink, truncate } from './music-format';
import { getLavalinkNodes, getMusicPrefix, lavalinkConfigured } from './music-node-config';
import { NOW_PLAYING_CARD_FILENAME, renderNowPlayingCard } from './music-now-playing-card';
import { MusicComponentRow, musicControlRows, searchResultRow } from './music-panel-components';
import { findPrimarySession, MusicSession } from './music-session-router';

// ============================================================
//  MUSIC PANEL — embed now-playing + queue
// ============================================================
// Phan cong: card anh ganh phan nhin (anh bia, ten bai, tien do, chip trang
// thai), embed chi con link bai bam duoc, mot dong trang thai va danh sach bai
// ke tiep. Khong lap lai thong tin giua hai ben cho panel do roi mat.

export type MusicPanelPayload = {
    embeds: EmbedBuilder[];
    components: MusicComponentRow[];
    files?: AttachmentBuilder[];
    attachments?: any[];
};

function accentColor(sourceName: string) {
    const key = (sourceName || '').toLowerCase();
    return (config.music.accentColors[key] || config.music.accentColors.default) as any;
}

function queueDurationText(tracks: any[]) {
    const total = tracks.reduce((sum, track) => sum + Number(track?.info?.duration || 0), 0);
    if (!total) return '';
    return ` • còn ${formatDuration(total)}`;
}

function loopLabel(repeatMode: string) {
    if (repeatMode === 'track') return '1 bài';
    if (repeatMode === 'queue') return 'Cả queue';
    return 'Tắt';
}

/**
 * Mot dong trang thai gon thay cho 6 field roi rac: card da ve anh bia, tien do
 * va cac chip, nen embed chi con nhiem vu liet ke bai ke tiep + link bai.
 */
function statusLine(session: MusicSession | null, tracks: any[]) {
    const player = session?.player;
    const parts = [
        `Âm lượng **${player?.volume ?? 100}%**`,
        `Lặp **${loopLabel(String(player?.repeatMode || 'off'))}**`,
        `Queue **${tracks.length} bài**${queueDurationText(tracks)}`
    ];
    if (session?.voiceChannelId) parts.push(`<#${session.voiceChannelId}>`);
    if (session && listMusicEntries().length > 1) parts.push(session.entry.label);
    return parts.join(' • ');
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
    embed
        .setColor(accentColor(info.sourceName))
        .setDescription(`${player?.paused ? '⏸' : '▶'} ${trackLink(current)}\n${statusLine(session, tracks)}`);

    if (tracks.length) {
        const preview = tracks.slice(0, 3).map((track, index) => {
            const next = trackInfo(track);
            return `\`${index + 1}.\` ${truncate(next.title, 58)} \`${formatDuration(next.duration, next.isStream)}\``;
        });
        if (tracks.length > 3) preview.push(`_…và ${tracks.length - 3} bài nữa_`);
        embed.addFields({ name: 'Bài kế tiếp', value: preview.join('\n').slice(0, 1000) });
    }

    embed.setFooter({ text: lavalinkConfigured() ? 'Lavalink playback' : 'Cần cấu hình Lavalink để phát audio' });
    if (options.cardAttached) embed.setImage(`attachment://${NOW_PLAYING_CARD_FILENAME}`);
    return { embeds: [embed], components: musicControlRows(session) };
}

/**
 * Panel day du: render card anh moi. Dung khi doi bai, khi tra ket qua play,
 * hoac khi nguoi dung bam nut dieu khien (nut doi volume/pause/loop nen card
 * phai ve lai, khong thi card noi nguoc voi embed). Card loi thi tu dong tra
 * panel khong anh.
 */
export async function buildMusicPanel(session: MusicSession | null): Promise<MusicPanelPayload> {
    const current = session?.player?.queue?.current;
    if (!session || !current) return musicPanelForSession(session);

    const info = trackInfo(current);
    const entries = listMusicEntries();
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
        cacheKey: info.identifier || info.uri || info.title,
        volume: Number(session.player.volume ?? 100),
        queueCount: (session.player.queue?.tracks || []).length,
        loopLabel: loopLabel(String(session.player.repeatMode || 'off')),
        speakerLabel: entries.length > 1 ? session.entry.label : ''
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
    // Chi in 10 dong: select menu ben duoi van giu du 24 ket qua, in het ra
    // embed thi panel dai loang thoang chang ai doc.
    const listed = tracks.slice(0, 10);
    const lines = listed.map((track, index) => {
        const info = trackInfo(track);
        const meta = [info.author, prettySourceName(info.sourceName)].filter(Boolean).join(' • ');
        return `**${index + 1}.** ${truncate(info.title, 62)} \`${formatDuration(info.duration, info.isStream)}\`${meta ? `\n ${truncate(meta, 64)}` : ''}`;
    });
    const rest = tracks.length - listed.length;

    const embed = new EmbedBuilder()
        .setColor(accentColor(trackInfo(tracks[0]).sourceName))
        .setTitle(`Kết quả cho “${truncate(query, 70)}”`)
        .setDescription(`${lines.join('\n')}${rest > 0 ? `\n\n_Còn ${rest} kết quả nữa trong menu bên dưới._` : ''}`.slice(0, 4000))
        .setThumbnail(config.music.panelGif)
        .setFooter({ text: 'Chọn một bài ở menu bên dưới • kết quả hết hạn sau 5 phút' });

    return { embeds: [embed], components: [searchResultRow(searchId, tracks)] };
}

/** Source quan trong nhat khi debug: thieu source nao thi link do bao loi. */
const WATCHED_SOURCES = ['youtube', 'spotify', 'soundcloud', 'applemusic', 'deezer', 'http'];

/**
 * Doc info that tu node dang ket noi. `/music health` phai tra loi duoc cau
 * "vi sao link Spotify bao khong duoc" — cau tra loi nam o day.
 */
function liveNodeLines(revealNodeAddresses: boolean) {
    const nodes: any[] = [...(getMainMusicEntry()?.lavalink?.nodeManager?.nodes?.values?.() ?? [])];
    if (!nodes.length) return { nodeLines: '', sourceLines: '' };

    const nodeLines = nodes.map(node => {
        const where = revealNodeAddresses ? ` - ${node.options?.host}:${node.options?.port}` : '';
        return `**${node.id}**${where} - ${node.connected ? 'đã kết nối' : 'chưa kết nối'}`;
    }).join('\n');

    const sourceLines = nodes.map(node => {
        const managers: string[] = node.info?.sourceManagers || [];
        if (!managers.length) return `**${node.id}**: chưa lấy được info từ node.`;
        const marks = WATCHED_SOURCES.map(source => `${managers.includes(source) ? '✅' : '❌'} ${source}`).join(' • ');
        const plugins = (node.info?.plugins || []).map((plugin: any) => `${plugin.name} ${plugin.version}`).join(', ');
        return `**${node.id}**\n${marks}${plugins ? `\nPlugin: ${plugins}` : ''}`;
    }).join('\n\n');

    return { nodeLines, sourceLines };
}

export function musicHealthPanel(client: Client, revealNodeAddresses = false) {
    const nodes = getLavalinkNodes();
    const entries = listMusicEntries();
    const live = liveNodeLines(revealNodeAddresses);
    const nodeLines = live.nodeLines || (nodes.length
        ? nodes.map(node => revealNodeAddresses ? `**${node.id}** - ${node.host}:${node.port}${node.secure ? ' TLS' : ''}` : `**${node.id}** - đã cấu hình, chưa kết nối`).join('\n')
        : 'Chưa cấu hình node Lavalink.');
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

    const embed = new EmbedBuilder()
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
        .setFooter({ text: 'Không hiển thị password/token trong health check.' });

    if (live.sourceLines) {
        embed.addFields({ name: 'Source node đang bật', value: live.sourceLines.slice(0, 1000) });
    }

    return { embeds: [embed] };
}
