import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildMember,
    Message
} from 'discord.js';
import prisma from '../lib/prisma';

const DEFAULT_PREFIX = process.env.MUSIC_PREFIX || 's!';
const MAX_PLAYLIST_TRACKS = 20;
const playCooldown = new Map<string, number>();

type QueueTrack = {
    title: string;
    uri: string;
    requestedBy: string;
};

type GuildQueue = {
    tracks: QueueTrack[];
    paused: boolean;
    loop: boolean;
    volume: number;
};

const queues = new Map<string, GuildQueue>();

function getQueue(guildId: string): GuildQueue {
    let queue = queues.get(guildId);
    if (!queue) {
        queue = { tracks: [], paused: false, loop: false, volume: 75 };
        queues.set(guildId, queue);
    }
    return queue;
}

function isUrl(input: string) {
    return /^https?:\/\//i.test(input);
}

function ensureVoice(member: GuildMember | null) {
    if (!member?.voice?.channelId) throw new Error('Ban can vao voice channel truoc.');
}

function checkPlayCooldown(userId: string) {
    const now = Date.now();
    const until = playCooldown.get(userId) || 0;
    if (until > now) throw new Error(`Cho them ${Math.ceil((until - now) / 1000)}s roi play tiep nhe.`);
    playCooldown.set(userId, now + 5000);
}

function lavalinkConfigured() {
    return Boolean(process.env.LAVALINK_HOST && process.env.LAVALINK_PORT && process.env.LAVALINK_PASSWORD);
}

export function musicPanel(guildId: string) {
    const queue = getQueue(guildId);
    const current = queue.tracks[0];
    const embed = new EmbedBuilder()
        .setColor('#5865f2')
        .setTitle(current ? 'Now Playing' : 'Music Queue')
        .setDescription(current ? `**${current.title}**\n${current.uri}` : 'Queue dang trong.')
        .addFields(
            { name: 'Queue', value: `${Math.max(0, queue.tracks.length - 1)} bai dang cho`, inline: true },
            { name: 'Loop', value: queue.loop ? 'On' : 'Off', inline: true },
            { name: 'Volume', value: `${queue.volume}%`, inline: true }
        )
        .setFooter({ text: lavalinkConfigured() ? 'Lavalink configured' : 'Can cau hinh Lavalink de phat nhac that' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music_pause').setLabel(queue.paused ? 'Resume' : 'Pause').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_skip').setLabel('Skip').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_stop').setLabel('Stop').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('music_loop').setLabel('Loop').setStyle(queue.loop ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_shuffle').setLabel('Shuffle').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}

export async function queueTrack(guildId: string, member: GuildMember | null, userId: string, query: string) {
    ensureVoice(member);
    checkPlayCooldown(userId);

    const queue = getQueue(guildId);
    const track: QueueTrack = {
        title: isUrl(query) ? query : `Search: ${query}`,
        uri: query,
        requestedBy: userId
    };
    queue.tracks.push(track);
    return track;
}

export function controlMusic(guildId: string, action: string) {
    const queue = getQueue(guildId);
    if (action === 'pause') queue.paused = !queue.paused;
    if (action === 'skip') {
        const current = queue.tracks.shift();
        if (queue.loop && current) queue.tracks.push(current);
    }
    if (action === 'stop') queue.tracks = [];
    if (action === 'loop') queue.loop = !queue.loop;
    if (action === 'shuffle') {
        for (let i = queue.tracks.length - 1; i > 1; i--) {
            const j = Math.floor(Math.random() * (i - 1)) + 1;
            [queue.tracks[i], queue.tracks[j]] = [queue.tracks[j], queue.tracks[i]];
        }
    }
    if (action === 'volume_up') queue.volume = Math.min(100, queue.volume + 10);
    if (action === 'volume_down') queue.volume = Math.max(10, queue.volume - 10);
}

export async function addPlaylistTrack(userId: string, title: string, uri: string, source = 'manual', durationMs?: number | null) {
    const count = await prisma.musicPlaylistTrack.count({ where: { userId } });
    if (count >= MAX_PLAYLIST_TRACKS) throw new Error(`Playlist chi luu toi da ${MAX_PLAYLIST_TRACKS} bai.`);
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
    if (!track) throw new Error('Khong tim thay bai trong playlist.');
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

export async function playPlaylist(guildId: string, member: GuildMember | null, userId: string) {
    ensureVoice(member);
    const tracks = await getPlaylist(userId);
    if (!tracks.length) throw new Error('Playlist cua ban dang trong.');
    const queue = getQueue(guildId);
    queue.tracks.push(...tracks.map(track => ({
        title: track.title,
        uri: track.uri,
        requestedBy: userId
    })));
    return tracks.length;
}

export async function handleMusicPrefix(message: Message): Promise<boolean> {
    if (!message.guild || !message.content.startsWith(DEFAULT_PREFIX)) return false;

    const [rawCommand, ...args] = message.content.slice(DEFAULT_PREFIX.length).trim().split(/\s+/);
    const command = rawCommand?.toLowerCase();
    if (!command) return false;

    try {
        if (command === 'play') {
            const query = args.join(' ');
            if (!query) throw new Error(`Dung: ${DEFAULT_PREFIX}play <link/search>`);
            const track = await queueTrack(message.guild.id, message.member, message.author.id, query);
            await message.reply({ content: `Da them vao queue: **${track.title}**${lavalinkConfigured() ? '' : '\nLuu y: can chay Lavalink de phat audio that.'}`, ...musicPanel(message.guild.id) });
            return true;
        }
        if (['queue', 'now'].includes(command)) {
            await message.reply(musicPanel(message.guild.id));
            return true;
        }
        if (['skip', 'stop', 'pause', 'resume', 'loop', 'shuffle'].includes(command)) {
            controlMusic(message.guild.id, command === 'resume' ? 'pause' : command);
            await message.reply(musicPanel(message.guild.id));
            return true;
        }
        if (command === 'volume') {
            const queue = getQueue(message.guild.id);
            const value = Number(args[0]);
            if (!Number.isFinite(value) || value < 10 || value > 100) throw new Error('Volume tu 10 den 100.');
            queue.volume = value;
            await message.reply(musicPanel(message.guild.id));
            return true;
        }
    } catch (error: any) {
        await message.reply(error?.message || 'Da co loi music.').catch(() => {});
        return true;
    }

    return false;
}

export async function executeMusicSlash(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!guildId) return interaction.editReply('Chi dung music trong server.');

    if (sub === 'play') {
        const query = interaction.options.getString('query', true);
        const track = await queueTrack(guildId, interaction.member as GuildMember, interaction.user.id, query);
        return interaction.editReply({ content: `Da them vao queue: **${track.title}**${lavalinkConfigured() ? '' : '\nLuu y: can chay Lavalink de phat audio that.'}`, ...musicPanel(guildId) });
    }

    if (['queue', 'now'].includes(sub)) return interaction.editReply(musicPanel(guildId));

    if (['stop', 'skip', 'pause', 'resume', 'loop', 'shuffle'].includes(sub)) {
        controlMusic(guildId, sub === 'resume' ? 'pause' : sub);
        return interaction.editReply(musicPanel(guildId));
    }

    return null;
}
