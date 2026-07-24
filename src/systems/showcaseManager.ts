import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    ForumChannel,
    Message,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextChannel,
    User
} from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { messageLink, sendAdminLog } from '../utils/adminLog';
import { adjustScoin } from './scoinManager';
import { queueCrossPostCandidate } from './facebookCrossPostManager';

export function isAllowedShowcaseMessage(message: Message): boolean {
    const hasAttachment = message.attachments.some(att =>
        att.contentType?.startsWith('image/') ||
        att.contentType?.startsWith('video/') ||
        /\.(png|jpe?g|gif|webp|mp4|mov|webm)(\?.*)?$/i.test(att.url)
    );
    const hasLink = /(https?:\/\/[^\s]+)/i.test(message.content);
    return hasAttachment || hasLink;
}

function buildShowcaseControlEmbed(user: User, post: { title: string; tagName: string; status: string; messageId: string; channelId: string }, guildId?: string | null): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(post.status === 'OPTED_OUT' ? '#e74c3c' : '#9b59b6')
        .setAuthor({ name: `${user.username} - Showcase Voting`, iconURL: user.displayAvatarURL() })
        .setTitle('Bình chọn Showcase đang hoạt động')
        .setDescription(
            `Bài showcase của bạn đang được đưa vào vòng bình chọn để lên kênh nổi bật.\n\n` +
            `Cần đạt: **${config.showcase.threshold}** ${config.ui.emojis.star}\n` +
            `Tiêu đề: **${post.title}**\n` +
            `Phân loại: **${post.tagName}**\n` +
            `Trạng thái: **${post.status}**\n\n` +
            `Bạn có thể bấm **Settings** để chỉnh tiêu đề/tag, hoặc **Opt Out** để rút khỏi bình chọn.`
        )
        .setImage(config.showcase.controlGif)
        .addFields({ name: 'Bài gốc', value: `[Mở bài showcase](${messageLink(guildId, post.channelId, post.messageId)})` })
        .setFooter({ text: 'Stella Studio - Showcase nổi bật' })
        .setTimestamp();
}

async function sourceGuildId(client: Client, channelId: string): Promise<string | null> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    return channel && 'guildId' in channel ? String(channel.guildId) : null;
}

function buildShowcaseControls(messageId: string, disabled = false) {
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`showcase_settings_${messageId}`)
            .setLabel('Settings')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`showcase_optout_${messageId}`)
            .setLabel('Opt Out')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled)
    );

    const tagRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`showcase_tag_${messageId}`)
            .setPlaceholder('Chọn tag showcase')
            .setDisabled(disabled)
            .addOptions(config.showcase.tags.map(tag =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(tag)
                    .setValue(tag)
            ))
    );

    return [buttonRow, tagRow];
}

export async function createShowcasePost(message: Message): Promise<void> {
    const title = `Showcase by ${message.author.username}`;
    const post = await prisma.showcasePost.upsert({
        where: { messageId: message.id },
        update: {},
        create: {
            messageId: message.id,
            channelId: message.channelId,
            authorId: message.author.id,
            title,
            tagName: 'Nothing'
        }
    });

    let dmMessageId: string | undefined;
    try {
        const dm = await message.author.send({
            embeds: [buildShowcaseControlEmbed(message.author, post, message.guildId)],
            components: buildShowcaseControls(message.id)
        });
        dmMessageId = dm.id;
        await prisma.showcasePost.update({
            where: { messageId: message.id },
            data: { dmMessageId }
        });
    } catch {
        await sendAdminLog(message.client, {
            title: 'Showcase DM failed',
            color: '#e67e22',
            fields: [
                { name: 'User', value: `<@${message.author.id}>`, inline: true },
                { name: 'Message', value: messageLink(message.guildId, message.channelId, message.id) }
            ]
        });
    }

    await sendAdminLog(message.client, {
        title: 'Showcase voting created',
        fields: [
            { name: 'User', value: `<@${message.author.id}>`, inline: true },
            { name: 'Title', value: title, inline: true },
            { name: 'Message', value: messageLink(message.guildId, message.channelId, message.id) }
        ]
    });
}

export async function updateShowcaseTitle(client: Client, messageId: string, user: User, title: string): Promise<boolean> {
    const post = await prisma.showcasePost.findUnique({ where: { messageId } });
    if (!post || post.authorId !== user.id || post.status !== 'VOTING') return false;

    const updated = await prisma.showcasePost.update({
        where: { messageId },
        data: { title: title.trim().slice(0, 100) || `Showcase by ${user.username}` }
    });

    if (updated.dmMessageId) {
        const [dm, guildId] = await Promise.all([
            user.createDM().catch(() => null),
            sourceGuildId(client, updated.channelId)
        ]);
        const dmMessage = await dm?.messages.fetch(updated.dmMessageId).catch(() => null);
        await dmMessage?.edit({
            embeds: [buildShowcaseControlEmbed(user, updated, guildId)],
            components: buildShowcaseControls(messageId)
        }).catch(() => {});
    }

    await sendAdminLog(client, {
        title: 'Showcase settings updated',
        fields: [
            { name: 'User', value: `<@${user.id}>`, inline: true },
            { name: 'Title', value: updated.title, inline: true },
            { name: 'Tag', value: updated.tagName, inline: true }
        ]
    });
    return true;
}

export async function updateShowcaseTag(client: Client, messageId: string, user: User, tagName: string): Promise<boolean> {
    if (!config.showcase.tags.includes(tagName)) return false;
    const post = await prisma.showcasePost.findUnique({ where: { messageId } });
    if (!post || post.authorId !== user.id || post.status !== 'VOTING') return false;

    await prisma.showcasePost.update({ where: { messageId }, data: { tagName } });
    await sendAdminLog(client, {
        title: 'Showcase tag updated',
        fields: [
            { name: 'User', value: `<@${user.id}>`, inline: true },
            { name: 'Tag', value: tagName, inline: true }
        ]
    });
    return true;
}

export async function optOutShowcase(client: Client, messageId: string, user: User): Promise<boolean> {
    const post = await prisma.showcasePost.findUnique({ where: { messageId } });
    if (!post || post.authorId !== user.id || post.status !== 'VOTING') return false;
    await prisma.showcasePost.update({ where: { messageId }, data: { status: 'OPTED_OUT' } });
    await sendAdminLog(client, {
        title: 'Showcase opted out',
        color: '#e74c3c',
        fields: [{ name: 'User', value: `<@${user.id}>`, inline: true }]
    });
    return true;
}

export async function renderShowcaseControl(client: Client, messageId: string, user: User) {
    const post = await prisma.showcasePost.findUnique({ where: { messageId } });
    if (!post) return null;
    const disabled = post.status !== 'VOTING';
    const guildId = await sourceGuildId(client, post.channelId);
    return {
        embeds: [buildShowcaseControlEmbed(user, post, guildId)],
        components: buildShowcaseControls(messageId, disabled)
    };
}

const SHOWCASE_PUBLISH_LEASE_MS = 5 * 60_000;

function showcasePublicationMarker(messageId: string) {
    return `stella-showcase:${messageId}`;
}

async function findPublishedShowcaseThread(forum: ForumChannel, messageId: string) {
    const active = await (forum.threads as any).fetchActive().catch(() => null);
    const archived = await (forum.threads as any).fetchArchived({ type: 'public', fetchAll: true }).catch(() => null);
    if (!active?.threads || !archived?.threads) return { thread: null, certain: false };
    const marker = showcasePublicationMarker(messageId);
    const threads = [...active.threads.values(), ...archived.threads.values()];
    for (const thread of threads) {
        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (starter?.embeds?.some((embed: any) => embed.footer?.text === marker)) return { thread, certain: true };
    }
    return { thread: null, certain: true };
}

export async function maybePublishShowcase(client: Client, message: Message): Promise<boolean> {
    let post = await prisma.showcasePost.findUnique({ where: { messageId: message.id } });
    if (!post && message.author && message.channelId === config.channels.showcase && isAllowedShowcaseMessage(message)) {
        post = await prisma.showcasePost.upsert({
            where: { messageId: message.id },
            update: {},
            create: {
                messageId: message.id,
                channelId: message.channelId,
                authorId: message.author.id,
                title: `Showcase by ${message.author.username}`,
                tagName: 'Nothing'
            }
        });
    }
    const staleBefore = new Date(Date.now() - SHOWCASE_PUBLISH_LEASE_MS);
    const retryingStalePublish = !!post
        && post.status === 'PUBLISHING'
        && !post.forumThreadId
        && post.updatedAt <= staleBefore;
    if (!post || (post.status !== 'VOTING' && !retryingStalePublish)) return false;

    const plusCount = await prisma.vote.count({
        where: {
            messageId: message.id,
            channelId: config.channels.showcase,
            value: 1,
            voterId: { not: post.authorId }
        }
    });

    if (plusCount < config.showcase.threshold) return false;

    // Claim the one-way publish side effect before creating the forum thread.
    // A stale PUBLISHING lease is safely retried only after reconciliation below.
    const claimed = retryingStalePublish
        ? await prisma.showcasePost.updateMany({
            where: { messageId: message.id, status: 'PUBLISHING', forumThreadId: null, updatedAt: { lte: staleBefore } },
            data: { updatedAt: new Date() }
        })
        : await prisma.showcasePost.updateMany({
            where: { messageId: message.id, status: 'VOTING' },
            data: { status: 'PUBLISHING' }
        });
    if (claimed.count === 0) return false;

    const forum = await client.channels.fetch(config.channels.betterShowcase).catch(() => null);
    if (!forum || forum.type !== 15) {
        await sendAdminLog(client, {
            title: 'Showcase publish failed',
            color: '#e74c3c',
            description: `Không tìm thấy forum <#${config.channels.betterShowcase}>.`
        });
        return false;
    }

    const forumChannel = forum as ForumChannel;
    const discovery = await findPublishedShowcaseThread(forumChannel, message.id);
    if (!discovery.certain) {
        await sendAdminLog(client, {
            title: 'Showcase publish reconciliation deferred',
            color: '#e67e22',
            fields: [{ name: 'Original', value: messageLink(message.guildId, message.channelId, message.id) }]
        }).catch(() => {});
        return false;
    }
    if (discovery.thread) {
        const reconciled = await prisma.showcasePost.updateMany({
            where: { messageId: message.id, status: 'PUBLISHING' },
            data: { status: 'PUBLISHED', forumThreadId: discovery.thread.id, publishedAt: new Date() }
        });
        return reconciled.count === 1;
    }

    const tag = forumChannel.availableTags.find(t => t.name.toLowerCase() === post.tagName.toLowerCase())
        || forumChannel.availableTags.find(t => t.name.toLowerCase() === 'nothing');

    const attachmentLines = message.attachments.map(att => att.url).join('\n');
    const content = [
        `**${post.title}**`,
        `Tác giả: <@${post.authorId}>`,
        message.content || '',
        attachmentLines,
        `[Bài gốc](${messageLink(message.guildId, message.channelId, message.id)})`
    ].filter(Boolean).join('\n\n').slice(0, 1900);

    let thread;
    try {
        thread = await forumChannel.threads.create({
            name: post.title.slice(0, 100),
            appliedTags: tag ? [tag.id] : [],
            message: {
                content,
                embeds: [new EmbedBuilder().setFooter({ text: showcasePublicationMarker(message.id) })],
                allowedMentions: { users: [post.authorId], roles: [], parse: [] }
            }
        });
    } catch (error: any) {
        await sendAdminLog(client, {
            title: 'Showcase publish failed',
            color: '#e74c3c',
            fields: [
                { name: 'User', value: `<@${post.authorId}>`, inline: true },
                { name: 'Votes', value: `${plusCount}`, inline: true },
                { name: 'Error', value: String(error?.message || error).slice(0, 800) },
                { name: 'Original', value: messageLink(message.guildId, message.channelId, message.id) }
            ]
        });
        return false;
    }

    const threadRecorded = await prisma.showcasePost.updateMany({
        where: { messageId: message.id, status: 'PUBLISHING' },
        data: { forumThreadId: thread.id }
    });
    if (threadRecorded.count === 0) {
        await sendAdminLog(client, {
            title: 'Showcase forum thread not checkpointed',
            color: '#e74c3c',
            fields: [{ name: 'Original', value: messageLink(message.guildId, message.channelId, message.id) }, { name: 'Forum', value: `<#${thread.id}>` }]
        }).catch(() => {});
        return false;
    }

    const finalized = await prisma.showcasePost.updateMany({
        where: { messageId: message.id, status: 'PUBLISHING' },
        data: {
            status: 'PUBLISHED',
            forumThreadId: thread.id,
            publishedAt: new Date()
        }
    });
    if (finalized.count === 0) {
        await sendAdminLog(client, {
            title: 'Showcase publish state mismatch',
            color: '#e74c3c',
            fields: [{ name: 'Original', value: messageLink(message.guildId, message.channelId, message.id) }, { name: 'Forum', value: `<#${thread.id}>` }]
        }).catch(() => {});
        return false;
    }

    // Service-action reward: showcase reaching the vote threshold and publishing
    // pays the author once. Gated by the finalized.count===1 atomic transition
    // above, so a re-publish attempt can't double-credit. Ledgered via adjustScoin.
    if (config.rewards.showcasePublished > 0) {
        await adjustScoin(
            post.authorId,
            config.rewards.showcasePublished,
            `Showcase published #${message.id}`,
            'showcase:publish',
            `messageId:${message.id}`
        ).catch(() => {});
    }

    await sendAdminLog(client, {
        title: 'Showcase published',
        color: '#2ecc71',
        fields: [
            { name: 'User', value: `<@${post.authorId}>`, inline: true },
            { name: 'Votes', value: `${plusCount}`, inline: true },
            { name: 'Tag', value: post.tagName, inline: true },
            { name: 'Forum', value: `<#${thread.id}>` },
            { name: 'Original', value: messageLink(message.guildId, message.channelId, message.id) }
        ]
    });

    // Queue an admin-approval Facebook cross-post candidate. No-op (fail-closed)
    // when the feature is disabled or the token/page env vars are unset.
    await queueCrossPostCandidate(client, {
        sourceChannelId: message.channelId,
        sourceMessageId: message.id,
        authorId: post.authorId,
        caption: post.title
    }).catch(() => {});

    const author = await client.users.fetch(post.authorId).catch(() => null);
    await author?.send({
        embeds: [
            new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('Showcase của bạn đã được featured')
                .setDescription(`Bài **${post.title}** đã đạt ${plusCount} plus và được đăng vào <#${thread.id}>.`)
                .setTimestamp()
        ]
    }).catch(() => {});
    return true;
}

export async function publishEligibleShowcases(client: Client, limit = 25): Promise<number> {
    const staleBefore = new Date(Date.now() - SHOWCASE_PUBLISH_LEASE_MS);
    // A stored thread ID means Discord creation succeeded; finish the durable
    // transition. Without an ID, retry the publish after the stale lease expires.
    await prisma.showcasePost.updateMany({
        where: { status: 'PUBLISHING', forumThreadId: { not: null }, updatedAt: { lte: staleBefore } },
        data: { status: 'PUBLISHED', publishedAt: new Date() }
    }).catch(() => {});
    const posts = await prisma.showcasePost.findMany({
        where: {
            channelId: config.channels.showcase,
            OR: [
                { status: 'VOTING' },
                { status: 'PUBLISHING', forumThreadId: null, updatedAt: { lte: staleBefore } }
            ]
        },
        orderBy: { createdAt: 'desc' },
        take: limit
    });

    const channel = await client.channels.fetch(config.channels.showcase).catch(() => null);
    if (!channel || !channel.isTextBased()) return 0;

    let published = 0;
    for (const post of posts) {
        const plusCount = await prisma.vote.count({
            where: {
                messageId: post.messageId,
                channelId: config.channels.showcase,
                value: 1,
                voterId: { not: post.authorId }
            }
        });
        if (plusCount < config.showcase.threshold) continue;

        const message = await (channel as TextChannel).messages.fetch(post.messageId).catch(() => null);
        if (!message) continue;

        if (await maybePublishShowcase(client, message as Message)) published++;
    }

    if (published > 0) {
        await sendAdminLog(client, {
            title: 'Eligible showcases published',
            color: '#2ecc71',
            fields: [{ name: 'Published', value: `${published}`, inline: true }]
        });
    }

    return published;
}
