import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    Client,
    EmbedBuilder,
    GuildMember,
    Message,
    PermissionFlagsBits
} from 'discord.js';
import { LavalinkManager } from 'lavalink-client';
import prisma from '../lib/prisma';

const DEFAULT_PREFIX = process.env.MUSIC_PREFIX || 's!';
const MAX_PLAYLIST_TRACKS = 20;
const playCooldown = new Map<string, number>();

type LavalinkNodeConfig = {
    id: string;
    host: string;
    port: number;
    authorization: string;
    secure: boolean;
};

function isUrl(input: string) {
    return /^https?:\/\//i.test(input);
}

function ensureVoice(member: GuildMember | null) {
    const channel = member?.voice?.channel;
    if (!channel) throw new Error('Bạn cần vào voice channel trước.');
    const me = member.guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
        throw new Error('Stella không có quyền Connect/Speak trong voice channel này.');
    }
}

function getControllablePlayer(client: Client, guildId: string, member: GuildMember | null) {
    const player = getPlayer(client, guildId);
    if (!player) throw new Error('Không có player đang chạy.');
    ensureVoice(member);
    if (member!.voice.channelId !== player.voiceChannelId) {
        throw new Error('Bạn cần ở cùng voice channel với Stella để điều khiển nhạc.');
    }
    return player;
}

function checkPlayCooldown(userId: string) {
    const now = Date.now();
    for (const [id, expiresAt] of playCooldown) {
        if (expiresAt <= now) playCooldown.delete(id);
    }
    const until = playCooldown.get(userId) || 0;
    if (until > now) throw new Error(`Chờ thêm ${Math.ceil((until - now) / 1000)}s rồi play tiếp nhé.`);
    playCooldown.set(userId, now + 5000);
}

function parseBoolean(value: unknown, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function normalizeNode(node: any, index: number): LavalinkNodeConfig | null {
    if (!node || typeof node !== 'object') return null;
    const host = String(node.host || '').trim();
    const authorization = String(node.authorization || node.password || '').trim();
    const port = Number(node.port || (parseBoolean(node.secure) ? 443 : 2333));
    if (!host || !authorization || !Number.isFinite(port)) return null;

    return {
        id: String(node.id || `Stella Node ${index + 1}`),
        host,
        port,
        authorization,
        secure: parseBoolean(node.secure, port === 443)
    };
}

function getLavalinkNodes(): LavalinkNodeConfig[] {
    const rawNodes = process.env.LAVALINK_NODES?.trim();
    if (rawNodes) {
        try {
            const parsed = JSON.parse(rawNodes);
            const list = Array.isArray(parsed) ? parsed : [parsed];
            return list.map((node, index) => normalizeNode(node, index)).filter(Boolean) as LavalinkNodeConfig[];
        } catch {
            console.warn('LAVALINK_NODES is not valid JSON. Falling back to LAVALINK_HOST/LAVALINK_PORT.');
        }
    }

    const node = normalizeNode({
        id: process.env.LAVALINK_NODE_ID || 'Stella Main',
        host: process.env.LAVALINK_HOST,
        port: process.env.LAVALINK_PORT,
        authorization: process.env.LAVALINK_PASSWORD,
        secure: process.env.LAVALINK_SECURE
    }, 0);
    return node ? [node] : [];
}

function lavalinkConfigured() {
    return getLavalinkNodes().length > 0;
}

function getLavalink(client: Client): any {
    return (client as any).lavalink;
}

function getPlayer(client: Client, guildId: string): any | null {
    return getLavalink(client)?.getPlayer(guildId) || null;
}

export function setupLavalink(client: Client) {
    const nodes = getLavalinkNodes();
    if (!nodes.length) {
        console.warn('Lavalink env is missing. Music playback is disabled.');
        return;
    }
    if (getLavalink(client)) return;

    (client as any).lavalink = new LavalinkManager({
        nodes,
        sendToShard: (guildId: string, payload: any) => client.guilds.cache.get(guildId)?.shard?.send(payload),
        autoSkip: true,
        client: {
            id: process.env.CLIENT_ID || client.user?.id || '',
            username: client.user?.username || 'Stella'
        },
        playerOptions: {
            defaultSearchPlatform: 'ytmsearch',
            volumeDecrementer: 0.75,
            onEmptyQueue: { destroyAfterMs: 30_000 },
            onDisconnect: { autoReconnect: true, destroyPlayer: false }
        }
    });

    const lavalink = getLavalink(client);
    console.log(`[Lavalink] Configured ${nodes.length} node(s): ${nodes.map(node => `${node.id}@${node.host}:${node.port}${node.secure ? ' secure' : ''}`).join(', ')}`);
    lavalink.nodeManager.on('connect', (node: any) => console.log(`[Lavalink] Node connected: ${node.id}`));
    lavalink.nodeManager.on('error', (node: any, error: any) => console.error(`[Lavalink] Node error ${node?.id}:`, error?.message || error));
    lavalink.on('queueEnd', async (player: any) => {
        const channel = client.channels.cache.get(player.textChannelId) as any;
        await channel?.send('Queue đã hết, Stella sẽ rời voice nếu không có bài mới.').catch(() => {});
    });
}

export function musicHealthPanel(client: Client, revealNodeAddresses = false) {
    const nodes = getLavalinkNodes();
    const lavalink = getLavalink(client);
    const nodeLines = nodes.length
        ? nodes.map(node => revealNodeAddresses ? `**${node.id}** - ${node.host}:${node.port}${node.secure ? ' TLS' : ''}` : `**${node.id}** - configured`).join('\n')
        : 'Chưa cấu hình node Lavalink.';
    const playerCount = lavalink?.players?.size ?? lavalink?.playerManager?.players?.size ?? lavalink?.players?.cache?.size ?? 0;

    return {
        embeds: [new EmbedBuilder()
            .setColor(nodes.length && lavalink ? '#2ecc71' : '#e67e22')
            .setTitle('Music Health')
            .setDescription(lavalink ? 'Music manager đã khởi tạo.' : 'Music manager chưa khởi tạo hoặc thiếu Lavalink env.')
            .addFields(
                { name: 'Node configured', value: String(nodes.length), inline: true },
                { name: 'Players', value: String(playerCount), inline: true },
                { name: 'Prefix', value: DEFAULT_PREFIX, inline: true },
                { name: 'Nodes', value: nodeLines.slice(0, 1000) }
            )
            .setFooter({ text: 'Không hiển thị password/token trong health check.' })]
    };
}

export function initLavalink(client: Client) {
    const lavalink = getLavalink(client);
    if (!lavalink || !client.user) return;
    lavalink.init({ id: client.user.id, username: client.user.username });
}

export function sendLavalinkRaw(client: Client, payload: any) {
    getLavalink(client)?.sendRawData(payload);
}

export function musicPanel(client: Client, guildId: string) {
    const player = getPlayer(client, guildId);
    const current = player?.queue?.current;
    const tracks = player?.queue?.tracks || [];
    const embed = new EmbedBuilder()
        .setColor('#5865f2')
        .setTitle(current ? 'Now Playing' : 'Music Queue')
        .setDescription(current ? `**${current.info?.title || current.title}**\n${current.info?.uri || current.uri || ''}` : 'Queue đang trống.')
        .addFields(
            { name: 'Queue', value: `${tracks.length || 0} bài đang chờ`, inline: true },
            { name: 'Loop', value: player?.repeatMode && player.repeatMode !== 'off' ? player.repeatMode : 'Off', inline: true },
            { name: 'Volume', value: `${player?.volume ?? 75}%`, inline: true }
        )
        .setFooter({ text: lavalinkConfigured() ? 'Lavalink playback' : 'Cần cấu hình Lavalink để phát audio' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music_pause').setLabel(player?.paused ? 'Resume' : 'Pause').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_skip').setLabel('Skip').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_stop').setLabel('Stop').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('music_loop').setLabel(player?.repeatMode && player.repeatMode !== 'off' ? 'Loop On' : 'Loop').setStyle(player?.repeatMode && player.repeatMode !== 'off' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_shuffle').setLabel('Shuffle').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}

export async function queueTrack(client: Client, guildId: string, textChannelId: string, member: GuildMember | null, userId: string, query: string) {
    if (!lavalinkConfigured() || !getLavalink(client)) {
        throw new Error('Music chưa được cấu hình Lavalink. Hãy chạy Lavalink và điền LAVALINK_* trong .env.');
    }
    ensureVoice(member);
    checkPlayCooldown(userId);

    const existingPlayer = getPlayer(client, guildId);
    if (existingPlayer && existingPlayer.voiceChannelId !== member!.voice.channelId) {
        throw new Error('Stella đang phát nhạc ở voice channel khác. Hãy vào cùng channel để thêm bài.');
    }
    const player = getLavalink(client).createPlayer({
        guildId,
        voiceChannelId: member!.voice.channelId!,
        textChannelId,
        selfDeaf: true,
        selfMute: false,
        volume: 75
    });

    await player.connect();
    const searchQuery = isUrl(query) ? query : { query, source: 'ytmsearch' };
    const result = await player.search(searchQuery, { id: userId }, true);
    const tracks = (result.tracks || []).filter((track: any) => getLavalink(client).utils.isNotBrokenTrack(track));
    if (!tracks.length) throw new Error('Không tìm thấy bài hợp lệ.');

    if (result.loadType === 'playlist') await player.queue.add(tracks);
    else await player.queue.add(tracks[0]);

    if (!player.playing && !player.paused) await player.play();
    return {
        title: result.loadType === 'playlist' ? `${tracks.length} bài từ playlist` : tracks[0].info.title,
        uri: result.loadType === 'playlist' ? query : tracks[0].info.uri,
        count: tracks.length,
        playlist: result.loadType === 'playlist'
    };
}

export async function controlMusic(client: Client, guildId: string, member: GuildMember | null, action: string) {
    const player = getControllablePlayer(client, guildId, member);

    if (action === 'pause') {
        if (player.paused) await player.resume();
        else await player.pause();
    }
    if (action === 'skip') await player.skip(0, false);
    if (action === 'stop') {
        await player.stopPlaying(true, false);
        await player.destroy('Stopped by user').catch(() => {});
    }
    if (action === 'loop') await player.setRepeatMode(player.repeatMode === 'off' ? 'queue' : 'off');
    if (action === 'shuffle') await player.queue.shuffle();
    if (action === 'volume_up') await player.setVolume(Math.min(100, (player.volume || 75) + 10));
    if (action === 'volume_down') await player.setVolume(Math.max(10, (player.volume || 75) - 10));
}

export async function addPlaylistTrack(userId: string, title: string, uri: string, source = 'manual', durationMs?: number | null) {
    const count = await prisma.musicPlaylistTrack.count({ where: { userId } });
    if (count >= MAX_PLAYLIST_TRACKS) throw new Error(`Playlist chỉ lưu tối đa ${MAX_PLAYLIST_TRACKS} bài.`);
    await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
    return prisma.musicPlaylistTrack.create({
        data: {
            userId,
            position: count + 1,
            title,
            uri,
            source,
            duration: durationMs || null
        }
    });
}

export async function removePlaylistTrack(userId: string, position: number) {
    const track = await prisma.musicPlaylistTrack.findUnique({ where: { userId_position: { userId, position } } });
    if (!track) throw new Error('Không tìm thấy bài trong playlist.');
    await prisma.$transaction(async tx => {
        await tx.musicPlaylistTrack.delete({ where: { id: track.id } });
        const rest = await tx.musicPlaylistTrack.findMany({ where: { userId, position: { gt: position } }, orderBy: { position: 'asc' } });
        for (const item of rest) {
            await tx.musicPlaylistTrack.update({ where: { id: item.id }, data: { position: item.position - 1 } });
        }
    });
}

export async function clearPlaylist(userId: string) {
    await prisma.musicPlaylistTrack.deleteMany({ where: { userId } });
}

export async function getPlaylist(userId: string) {
    return prisma.musicPlaylistTrack.findMany({ where: { userId }, orderBy: { position: 'asc' } });
}

export async function playPlaylist(client: Client, guildId: string, textChannelId: string, member: GuildMember | null, userId: string) {
    if (!lavalinkConfigured() || !getLavalink(client)) {
        throw new Error('Music chưa được cấu hình Lavalink. Hãy cấu hình Lavalink remote/local trong .env.');
    }
    ensureVoice(member);
    const tracks = await getPlaylist(userId);
    if (!tracks.length) throw new Error('Playlist của bạn đang trống.');
    checkPlayCooldown(userId);

    const existingPlayer = getPlayer(client, guildId);
    if (existingPlayer && existingPlayer.voiceChannelId !== member!.voice.channelId) {
        throw new Error('Stella đang phát nhạc ở voice channel khác. Hãy vào cùng channel để thêm bài.');
    }
    const player = getLavalink(client).createPlayer({
        guildId,
        voiceChannelId: member!.voice.channelId!,
        textChannelId,
        selfDeaf: true,
        selfMute: false,
        volume: 75
    });
    await player.connect();

    let queued = 0;
    let skipped = 0;
    for (const track of tracks) {
        try {
            const result = await player.search(isUrl(track.uri) ? track.uri : { query: track.uri, source: 'ytmsearch' }, { id: userId }, true);
            const playable = (result.tracks || []).filter((candidate: any) => getLavalink(client).utils.isNotBrokenTrack(candidate));
            if (!playable.length) throw new Error('No playable track');
            if (result.loadType === 'playlist') {
                await player.queue.add(playable);
                queued += playable.length;
            } else {
                await player.queue.add(playable[0]);
                queued++;
            }
        } catch {
            skipped++;
        }
    }
    if (!queued) throw new Error('Không có bài nào trong playlist còn phát được.');
    if (!player.playing && !player.paused) await player.play();
    return { queued, skipped };
}

export async function handleMusicPrefix(message: Message): Promise<boolean> {
    if (!message.guild || !message.content.startsWith(DEFAULT_PREFIX)) return false;

    const [rawCommand, ...args] = message.content.slice(DEFAULT_PREFIX.length).trim().split(/\s+/);
    const command = rawCommand?.toLowerCase();
    if (!command) return false;

    try {
        if (command === 'play') {
            const query = args.join(' ');
            if (!query) throw new Error(`Dùng: ${DEFAULT_PREFIX}play <link/search>`);
            const track = await queueTrack(message.client, message.guild.id, message.channelId, message.member, message.author.id, query);
            await message.reply({ content: `Đã thêm vào queue: **${track.title}**`, ...musicPanel(message.client, message.guild.id) });
            return true;
        }
        if (['queue', 'now'].includes(command)) {
            await message.reply(musicPanel(message.client, message.guild.id));
            return true;
        }
        if (['health', 'status'].includes(command)) {
            await message.reply(musicHealthPanel(message.client, message.member?.permissions.has('ManageGuild') ?? false));
            return true;
        }
        if (['skip', 'stop', 'pause', 'resume', 'loop', 'shuffle'].includes(command)) {
            await controlMusic(message.client, message.guild.id, message.member, command === 'resume' ? 'pause' : command);
            await message.reply(musicPanel(message.client, message.guild.id));
            return true;
        }
        if (command === 'volume') {
            const player = getControllablePlayer(message.client, message.guild.id, message.member);
            const value = Number(args[0]);
            if (!Number.isFinite(value) || value < 10 || value > 100) throw new Error('Volume từ 10 đến 100.');
            await player.setVolume(value);
            await message.reply(musicPanel(message.client, message.guild.id));
            return true;
        }
    } catch (error: any) {
        await message.reply(error?.message || 'Đã có lỗi music.').catch(() => {});
        return true;
    }

    return false;
}

export async function executeMusicSlash(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!guildId) return interaction.editReply('Chỉ dùng music trong server.');

    if (sub === 'play') {
        const query = interaction.options.getString('query', true);
        const track = await queueTrack(interaction.client, guildId, interaction.channelId, interaction.member as GuildMember, interaction.user.id, query);
        return interaction.editReply({ content: `Đã thêm vào queue: **${track.title}**`, ...musicPanel(interaction.client, guildId) });
    }

    if (['queue', 'now'].includes(sub)) return interaction.editReply(musicPanel(interaction.client, guildId));
    if (sub === 'health') return interaction.editReply(musicHealthPanel(interaction.client, interaction.memberPermissions?.has('ManageGuild') ?? false));

    if (['stop', 'skip', 'pause', 'resume', 'loop', 'shuffle'].includes(sub)) {
        await controlMusic(interaction.client, guildId, interaction.member as GuildMember, sub === 'resume' ? 'pause' : sub);
        return interaction.editReply(musicPanel(interaction.client, guildId));
    }

    return null;
}
