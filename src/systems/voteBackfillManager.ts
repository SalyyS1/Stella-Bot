import { Client, Message, TextChannel } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { isAllowedShowcaseMessage, maybePublishShowcase, publishEligibleShowcases } from './showcaseManager';
import { sendAdminLog } from '../utils/adminLog';

const upvoteId = config.ui.emojis.upvote.match(/:(\d+)>/)?.[1];
const downvoteId = config.ui.emojis.downvote.match(/:(\d+)>/)?.[1];

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return await Promise.race([
        promise,
        new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))
    ]);
}

function emojiIdentifier(raw: string): string | null {
    const match = raw.match(/<(?:a)?:([^:>]+):(\d+)>/);
    return match ? `${match[1]}:${match[2]}` : null;
}

async function reactIfMissing(message: Message): Promise<void> {
    const up = emojiIdentifier(config.ui.emojis.upvote);
    const down = emojiIdentifier(config.ui.emojis.downvote);
    if (up && !message.reactions.cache.some(reaction => reaction.emoji.id === upvoteId)) {
        await withTimeout(message.react(up).then(() => true).catch(() => false), 2500, false);
    }
    if (down && !message.reactions.cache.some(reaction => reaction.emoji.id === downvoteId)) {
        await withTimeout(message.react(down).then(() => true).catch(() => false), 2500, false);
    }
}

async function recomputeScoresForAuthors(authorIds: Set<string>): Promise<void> {
    for (const authorId of authorIds) {
        const expertScore = await prisma.vote.count({
            where: {
                targetAuthorId: authorId,
                channelId: config.channels.showcase,
                value: 1
            }
        });

        const contribution = await prisma.vote.aggregate({
            where: {
                targetAuthorId: authorId,
                channelId: config.channels.share
            },
            _sum: { value: true }
        });

        await prisma.user.upsert({
            where: { id: authorId },
            update: {
                expertScore,
                contributionScore: contribution._sum.value || 0
            },
            create: {
                id: authorId,
                expertScore,
                contributionScore: contribution._sum.value || 0
            }
        });
    }
}

async function syncVotesForMessage(message: Message, channelId: string): Promise<{ synced: number; changed: boolean; skipped: boolean }> {
    const plusUsers = await collectReactionUserIds(message, upvoteId);
    const minusUsers = await collectReactionUserIds(message, downvoteId);
    if (!plusUsers || !minusUsers) return { synced: 0, changed: false, skipped: true };

    const voters = new Map<string, number>();
    for (const userId of plusUsers) voters.set(userId, 1);
    for (const userId of minusUsers) {
        if (!voters.has(userId)) voters.set(userId, -1);
    }

    let changed = false;
    const existing = await prisma.vote.findMany({
        where: { messageId: message.id },
        select: { voterId: true, value: true, channelId: true, targetAuthorId: true }
    });
    const existingByVoter = new Map(existing.map(vote => [vote.voterId, vote]));

    for (const [voterId, value] of voters) {
        const current = existingByVoter.get(voterId);
        if (!current || current.value !== value || current.channelId !== channelId || current.targetAuthorId !== message.author!.id) {
            changed = true;
        }

        await prisma.vote.upsert({
            where: { messageId_voterId: { messageId: message.id, voterId } },
            update: {
                channelId,
                targetAuthorId: message.author!.id,
                value
            },
            create: {
                messageId: message.id,
                channelId,
                targetAuthorId: message.author!.id,
                voterId,
                value
            }
        });
    }

    const currentVoters = [...voters.keys()];
    const deleteResult = currentVoters.length > 0
        ? await prisma.vote.deleteMany({
            where: {
                messageId: message.id,
                voterId: { notIn: currentVoters }
            }
        })
        : await prisma.vote.deleteMany({ where: { messageId: message.id } });
    if (deleteResult.count > 0) changed = true;

    return { synced: voters.size, changed, skipped: false };
}

export async function ensureRecentVoteReactions(client: Client, limit = 50): Promise<{ scanned: number; reacted: number; synced: number; published: number }> {
    const channels = [config.channels.share, config.channels.showcase];
    let scanned = 0;
    let reacted = 0;
    let synced = 0;
    const affectedAuthors = new Set<string>();

    for (const channelId of channels) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;
        const messages = await (channel as TextChannel).messages.fetch({ limit }).catch(() => null);
        if (!messages) continue;

        for (const message of messages.values()) {
            if (message.author?.bot) continue;
            if (channelId === config.channels.showcase && !isAllowedShowcaseMessage(message)) continue;
            if (channelId === config.channels.share && message.attachments.size === 0 && !/(https?:\/\/[^\s]+)/i.test(message.content)) continue;

            scanned++;
            const hadUp = message.reactions.cache.some(reaction => reaction.emoji.id === upvoteId);
            const hadDown = message.reactions.cache.some(reaction => reaction.emoji.id === downvoteId);
            if (!hadUp || !hadDown) {
                await reactIfMissing(message);
                reacted++;
            }

            if (channelId === config.channels.showcase) {
                await prisma.showcasePost.upsert({
                    where: { messageId: message.id },
                    update: {
                        channelId,
                        authorId: message.author!.id
                    },
                    create: {
                        messageId: message.id,
                        channelId,
                        authorId: message.author!.id,
                        title: `Showcase by ${message.author!.username}`,
                        tagName: 'Nothing'
                    }
                }).catch(() => {});
            }

            const result = await syncVotesForMessage(message, channelId);
            synced += result.synced;
            if (result.changed) affectedAuthors.add(message.author!.id);
        }
    }

    await recomputeScoresForAuthors(affectedAuthors);
    const published = await publishEligibleShowcases(client);

    if (reacted > 0 || synced > 0 || published > 0) {
        await sendAdminLog(client, {
            title: 'Vote state self-healed',
            color: '#3498db',
            fields: [
                { name: 'Scanned', value: `${scanned}`, inline: true },
                { name: 'Reacted', value: `${reacted}`, inline: true },
                { name: 'Synced', value: `${synced}`, inline: true },
                { name: 'Published', value: `${published}`, inline: true }
            ]
        });
    }

    return { scanned, reacted, synced, published };
}

async function fetchAllRecentMessages(channel: TextChannel, limit = 300): Promise<Message[]> {
    const messages: Message[] = [];
    let before: string | undefined;

    while (messages.length < limit) {
        const batch = await channel.messages.fetch({ limit: Math.min(100, limit - messages.length), before }).catch(() => null);
        if (!batch || batch.size === 0) break;
        messages.push(...batch.values());
        before = batch.last()?.id;
        if (batch.size < 100) break;
    }

    return messages;
}

async function collectReactionUserIds(message: Message, emojiId: string | undefined): Promise<string[] | null> {
    if (!emojiId) return [];
    const reaction = message.reactions.cache.find(item => item.emoji.id === emojiId);
    if (!reaction) return [];
    if ((reaction.count || 0) <= 1) return [];
    const users = await withTimeout(reaction.users.fetch().catch(() => null), 5000, null);
    if (!users) return null;
    return users.filter(user => !user.bot && user.id !== message.author?.id).map(user => user.id);
}

export async function backfillVotesAndScores(client: Client): Promise<{ scanned: number; reacted: number; votes: number; created: number; published: number }> {
    const shareId = config.channels.share;
    const showcaseId = config.channels.showcase;
    const channels = [shareId, showcaseId];
    let scanned = 0;
    let reacted = 0;
    let created = 0;
    let published = 0;

    for (const channelId of channels) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;

        const messages = await fetchAllRecentMessages(channel as TextChannel);
        console.log(`[backfill] ${channelId}: ${messages.length} messages`);
        for (const message of messages) {
            if (message.author?.bot) continue;
            if (channelId === showcaseId && !isAllowedShowcaseMessage(message)) continue;
            if (channelId === shareId && message.attachments.size === 0 && !/(https?:\/\/[^\s]+)/i.test(message.content)) continue;

            scanned++;
            const before = message.reactions.cache.size;
            await reactIfMissing(message);
            if (message.reactions.cache.size !== before) reacted++;

            if (channelId === showcaseId) {
                const existingPost = await prisma.showcasePost.findUnique({ where: { messageId: message.id }, select: { messageId: true } });
                await prisma.showcasePost.upsert({
                    where: { messageId: message.id },
                    update: {},
                    create: {
                        messageId: message.id,
                        channelId,
                        authorId: message.author!.id,
                        title: `Showcase by ${message.author!.username}`,
                        tagName: 'Nothing'
                    }
                }).catch(() => {});
                if (!existingPost) created++;
            }

            await syncVotesForMessage(message, channelId);
            if (channelId === showcaseId) {
                const before = await prisma.showcasePost.findUnique({ where: { messageId: message.id }, select: { status: true } });
                await maybePublishShowcase(client, message);
                const after = await prisma.showcasePost.findUnique({ where: { messageId: message.id }, select: { status: true } });
                if (before?.status === 'VOTING' && after?.status === 'PUBLISHED') published++;
            }
        }
    }

    await prisma.user.updateMany({ data: { expertScore: 0, contributionScore: 0 } });

    const grouped = await prisma.vote.groupBy({
        by: ['targetAuthorId', 'channelId'],
        _sum: { value: true },
        where: { channelId: { in: channels } }
    });

    for (const group of grouped) {
        if (group.channelId === showcaseId) {
            const plusCount = await prisma.vote.count({
                where: { targetAuthorId: group.targetAuthorId, channelId: showcaseId, value: 1 }
            });
            await prisma.user.upsert({
                where: { id: group.targetAuthorId },
                update: { expertScore: plusCount },
                create: { id: group.targetAuthorId, expertScore: plusCount }
            });
        } else if (group.channelId === shareId) {
            await prisma.user.upsert({
                where: { id: group.targetAuthorId },
                update: { contributionScore: group._sum.value || 0 },
                create: { id: group.targetAuthorId, contributionScore: group._sum.value || 0 }
            });
        }
    }

    const votes = await prisma.vote.count();
    published += await publishEligibleShowcases(client, 100);
    await sendAdminLog(client, {
        title: 'Vote backfill completed',
        color: '#2ecc71',
        fields: [
            { name: 'Scanned', value: `${scanned}`, inline: true },
            { name: 'Created', value: `${created}`, inline: true },
            { name: 'Reacted', value: `${reacted}`, inline: true },
            { name: 'Votes', value: `${votes}`, inline: true },
            { name: 'Published', value: `${published}`, inline: true }
        ]
    });

    return { scanned, reacted, votes, created, published };
}
