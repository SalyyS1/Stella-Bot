import { ButtonInteraction, ChatInputCommandInteraction, GuildMember, MessageFlags, StringSelectMenuInteraction } from 'discord.js';
import { config } from '../../config';
import { safeDeferUpdate, safeInteractionReply } from '../../utils/interaction-safe-reply';
import { applyMusicFilter } from './music-filter-service';
import { asNewMessagePayload, buildMusicPanel, musicHealthPanel, musicPanelForSession, MusicPanelPayload, musicSearchPanel } from './music-panel';
import { rememberPanelMessage } from './music-panel-message';
import { MUSIC_COMPONENT_PREFIX } from './music-panel-components';
import { controlMusic, jumpToQueueIndex, playSearchPick, queueTrack, searchForSelection, setMusicVolume } from './music-queue-service';
import { MusicSession, resolveViewableSession } from './music-session-router';

// ============================================================
//  MUSIC SLASH + COMPONENT HANDLERS
// ============================================================

const CONTROL_SUBCOMMANDS = ['stop', 'skip', 'pause', 'resume', 'loop', 'shuffle'];

/** editReply panel roi nho message do lam panel cua session. */
async function replyPanel(interaction: ChatInputCommandInteraction, session: MusicSession | null, content?: string) {
    const payload = await buildMusicPanel(session);
    await interaction.editReply(content ? { content, ...payload } : payload);
    if (session) {
        const sent = await interaction.fetchReply().catch(() => null);
        rememberPanelMessage(session, sent);
    }
    return null;
}

export async function executeMusicSlash(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!guildId) return interaction.editReply('Chỉ dùng music trong server.');
    const member = interaction.member as GuildMember;

    if (sub === 'play') {
        const query = interaction.options.getString('query', true);
        const track = await queueTrack(member, interaction.channelId, interaction.user.id, query);
        return replyPanel(interaction, track.session, `Đã thêm vào queue: **${track.title}**`);
    }

    if (sub === 'search') {
        const query = interaction.options.getString('query', true);
        const found = await searchForSelection(member, interaction.channelId, interaction.user.id, query);
        return interaction.editReply(musicSearchPanel(query, found.searchId, found.tracks));
    }

    if (['queue', 'now'].includes(sub)) return replyPanel(interaction, resolveViewableSession(member, guildId));
    if (sub === 'health') return interaction.editReply(musicHealthPanel(interaction.client, interaction.memberPermissions?.has('ManageGuild') ?? false));

    if (sub === 'volume') {
        const session = await setMusicVolume(member, interaction.options.getInteger('value', true));
        return replyPanel(interaction, session);
    }

    if (sub === 'filter') {
        const result = await applyMusicFilter(member, interaction.options.getString('preset', true));
        return replyPanel(interaction, result.session, `Đã áp filter: **${result.label}**`);
    }

    if (CONTROL_SUBCOMMANDS.includes(sub)) {
        const session = await controlMusic(member, sub === 'resume' ? 'pause' : sub);
        if (sub === 'stop') return interaction.editReply(musicPanelForSession(null));
        return replyPanel(interaction, session);
    }

    return null;
}

/** Doc action tu custom_id, ho tro ca dang moi "music:x" va dang cu "music_x". */
export function parseMusicComponentAction(customId: string): string | null {
    if (customId.startsWith(MUSIC_COMPONENT_PREFIX)) return customId.slice(MUSIC_COMPONENT_PREFIX.length);
    if (customId.startsWith('music_')) return customId.slice('music_'.length);
    return null;
}

/** Tra ve true neu interaction nay la cua music va da duoc xu ly. */
export async function handleMusicComponent(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<boolean> {
    const action = parseMusicComponentAction(interaction.customId);
    if (!action) return false;

    if (!interaction.guildId) {
        await safeInteractionReply(interaction, { content: 'Chỉ dùng music trong server.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const acknowledged = await safeDeferUpdate(interaction);
    if (!acknowledged) return true;

    try {
        const member = interaction.member as GuildMember;

        // Select menu: chon bai trong queue hoac chon ket qua search.
        if (interaction.isStringSelectMenu()) {
            const value = Number(interaction.values[0]);
            if (action === 'jump') {
                const session = await jumpToQueueIndex(member, value);
                await editWithPanel(interaction, await buildMusicPanel(session), session);
                return true;
            }
            if (action.startsWith('pick:')) {
                const searchId = action.slice('pick:'.length);
                const picked = await playSearchPick(member, interaction.channelId || '', interaction.user.id, searchId, value);
                await editWithPanel(interaction, await buildMusicPanel(picked.session), picked.session);
                return true;
            }
        }

        if (action === 'refresh') {
            const session = resolveViewableSession(member, interaction.guildId);
            await editWithPanel(interaction, await buildMusicPanel(session), session);
            return true;
        }

        const session = await controlMusic(member, action);
        // Update nhe: giu nguyen card cu, chi doi embed + nut.
        const payload = action === 'stop' ? musicPanelForSession(null) : musicPanelForSession(session, { cardAttached: true });
        await interaction.editReply(payload).catch(() => {});
    } catch (error: any) {
        await safeInteractionReply(interaction, {
            content: `${config.ui.emojis.error} ${error?.message || 'Music error.'}`,
            flags: MessageFlags.Ephemeral
        });
    }
    return true;
}

async function editWithPanel(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    payload: MusicPanelPayload,
    session: MusicSession | null
) {
    await interaction.editReply({ content: null, ...payload }).catch(() => {});
    if (session) rememberPanelMessage(session, interaction.message);
}
