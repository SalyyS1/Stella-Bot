import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { formatDuration, trackInfo, truncate } from './music-format';
import { MusicSession } from './music-session-router';

// ============================================================
//  MUSIC PANEL COMPONENTS — hang nut dieu khien
// ============================================================
// custom_id dung dang "music:<action>" de action co the co dau gach duoi
// (volume_up, seek_back...). Panel cu dung "music_<action>" van duoc
// handleMusicComponent doc, khong can xoa tin nhan panel cu.

export const MUSIC_COMPONENT_PREFIX = 'music:';
/** Discord chi cho 25 option moi select menu. */
const MAX_SELECT_OPTIONS = 24;

export type MusicComponentRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

function button(action: string, label: string, style: ButtonStyle, emoji?: string, disabled = false) {
    const builder = new ButtonBuilder()
        .setCustomId(`${MUSIC_COMPONENT_PREFIX}${action}`)
        .setLabel(label)
        .setStyle(style)
        .setDisabled(disabled);
    if (emoji) builder.setEmoji(emoji);
    return builder;
}

function repeatLabel(repeatMode: string) {
    if (repeatMode === 'track') return 'Lặp 1 bài';
    if (repeatMode === 'queue') return 'Lặp queue';
    return 'Lặp';
}

export function musicControlRows(session: MusicSession | null): MusicComponentRow[] {
    const player = session?.player;
    const idle = !player;
    const repeatMode = String(player?.repeatMode || 'off');
    const looping = repeatMode !== 'off';

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('pause', player?.paused ? 'Tiếp tục' : 'Tạm dừng', ButtonStyle.Secondary, player?.paused ? '▶️' : '⏸️', idle),
        button('skip', 'Bài kế', ButtonStyle.Primary, '⏭️', idle),
        button('stop', 'Dừng', ButtonStyle.Danger, '⏹️', idle),
        button('loop', repeatLabel(repeatMode), looping ? ButtonStyle.Success : ButtonStyle.Secondary, '🔁', idle),
        button('shuffle', 'Trộn', ButtonStyle.Secondary, '🔀', idle)
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('volume_down', 'Nhỏ', ButtonStyle.Secondary, '🔉', idle),
        button('volume_up', 'To', ButtonStyle.Secondary, '🔊', idle),
        button('seek_back', '-10s', ButtonStyle.Secondary, '⏪', idle),
        button('seek_forward', '+10s', ButtonStyle.Secondary, '⏩', idle),
        button('refresh', 'Làm mới', ButtonStyle.Secondary, '🔄', idle)
    );

    const rows: MusicComponentRow[] = [row1, row2];
    const jumpRow = queueJumpRow(session);
    if (jumpRow) rows.push(jumpRow);
    return rows;
}

function trackOption(track: any, index: number, position: number) {
    const info = trackInfo(track);
    const description = [info.author, formatDuration(info.duration, info.isStream)].filter(Boolean).join(' • ');
    return new StringSelectMenuOptionBuilder()
        .setLabel(truncate(`${position}. ${info.title}`, 100))
        .setDescription(truncate(description || 'Không rõ thông tin', 100))
        .setValue(String(index));
}

/** Select "chon bai trong queue de phat ngay". Null khi queue trong. */
export function queueJumpRow(session: MusicSession | null): ActionRowBuilder<StringSelectMenuBuilder> | null {
    const tracks: any[] = session?.player?.queue?.tracks || [];
    if (!tracks.length) return null;

    const options = tracks.slice(0, MAX_SELECT_OPTIONS).map((track, index) => trackOption(track, index, index + 1));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${MUSIC_COMPONENT_PREFIX}jump`)
            .setPlaceholder(`Chọn bài để phát ngay (${tracks.length} bài trong queue)`)
            .addOptions(options)
    );
}

/** Select ket qua search: value la index trong cache search. */
export function searchResultRow(searchId: string, tracks: any[]): ActionRowBuilder<StringSelectMenuBuilder> {
    const options = tracks.slice(0, MAX_SELECT_OPTIONS).map((track, index) => trackOption(track, index, index + 1));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${MUSIC_COMPONENT_PREFIX}pick:${searchId}`)
            .setPlaceholder('Chọn bài muốn phát')
            .addOptions(options)
    );
}
