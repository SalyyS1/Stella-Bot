import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    Message,
    TextChannel,
    User
} from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { messageLink, sendAdminLog } from '../utils/adminLog';
import { getGuildLocale, tr } from '../i18n';

export type RequestKind = 'PAID' | 'FREE';

function statusLabel(status: string) {
    if (status === 'OPEN') return 'Đang mở';
    if (status === 'CLAIMED') return 'Đã có người nhận';
    if (status === 'DONE') return 'Hoàn thành';
    if (status === 'RATED') return 'Đã rate';
    if (status === 'CLOSED') return 'Đã đóng';
    return status;
}

function requestButtons(id: number, status: string, disabled = false) {
    const isOpen = status === 'OPEN';
    const isClaimed = status === 'CLAIMED';
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`request_claim_${id}`)
                .setLabel('Nhận job')
                .setStyle(ButtonStyle.Success)
                .setEmoji(config.ui.emojis.keep)
                .setDisabled(disabled || !isOpen),
            new ButtonBuilder()
                .setCustomId(`request_complete_${id}`)
                .setLabel('Hoàn thành')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(config.ui.emojis.success)
                .setDisabled(disabled || !isClaimed),
            new ButtonBuilder()
                .setCustomId(`request_close_${id}`)
                .setLabel('Đóng')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(config.ui.emojis.close)
                .setDisabled(disabled || ['DONE', 'RATED', 'CLOSED'].includes(status))
        )
    ];
}

async function buildRequestEmbed(id: number) {
    const request = await prisma.requestPost.findUnique({
        where: { id },
        include: { claims: { where: { status: 'ACTIVE' }, take: 1 } }
    });
    if (!request) throw new Error('Không tìm thấy request.');

    const emojis = config.ui.emojis;
    const color = request.kind === 'PAID' ? config.ui.colors.requestPaid : config.ui.colors.requestFree;
    const title = request.kind === 'PAID' ? 'YÊU CẦU TÌM NGƯỜI (PAID)' : 'YÊU CẦU GIÚP ĐỠ (FREE)';
    const claimer = request.claimedById ? `<@${request.claimedById}>` : 'Chưa có';

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${emojis.starJump} ${title} #${request.id}`)
        .setDescription(request.description)
        .addFields(
            { name: `${emojis.customer} Chủ request`, value: `<@${request.requesterId}>`, inline: true },
            { name: `${emojis.service} Dịch vụ`, value: request.service, inline: true },
            { name: `${emojis.note} Trạng thái`, value: statusLabel(request.status), inline: true },
            { name: `${emojis.keep} Người nhận`, value: claimer, inline: true }
        )
        .setFooter({ text: 'Stella Studio • Request Board' })
        .setTimestamp(request.updatedAt);

    if (request.kind === 'PAID') {
        embed.addFields({ name: `${emojis.budget} Ngân sách`, value: request.budget || 'Chưa ghi', inline: true });
    }
    if (request.other) {
        embed.addFields({ name: `${emojis.contact} Liên hệ / Ghi chú`, value: request.other.slice(0, 1000), inline: false });
    }

    return { request, embed };
}

export async function refreshRequestMessage(client: Client, id: number) {
    const { request, embed } = await buildRequestEmbed(id);
    if (!request.messageId) return;
    const channel = await client.channels.fetch(request.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await (channel as TextChannel).messages.fetch(request.messageId).catch(() => null);
    await message?.edit({ embeds: [embed], components: requestButtons(request.id, request.status) }).catch(() => {});
}

export async function createCommunityRequest(options: {
    client: Client;
    channel: TextChannel;
    requester: User;
    kind: RequestKind;
    service: string;
    description: string;
    budget?: string | null;
    other?: string | null;
}) {
    const request = await prisma.requestPost.create({
        data: {
            channelId: options.channel.id,
            requesterId: options.requester.id,
            kind: options.kind,
            service: options.service.slice(0, 500),
            description: options.description.slice(0, 2000),
            budget: options.budget?.slice(0, 200) || null,
            other: options.other?.slice(0, 1000) || null
        }
    });

    const { embed } = await buildRequestEmbed(request.id);
    const message = await options.channel.send({
        content: `<@${options.requester.id}>`,
        embeds: [embed],
        components: requestButtons(request.id, request.status),
        allowedMentions: { users: [options.requester.id] }
    }) as Message;

    await prisma.requestPost.update({
        where: { id: request.id },
        data: { messageId: message.id }
    });

    await sendAdminLog(options.client, {
        title: 'Request created',
        color: options.kind === 'PAID' ? '#2ecc71' : '#3498db',
        fields: [
            { name: 'Kind', value: options.kind, inline: true },
            { name: 'Requester', value: `<@${options.requester.id}>`, inline: true },
            { name: 'Message', value: messageLink(message.guildId, message.channelId, message.id) }
        ]
    }).catch(() => {});

    return { ...request, messageId: message.id };
}

export async function claimRequest(client: Client, guildId: string | null, id: number, user: User) {
    const locale = await getGuildLocale(guildId);
    const request = await prisma.requestPost.findUnique({ where: { id } });
    if (!request || request.status !== 'OPEN') throw new Error(tr(locale, 'request.alreadyClaimed'));
    if (request.requesterId === user.id) throw new Error(tr(locale, 'request.ownClaim'));

    await prisma.$transaction(async tx => {
        await tx.user.upsert({ where: { id: user.id }, update: {}, create: { id: user.id } });
        await tx.requestClaim.upsert({
            where: { requestId_claimerId: { requestId: id, claimerId: user.id } },
            update: { status: 'ACTIVE' },
            create: { requestId: id, claimerId: user.id, status: 'ACTIVE' }
        });
        await tx.requestPost.update({
            where: { id },
            data: { status: 'CLAIMED', claimedById: user.id }
        });
    });

    await refreshRequestMessage(client, id);
    return tr(locale, 'request.claimed', { id });
}

export async function closeRequest(client: Client, guildId: string | null, id: number, actorId: string, isAdmin: boolean) {
    const locale = await getGuildLocale(guildId);
    const request = await prisma.requestPost.findUnique({ where: { id } });
    if (!request) throw new Error('Không tìm thấy request.');
    if (!isAdmin && request.requesterId !== actorId) throw new Error('Chỉ chủ request hoặc admin mới được đóng.');

    await prisma.requestPost.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date() }
    });
    await refreshRequestMessage(client, id);
    return tr(locale, 'request.closed', { id });
}

function ratingButtons(requestId: number) {
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            [1, 2, 3, 4, 5].map(score =>
                new ButtonBuilder()
                    .setCustomId(`request_rate_${requestId}_${score}`)
                    .setLabel(`${score}`)
                    .setStyle(score >= 4 ? ButtonStyle.Success : score >= 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            )
        )
    ];
}

export async function completeRequest(client: Client, guildId: string | null, id: number, actorId: string, isAdmin: boolean) {
    const locale = await getGuildLocale(guildId);
    const request = await prisma.requestPost.findUnique({ where: { id } });
    if (!request) throw new Error('Không tìm thấy request.');
    if (!request.claimedById) throw new Error(tr(locale, 'request.rateNoTarget'));
    if (!isAdmin && request.requesterId !== actorId && request.claimedById !== actorId) {
        throw new Error('Chỉ chủ request, người nhận job hoặc admin mới được hoàn thành.');
    }

    await prisma.requestPost.update({
        where: { id },
        data: { status: 'DONE', completedAt: new Date() }
    });
    await refreshRequestMessage(client, id);

    const rateChannel = await client.channels.fetch(config.channels.rate).catch(() => null);
    if (rateChannel?.isTextBased()) {
        const embed = new EmbedBuilder()
            .setColor('#ff66cc')
            .setTitle(`${config.ui.emojis.starJump} Rate request #${id}`)
            .setDescription(`Chủ request <@${request.requesterId}> hãy rate người nhận job <@${request.claimedById}>.`)
            .addFields(
                { name: 'Dịch vụ', value: request.service, inline: true },
                { name: 'Người nhận', value: `<@${request.claimedById}>`, inline: true }
            )
            .setTimestamp();
        await (rateChannel as TextChannel).send({
            content: `<@${request.requesterId}>`,
            embeds: [embed],
            components: ratingButtons(id),
            allowedMentions: { users: [request.requesterId] }
        }).catch(() => {});
    }

    return tr(locale, 'request.completed', { id });
}

export async function rateRequest(client: Client, guildId: string | null, id: number, reviewerId: string, rating: number) {
    const locale = await getGuildLocale(guildId);
    const request = await prisma.requestPost.findUnique({ where: { id } });
    if (!request) throw new Error('Không tìm thấy request.');
    if (request.requesterId !== reviewerId) throw new Error(tr(locale, 'request.rateNotAllowed'));
    if (!request.claimedById) throw new Error(tr(locale, 'request.rateNoTarget'));

    await prisma.$transaction(async tx => {
        await tx.user.upsert({ where: { id: reviewerId }, update: {}, create: { id: reviewerId } });
        await tx.user.upsert({ where: { id: request.claimedById! }, update: {}, create: { id: request.claimedById! } });
        await tx.requestReview.upsert({
            where: { requestId_reviewerId: { requestId: id, reviewerId } },
            update: { rating },
            create: { requestId: id, reviewerId, targetId: request.claimedById!, rating }
        });
        await tx.user.update({
            where: { id: request.claimedById! },
            data: {
                contributionScore: { increment: rating },
                scoinBalance: { increment: rating * 10 },
                scoinEarnedTotal: { increment: rating * 10 }
            }
        });
        await tx.scoinTransaction.create({
            data: {
                userId: request.claimedById!,
                amount: rating * 10,
                reason: `Request #${id} rating reward`,
                source: 'request:rate',
                metadata: `rating:${rating};reviewer:${reviewerId}`
            }
        });
        await tx.requestPost.update({ where: { id }, data: { status: 'RATED' } });
    });

    await refreshRequestMessage(client, id);
    await sendAdminLog(client, {
        title: 'Request rated',
        color: '#ff66cc',
        fields: [
            { name: 'Request', value: `#${id}`, inline: true },
            { name: 'Rating', value: `${rating}/5`, inline: true },
            { name: 'Target', value: `<@${request.claimedById}>`, inline: true }
        ]
    }).catch(() => {});

    return tr(locale, 'request.rateThanks', { rating, targetId: request.claimedById });
}
