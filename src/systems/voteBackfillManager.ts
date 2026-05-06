import { Client, Message, TextChannel } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { isAllowedShowcaseMessage } from './showcaseManager';
import { getManagedChannelId } from '../utils/managedChannels';
import { sendAdminLog } from '../utils/adminLog';

const upvoteId = config.ui.emojis.upvote.match(/:(\d+)>/)?.[1];
const downvoteId = config.ui.emojis.downvote.match(/:(\d+)>/)?.[1];

function emojiIdentifier(raw: string): string | null {
    const match = raw.match(/<(?:a)?:([^:>]+):(\d+)>/);
    return match ? `${match[1]}:${match[2]}` : null;
}

async function reactIfMissing(message: Message): Promise<void> {
    const up = emojiIdentifier(config.ui.emojis.upvote);
    const down = emojiIdentifier(config.ui.emojis.downvote);
    if (up && !message.reactions.cache.some(reaction => reaction.emoji.id === upvoteId)) {
        await message.react(up).catch(() => {});
    }
    if (down && !message.reactions.cache.some(reaction => reaction.emoji.id === downvoteId)) {
        await message.react(down).catch(() => {});
    }
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

async function collectReactionUserIds(message: Message, emojiId: string | undefined): Promise<string[]> {
    if (!emojiId) return [];
    const reaction = message.reactions.cache.find(item => item.emoji.id === emojiId);
    if (!reaction) return [];
    const users = await reaction.users.fetch().catch(() => null);
    if (!users) return [];
    return users.filter(user => !user.bot && user.id !== message.author?.id).map(user => user.id);
}

export async function backfillVotesAndScores(client: Client): Promise<{ scanned: number; reacted: number; votes: number }> {
    const shareId = config.channels.share;
    const showcaseId = config.channels.showcase;
    const channels = [shareId, showcaseId];
    let scanned = 0;
    let reacted = 0;

    await prisma.vote.deleteMany({});
    await prisma.user.updateMany({ data: { expertScore: 0, contributionScore: 0 } });

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
            }

            const plusUsers = await collectReactionUserIds(message, upvoteId);
            const minusUsers = await collectReactionUserIds(message, downvoteId);
            const voters = new Map<string, number>();
            for (const userId of plusUsers) voters.set(userId, 1);
            for (const userId of minusUsers) {
                if (!voters.has(userId)) voters.set(userId, -1);
            }

            for (const [voterId, value] of voters) {
                await prisma.vote.upsert({
                    where: { messageId_voterId: { messageId: message.id, voterId } },
                    update: { value },
                    create: {
                        messageId: message.id,
                        channelId,
                        targetAuthorId: message.author!.id,
                        voterId,
                        value
                    }
                });
            }
        }
    }

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
    await sendAdminLog(client, {
        title: 'Vote backfill completed',
        color: '#2ecc71',
        fields: [
            { name: 'Scanned', value: `${scanned}`, inline: true },
            { name: 'Reacted', value: `${reacted}`, inline: true },
            { name: 'Votes', value: `${votes}`, inline: true }
        ]
    });

    return { scanned, reacted, votes };
}
