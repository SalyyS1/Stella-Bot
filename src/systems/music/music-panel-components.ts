import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { isAutoplayOn } from './music-autoplay';
import { formatDuration, trackInfo, truncate } from './music-format';
import { PANEL_TEXT_LIMITS, PanelLayout } from './music-panel-layout';
import { MusicSession } from './music-session-router';

// ============================================================
//  MUSIC PANEL COMPONENTS — hang nut dieu khien
// ============================================================
// custom_id dung dang "music:<action>" de action co the co dau gach duoi
// (volume_up, seek_back...). Panel cu dung "music_<action>" van duoc
// handleMusicComponent doc, khong can xoa tin nhan panel cu.
//
// Khuon compact (chat trong kenh voice) dung nut CHI CO ICON: cot chat hep lam
// nut co chu bi xuong dong, moi hang nut an het mot khoang cao vo ich.

export const MUSIC_COMPONENT_PREFIX = 'music:';
/** Discord chi cho 25 option moi select menu. */
const MAX_SELECT_OPTIONS = 24;

export type MusicComponentRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

function button(action: string, label: string, style: ButtonStyle, emoji?: string, disabled = false) {
    const builder = new ButtonBuilder()
        .setCustomId(`${MUSIC_COMPONENT_PREFIX}${action}`)
        .setStyle(style)
        .setDisabled(disabled);
    if (label) builder.setLabel(label);
    if (emoji) builder.setEmoji(emoji);
    return builder;
}

function repeatLabel(repeatMode: string) {
    if (repeatMode === 'track') return 'Lặp 1 bài';
    if (repeatMode === 'queue') return 'Lặp queue';
    return 'Lặp';
}

export function musicControlRows(session: MusicSession | null, layout: PanelLayout = 'wide'): MusicComponentRow[] {
    const player = session?.player;
    const idle = !player;
    const repeatMode = String(player?.repeatMode || 'off');
    const looping = repeatMode !== 'off';
    const autoplay = isAutoplayOn(player);
    const compact = layout === 'compact';
    /** Compact bo chu, chi giu icon. */
    const text = (value: string) => (compact ? '' : value);

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('prev', text('Trước'), ButtonStyle.Secondary, '⏮️', idle),
        button('pause', text(player?.paused ? 'Tiếp tục' : 'Tạm dừng'), ButtonStyle.Secondary, player?.paused ? '▶️' : '⏸️', idle),
        button('skip', text('Bài kế'), ButtonStyle.Primary, '⏭️', idle),
        button('stop', text('Dừng'), ButtonStyle.Danger, '⏹️', idle),
        button('loop', text(repeatLabel(repeatMode)), looping ? ButtonStyle.Success : ButtonStyle.Secondary, '🔁', idle)
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('shuffle', text('Trộn'), ButtonStyle.Secondary, '🔀', idle),
        button('volume_down', text('Nhỏ'), ButtonStyle.Secondary, '🔉', idle),
        button('volume_up', text('To'), ButtonStyle.Secondary, '🔊', idle),
        // Compact chi du cho 2 nut nua: uu tien autoplay + luu bai, bo seek va
        // refresh (panel tu ve lai sau moi lan bam nut).
        ...(compact
            ? [
                button('autoplay', '', autoplay ? ButtonStyle.Success : ButtonStyle.Secondary, '📻', idle),
                button('save', '', ButtonStyle.Secondary, '💾', idle)
            ]
            : [
                button('seek_back', '-10s', ButtonStyle.Secondary, '⏪', idle),
                button('seek_forward', '+10s', ButtonStyle.Secondary, '⏩', idle)
            ])
    );

    const rows: MusicComponentRow[] = [row1, row2];

    if (!compact) {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
            button('autoplay', autoplay ? 'Autoplay: bật' : 'Autoplay: tắt', autoplay ? ButtonStyle.Success : ButtonStyle.Secondary, '📻', idle),
            button('save', 'Lưu vào playlist', ButtonStyle.Secondary, '💾', idle),
            button('refresh', 'Làm mới', ButtonStyle.Secondary, '🔄', idle)
        ));
    }

    const jumpRow = queueJumpRow(session, layout);
    if (jumpRow) rows.push(jumpRow);
    return rows;
}

function trackOption(track: any, index: number, position: number, labelMax: number) {
    const info = trackInfo(track);
    const description = [info.author, formatDuration(info.duration, info.isStream)].filter(Boolean).join(' • ');
    return new StringSelectMenuOptionBuilder()
        .setLabel(truncate(`${position}. ${info.title}`, labelMax))
        .setDescription(truncate(description || 'Không rõ thông tin', 100))
        .setValue(String(index));
}

/** Select "chon bai trong queue de phat ngay". Null khi queue trong. */
export function queueJumpRow(session: MusicSession | null, layout: PanelLayout = 'wide'): ActionRowBuilder<StringSelectMenuBuilder> | null {
    const tracks: any[] = session?.player?.queue?.tracks || [];
    if (!tracks.length) return null;

    const labelMax = PANEL_TEXT_LIMITS[layout].selectLabel;
    const options = tracks.slice(0, MAX_SELECT_OPTIONS).map((track, index) => trackOption(track, index, index + 1, labelMax));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${MUSIC_COMPONENT_PREFIX}jump`)
            .setPlaceholder(`Chọn bài để phát ngay (${tracks.length} bài trong queue)`)
            .addOptions(options)
    );
}

/** Select ket qua search: value la index trong cache search. */
export function searchResultRow(searchId: string, tracks: any[], layout: PanelLayout = 'wide'): ActionRowBuilder<StringSelectMenuBuilder> {
    const labelMax = PANEL_TEXT_LIMITS[layout].selectLabel;
    const options = tracks.slice(0, MAX_SELECT_OPTIONS).map((track, index) => trackOption(track, index, index + 1, labelMax));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${MUSIC_COMPONENT_PREFIX}pick:${searchId}`)
            .setPlaceholder('Chọn bài muốn phát')
            .addOptions(options)
    );
}

/**
 * Select chon playlist de luu bai dang phat. Value la TEN playlist (toi da 60
 * ky tu theo config, con xa gioi han 100 ky tu cua Discord).
 */
export function savePlaylistRow(playlists: { name: string; _count?: { tracks: number } }[]): ActionRowBuilder<StringSelectMenuBuilder> {
    const options = playlists.slice(0, MAX_SELECT_OPTIONS).map(playlist => new StringSelectMenuOptionBuilder()
        .setLabel(truncate(playlist.name, 100))
        .setDescription(`${playlist._count?.tracks ?? 0} bài`)
        .setValue(playlist.name.slice(0, 100)));

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${MUSIC_COMPONENT_PREFIX}savepick`)
            .setPlaceholder('Lưu bài đang phát vào playlist nào?')
            .addOptions(options)
    );
}
