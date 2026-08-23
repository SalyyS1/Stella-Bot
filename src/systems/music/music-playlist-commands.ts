import { AutocompleteInteraction, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { buildMusicPanel } from './music-panel';
import { rememberPanelMessage } from './music-panel-message';
import { storeCoverAttachment, validateCoverUrl } from './music-playlist-cover';
import { playlistListEmbed, playlistViewEmbed } from './music-playlist-panel';
import { playStoredPlaylist, savePlayingTrackToPlaylist, trackToPlaylistInput } from './music-playlist-play';
import {
    addTrackToPlaylist,
    copyPlaylistFromShareCode,
    createPlaylist,
    deletePlaylist,
    getPlaylistByName,
    listPlaylists,
    movePlaylistTrack,
    removeTrackFromPlaylist,
    renamePlaylist,
    setPlaylistCover,
    setPlaylistPublic
} from './music-playlist-service';
import { buildRequester, searchWithoutSession } from './music-queue-service';
import { MusicSession } from './music-session-router';

// ============================================================
//  MUSIC PLAYLIST COMMANDS — handler cho nhom /music playlist
// ============================================================

async function replyPanel(interaction: ChatInputCommandInteraction, session: MusicSession, content: string) {
    const payload = await buildMusicPanel(session);
    await interaction.editReply({ content, ...payload });
    const sent = await interaction.fetchReply().catch(() => null);
    rememberPanelMessage(session, sent);
    return null;
}

export async function handleMusicPlaylistSlash(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const member = interaction.member as GuildMember;

    if (sub === 'list') {
        const playlists = await listPlaylists(userId);
        return interaction.editReply({ embeds: [playlistListEmbed(interaction.user, playlists)] });
    }

    if (sub === 'create') {
        const cover = interaction.options.getString('cover');
        const playlist = await createPlaylist(userId, interaction.options.getString('name', true), {
            description: interaction.options.getString('description'),
            coverUrl: cover ? validateCoverUrl(cover) : null
        });
        return interaction.editReply(
            `Đã tạo playlist **${playlist.name}**.\nThêm bài: \`/music playlist add name:${playlist.name} query:<tên bài>\``
        );
    }

    const name = interaction.options.getString('name', true);

    if (sub === 'view') {
        const playlist = await getPlaylistByName(userId, name);
        return interaction.editReply({ embeds: [await playlistViewEmbed(interaction.client, interaction.user, playlist)] });
    }

    if (sub === 'add') {
        const query = interaction.options.getString('query', true);
        const { tracks } = await searchWithoutSession(query, buildRequester(member, userId));
        const saved = await addTrackToPlaylist(userId, name, trackToPlaylistInput(tracks[0]));
        return interaction.editReply(`Đã thêm **${saved.title}** vào **${name}** (vị trí ${saved.position}).`);
    }

    if (sub === 'remove') {
        const result = await removeTrackFromPlaylist(userId, name, interaction.options.getInteger('position', true));
        return interaction.editReply(`Đã xóa **${result.track.title}** khỏi **${result.playlist.name}**.`);
    }

    if (sub === 'move') {
        const from = interaction.options.getInteger('from', true);
        const to = interaction.options.getInteger('to', true);
        await movePlaylistTrack(userId, name, from, to);
        return interaction.editReply(`Đã chuyển bài ở vị trí ${from} sang vị trí ${to} trong **${name}**.`);
    }

    if (sub === 'play') {
        const playlist = await getPlaylistByName(userId, name);
        const result = await playStoredPlaylist(member, interaction.channelId, userId, playlist, {
            shuffle: interaction.options.getBoolean('shuffle') ?? false
        });
        const notes = [
            result.skipped ? `bỏ qua ${result.skipped} bài lỗi` : '',
            result.overflow ? `còn ${result.overflow} bài chưa nạp (giới hạn mỗi lượt)` : ''
        ].filter(Boolean);
        const suffix = notes.length ? ` (${notes.join(', ')})` : '';
        return replyPanel(interaction, result.session, `Đã nạp **${result.queued}** bài từ **${playlist.name}**${suffix}.`);
    }

    if (sub === 'save') {
        if (!interaction.guildId) return interaction.editReply('Chỉ dùng trong server.');
        const saved = await savePlayingTrackToPlaylist(member, interaction.guildId, userId, name);
        return interaction.editReply(`Đã lưu **${saved.title}** vào **${saved.playlistName}** (vị trí ${saved.position}).`);
    }

    if (sub === 'cover') {
        const url = interaction.options.getString('url');
        const file = interaction.options.getAttachment('file');
        if (!url && !file) return interaction.editReply('Cần một trong hai: `url` (link ảnh https) hoặc `file` (ảnh upload).');

        if (url) await setPlaylistCover(userId, name, { coverUrl: validateCoverUrl(url) });
        else {
            const messageId = await storeCoverAttachment(interaction.client, {
                url: file!.url,
                contentType: file!.contentType,
                size: file!.size,
                name: file!.name
            });
            await setPlaylistCover(userId, name, { coverMessageId: messageId });
        }
        return interaction.editReply(`Đã đổi ảnh bìa cho **${name}**. Xem bằng \`/music playlist view name:${name}\`.`);
    }

    if (sub === 'share') {
        const isPublic = interaction.options.getBoolean('public') ?? true;
        const playlist = await setPlaylistPublic(userId, name, isPublic);
        if (!isPublic) return interaction.editReply(`**${playlist.name}** đã chuyển về riêng tư. Mã share cũ không dùng được nữa.`);
        return interaction.editReply(
            `**${playlist.name}** đang công khai.\nMã share: \`${playlist.shareCode}\`\nNgười khác nạp bằng \`/music playlist import code:${playlist.shareCode}\`.`
        );
    }

    if (sub === 'rename') {
        const playlist = await renamePlaylist(userId, name, interaction.options.getString('newname', true));
        return interaction.editReply(`Đã đổi tên playlist thành **${playlist.name}**.`);
    }

    if (sub === 'delete') {
        const playlist = await deletePlaylist(userId, name);
        return interaction.editReply(`Đã xóa playlist **${playlist.name}** và toàn bộ bài trong đó.`);
    }

    return null;
}

/** `import` khong dung option `name` bat buoc nen tach rieng khoi handler tren. */
export async function handleMusicPlaylistImport(interaction: ChatInputCommandInteraction) {
    const result = await copyPlaylistFromShareCode(
        interaction.user.id,
        interaction.options.getString('code', true),
        interaction.options.getString('name')
    );
    const skipped = result.skipped ? ` (bỏ ${result.skipped} bài vượt giới hạn)` : '';
    return interaction.editReply(`Đã copy **${result.copied}** bài vào playlist **${result.created.name}**${skipped}.`);
}

export async function autocompleteMusicPlaylistName(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'name') return interaction.respond([]);

    const playlists = await listPlaylists(interaction.user.id).catch(() => []);
    const query = String(focused.value || '').toLowerCase();
    const choices = playlists
        .filter(playlist => playlist.name.toLowerCase().includes(query))
        .slice(0, 25)
        .map(playlist => ({
            name: `${playlist.name} (${playlist._count?.tracks ?? 0} bài)`.slice(0, 100),
            value: playlist.name
        }));
    return interaction.respond(choices);
}
