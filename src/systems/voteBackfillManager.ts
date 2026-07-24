import { Client, Message, TextChannel } from 'discord.js';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { config } from '../config';
import { isAllowedShowcaseMessage, maybePublishShowcase, publishEligibleShowcases } from './showcaseManager';
import { sendAdminLog } from '../utils/adminLog';
import { lockVoteScores } from './voteScoreLock';

const upvoteId = config.ui.emojis.upvote.match(/:(\d+)>/)?.[1];
const downvoteId = config.ui.emojis.downvote.match(/:(\d+)>/)?.[1];

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return await Promise.race([
        promise,
        new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))
    ]);
}

const SCORE_UPSERT_BATCH_SIZE = 100;

async function upsertExpertScores(tx: any, scores: Array<{ id: string; value: number }>) {
    for (let start = 0; start < scores.length; start += SCORE_UPSERT_BATCH_SIZE) {
        const values = scores.slice(start, start + SCORE_UPSERT_BATCH_SIZE).map(score => Prisma.sql`(${score.id}, ${score.value})`);
        await tx.$executeRaw(Prisma.sql`
            INSERT INTO "User" ("id", "expertScore") VALUES ${Prisma.join(values)}
            ON CONFLICT ("id") DO UPDATE SET "expertScore" = EXCLUDED."expertScore"
        `);
    }
}

async function upsertContributionScores(tx: any, scores: Array<{ id: string; value: number }>) {
    for (let start = 0; start < scores.length; start += SCORE_UPSERT_BATCH_SIZE) {
        const values = scores.slice(start, start + SCORE_UPSERT_BATCH_SIZE).map(score => Prisma.sql`(${score.id}, ${score.value})`);
        await tx.$executeRaw(Prisma.sql`
            INSERT INTO "User" ("id", "contributionScore") VALUES ${Prisma.join(values)}
            ON CONFLICT ("id") DO UPDATE SET "contributionScore" = EXCLUDED."contributionScore"
        `);
    }
}

function emojiIdentifier(raw: string): string | null {
    const match = raw.match(/<(?:a)?:([^:>]+):(\d+)>/);
    return match ? `${match[1]}:${match[2]}` : null;
}

async function reactIfMissing(message: Message): Promise<number> {
    const up = emojiIdentifier(config.ui.emojis.upvote);
    const down = emojiIdentifier(config.ui.emojis.downvote);
    let added = 0;
    if (up && !message.reactions.cache.some(reaction => reaction.emoji.id === upvoteId)) {
        if (await withTimeout(message.react(up).then(() => true).catch(() => false), 2500, false)) added++;
    }
    if (down && !message.reactions.cache.some(reaction => reaction.emoji.id === downvoteId)) {
        if (await withTimeout(message.react(down).then(() => true).catch(() => false), 2500, false)) added++;
    }
    return added;
}

async function recomputeScoresForAuthors(authorIds: Set<string>): Promise<void> {
    if (!authorIds.size) return;
    await prisma.$transaction(async tx => {
        await lockVoteScores(tx);
        for (const authorId of authorIds) {
            const [expertScore, contribution, requestRatings] = await Promise.all([
                tx.vote.count({
                    where: { targetAuthorId: authorId, channelId: config.channels.showcase, value: 1 }
                }),
                tx.vote.aggregate({
                    where: { targetAuthorId: authorId, channelId: config.channels.share },
                    _sum: { value: true }
                }),
                tx.requestReview.aggregate({
                    where: { targetId: authorId },
                    _sum: { rating: true }
                })
            ]);
            const contributionScore = (contribution._sum.value || 0) + (requestRatings._sum.rating || 0);
            await tx.user.upsert({
                where: { id: authorId },
                update: { expertScore, contributionScore },
                create: { id: authorId, expertScore, contributionScore }
            });
        }
    }, { maxWait: 15_000, timeout: 60_000 });
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

    return prisma.$transaction(async tx => {
        await lockVoteScores(tx);
        let synced = 0;
        const existing = await tx.vote.findMany({
            where: { messageId: message.id },
            select: { voterId: true, value: true, channelId: true, targetAuthorId: true }
        });
        const existingByVoter = new Map(existing.map(vote => [vote.voterId, vote]));

        for (const [voterId, value] of voters) {
            const current = existingByVoter.get(voterId);
            if (!current || current.value !== value || current.channelId !== channelId || current.targetAuthorId !== message.author!.id) {
                synced++;
                await tx.vote.upsert({
                    where: { messageId_voterId: { messageId: message.id, voterId } },
                    update: { channelId, targetAuthorId: message.author!.id, value },
                    create: { messageId: message.id, channelId, targetAuthorId: message.author!.id, voterId, value }
                });
            }
        }

        const currentVoters = [...voters.keys()];
        const deleted = currentVoters.length > 0
            ? await tx.vote.deleteMany({ where: { messageId: message.id, voterId: { notIn: currentVoters } } })
            : await tx.vote.deleteMany({ where: { messageId: message.id } });
        synced += deleted.count;
        return { synced, changed: synced > 0, skipped: false };
    });
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
            reacted += await reactIfMissing(message);

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

    const userIds: string[] = [];
    let after: string | undefined;
    while (true) {
        const users = await withTimeout(
            reaction.users.fetch({ limit: 100, after }).catch(() => null),
            5000,
            null
        );
        if (!users) return null;
        for (const user of users.values()) {
            if (!user.bot && user.id !== message.author?.id) userIds.push(user.id);
        }
        if (users.size < 100) break;
        after = users.last()?.id;
        if (!after) break;
    }
    return userIds;
}

export async function backfillVotesAndScores(client: Client): Promise<{ scanned: number; reacted: number; votes: number; created: number; published: number }> {
    const shareId = config.channels.share;
    const showcaseId = config.channels.showcase;
    const channels = [shareId, showcaseId];
    let scanned = 0;
    let reacted = 0;
    let created = 0;
    let votes = 0;
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
            reacted += await reactIfMissing(message);

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

            const result = await syncVotesForMessage(message, channelId);
            votes += result.synced;
            if (channelId === showcaseId) {
                if (await maybePublishShowcase(client, message)) published++;
            }
        }
    }

    // Vote event handlers acquire the same advisory lock before mutating votes
    // and scores. This makes the grouped snapshot and replacement writes one
    // serialized derived-state operation instead of overwriting a live vote.
    await prisma.$transaction(async tx => {
        await lockVoteScores(tx);
        const [showcaseGroups, shareGroups, requestGroups] = await Promise.all([
            tx.vote.groupBy({
                by: ['targetAuthorId'],
                _count: { _all: true },
                where: { channelId: showcaseId, value: 1 }
            }),
            tx.vote.groupBy({
                by: ['targetAuthorId'],
                _sum: { value: true },
                where: { channelId: shareId }
            }),
            tx.requestReview.groupBy({
                by: ['targetId'],
                _sum: { rating: true }
            })
        ]);
        const expertScores = showcaseGroups.map(score => ({ id: score.targetAuthorId, value: score._count._all }));
        const requestRatings = new Map(requestGroups.map(score => [score.targetId, score._sum.rating || 0]));
        const contributionByAuthor = new Map(shareGroups.map(score => [score.targetAuthorId, score._sum.value || 0]));
        for (const [targetId, rating] of requestRatings) {
            contributionByAuthor.set(targetId, (contributionByAuthor.get(targetId) || 0) + rating);
        }
        const contributionScores = [...contributionByAuthor].map(([id, value]) => ({ id, value }));

        await upsertExpertScores(tx, expertScores);
        await upsertContributionScores(tx, contributionScores);
        await tx.user.updateMany({
            where: expertScores.length ? { id: { notIn: expertScores.map(score => score.id) } } : {},
            data: { expertScore: 0 }
        });
        await tx.user.updateMany({
            where: contributionScores.length ? { id: { notIn: contributionScores.map(score => score.id) } } : {},
            data: { contributionScore: 0 }
        });
    }, { maxWait: 10_000, timeout: 30_000 });

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
