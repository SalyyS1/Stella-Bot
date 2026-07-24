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
import { randomInt } from 'crypto';

export const GIVEAWAY_BANNER = 'https://i.pinimg.com/originals/26/7b/1c/267b1c57cc1a1ac4644df3d91d4d377b.gif';
const MAX_GIVEAWAY_DURATION_MS = 365 * 24 * 60 * 60_000;

export function parseDuration(input: string): number {
    const match = input.trim().toLowerCase().match(/^(\d+)\s*(m|h|d)$/);
    if (!match) throw new Error('Thời lượng đúng dạng 10m, 2h hoặc 3d.');
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Thời lượng phải lớn hơn 0.');
    const durationMs = amount * (unit === 'm' ? 60_000 : unit === 'h' ? 60 * 60_000 : 24 * 60 * 60_000);
    if (!Number.isSafeInteger(durationMs) || durationMs > MAX_GIVEAWAY_DURATION_MS) {
        throw new Error('Thời lượng giveaway tối đa là 365 ngày.');
    }
    return durationMs;
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
        include: {
            _count: {
                select: { entries: true }
            }
        }
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
    const isProcessing = giveaway.status === 'ENDING' || giveaway.status === 'REROLLING';
    const statusLabel = giveaway.status === 'ACTIVE'
        ? 'Đang mở'
        : giveaway.status === 'CANCELLED'
            ? giveaway.entryCost > 0 ? 'Đã hủy • phí tham gia đã hoàn' : 'Đã hủy'
            : isProcessing
                ? giveaway.status === 'REROLLING' ? 'Đang chọn winner mới' : 'Đang xác minh kết quả'
                : 'Đã kết thúc';
    const timeLabel = giveaway.status === 'ACTIVE'
        ? 'Kết thúc'
        : giveaway.status === 'CANCELLED'
            ? 'Lịch kết thúc cũ'
            : 'Đã đóng lúc';
    const endsAt = Math.floor(giveaway.endsAt.getTime() / 1000);
    const embed = new EmbedBuilder()
        .setColor(giveaway.status === 'ACTIVE' ? '#ff66cc' : giveaway.status === 'CANCELLED' ? '#95a5a6' : isProcessing ? '#f1c40f' : '#2ecc71')
        .setTitle(`${emojis.starJump} Giveaway - ${giveaway.title}`)
        .setDescription([
            `${emojis.purpleArrow} **Phần thưởng**`,
            `> ${giveaway.prize}`,
            '',
            giveaway.description || 'Nhấn nút **Tham gia** bên dưới để vào danh sách quay thưởng.'
        ].join('\n'))
        .addFields(
            { name: `${emojis.note} Trạng thái`, value: `**${statusLabel}**`, inline: true },
            { name: `${emojis.star} Số winner`, value: `**${giveaway.winnersCount}**`, inline: true },
            { name: `${emojis.contribution} Tham gia`, value: `**${giveaway._count.entries.toLocaleString('vi-VN')}** người`, inline: true },
            { name: `${emojis.redArrow} Thời gian`, value: `${timeLabel} <t:${endsAt}:R>\n<t:${endsAt}:F>`, inline: false },
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

    if (!options.title.trim() || !options.prize.trim()) throw new Error('Tiêu đề và phần thưởng không được để trống.');
    if (!Number.isSafeInteger(options.durationMs) || options.durationMs <= 0 || options.durationMs > MAX_GIVEAWAY_DURATION_MS) {
        throw new Error('Thời lượng giveaway phải từ 1 phút đến 365 ngày.');
    }
    if (!Number.isInteger(options.winnersCount) || options.winnersCount < 1 || options.winnersCount > 20) {
        throw new Error('Số winner phải từ 1 đến 20.');
    }
    if ((options.entryCost || 0) < 0 || (options.minLevel || 0) < 0 || (options.minScoin || 0) < 0) {
        throw new Error('Điều kiện giveaway không hợp lệ.');
    }
    const rewardType = options.rewardType || 'contact_host';
    if (!['contact_host', 'link', 'file'].includes(rewardType)) throw new Error('Kiểu phần thưởng không hợp lệ.');
    if ((rewardType === 'link' || rewardType === 'file') && !options.rewardSecret?.trim()) {
        throw new Error('Phần thưởng link/file cần có link bí mật để gửi winner.');
    }

    const giveaway = await prisma.giveaway.create({
        data: {
            channelId: options.channel.id,
            title: options.title.trim(),
            description: options.description.trim() || 'Nhấn nút bên dưới để tham gia giveaway.',
            prize: options.prize.trim(),
            hostId: options.hostId,
            pingRoleId: options.pingRoleId || null,
            winnersCount: options.winnersCount,
            endsAt: new Date(Date.now() + options.durationMs),
            requiredRoleId: options.requiredRoleId || null,
            minLevel: options.minLevel || null,
            minScoin: options.minScoin || null,
            entryCost: options.entryCost || 0,
            rewardType,
            rewardSecret: options.rewardSecret?.trim() || null,
            publicMediaUrl: options.publicMediaUrl || null,
            bannerUrl: GIVEAWAY_BANNER
        }
    });

    let message: Message | null = null;
    try {
        const { embed } = await buildGiveawayEmbed(giveaway.id);
        message = await options.channel.send({
            content: options.pingRoleId ? `<@&${options.pingRoleId}>` : undefined,
            embeds: [embed],
            components: giveawayButtons(giveaway.id),
            allowedMentions: options.pingRoleId ? { roles: [options.pingRoleId] } : { parse: [] }
        }) as Message;
        await prisma.giveaway.update({ where: { id: giveaway.id }, data: { messageId: message.id } });
    } catch (error) {
        await message?.delete().catch(() => {});
        await prisma.giveaway.delete({ where: { id: giveaway.id } }).catch(() => {});
        throw error;
    }

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
        // Take a short row-level lock while the entry is created. This prevents an
        // end/cancel transition from winning between the initial status check and
        // the Scoin charge / entry insert below.
        const active = await tx.giveaway.updateMany({
            where: { id: giveawayId, status: 'ACTIVE', endsAt: { gt: new Date() } },
            data: { updatedAt: new Date() }
        });
        if (active.count === 0) throw new Error('Giveaway này đã kết thúc hoặc đang xử lý.');

        const existing = await tx.giveawayEntry.findUnique({ where: { giveawayId_userId: { giveawayId, userId } } });
        if (existing) return;
        if (giveaway.entryCost > 0) {
            await tx.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
            // Conditional decrement: the balance floor lives in the WHERE clause, so two
            // concurrent joins can't both read a pre-decrement balance and overspend.
            const charged = await tx.user.updateMany({
                where: { id: userId, scoinBalance: { gte: giveaway.entryCost } },
                data: { scoinBalance: { decrement: giveaway.entryCost } }
            });
            if (charged.count === 0) throw new Error(`Bạn cần ${giveaway.entryCost} Scoin để tham gia.`);
            await tx.scoinTransaction.create({
                data: {
                    userId,
                    amount: -giveaway.entryCost,
                    reason: `Join giveaway #${giveawayId}`,
                    source: 'giveaway:entry',
                    metadata: `giveaway:${giveawayId}`
                }
            });
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
        // Mirror join's lock so cancellation/end cannot refund an entry that a
        // concurrent leave has already refunded.
        const active = await tx.giveaway.updateMany({
            where: { id: giveawayId, status: 'ACTIVE' },
            data: { updatedAt: new Date() }
        });
        if (active.count === 0) throw new Error('Giveaway này đã kết thúc hoặc đang xử lý.');

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
        const index = randomInt(pool.length);
        winners.push(pool.splice(index, 1)[0]);
    }
    return winners;
}

async function deliverGiveawayRewards(
    client: Client,
    giveaway: {
        id: number;
        title: string;
        prize: string;
        hostId: string;
        rewardType: string;
        rewardSecret: string | null;
    },
    winnerIds: string[]
): Promise<{ sent: number; failed: number; skipped: number }> {
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const winnerId of winnerIds) {
        const latest = await prisma.giveawayRewardDelivery.findFirst({
            where: { giveawayId: giveaway.id, userId: winnerId },
            orderBy: { createdAt: 'desc' }
        });
        if (latest?.status === 'SENT') {
            skipped++;
            continue;
        }

        let error: string | null = null;
        try {
            const user = await client.users.fetch(winnerId) as User;
            const secret = giveaway.rewardType === 'link' || giveaway.rewardType === 'file'
                ? `Phần thưởng của bạn:\n${giveaway.rewardSecret || giveaway.prize}`
                : `Hãy liên hệ host <@${giveaway.hostId}> để nhận phần thưởng: **${giveaway.prize}**.`;
            await user.send(`🎉 Bạn đã thắng giveaway **${giveaway.title}**!\n${secret}`);
            sent++;
        } catch (cause: any) {
            error = String(cause?.message || cause).slice(0, 500);
            failed++;
            await sendAdminLog(client, {
                title: 'Giveaway DM failed',
                color: '#e74c3c',
                fields: [
                    { name: 'Giveaway', value: `#${giveaway.id}`, inline: true },
                    { name: 'Winner', value: `<@${winnerId}>`, inline: true },
                    { name: 'Error', value: error }
                ]
            }).catch(() => {});
        }

        await prisma.giveawayRewardDelivery.create({
            data: {
                giveawayId: giveaway.id,
                userId: winnerId,
                status: error ? 'FAILED' : 'SENT',
                error
            }
        });
    }

    return { sent, failed, skipped };
}

export async function retryGiveawayRewards(client: Client, giveawayId: number) {
    const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });
    if (!giveaway) throw new Error('Không tìm thấy giveaway.');
    if (giveaway.status !== 'ENDED') throw new Error('Chỉ gửi lại phần thưởng của giveaway đã kết thúc.');

    const winnerIds = giveaway.winnerIds?.split(',').filter(Boolean) || [];
    if (!winnerIds.length) throw new Error('Giveaway này không có winner để gửi thưởng.');
    return deliverGiveawayRewards(client, giveaway, winnerIds);
}

export async function endGiveaway(client: Client, giveawayId: number, reroll = false) {
    const expectedStatus = reroll ? 'ENDED' : 'ACTIVE';
    const processingStatus = reroll ? 'REROLLING' : 'ENDING';
    const claimed = await prisma.giveaway.updateMany({
        where: { id: giveawayId, status: expectedStatus },
        data: { status: processingStatus }
    });

    if (claimed.count === 0) {
        const current = await prisma.giveaway.findUnique({ where: { id: giveawayId }, select: { status: true } });
        if (!current) throw new Error('Không tìm thấy giveaway.');
        if (reroll) throw new Error('Chỉ có thể reroll giveaway đã kết thúc và không đang xử lý.');
        throw new Error('Giveaway đã kết thúc hoặc đang xử lý.');
    }

    let finalized = false;
    try {
        // Read entries only after claiming the state transition. Joins/leaves take
        // the same row lock, so every committed entry before ENDING is included.
        const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId }, include: { entries: true } });
        if (!giveaway) throw new Error('Không tìm thấy giveaway.');

        const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
        const guild = channel && 'guild' in channel ? channel.guild : null;
        if (!guild) throw new Error('Không tìm thấy server chứa giveaway để xác minh winner.');

        const oldWinners = giveaway.winnerIds?.split(',').filter(Boolean) || [];
        const validEntries: string[] = [];
        for (const entry of giveaway.entries) {
            if (reroll && oldWinners.includes(entry.userId)) continue;
            const reason = await checkRequirements(guild, giveaway, entry.userId).catch(() => 'invalid');
            if (!reason) validEntries.push(entry.userId);
        }

        const winners = pickWinners(validEntries, giveaway.winnersCount);
        const finalizedUpdate = await prisma.giveaway.updateMany({
            where: { id: giveawayId, status: processingStatus },
            data: { status: 'ENDED', winnerIds: winners.join(',') }
        });
        if (finalizedUpdate.count === 0) throw new Error('Giveaway đang được xử lý bởi phiên khác.');
        finalized = true;

        await refreshGiveawayMessage(client, giveawayId);

        if (channel?.isSendable()) {
            const action = reroll ? 'ĐÃ REROLL' : 'ĐÃ KẾT THÚC';
            const announcement = new EmbedBuilder()
                .setColor(winners.length ? '#2ecc71' : '#95a5a6')
                .setTitle(`🎁 ${action} • ${giveaway.title}`)
                .setDescription(winners.length
                    ? `Chúc mừng ${winners.map(id => `<@${id}>`).join(', ')}!\n\n**Phần thưởng:** ${giveaway.prize}`
                    : 'Không có người tham gia nào còn đủ điều kiện nhận thưởng.')
                .setFooter({ text: `Giveaway #${giveawayId}${reroll ? ' • Winner cũ đã được loại khỏi lượt quay' : ''}` })
                .setTimestamp();
            await channel.send({
                embeds: [announcement],
                allowedMentions: { users: winners }
            }).catch(() => {});
        }

        await deliverGiveawayRewards(client, giveaway, winners);

        return winners;
    } catch (error) {
        // Before winners are persisted, restore the previous stable state so a
        // temporary Discord/DB failure can be retried. Never reopen after finalizing.
        if (!finalized) {
            await prisma.giveaway.updateMany({
                where: { id: giveawayId, status: processingStatus },
                data: { status: expectedStatus }
            }).catch(() => {});
        }
        throw error;
    }
}

export async function cancelGiveaway(client: Client, giveawayId: number) {
    const cancelled = await prisma.$transaction(async tx => {
        const transition = await tx.giveaway.updateMany({
            where: { id: giveawayId, status: 'ACTIVE' },
            data: { status: 'CANCELLED' }
        });
        if (transition.count === 0) return null;

        const giveaway = await tx.giveaway.findUnique({ where: { id: giveawayId }, include: { entries: true } });
        if (!giveaway) throw new Error('Không tìm thấy giveaway.');
        if (giveaway.entryCost > 0) {
            for (const entry of giveaway.entries) {
                await adjustScoinTx(tx, entry.userId, giveaway.entryCost, `Cancel giveaway #${giveawayId}`, 'giveaway:refund', `giveaway:${giveawayId}`);
            }
        }
        return giveaway;
    });

    if (!cancelled) {
        const current = await prisma.giveaway.findUnique({ where: { id: giveawayId }, select: { status: true } });
        if (!current) throw new Error('Không tìm thấy giveaway.');
        return {
            cancelled: false,
            reason: current.status === 'CANCELLED'
                ? 'Giveaway này đã được hủy trước đó.'
                : 'Giveaway này đã kết thúc hoặc đang xử lý nên không thể hủy.'
        };
    }
    await refreshGiveawayMessage(client, giveawayId);
    return { cancelled: true, reason: null };
}

let giveawayInterval: NodeJS.Timeout | null = null;
let giveawaySchedulerBusy = false;
const GIVEAWAY_RECOVERY_DELAY_MS = 2 * 60_000;

async function recoverStaleGiveawayTransitions(client: Client) {
    const staleBefore = new Date(Date.now() - GIVEAWAY_RECOVERY_DELAY_MS);
    const stale = await prisma.giveaway.findMany({
        where: {
            status: { in: ['ENDING', 'REROLLING'] },
            updatedAt: { lte: staleBefore }
        },
        select: { id: true, status: true }
    }).catch(() => []);

    for (const giveaway of stale) {
        if (giveaway.status === 'ENDING') {
            const restored = await prisma.giveaway.updateMany({
                where: { id: giveaway.id, status: 'ENDING' },
                data: { status: 'ACTIVE' }
            });
            if (restored.count === 1) {
                await endGiveaway(client, giveaway.id).catch(error => console.error('Giveaway recovery end failed:', error));
            }
            continue;
        }

        // A reroll does not change entries. Returning it to ENDED preserves the
        // prior winners and lets an admin safely request a fresh reroll later.
        await prisma.giveaway.updateMany({
            where: { id: giveaway.id, status: 'REROLLING' },
            data: { status: 'ENDED' }
        });
    }
}

export function startGiveawayScheduler(client: Client) {
    if (giveawayInterval) clearInterval(giveawayInterval);
    giveawayInterval = setInterval(async () => {
        if (giveawaySchedulerBusy) return;
        giveawaySchedulerBusy = true;
        try {
            await recoverStaleGiveawayTransitions(client);
            const due = await prisma.giveaway.findMany({
                where: { status: 'ACTIVE', endsAt: { lte: new Date() } },
                take: 5
            }).catch(() => []);
            for (const giveaway of due) {
                await endGiveaway(client, giveaway.id).catch(error => console.error('Giveaway auto end failed:', error));
            }
        } finally {
            giveawaySchedulerBusy = false;
        }
    }, 45_000);
}
