import { Message } from 'discord.js';
import { applyMusicFilter } from './music-filter-service';
import { getMusicPrefix } from './music-node-config';
import { asNewMessagePayload, buildMusicPanel, musicHealthPanel, musicPanelForSession, musicSearchPanel } from './music-panel';
import { resolvePanelLayout } from './music-panel-layout';
import { rememberPanelMessage } from './music-panel-message';
import { playStoredPlaylist, savePlayingTrackToPlaylist } from './music-playlist-play';
import { getPlaylistByName } from './music-playlist-service';
import { controlMusic, queueTrack, searchForSelection, setMusicVolume } from './music-queue-service';
import { MusicSession, resolveViewableSession } from './music-session-router';

// ============================================================
//  MUSIC PREFIX COMMANDS — s!play, s!skip, s!volume...
// ============================================================
// Playlist chi co 2 shortcut prefix (phat + luu bai dang phat). Phan tao/sua/
// anh bia/share nam o slash vi can autocomplete va upload file.

const CONTROL_COMMANDS = ['skip', 'stop', 'pause', 'resume', 'loop', 'shuffle', 'prev', 'back', 'autoplay'];

/** Ten lenh nguoi dung go -> action cua controlMusic. */
function controlAction(command: string) {
    if (command === 'resume') return 'pause';
    if (command === 'back') return 'prev';
    return command;
}

/** Gui panel moi va nho lai de trackStart tu update card sau nay. */
async function replyWithPanel(message: Message, session: MusicSession | null, content?: string) {
    const payload = asNewMessagePayload(await buildMusicPanel(session));
    const sent = await message.reply(content ? { content, ...payload } : payload);
    if (session) rememberPanelMessage(session, sent);
}

export async function handleMusicPrefix(message: Message): Promise<boolean> {
    const prefix = getMusicPrefix();
    if (!message.guild || !message.content.startsWith(prefix)) return false;

    const [rawCommand, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);
    const command = rawCommand?.toLowerCase();
    if (!command) return false;

    try {
        if (command === 'play') {
            const query = args.join(' ');
            if (!query) throw new Error(`Dùng: ${prefix}play <link/search>`);
            const track = await queueTrack(message.member, message.channelId, message.author.id, query);
            await replyWithPanel(message, track.session, `Đã thêm vào queue: **${track.title}**`);
            return true;
        }
        if (command === 'search') {
            const query = args.join(' ');
            if (!query) throw new Error(`Dùng: ${prefix}search <tên bài>`);
            const found = await searchForSelection(message.member, message.channelId, message.author.id, query);
            await message.reply(asNewMessagePayload(musicSearchPanel(query, found.searchId, found.tracks, resolvePanelLayout(message.channelId))));
            return true;
        }
        if (['pl', 'playlist'].includes(command)) {
            const name = args.join(' ');
            if (!name) throw new Error(`Dùng: ${prefix}pl <tên playlist>`);
            const playlist = await getPlaylistByName(message.author.id, name);
            const result = await playStoredPlaylist(message.member, message.channelId, message.author.id, playlist);
            const skipped = result.skipped ? ` (bỏ qua ${result.skipped} bài lỗi)` : '';
            await replyWithPanel(message, result.session, `Đã nạp **${result.queued}** bài từ **${playlist.name}**${skipped}.`);
            return true;
        }
        if (command === 'save') {
            const name = args.join(' ');
            if (!name) throw new Error(`Dùng: ${prefix}save <tên playlist>`);
            const saved = await savePlayingTrackToPlaylist(message.member, message.guild.id, message.author.id, name);
            await message.reply(`Đã lưu **${saved.title}** vào **${saved.playlistName}** (vị trí ${saved.position}).`);
            return true;
        }
        if (['queue', 'now'].includes(command)) {
            await replyWithPanel(message, resolveViewableSession(message.member, message.guild.id));
            return true;
        }
        if (['health', 'status'].includes(command)) {
            await message.reply(musicHealthPanel(message.client, message.member?.permissions.has('ManageGuild') ?? false));
            return true;
        }
        if (CONTROL_COMMANDS.includes(command)) {
            const session = await controlMusic(message.member, controlAction(command));
            if (command === 'stop') await message.reply(asNewMessagePayload(musicPanelForSession(null, { layout: resolvePanelLayout(message.channelId) })));
            else await replyWithPanel(message, session);
            return true;
        }
        if (command === 'volume') {
            const session = await setMusicVolume(message.member, Number(args[0]));
            await replyWithPanel(message, session);
            return true;
        }
        if (command === 'filter') {
            const result = await applyMusicFilter(message.member, (args[0] || '').toLowerCase());
            await replyWithPanel(message, result.session, `Đã áp filter: **${result.label}**`);
            return true;
        }
    } catch (error: any) {
        await message.reply(error?.message || 'Đã có lỗi music.').catch(() => {});
        return true;
    }

    return false;
}
