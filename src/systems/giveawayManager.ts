import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    Guild,
    Message,
    TextBasedChannel,
    TextChannel,
    User
} from 'discord.js';
import prisma from '../lib/prisma';
import { adjustScoinTx } from './scoinManager';
import { messageLink, sendAdminLog } from '../utils/adminLog';

export const GIVEAWAY_BANNER = 'https://i.pinimg.com/originals/26/7b/1c/267b1c57cc1a1ac4644df3d91d4d377b.gif';

export function parseDuration(input: string): number {
    const match = input.trim().toLowerCase().match(/^(\d+)\s*(m|h|d)$/);
    if (!match) throw new Error('Duration dung dang 10m, 2h hoac 3d.');
    const amount = Number(match[1]);
    const unit = match[2];
    if (amount <= 0) throw new Error('Duration phai lon hon 0.');
    if (unit === 'm') return amount * 60_000;
    if (unit === 'h') return amount * 60 * 60_000;
    return amount * 24 * 60 * 60_000;
}

export function giveawayButtons(id: number, disabled = false) {
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`giveaway_join_${id}`).setLabel('Tham gia').setStyle(ButtonStyle.Success).setEmoji('🎉').setDisabled(disabled),
            new ButtonBuilder().setCustomId(`giveaway_leave_${id}`).setLabel('Roi giveaway').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`giveaway_participants_${id}`).setLabel('Danh sach').setStyle(ButtonStyle.Primary)
        )
    ];
}

export async function buildGiveawayEmbed(giveawayId: number) {
    const giveaway = await prisma.giveaway.findUnique({
        where: { id: giveawayId },
        include: { entries: true }
    });
    if (!giveaway) throw new Error('Giveaway not found.');

    const requirements = [
        giveaway.requiredRoleId ? `Role: <@&${giveaway.requiredRoleId}>` : null,
        giveaway.minLevel ? `Level toi thieu: **${giveaway.minLevel}**` : null,
        giveaway.minScoin ? `Scoin toi thieu: **${giveaway.minScoin.toLocaleString('vi-VN')}**` : null,
        giveaway.entryCost ? `Phi tham gia: **${giveaway.entryCost.toLocaleString('vi-VN')}** Scoin` : 'Mien phi tham gia'
    ].filter(Boolean).join('\n');

    const winners = giveaway.winnerIds ? giveaway.winnerIds.split(',').filter(Boolean).map(id => `<@${id}>`).join(', ') : null;
    const embed = new EmbedBuilder()
        .setColor(giveaway.status === 'ACTIVE' ? '#f1c40f' : giveaway.status === 'CANCELLED' ? '#95a5a6' : '#2ecc71')
        .setTitle(`🎁 ${giveaway.title}`)
        .setDescription(giveaway.description || 'Nhan nut ben duoi de tham gia giveaway.')
        .addFields(
            { name: 'Phan thuong', value: giveaway.prize, inline: false },
            { name: 'Host', value: `<@${giveaway.hostId}>`, inline: true },
            { name: 'Nguoi thang', value: `${giveaway.winnersCount}`, inline: true },
            { name: 'Ket thuc', value: `<t:${Math.floor(giveaway.endsAt.getTime() / 1000)}:R>`, inline: true },
            { name: 'Dieu kien', value: requirements || 'Khong co', inline: false },
            { name: 'Da tham gia', value: `**${giveaway.entries.length.toLocaleString('vi-VN')}** nguoi`, inline: true }
        )
        .setImage(giveaway.publicMediaUrl || giveaway.bannerUrl || GIVEAWAY_BANNER)
        .setFooter({ text: `Giveaway #${giveaway.id} - ${giveaway.status}` })
        .setTimestamp(giveaway.endsAt);

    if (winners) embed.addFields({ name: 'Winner', value: winners, inline: false });
    return { giveaway, embed };
}

async function refreshGiveawayMessage(client: Client, giveawayId: number) {
    const { giveaway, embed } = await buildGiveawayEmbed(giveawayId);
    if (!giveaway.messageId) return;
    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await (channel as TextBasedChannel).messages.fetch(giveaway.messageId).catch(() => null);
    await message?.edit({ embeds: [embed], components: giveawayButtons(giveaway.id, giveaway.status !== 'ACTIVE') }).catch(() => {});
}

export async function createGiveaway(client: Client, options: {
    channel: TextChannel;
    title: string;
    description: string;
    prize: string;
    hostId: string;
    durationMs: number;
    winnersCount: number;
    requiredRoleId?: string | null;
    minLevel?: number | null;
    minScoin?: number | null;
    entryCost?: number;
    rewardType?: string;
    rewardSecret?: string | null;
    publicMediaUrl?: string | null;
    createdBy: string;
}) {
    const giveaway = await prisma.giveaway.create({
        data: {
            channelId: options.channel.id,
            title: options.title,
            description: options.description || 'Nhan nut ben duoi de tham gia giveaway.',
            prize: options.prize,
            hostId: options.hostId,
            winnersCount: Math.max(1, options.winnersCount),
            endsAt: new Date(Date.now() + options.durationMs),
            requiredRoleId: options.requiredRoleId || null,
            minLevel: options.minLevel || null,
            minScoin: options.minScoin || null,
            entryCost: options.entryCost || 0,
            rewardType: options.rewardType || 'contact_host',
            rewardSecret: options.rewardSecret || null,
            publicMediaUrl: options.publicMediaUrl || null,
            bannerUrl: GIVEAWAY_BANNER
        }
    });

    const { embed } = await buildGiveawayEmbed(giveaway.id);
    const message = await options.channel.send({ embeds: [embed], components: giveawayButtons(giveaway.id) }) as Message;
    await prisma.giveaway.update({ where: { id: giveaway.id }, data: { messageId: message.id } });

    await sendAdminLog(client, {
        title: 'Giveaway created',
        color: '#f1c40f',
        fields: [
            { name: 'Creator', value: `<@${options.createdBy}>`, inline: true },
            { name: 'Host', value: `<@${options.hostId}>`, inline: true },
            { name: 'Message', value: messageLink(message.guildId, message.channelId, message.id) }
        ]
    }).catch(() => {});

    return giveaway;
}

async function checkRequirements(guild: Guild, giveaway: any, userId: string): Promise<string | null> {
    const user = await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
    if (giveaway.minLevel && user.level < giveaway.minLevel) return `Ban can dat Level ${giveaway.minLevel}.`;
    if (giveaway.minScoin && user.scoinBalance < giveaway.minScoin) return `Ban can co it nhat ${giveaway.minScoin} Scoin.`;
    if (giveaway.entryCost && user.scoinBalance < giveaway.entryCost) return `Ban can ${giveaway.entryCost} Scoin de tham gia.`;
    if (giveaway.requiredRoleId) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member?.roles.cache.has(giveaway.requiredRoleId)) return `Ban can role <@&${giveaway.requiredRoleId}>.`;
    }
    return null;
}

export async function joinGiveaway(client: Client, guild: Guild, giveawayId: number, userId: string) {
    const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });
    if (!giveaway || giveaway.status !== 'ACTIVE') throw new Error('Giveaway nay da ket thuc.');
    if (giveaway.endsAt.getTime() <= Date.now()) throw new Error('Giveaway nay da het han.');
    const reason = await checkRequirements(guild, giveaway, userId);
    if (reason) throw new Error(reason);

    await prisma.$transaction(async tx => {
        const existing = await tx.giveawayEntry.findUnique({ where: { giveawayId_userId: { giveawayId, userId } } });
        if (existing) return;
        if (giveaway.entryCost > 0) {
            await adjustScoinTx(tx, userId, -giveaway.entryCost, `Join giveaway #${giveawayId}`, 'giveaway:entry', `giveaway:${giveawayId}`);
        }
        await tx.giveawayEntry.create({ data: { giveawayId, userId } });
    });

    await refreshGiveawayMessage(client, giveawayId);
}

export async function leaveGiveaway(client: Client, giveawayId: number, userId: string) {
    const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });
    if (!giveaway || giveaway.status !== 'ACTIVE') throw new Error('Giveaway nay da ket thuc.');

    await prisma.$transaction(async tx => {
        const existing = await tx.giveawayEntry.findUnique({ where: { giveawayId_userId: { giveawayId, userId } } });
        if (!existing) return;
        await tx.giveawayEntry.delete({ where: { id: existing.id } });
        if (giveaway.entryCost > 0) {
            await adjustScoinTx(tx, userId, giveaway.entryCost, `Leave giveaway #${giveawayId}`, 'giveaway:refund', `giveaway:${giveawayId}`);
        }
    });

    await refreshGiveawayMessage(client, giveawayId);
}

function pickWinners(userIds: string[], count: number): string[] {
    const pool = [...new Set(userIds)];
    const winners: string[] = [];
    while (pool.length && winners.length < count) {
        const index = Math.floor(Math.random() * pool.length);
        winners.push(pool.splice(index, 1)[0]);
    }
    return winners;
}

export async function endGiveaway(client: Client, giveawayId: number, reroll = false) {
    const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId }, include: { entries: true } });
    if (!giveaway) throw new Error('Giveaway not found.');
    if (!reroll && giveaway.status !== 'ACTIVE') throw new Error('Giveaway da ket thuc.');

    const guilds = client.guilds.cache;
    const guild = guilds.find(g => !!g.channels.cache.get(giveaway.channelId)) || guilds.first();
    const oldWinners = giveaway.winnerIds?.split(',').filter(Boolean) || [];
    const validEntries: string[] = [];

    if (guild) {
        for (const entry of giveaway.entries) {
            if (oldWinners.includes(entry.userId) && reroll) continue;
            const reason = await checkRequirements(guild, giveaway, entry.userId).catch(() => 'invalid');
            if (!reason) validEntries.push(entry.userId);
        }
    } else {
        validEntries.push(...giveaway.entries.map(e => e.userId).filter(id => !(reroll && oldWinners.includes(id))));
    }

    const winners = pickWinners(validEntries, giveaway.winnersCount);
    const nextWinnerIds = reroll ? [...oldWinners, ...winners].join(',') : winners.join(',');
    await prisma.giveaway.update({
        where: { id: giveawayId },
        data: { status: 'ENDED', winnerIds: nextWinnerIds }
    });

    await refreshGiveawayMessage(client, giveawayId);

    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (channel?.isTextBased()) {
        await (channel as any).send({
            content: winners.length
                ? `🎁 Giveaway **${giveaway.title}** da ket thuc! Winner: ${winners.map(id => `<@${id}>`).join(', ')}`
                : `🎁 Giveaway **${giveaway.title}** da ket thuc nhung khong co winner hop le.`
        }).catch(() => {});
    }

    for (const winnerId of winners) {
        const user = await client.users.fetch(winnerId).catch(() => null) as User | null;
        if (!user) continue;
        try {
            const secret = giveaway.rewardType === 'link' || giveaway.rewardType === 'file'
                ? `Phan thuong cua ban:\n${giveaway.rewardSecret || giveaway.prize}`
                : `Hay lien he host <@${giveaway.hostId}> de nhan phan thuong: **${giveaway.prize}**.`;
            await user.send(`Ban da thang giveaway **${giveaway.title}**!\n${secret}`);
            await prisma.giveawayRewardDelivery.create({ data: { giveawayId, userId: winnerId, status: 'SENT' } });
        } catch (error: any) {
            await prisma.giveawayRewardDelivery.create({ data: { giveawayId, userId: winnerId, status: 'FAILED', error: String(error?.message || error).slice(0, 500) } });
            await sendAdminLog(client, {
                title: 'Giveaway DM failed',
                color: '#e74c3c',
                fields: [
                    { name: 'Giveaway', value: `#${giveawayId}`, inline: true },
                    { name: 'Winner', value: `<@${winnerId}>`, inline: true },
                    { name: 'Error', value: String(error?.message || error).slice(0, 500) }
                ]
            }).catch(() => {});
        }
    }

    return winners;
}

export async function cancelGiveaway(client: Client, giveawayId: number) {
    const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId }, include: { entries: true } });
    if (!giveaway || giveaway.status !== 'ACTIVE') throw new Error('Giveaway khong active.');

    await prisma.$transaction(async tx => {
        await tx.giveaway.update({ where: { id: giveawayId }, data: { status: 'CANCELLED' } });
        if (giveaway.entryCost > 0) {
            for (const entry of giveaway.entries) {
                await adjustScoinTx(tx, entry.userId, giveaway.entryCost, `Cancel giveaway #${giveawayId}`, 'giveaway:refund', `giveaway:${giveawayId}`);
            }
        }
    });
    await refreshGiveawayMessage(client, giveawayId);
}

let giveawayInterval: NodeJS.Timeout | null = null;

export function startGiveawayScheduler(client: Client) {
    if (giveawayInterval) clearInterval(giveawayInterval);
    giveawayInterval = setInterval(async () => {
        const due = await prisma.giveaway.findMany({
            where: { status: 'ACTIVE', endsAt: { lte: new Date() } },
            take: 5
        }).catch(() => []);
        for (const giveaway of due) {
            await endGiveaway(client, giveaway.id).catch(error => console.error('Giveaway auto end failed:', error));
        }
    }, 45_000);
}
