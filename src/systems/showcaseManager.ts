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
        .setTitle('Showcase Voting Active')
        .setDescription(
            `Bài showcase của bạn đang được đưa vào lượt bình chọn nổi bật.\n\n` +
            `Votes needed: **${config.showcase.threshold}** ${config.ui.emojis.star}\n` +
            `Title: **${post.title}**\n` +
            `Post Type: **${post.tagName}**\n` +
            `Status: **${post.status}**\n\n` +
            `Bạn có thể chỉnh title/tag hoặc rút khỏi featured voting.`
        )
        .setImage(config.showcase.controlGif)
        .addFields({ name: 'Bài gốc', value: `[Mở bài showcase](${messageLink(guildId, post.channelId, post.messageId)})` })
        .setFooter({ text: 'Stella Studio - Featured Showcase' })
        .setTimestamp();
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
    return {
        embeds: [buildShowcaseControlEmbed(user, post)],
        components: buildShowcaseControls(messageId, disabled)
    };
}

export async function maybePublishShowcase(client: Client, message: Message): Promise<void> {
    const post = await prisma.showcasePost.findUnique({ where: { messageId: message.id } });
    if (!post || post.status !== 'VOTING') return;

    const plusCount = await prisma.vote.count({
        where: {
            messageId: message.id,
            channelId: config.channels.showcase,
            value: 1,
            voterId: { not: post.authorId }
        }
    });

    if (plusCount < config.showcase.threshold) return;

    const forum = await client.channels.fetch(config.channels.betterShowcase).catch(() => null);
    if (!forum || forum.type !== 15) {
        await sendAdminLog(client, {
            title: 'Showcase publish failed',
            color: '#e74c3c',
            description: `Không tìm thấy forum <#${config.channels.betterShowcase}>.`
        });
        return;
    }

    const forumChannel = forum as ForumChannel;
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

    const thread = await forumChannel.threads.create({
        name: post.title.slice(0, 100),
        appliedTags: tag ? [tag.id] : [],
        message: {
            content
        }
    });

    await prisma.showcasePost.update({
        where: { messageId: message.id },
        data: {
            status: 'PUBLISHED',
            forumThreadId: thread.id,
            publishedAt: new Date()
        }
    });

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
}
