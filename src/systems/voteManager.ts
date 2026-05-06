import { Client, Message, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { messageLink, sendAdminLog } from '../utils/adminLog';
import { maybePublishShowcase } from './showcaseManager';

const upvoteId = config.ui.emojis.upvote.match(/:(\d+)>/)?.[1];
const downvoteId = config.ui.emojis.downvote.match(/:(\d+)>/)?.[1];
const locks = new Map<string, number>();
const LOCK_MS = 2500;

function voteValueFromEmoji(emojiId: string | null): 1 | -1 | null {
    if (emojiId === upvoteId) return 1;
    if (emojiId === downvoteId) return -1;
    return null;
}

function scoreDelta(channelId: string, oldValue: number | null, newValue: number | null): { expert: number; contribution: number } {
    const oldScore = oldValue ?? 0;
    const nextScore = newValue ?? 0;

    if (channelId === config.channels.showcase) {
        return { expert: (nextScore === 1 ? 1 : 0) - (oldScore === 1 ? 1 : 0), contribution: 0 };
    }

    if (channelId === config.channels.share) {
        return { expert: 0, contribution: nextScore - oldScore };
    }

    return { expert: 0, contribution: 0 };
}

async function fetchFullMessage(reaction: MessageReaction | PartialMessageReaction): Promise<Message | null> {
    try {
        if (reaction.partial) await reaction.fetch();
        const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
        return message as Message;
    } catch {
        return null;
    }
}

async function removeOppositeReaction(message: Message, userId: string, value: 1 | -1): Promise<void> {
    const oppositeId = value === 1 ? downvoteId : upvoteId;
    if (!oppositeId) return;
    const opposite = message.reactions.cache.find(r => r.emoji.id === oppositeId);
    await opposite?.users.remove(userId).catch(() => {});
}

export async function handleVoteAdd(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, client: Client): Promise<void> {
    if (user.bot) return;

    const value = voteValueFromEmoji(reaction.emoji.id);
    if (!value) return;

    const message = await fetchFullMessage(reaction);
    if (!message) return;
    if (message.channelId !== config.channels.share && message.channelId !== config.channels.showcase) return;

    if (!message.author || message.author.id === user.id) {
        await reaction.users.remove(user.id).catch(() => {});
        return;
    }

    const lockKey = `${message.id}:${user.id}`;
    const now = Date.now();
    const lockedUntil = locks.get(lockKey) || 0;
    if (lockedUntil > now) {
        await reaction.users.remove(user.id).catch(() => {});
        await sendAdminLog(client, {
            title: 'Vote spam blocked',
            color: '#e67e22',
            fields: [
                { name: 'User', value: `<@${user.id}>`, inline: true },
                { name: 'Message', value: messageLink(message.guildId, message.channelId, message.id) }
            ]
        });
        return;
    }
    locks.set(lockKey, now + LOCK_MS);
    setTimeout(() => {
        if ((locks.get(lockKey) || 0) <= Date.now()) locks.delete(lockKey);
    }, LOCK_MS + 250);

    await removeOppositeReaction(message, user.id, value);

    const existing = await prisma.vote.findUnique({
        where: { messageId_voterId: { messageId: message.id, voterId: user.id } }
    });
    if (existing?.value === value) return;

    const delta = scoreDelta(message.channelId, existing?.value ?? null, value);

    await prisma.$transaction(async tx => {
        await tx.user.upsert({
            where: { id: message.author!.id },
            update: {
                expertScore: { increment: delta.expert },
                contributionScore: { increment: delta.contribution }
            },
            create: {
                id: message.author!.id,
                expertScore: delta.expert,
                contributionScore: delta.contribution
            }
        });

        await tx.vote.upsert({
            where: { messageId_voterId: { messageId: message.id, voterId: user.id } },
            update: { value },
            create: {
                messageId: message.id,
                channelId: message.channelId,
                targetAuthorId: message.author!.id,
                voterId: user.id,
                value
            }
        });
    });

    if (existing && existing.value !== value) {
        await sendAdminLog(client, {
            title: 'Vote changed',
            fields: [
                { name: 'User', value: `<@${user.id}>`, inline: true },
                { name: 'From/To', value: `${existing.value} -> ${value}`, inline: true },
                { name: 'Message', value: messageLink(message.guildId, message.channelId, message.id) }
            ]
        });
    }

    if (message.channelId === config.channels.showcase) {
        await maybePublishShowcase(client, message);
    }
}

export async function handleVoteRemove(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, client: Client): Promise<void> {
    if (user.bot) return;

    const value = voteValueFromEmoji(reaction.emoji.id);
    if (!value) return;

    const message = await fetchFullMessage(reaction);
    if (!message) return;
    if (message.channelId !== config.channels.share && message.channelId !== config.channels.showcase) return;
    if (!message.author || message.author.id === user.id) return;

    const existing = await prisma.vote.findUnique({
        where: { messageId_voterId: { messageId: message.id, voterId: user.id } }
    });
    if (!existing || existing.value !== value) return;

    const delta = scoreDelta(message.channelId, existing.value, null);
    await prisma.$transaction(async tx => {
        await tx.vote.delete({ where: { id: existing.id } });
        await tx.user.upsert({
            where: { id: message.author!.id },
            update: {
                expertScore: { increment: delta.expert },
                contributionScore: { increment: delta.contribution }
            },
            create: {
                id: message.author!.id,
                expertScore: delta.expert,
                contributionScore: delta.contribution
            }
        });
    });
}
