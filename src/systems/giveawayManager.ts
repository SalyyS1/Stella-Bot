import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    Guild,
    Message,
    PermissionFlagsBits,
    TextBasedChannel,
    TextChannel,
    User
} from 'discord.js';
import prisma from '../lib/prisma';
import { adjustScoinTx } from './scoinManager';
import { messageLink, sendAdminLog } from '../utils/adminLog';
import { config } from '../config';

export const GIVEAWAY_BANNER = 'https://i.pinimg.com/originals/26/7b/1c/267b1c57cc1a1ac4644df3d91d4d377b.gif';

export function parseDuration(input: string): number {
    const match = input.trim().toLowerCase().match(/^(\d+)\s*(m|h|d)$/);
    if (!match) throw new Error('Thời lượng đúng dạng 10m, 2h hoặc 3d.');
    const amount = Number(match[1]);
    const unit = match[2];
    if (amount <= 0) throw new Error('Thời lượng phải lớn hơn 0.');
    if (unit === 'm') return amount * 60_000;
    if (unit === 'h') return amount * 60 * 60_000;
    return amount * 24 * 60 * 60_000;
}

export function giveawayButtons(id: number, disabled = false) {
    const emojis = config.ui.emojis;
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`giveaway_join_${id}`).setLabel('Tham gia').setStyle(ButtonStyle.Success).setEmoji(emojis.success).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`giveaway_leave_${id}`).setLabel('Rời').setStyle(ButtonStyle.Secondary).setEmoji(emojis.error).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`giveaway_participants_${id}`).setLabel('Người tham gia').setStyle(ButtonStyle.Primary).setEmoji(emojis.note)
        )
    ];
}

export async function buildGiveawayEmbed(giveawayId: number) {
    const giveaway = await prisma.giveaway.findUnique({
        where: { id: giveawayId },
        include: { entries: true }
    });
    if (!giveaway) throw new Error('Không tìm thấy giveaway.');

    const emojis = config.ui.emojis;
    const requirements = [
        giveaway.requiredRoleId ? `${emojis.keep} Cần role <@&${giveaway.requiredRoleId}>` : null,
        giveaway.minLevel ? `${emojis.star} Level từ **${giveaway.minLevel}** trở lên` : null,
        giveaway.minScoin ? `${emojis.budget} Có ít nhất **${giveaway.minScoin.toLocaleString('vi-VN')}** Scoin` : null,
        giveaway.entryCost ? `${emojis.budget} Phí tham gia **${giveaway.entryCost.toLocaleString('vi-VN')}** Scoin` : `${emojis.success} Miễn phí tham gia`
    ].filter(Boolean).join('\n');

    const winners = giveaway.winnerIds ? giveaway.winnerIds.split(',').filter(Boolean).map(id => `<@${id}>`).join(', ') : null;
    const statusLabel = giveaway.status === 'ACTIVE' ? 'Đang mở' : giveaway.status === 'CANCELLED' ? 'Đã hủy' : 'Đã kết thúc';
    const endsAt = Math.floor(giveaway.endsAt.getTime() / 1000);
    const embed = new EmbedBuilder()
        .setColor(giveaway.status === 'ACTIVE' ? '#ff66cc' : giveaway.status === 'CANCELLED' ? '#95a5a6' : '#2ecc71')
        .setTitle(`${emojis.starJump} Giveaway - ${giveaway.title}`)
        .setDescription([
            `${emojis.purpleArrow} **Phần thưởng**`,
            `> ${giveaway.prize}`,
            '',
            giveaway.description || 'Nhấn nút **Tham gia** bên dưới để vào danh sách quay thưởng.'
        ].join('\n'))
        .addFields(
            { name: `${emojis.note} Trạng thái`, value: `**${statusLabel}**`, inline: true },
            { name: `${emojis.star} Winner`, value: `**${giveaway.winnersCount}**`, inline: true },
            { name: `${emojis.contribution} Tham gia`, value: `**${giveaway.entries.length.toLocaleString('vi-VN')}** người`, inline: true },
            { name: `${emojis.redArrow} Thời gian`, value: `Kết thúc <t:${endsAt}:R>\n<t:${endsAt}:F>`, inline: false },
            { name: `${emojis.keep} Điều kiện`, value: requirements || 'Không có điều kiện.', inline: false },
            { name: `${emojis.contact} Host`, value: `<@${giveaway.hostId}>`, inline: true },
            { name: `${emojis.purpleArrow} Ping`, value: giveaway.pingRoleId ? `<@&${giveaway.pingRoleId}>` : 'Không ping role', inline: true }
        )
        .setImage(giveaway.publicMediaUrl || giveaway.bannerUrl || GIVEAWAY_BANNER)
        .setFooter({ text: `Giveaway #${giveaway.id} • Stella Studio` })
        .setTimestamp(giveaway.endsAt);

    if (winners) embed.addFields({ name: `${emojis.success} Winner`, value: winners, inline: false });
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
    pingRoleId?: string | null;
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
    const me = options.channel.guild?.members.me;
    const permissions = me ? options.channel.permissionsFor(me) : null;
    const missing = [
        permissions?.has(PermissionFlagsBits.ViewChannel) ? null : 'View Channel',
        permissions?.has(PermissionFlagsBits.SendMessages) ? null : 'Send Messages',
        permissions?.has(PermissionFlagsBits.EmbedLinks) ? null : 'Embed Links'
    ].filter(Boolean);
    if (missing.length) {
        throw new Error(`Bot thiếu quyền ở <#${options.channel.id}>: ${missing.join(', ')}.`);
    }

    const giveaway = await prisma.giveaway.create({
        data: {
            channelId: options.channel.id,
            title: options.title,
            description: options.description || 'Nhấn nút bên dưới để tham gia giveaway.',
            prize: options.prize,
            hostId: options.hostId,
            pingRoleId: options.pingRoleId || null,
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
    const message = await options.channel.send({
        content: options.pingRoleId ? `<@&${options.pingRoleId}>` : undefined,
        embeds: [embed],
        components: giveawayButtons(giveaway.id),
        allowedMentions: options.pingRoleId ? { roles: [options.pingRoleId] } : { parse: [] }
    }) as Message;
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
    if (giveaway.minLevel && user.level < giveaway.minLevel) return `Bạn cần đạt Level ${giveaway.minLevel}.`;
    if (giveaway.minScoin && user.scoinBalance < giveaway.minScoin) return `Bạn cần có ít nhất ${giveaway.minScoin} Scoin.`;
    if (giveaway.entryCost && user.scoinBalance < giveaway.entryCost) return `Bạn cần ${giveaway.entryCost} Scoin để tham gia.`;
    if (giveaway.requiredRoleId) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member?.roles.cache.has(giveaway.requiredRoleId)) return `Bạn cần role <@&${giveaway.requiredRoleId}>.`;
    }
    return null;
}

export async function joinGiveaway(client: Client, guild: Guild, giveawayId: number, userId: string) {
    const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });
    if (!giveaway || giveaway.status !== 'ACTIVE') throw new Error('Giveaway này đã kết thúc.');
    if (giveaway.endsAt.getTime() <= Date.now()) throw new Error('Giveaway này đã hết hạn.');
    const reason = await checkRequirements(guild, giveaway, userId);
    if (reason) throw new Error(reason);

    let created = false;
    await prisma.$transaction(async tx => {
        const existing = await tx.giveawayEntry.findUnique({ where: { giveawayId_userId: { giveawayId, userId } } });
        if (existing) return;
        if (giveaway.entryCost > 0) {
            await adjustScoinTx(tx, userId, -giveaway.entryCost, `Join giveaway #${giveawayId}`, 'giveaway:entry', `giveaway:${giveawayId}`);
        }
        await tx.giveawayEntry.create({ data: { giveawayId, userId } });
        created = true;
    });

    if (created) await refreshGiveawayMessage(client, giveawayId);
    return created;
}

export async function leaveGiveaway(client: Client, giveawayId: number, userId: string) {
    const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });
    if (!giveaway || giveaway.status !== 'ACTIVE') throw new Error('Giveaway này đã kết thúc.');

    let removed = false;
    await prisma.$transaction(async tx => {
        const existing = await tx.giveawayEntry.findUnique({ where: { giveawayId_userId: { giveawayId, userId } } });
        if (!existing) return;
        await tx.giveawayEntry.delete({ where: { id: existing.id } });
        if (giveaway.entryCost > 0) {
            await adjustScoinTx(tx, userId, giveaway.entryCost, `Leave giveaway #${giveawayId}`, 'giveaway:refund', `giveaway:${giveawayId}`);
        }
        removed = true;
    });

    if (removed) await refreshGiveawayMessage(client, giveawayId);
    return removed;
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
    if (!giveaway) throw new Error('Không tìm thấy giveaway.');
    if (!reroll && giveaway.status !== 'ACTIVE') throw new Error('Giveaway đã kết thúc.');

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
                ? `🎁 Giveaway **${giveaway.title}** đã kết thúc! Winner: ${winners.map(id => `<@${id}>`).join(', ')}`
                : `🎁 Giveaway **${giveaway.title}** đã kết thúc nhưng không có winner hợp lệ.`
        }).catch(() => {});
    }

    for (const winnerId of winners) {
        const user = await client.users.fetch(winnerId).catch(() => null) as User | null;
        if (!user) continue;
        try {
            const secret = giveaway.rewardType === 'link' || giveaway.rewardType === 'file'
                ? `Phần thưởng của bạn:\n${giveaway.rewardSecret || giveaway.prize}`
                : `Hãy liên hệ host <@${giveaway.hostId}> để nhận phần thưởng: **${giveaway.prize}**.`;
            await user.send(`Bạn đã thắng giveaway **${giveaway.title}**!\n${secret}`);
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
    if (!giveaway) throw new Error('Không tìm thấy giveaway.');
    if (giveaway.status !== 'ACTIVE') {
        return {
            cancelled: false,
            reason: giveaway.status === 'CANCELLED'
                ? 'Giveaway này đã được hủy trước đó.'
                : 'Giveaway này đã kết thúc nên không thể hủy.'
        };
    }

    await prisma.$transaction(async tx => {
        await tx.giveaway.update({ where: { id: giveawayId }, data: { status: 'CANCELLED' } });
        if (giveaway.entryCost > 0) {
            for (const entry of giveaway.entries) {
                await adjustScoinTx(tx, entry.userId, giveaway.entryCost, `Cancel giveaway #${giveawayId}`, 'giveaway:refund', `giveaway:${giveawayId}`);
            }
        }
    });
    await refreshGiveawayMessage(client, giveawayId);
    return { cancelled: true, reason: null };
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
